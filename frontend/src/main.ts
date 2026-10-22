import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import JourneyList from './views/JourneyList.vue';
import JourneyCreate from './views/JourneyCreate.vue';
import JourneyEditor from './views/JourneyEditor.vue';
import Profile from './views/Profile.vue';
import './styles/prototype-layout.css';
import './styles/prototype-base.css';
import './styles/prototype-journeys.css';
import './styles/app.css';
const router = createRouter({ history: createWebHistory(), routes: [
  { path: '/', redirect: '/journeys' }, { path: '/journeys', component: JourneyList },
  { path: '/journeys/new', component: JourneyCreate }, { path: '/journeys/:id', component: JourneyEditor },
  { path: '/me', component: Profile }, { path: '/:pathMatch(.*)*', redirect: '/journeys' },
] });
createApp(App).use(router).mount('#app');
