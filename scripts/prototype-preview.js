/* Plain browser JS for the editable OpenDesign export. No API, storage or Vue runtime. */
(() => {
  const page = document.body.dataset.prototypePage || 'index.html';
  const go = file => { location.href = new URL(file, document.baseURI).href; };
  const text = element => (element.textContent || '').replace(/\s+/g, '').trim();
  const isCity = page.startsWith('city');
  const route = element => {
    if (element.dataset.prototypeGo) return element.dataset.prototypeGo;
    const label = element.getAttribute('aria-label') || '', value = text(element);
    if (element.closest('.bottom-nav')) return ({ 地图: 'index.html', 旅程: 'journeys.html', 回忆: 'memories.html', 我的: 'profile.html' })[value];
    if (element.closest('.brand')) return 'index.html';
    if (label === '关闭弹窗') return page.startsWith('map-') ? 'index.html' : 'journey-days.html';
    if (label === '关闭候选列表' || label === '取消选择' || value === '所有回忆') return 'city.html';
    if (label.startsWith('返回')) return /我的/.test(label) ? 'profile.html' : /回忆/.test(label) ? 'memories.html' : /地区图|上一级|地区列表/.test(label) ? 'index.html' : /行程/.test(label) ? 'journey-days.html' : 'journeys.html';
    if (label === '寻找') return 'map-search.html';
    if (label === '时光') return 'map-time.html';
    if (label === '新增足迹或心愿' || /标记去过的地方/.test(value)) return 'map-add.html';
    if (label === '展开旅行记忆' || label === '收起旅行记忆') return page === 'map-cities.html' ? 'index.html' : 'map-cities.html';
    if (label === '展开城市回忆' || label === '收起城市回忆') return page === 'city-memories.html' ? 'city.html' : 'city-memories.html';
    if (label === '地图内容') return 'city-layers.html';
    if (label === '放大地图，进入下一级' || label === '放大地图') return isCity ? 'city-records.html' : page === 'province.html' ? 'city.html' : 'province.html';
    if (label === '缩小地图，返回上一级' || label === '缩小地图') return isCity ? 'province.html' : 'index.html';
    if (/居中|默认地图|全部城市足迹/.test(label)) return isCity ? 'city.html' : 'index.html';
    if (element.closest('.city-cluster-anchor')) return 'city-records.html';
    if (element.closest('.city-marker-anchor,.city-footprint-marker,.city-memory-place')) return 'city-place.html';
    if (element.closest('.city-map-choice')) return page === 'city-routes.html' ? 'city-journey.html' : 'city-place.html';
    if (element.closest('.city-journey-card')) return 'city-journey.html';
    if (element.closest('.atlas-city-card,.atlas-search-results')) return 'city.html';
    if (element.closest('.city-memory') && value.includes('查看回忆')) return 'city-memories.html';
    if (/打开所属行程|打开行程与图文/.test(value)) return 'journey-actual.html';
    if (/新建旅程|创建第一个行程|规划这一程|规划行程/.test(label + value)) return 'journey-new.html';
    if (/行程选项|编辑旅程信息/.test(label)) return 'journey-options.html';
    if (/添加地点|编辑地点/.test(label + value)) return 'journey-stop.html';
    if (value === '世界') return 'world.html';
    if (value === '中国') return 'index.html';
    if (value === '已完成') return 'journeys-completed.html';
    if (value === '计划中') return 'journeys.html';
    if (value === '行程概览') return 'journey-overview.html';
    if (value === '每日安排' || element.closest('.flow-day-overview')) return 'journey-days.html';
    if (value === '计划安排') return 'journey-days.html';
    if (value === '实际记录') return 'journey-actual.html';
    if (value === '日记' || /为这次旅程写日记|写日记|新建日记/.test(label + value)) return 'diary-new.html';
    if (/编辑日记/.test(label + value)) return 'diary-edit.html';
    if (/路线地图与GPX/.test(value)) return 'route-map.html';
    if (value === '分享这次旅程') return 'share.html';
    if (value === '预览访客将看到的内容') return 'share-preview.html';
    if (element.closest('.diary-cards .flow-card')) return 'diary-read.html';
    if (isCity && value === '地点') return 'city-place.html';
    if (isCity && value === '旅程') return 'city-memories.html';
    if (element.closest('.journey-grid .flow-card')) return 'journey-days.html';
    if (element.closest('.memory-grid,.memory-card,.diary-grid,.atlas-diary-row') || /打开日记/.test(label)) return 'diary-read.html';
    if (value.startsWith('我的足迹')) return 'index.html';
    if (value.startsWith('我的心愿')) return 'wishes.html';
    if (value.startsWith('旅行记录')) return 'journeys.html';
    if (value.startsWith('个人设置')) return 'settings.html';
    if (page === 'city-layers.html' && value === '关闭') return 'city.html';
  };
  const notify = () => { document.querySelector('.prototype-message')?.remove(); const message = document.createElement('div'); message.className = 'prototype-message'; message.setAttribute('role', 'status'); message.textContent = '这是页面样式预览，修改不会写入旅行记录。'; document.body.append(message); setTimeout(() => message.remove(), 2600); };
  document.addEventListener('click', event => {
    const element = event.target.closest('button,a,[data-prototype-go]'); if (!element) return;
    if (element.getAttribute('aria-label') === '展开地图工具' || element.getAttribute('aria-label') === '收起地图工具') { const tools = element.closest('.atlas-map-tools'), open = tools.classList.toggle('is-open'); element.setAttribute('aria-label', open ? '收起地图工具' : '展开地图工具'); element.setAttribute('aria-expanded', String(open)); return; }
    const destination = route(element); if (destination) { event.preventDefault(); go(destination); }
    else if (element.tagName === 'BUTTON' && element.type !== 'submit') { event.preventDefault(); notify(); }
    else if (element.tagName === 'A' && element.getAttribute('href') === '#') { event.preventDefault(); notify(); }
  });
  document.addEventListener('submit', event => { event.preventDefault(); notify(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') go(isCity ? 'city.html' : page.startsWith('map-') ? 'index.html' : 'journey-days.html'); });
  document.addEventListener('change', event => { if (event.target.id === 'footprint-region' || event.target.getAttribute('aria-label') === '足迹地区') go('province.html'); });
  for (const dialog of document.querySelectorAll('dialog[open]')) { dialog.removeAttribute('open'); dialog.showModal(); }
  document.querySelector('.private-label')?.replaceChildren('页面目录');
})();
