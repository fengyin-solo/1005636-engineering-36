<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">城市集中供热管网与换热站运行管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向一次二次管网台账、换热站运行、水力平衡调节、热计量抄表、抢修处置、停暖通知与热费结算的一体化城市集中供热运行管理工作台。</span>
        <span class="head-user">当前值班：{{ store.operator }} · {{ store.shiftLabel }}</span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { MODULES } from '@/data/modules'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

// 导航与本地存储取数同走模块清单这一份，新增模块不用再改两处。
const navItems = [
  { label: '运营概览', path: '/' },
  ...MODULES.map((item) => ({ label: item.name, path: `/${item.key}` })),
]
</script>
