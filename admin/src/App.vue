<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { api, ApiError, session, errorText } from '../../frontend/src/api';
import type { SessionData } from '../../packages/contracts/src/index.js';
import type { AdminDashboard, AdminPage, AdminResource, AdminEntry, AdminService, AdminAuditPage } from '../../packages/contracts/src/admin.js';
import ModalSheet from '../../frontend/src/components/ModalSheet.vue';
import AtlasIcon from './components/AdminIcon.vue';
import AccountsPanel from './components/AccountsPanel.vue';

type Section = 'overview' | 'content' | 'accounts' | 'shares' | 'services' | 'audit';
const sections = [{id:'overview',label:'概览',icon:'grid'}, {id:'content',label:'内容台账',icon:'list'}, {id:'accounts',label:'账号管理',icon:'user'}, {id:'shares',label:'分享管理',icon:'share'}, {id:'services',label:'服务与接入',icon:'settings'}, {id:'audit',label:'操作记录',icon:'clock'}] as const;
const resources: {id:AdminResource;label:string;help:string}[] = [
 {id:'journeys',label:'旅程',help:'查看旅程归属与状态。行程安排继续在使用端编辑。'},
 {id:'photos',label:'照片',help:'查看原图与衍生图的存储台账、拍摄日期及已确认地点；含尚未整理的上传。'},
 {id:'visits',label:'旅程到访',help:'本人主动确认的旅程到访记录；不包含独立录入的城市足迹。'},
 {id:'diaries',label:'图文日记',help:'保留已有日记的状态与归属。照片回忆不要求先写日记。'}
];
function sectionFromHash(): Section { const v=location.hash.slice(1); return sections.some(s=>s.id===v)?v as Section:'overview'; }
const mediaQuery=matchMedia('(max-width:900px)'),compact=ref(mediaQuery.matches);
const resize=()=>{compact.value=mediaQuery.matches;if(!compact.value)menu.value=false;};
const escapeMenu=(event:KeyboardEvent)=>{if(event.key==='Escape')menu.value=false;};
const section=ref<Section>(sectionFromHash()), resource=ref<AdminResource>('journeys'), menu=ref(false);
const initializing=ref(true), loading=ref(false), loginBusy=ref(false), actionBusy=ref(false), error=ref(''), notice=ref(''), username=ref(''), password=ref('');
const dashboard=ref<AdminDashboard|null>(null), catalog=ref<AdminPage|null>(null), services=ref<AdminService[]>([]), audit=ref<AdminAuditPage|null>(null);
const query=ref(''), appliedQuery=ref(''), page=ref(1), selected=ref<AdminEntry|null>(null), revoke=ref<AdminEntry|null>(null), modalError=ref('');
const heading=computed(()=>sections.find(s=>s.id===section.value)!.label), currentResource=computed(()=>section.value==='shares'?'shares':resource.value);
const help=computed(()=>({overview:'整理旅行，也照看这些珍贵的记录。',content:resources.find(r=>r.id===resource.value)?.help??'',accounts:'管理可登录账号及其权限。',shares:'查看已发出的快照，随时收回访问权限。',services:'查看当前服务配置与后续接入方向。',audit:'追溯账号调整、旅程删除与分享撤销等已记录操作。'}[section.value]));
const listing=computed(()=>section.value==='audit'?audit.value:catalog.value);
const labels:Record<string,string>={planning:'计划中',completed:'已完成',archived:'已归档',located:'已定位',place_only:'待补坐标',unlocated:'待定位',hidden:'已隐藏',assigned:'已归属',unassigned:'待补城市',draft:'草稿',written:'已记录',active:'有效',expired:'已到期',revoked:'已撤销',disabled:'账号停用',invalid:'签名失效'};
const actionLabel=(v:string)=>({'user.create':'创建账号','user.update':'更新账号设置','user.password':'重置账号密码','journey.delete':'删除旅程','journey_delete':'删除旅程','share.revoke':'撤销分享'}[v]??v);
const date=(v:string)=>new Date(v).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const bytes=(n:number)=>n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
let generation=0;
async function load() {
 const id=++generation;loading.value=true;error.value='';catalog.value=null;audit.value=null;
 try {
  const suffix=`?page=${page.value}&q=${encodeURIComponent(appliedQuery.value)}`;
  if(section.value==='overview'){const data=await api<AdminDashboard>('/admin/dashboard');if(id===generation)dashboard.value=data;}
  else if(section.value==='content'||section.value==='shares'){const data=await api<AdminPage>('/admin/catalog/'+currentResource.value+suffix);if(id===generation)catalog.value=data;}
  else if(section.value==='services'){const data=await api<AdminService[]>('/admin/services');if(id===generation)services.value=data;}
  else if(section.value==='audit'){const data=await api<AdminAuditPage>('/admin/events'+suffix);if(id===generation)audit.value=data;}
 }catch(e){if(id===generation)error.value=errorText(e);}finally{if(id===generation)loading.value=false;}
}
function navigate(value:Section) { if(section.value===value){menu.value=false;return;} section.value=value; location.hash=value;menu.value=false;query.value='';appliedQuery.value='';page.value=1;selected.value=null;notice.value='';if(session.value?.user.role==='owner')void load(); }
function hashChange(){const next=sectionFromHash();if(next!==section.value)navigate(next);}
watch(menu,async(open)=>{await nextTick();if(open)(document.querySelector('.console-sidebar nav button.active') as HTMLButtonElement|null)?.focus();else if(compact.value)(document.querySelector('.mobile-nav') as HTMLButtonElement|null)?.focus();});
onMounted(async()=>{mediaQuery.addEventListener('change',resize);window.addEventListener('keydown',escapeMenu);window.addEventListener('hashchange',hashChange);try{session.value=await api<SessionData>('/auth/session');if(session.value.user.role==='owner')await load();}catch(e){if(!(e instanceof ApiError&&e.status===401))error.value=errorText(e);}finally{initializing.value=false;}});
onBeforeUnmount(()=>{generation++;mediaQuery.removeEventListener('change',resize);window.removeEventListener('keydown',escapeMenu);window.removeEventListener('hashchange',hashChange);});
watch(resource,()=>{query.value='';appliedQuery.value='';page.value=1;void load();});
async function login(){loginBusy.value=true;error.value='';try{session.value=await api<SessionData>('/auth/login','POST',{username:username.value,password:password.value});password.value='';if(session.value.user.role==='owner')await load();}catch(e){error.value=errorText(e);}finally{loginBusy.value=false;}}
async function logout(){actionBusy.value=true;try{await api('/auth/logout','POST');session.value=null;generation++;selected.value=null;revoke.value=null;dashboard.value=null;catalog.value=null;services.value=[];audit.value=null;}catch(e){error.value=errorText(e);}finally{actionBusy.value=false;}}
function search(){appliedQuery.value=query.value.trim();page.value=1;void load();}
function turn(value:number){page.value=value;void load();}
async function revokeShare(){if(!revoke.value||actionBusy.value)return;actionBusy.value=true;modalError.value='';try{await api('/admin/shares/'+revoke.value.id+'/revoke','POST',{acknowledge:true});revoke.value=null;notice.value='分享已撤销，原链接已不能访问。';await load();}catch(e){modalError.value=errorText(e);}finally{actionBusy.value=false;}}
function inspect(entry:AdminEntry){selected.value=entry;}
</script>
<template>
 <div v-if="initializing" class="admin-boot">正在打开管理端…</div>
 <div v-else-if="!session || session.user.role!=='owner'" class="admin-auth">
  <div class="admin-auth-brand"><span class="brand-mark">迹</span><p>迹屿 <small>管理工作台</small></p></div>
  <section class="admin-login" v-if="!session"><p class="eyebrow">A PLACE FOR EVERY MEMORY</p><h1>照看旅途的每一页</h1><p class="muted">登录独立管理端，管理账号与旅行资料。</p><form @submit.prevent="login"><div class="flow-field"><label for="admin-username">账号</label><input id="admin-username" v-model="username" autocomplete="username" required maxlength="64"></div><div class="flow-field"><label for="admin-password">密码</label><input id="admin-password" v-model="password" type="password" autocomplete="current-password" required maxlength="128"></div><p v-if="error" class="flow-form-errors" role="alert">{{ error }}</p><button class="primary" :disabled="loginBusy">{{ loginBusy?'正在登录…':'进入管理端' }}<span aria-hidden="true">↗</span></button></form><small class="login-footnote">使用已有管理员账号 · 不开放注册</small></section>
  <section v-else class="admin-login"><h1>当前账号没有管理权限</h1><p class="muted">请使用管理员账号登录。</p><button class="secondary-button" :disabled="actionBusy" @click="logout">退出登录</button><p v-if="error" role="alert">{{ error }}</p></section>
  <div class="auth-art" aria-hidden="true"><span>沿途所见<br>皆有所藏。</span><small>TRAVEL ATLAS / PRIVATE COLLECTION</small></div>
 </div>
 <div v-else class="console-shell">
  <button v-if="menu" class="nav-backdrop" aria-label="关闭导航" @click="menu=false"></button>
  <aside class="console-sidebar" :class="{'is-open':menu}" aria-label="管理导航" :inert="compact && !menu"><a href="#overview" class="console-brand" @click.prevent="navigate('overview')"><span class="brand-mark">迹</span><span>迹屿<small>管理工作台</small></span></a><p class="nav-caption">工作空间</p><nav><button v-for="item in sections" :key="item.id" :class="{active:section===item.id}" :aria-current="section===item.id?'page':undefined" @click="navigate(item.id)"><AtlasIcon :name="item.icon"/><span>{{ item.label }}</span><span v-if="section===item.id" class="nav-dot"></span></button></nav><div class="sidebar-bottom"><div class="sidebar-note"><span class="tiny-dot"></span>独立管理入口<p>旅行记录，妥善收藏。</p></div><div class="console-profile"><span class="avatar">{{ session.user.displayName.slice(0,1) }}</span><div><strong>{{ session.user.displayName }}</strong><small>管理员</small></div><button aria-label="退出登录" title="退出登录" :disabled="actionBusy" @click="logout"><AtlasIcon name="logout"/></button></div></div></aside>
  <div class="console-main" :inert="compact && menu"><header class="console-topbar"><button class="mobile-nav icon-button" aria-label="打开导航" :aria-expanded="menu" @click="menu=true"><AtlasIcon name="menu"/></button><div class="breadcrumb">管理工作台 <span>/</span> <strong>{{ heading }}</strong></div><span class="private-label"><span class="tiny-dot"></span>私有空间</span></header>
  <main class="console-body"><div class="page-heading"><div><p class="eyebrow">TRAVEL ATLAS · {{ section.toUpperCase() }}</p><h1>{{ heading }}</h1><p>{{ help }}</p></div><button v-if="section!=='accounts'" class="secondary-button refresh-button" :disabled="loading" @click="load"><AtlasIcon name="refresh"/>刷新</button></div>
  <p v-if="error" class="flow-form-errors console-error" role="alert">{{ error }}<button class="text-button" :disabled="loading" @click="load">重新加载</button></p><p v-if="notice" class="admin-notice" role="status">{{ notice }}</p>
  <template v-if="section==='overview' && dashboard">
   <section class="welcome-card"><div><p>我的旅行资料库</p><h2>让下一次出发，<br class="mobile-break">从容一点。</h2><span>所有数字来自当前数据库，记录会随旅程慢慢生长。</span></div><div class="welcome-motif" aria-hidden="true"><span>迹</span><i></i><b>YOUR WORLD, COLLECTED.</b></div></section>
   <section class="metric-grid" aria-label="资料概览"><button @click="navigate('content');resource='journeys'"><span>旅行计划与记录 <AtlasIcon name="route"/></span><strong>{{ dashboard.journeys }}<small>次旅程</small></strong><em>查看全部旅程 <span>↗</span></em></button><button @click="navigate('content');resource='photos'"><span>收藏的照片 <AtlasIcon name="image"/></span><strong>{{ dashboard.photos }}<small>张照片</small></strong><em>{{ bytes(dashboard.mediaBytes) }} 存储占用<span>↗</span></em></button><button @click="navigate('content');resource='visits'"><span>主动确认的足迹 <AtlasIcon name="pin"/></span><strong>{{ dashboard.visits + dashboard.places }}<small>条记录</small></strong><em>{{ dashboard.visits }} 条旅程到访 · {{ dashboard.places }} 条独立足迹<span>↗</span></em></button><button @click="navigate('shares')"><span>正在分享 <AtlasIcon name="share"/></span><strong>{{ dashboard.activeShares }}<small>个链接</small></strong><em>查看与撤销分享<span>↗</span></em></button></section>
   <div class="overview-columns"><section class="console-card recent-card"><div class="card-heading"><h2>最近整理的旅程</h2><button class="text-button" @click="navigate('content');resource='journeys'">查看全部 ↗</button></div><div v-if="!dashboard.recent.length" class="empty-state"><AtlasIcon name="route"/><h3>旅行资料从第一次出发开始</h3><p>在使用端创建旅程后，这里会显示真实记录。</p></div><button v-for="item in dashboard.recent" :key="item.id" class="recent-row" @click="inspect(item)"><span class="recent-icon"><AtlasIcon name="route"/></span><div><strong>{{ item.title }}</strong><small>{{ item.subtitle }} · {{ item.ownerName }}</small></div><span class="status-badge" :data-state="item.status">{{ labels[item.status] }}</span><time>{{ date(item.updatedAt) }}</time><span aria-hidden="true">↗</span></button></section>
   <section class="console-card housekeeping"><p class="eyebrow">A LITTLE CARE</p><h2>有空时，再整理一下</h2><p>位置与归属可以慢慢补全，不影响已有记录。</p><button @click="navigate('content');resource='photos'"><span>待补精确位置的照片</span><strong>{{ dashboard.attention.unlocatedPhotos }}</strong><span>↗</span></button><button @click="navigate('content');resource='visits'"><span>待补城市的到访</span><strong>{{ dashboard.attention.unassignedVisits }}</strong><span>↗</span></button><div class="housekeeping-note">{{ dashboard.activeUsers }} / {{ dashboard.users }} 个账号启用 · {{ dashboard.diaries }} 篇已有日记<br>{{ dashboard.attention.failedJobs }} 条失败的算路任务记录</div></section></div><p class="checked-at">更新于 {{ date(dashboard.checkedAt) }}</p>
  </template>
  <AccountsPanel v-else-if="section==='accounts'"/>
  <section v-else-if="section==='content'||section==='shares'" class="console-card catalog-card">
   <div v-if="section==='content'" class="resource-tabs" role="tablist" aria-label="资料类型"><button v-for="r in resources" :key="r.id" role="tab" :aria-selected="resource===r.id" :class="{active:resource===r.id}" @click="resource=r.id">{{ r.label }}</button></div>
   <div class="catalog-toolbar"><form class="console-search" role="search" @submit.prevent="search"><AtlasIcon name="search"/><input v-model="query" aria-label="搜索资料" placeholder="搜索名称或所属账号" maxlength="100"><button type="submit" :disabled="loading">搜索</button><button v-if="appliedQuery" type="button" class="clear-search" @click="query='';search()">清除</button></form><span v-if="catalog?.items.length" class="table-hint">左右滑动查看完整台账</span><span v-if="catalog" class="result-count">共 {{ catalog.total }} 条</span></div>
   <p v-if="loading" class="table-loading" role="status">正在读取资料…</p>
   <template v-else-if="catalog"><div v-if="!catalog.items.length" class="empty-state"><AtlasIcon name="search"/><h2>{{ appliedQuery?'没有找到匹配的资料':'这里还没有记录' }}</h2><p>{{ appliedQuery?'试试更短的关键词，或清除搜索条件。':'使用端产生的真实记录会出现在这里。' }}</p></div><div v-else class="table-scroll"><table class="console-table"><thead><tr><th>名称与摘要</th><th>所属账号</th><th>状态</th><th>{{ currentResource==='journeys'||currentResource==='diaries'?'更新时间':'创建时间' }}</th><th><span class="sr-only">操作</span></th></tr></thead><tbody><tr v-for="item in catalog.items" :key="item.id"><td><button class="entry-name" @click="inspect(item)">{{ item.title }}</button><small>{{ item.subtitle }}</small></td><td>{{ item.ownerName }}</td><td><span class="status-badge" :data-state="item.status">{{ labels[item.status]??item.status }}</span></td><td class="time-cell">{{ date(item.updatedAt) }}</td><td><button v-if="currentResource==='shares' && ['active','disabled','invalid'].includes(item.status)" class="revoke-button" @click="revoke=item;modalError=''">撤销</button><button v-else class="text-button" @click="inspect(item)">查看</button></td></tr></tbody></table></div></template>
  </section>
  <div v-else-if="section==='services'" class="service-grid"><article v-for="item in services" :key="item.id" class="console-card service-card"><span class="service-symbol"><AtlasIcon :name="item.id==='amap'||item.id==='routing'?'map':item.id==='sharing'?'share':item.id==='ai'?'spark':item.id==='media'?'image':'settings'"/></span><span class="status-badge" :data-state="item.state">{{ item.label }}</span><h2>{{ item.name }}</h2><p>{{ item.description }}</p><small v-if="item.state==='configured'">配置状态 · 连通性未在此检查</small><small v-else-if="item.state==='planned'">后续阶段</small><small v-else-if="item.state==='unconfigured'">由服务器配置接入</small><small v-else>本次查询已验证</small></article><p class="service-footnote">凭据继续由服务器环境配置管理，页面不显示密钥或数据库连接信息。</p></div>
  <section v-else-if="section==='audit'" class="console-card catalog-card"><div class="catalog-toolbar"><form class="console-search" role="search" @submit.prevent="search"><AtlasIcon name="search"/><input v-model="query" aria-label="搜索操作记录" placeholder="搜索操作代码、账号或目标 ID" maxlength="100"><button :disabled="loading">搜索</button><button v-if="appliedQuery" type="button" @click="query='';search()">清除</button></form><span v-if="audit" class="result-count">共 {{ audit.total }} 条</span></div><p v-if="loading" class="table-loading">正在读取记录…</p><template v-else-if="audit"><div v-if="!audit.items.length" class="empty-state"><AtlasIcon name="clock"/><h2>{{ appliedQuery?'没有匹配的操作':'还没有管理操作记录' }}</h2><p>账号调整、旅程删除和后台分享撤销会记录在这里。</p></div><ol v-else class="event-list"><li v-for="item in audit.items" :key="item.id"><span class="event-dot"></span><div><strong>{{ actionLabel(item.action) }}</strong><small>{{ item.actorName }} <span>→</span> {{ item.targetName }}</small><code>{{ item.action }}</code></div><time>{{ date(item.createdAt) }}</time></li></ol></template></section>
  <nav v-if="listing && listing.total>listing.pageSize && !loading" class="console-pagination" aria-label="资料分页"><span>第 {{ page }} / {{ Math.ceil(listing.total/listing.pageSize) }} 页</span><button :disabled="page<=1" @click="turn(page-1)">上一页</button><button :disabled="page*listing.pageSize>=listing.total" @click="turn(page+1)">下一页</button></nav>
  <p v-if="loading && (section==='overview'||section==='services')" class="table-loading" role="status">正在读取…</p>
  <footer class="console-footer"><span>迹屿 · 把走过的路，留在这里</span><span>私人旅行资料库</span></footer>
  </main></div>
  <ModalSheet v-if="selected" title="资料详情" @close="selected=null"><div class="entry-detail"><span class="status-badge" :data-state="selected.status">{{ labels[selected.status]??selected.status }}</span><h3>{{ selected.title }}</h3><p>{{ selected.subtitle }}</p><dl><div><dt>所属账号</dt><dd>{{ selected.ownerName }}</dd></div><div v-for="field in selected.details" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div><div><dt>记录 ID</dt><dd><code>{{ selected.id }}</code></dd></div></dl><p class="detail-hint">内容整理与位置编辑请在使用端进行。</p></div></ModalSheet>
  <ModalSheet v-if="revoke" title="撤销这个分享？" :busy="actionBusy" @close="revoke=null"><div class="entry-detail"><h3>{{ revoke.title }}</h3><p>撤销后，持有原链接的人将无法继续访问。原始旅程、照片和日记会保留。</p><p v-if="modalError" class="flow-form-errors" role="alert">{{ modalError }}</p></div><template #footer><button class="primary danger-primary" :disabled="actionBusy" @click="revokeShare">{{ actionBusy?'正在撤销…':'确认撤销分享' }}</button></template></ModalSheet>
 </div>
</template>
