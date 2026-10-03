import { createRouter, createWebHistory } from 'vue-router'

import { MODULES } from '@/data/modules'

import Dashboard from '@/views/Dashboard.vue'

// 模块页面统一由 ModulePage 承接，路由清单也从模块清单生成，三处取数走同一份。
const routes = [
  { path: '/', name: 'dashboard', component: Dashboard },
  ...MODULES.map((meta) => ({
    path: `/${meta.key}`,
    name: meta.key,
    component: () => import(`@/views/${meta.key}/index.vue`),
  })),
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
