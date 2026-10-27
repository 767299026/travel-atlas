import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import JourneyList from './views/JourneyList.vue';
import JourneyCreate from './views/JourneyCreate.vue';
import JourneyEditor from './views/JourneyEditor.vue';
import Profile from './views/Profile.vue';
import Memories from './views/Memories.vue';
import './styles/prototype-layout.css';
import './styles/prototype-base.css';
import './styles/prototype-journeys.css';
import './styles/app.css';
import './styles/atlas.css';
const router = createRouter({ history: createWebHistory(), routes: [
  { path: '/', redirect: '/map' }, { path: '/journeys', component: JourneyList },
  { path: '/map', component: () => import('./views/Footprints.vue') },
  { path: '/wishes', component: () => import('./views/Wishes.vue'), meta: { compact: true } },
  { path: '/settings', component: () => import('./views/Settings.vue'), meta: { compact: true } },
  { path: '/journeys/new', component: JourneyCreate }, { path: '/journeys/:id', component: JourneyEditor },
  { path: '/journeys/:id/actual', component: JourneyEditor },
  { path: '/journeys/:id/map', component: () => import('./views/RouteMap.vue') },
  { path: '/journeys/:id/actual/map', component: () => import('./views/RouteMap.vue') },
  { path: '/journeys/:id/share', component: () => import('./views/JourneyShare.vue') },
  { path: '/s/:id', component: () => import('./views/ShareRead.vue'), meta: { public: true } },
  { path: '/memories', component: Memories }, { path: '/journals', component: () => import('./views/JournalList.vue') },
  { path: '/diaries/new', component: () => import('./views/DiaryEditor.vue') },
  { path: '/diaries/:id', component: () => import('./views/DiaryRead.vue') },
  { path: '/diaries/:id/edit', component: () => import('./views/DiaryEditor.vue') },
  { path: '/me', component: Profile }, { path: '/:pathMatch(.*)*', redirect: '/journeys' },
] });
const app = createApp(App); app.use(router); await router.isReady(); app.mount('#app');
