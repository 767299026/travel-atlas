import { computed, onBeforeUnmount, ref } from 'vue';
import { api, errorText, mutationId, session, ApiError } from './api';
import { clone, type WorkspaceData, type WorkspaceSave, type RouteDay, type RouteStop, type TravelMode } from '../../packages/contracts/src/index.js';
export function useJourneyWorkspace() {
  const data = ref<WorkspaceData>(), loading = ref(false), error = ref(''), saving = ref(false), state = ref<'saved'|'dirty'|'error'|'conflict'>('saved');
  let savedSignature = '', pending: WorkspaceSave | null = null, timer: ReturnType<typeof setTimeout> | undefined, disposed = false, task: Promise<boolean> | null = null;
  const arrivalModes = ref<Record<string, TravelMode>>({});
  const cacheKey = () => 'atlas-workspace:v1:' + session.value?.user.id + ':' + data.value?.journey.id;
  function stopInput(p: RouteStop) { const { id, label, region, time, note, role, location } = p; return { id,label,region,time,note,role,location }; }
  function content() {
    const d=data.value!;
    return { title:d.journey.title,destinations:d.journey.destinations,status:d.journey.status,days:d.route.days.map(day=>({id:day.id,title:day.title,area:day.area,date:day.date,stayName:day.stayName,unscheduled:!!day.unscheduled,stops:day.stops.map(stopInput)})),preferences:clone(d.preferences),arrivalModes:clone(arrivalModes.value) };
  }
  const dirty = computed(() => !!data.value && (state.value !== 'saved' || saving.value));
  function draft() { if(!data.value)return;try{localStorage.setItem(cacheKey(),JSON.stringify({savedAt:Date.now(),data:data.value,arrivalModes:arrivalModes.value,pending,savedSignature}));}catch{error.value='本机草稿无法暂存，请保持页面打开并重试服务器保存。';} }
  function clearDraft() { try{localStorage.removeItem(cacheKey());}catch{} }
  async function load(id:string, restore=true) {
    loading.value=true;error.value='';clearTimeout(timer);
    try { const value=await api<WorkspaceData>('/journeys/'+id+'/workspace');if(disposed)return;data.value=value;
      if(!value.route.days.some(d=>d.unscheduled))value.route.days.unshift({id:mutationId(),title:'待安排',unscheduled:true,area:'',date:null,stayName:'',stops:[]});
      arrivalModes.value=Object.fromEntries(value.route.segments.map(s=>[s.toStopId,s.mode]));savedSignature=JSON.stringify(content());pending=null;state.value='saved';
      if(restore)try{const raw=JSON.parse(localStorage.getItem(cacheKey())||'null');if(raw?.data?.journey?.id===id&&raw.savedAt>Date.now()-7*86400000){data.value=raw.data;arrivalModes.value=raw.arrivalModes;pending=raw.pending;savedSignature=raw.savedSignature;state.value='error';error.value='已恢复待保存草稿，请重试保存；如有版本冲突可先下载草稿核对。';}}catch{}
      else clearDraft();
    }catch(e){error.value=errorText(e);}finally{loading.value=false;}
  }
  async function oneSave():Promise<boolean> {
    if(!data.value)return false;const signature=JSON.stringify(content());if(!pending&&signature===savedSignature){state.value='saved';clearDraft();return true;}
    if(!pending)pending={...clone(content()),journeyVersion:data.value.journey.version,routeVersion:data.value.route.version,clientMutationId:mutationId()};
    const body=pending;draft();saving.value=true;error.value='';
    try{const result=await api<{journeyVersion:number;routeVersion:number}>('/journeys/'+data.value.journey.id+'/workspace','PUT',body);data.value.journey.version=result.journeyVersion;data.value.route.version=result.routeVersion;
      const {journeyVersion:_j,routeVersion:_r,clientMutationId:_m,...saved}=body;savedSignature=JSON.stringify(saved);pending=null;
      if(JSON.stringify(content())===savedSignature){state.value='saved';clearDraft();}else{state.value='dirty';draft();if(!disposed)timer=setTimeout(()=>void save(),120);}return true;
    }catch(e){state.value=e instanceof ApiError&&e.code==='VERSION_CONFLICT'?'conflict':'error';error.value=errorText(e);draft();return false;}finally{saving.value=false;}
  }
  function save():Promise<boolean>{clearTimeout(timer);if(task)return task;task=oneSave().finally(()=>{task=null});return task;}
  async function flush(){clearTimeout(timer);if(task&&!await task)return false;for(let i=0;i<20;i++){if(!data.value)return false;if(!pending&&JSON.stringify(content())===savedSignature)return true;if(!await save())return false;}return false;}
  function change(fn:()=>void){if(!data.value)return;fn();if(state.value!=='conflict')state.value='dirty';draft();clearTimeout(timer);if(state.value!=='conflict')timer=setTimeout(()=>void save(),350);}
  const scheduled=computed(()=>data.value?.route.days.filter(d=>!d.unscheduled)||[]), allPoints=computed(()=>data.value?.route.days.flatMap(d=>d.stops)||[]);
  function exportDraft(){const url=URL.createObjectURL(new Blob([JSON.stringify({data:data.value,arrivalModes:arrivalModes.value,pending},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='journey-draft.json';a.click();URL.revokeObjectURL(url);}
  const beforeUnload=(event:BeforeUnloadEvent)=>{if(dirty.value){draft();event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',beforeUnload);
  onBeforeUnmount(()=>{disposed=true;clearTimeout(timer);if(dirty.value)draft();window.removeEventListener('beforeunload',beforeUnload)});
  return {data,loading,error,saving,state,arrivalModes,dirty,load,change,save,flush,scheduled,allPoints,exportDraft,stopInput};
}
