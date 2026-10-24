import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('./pages/LoginPage.vue') },
    { path: '/workbench', name: 'workbench', component: () => import('./pages/WorkbenchPage.vue') },
    { path: '/', redirect: '/workbench' },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('./pages/NotFoundPage.vue') },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.initialized) {
    await auth.refresh();
  }
  if (to.name !== 'login' && !auth.authenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.name === 'login' && auth.authenticated) {
    return { name: 'workbench' };
  }
  return true;
});
