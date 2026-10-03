<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
        <button class="btn ghost" type="button" @click="rerun">重新提交迁移</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>迁移待复核</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>
            <span :class="{ 'error-text': issueCountByModule[row.name] > 0 }">
              {{ issueCountByModule[row.name] ?? 0 }}
            </span>
          </td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <section v-if="migrationLog" class="migration-panel">
      <h3>本地存储结构迁移</h3>
      <p class="page-desc">
        旧版本地数据已从 v{{ migrationLog.from }} 迁移到 v{{ migrationLog.to }}
        （{{ migrationLog.migratedAt }}），触碰 {{ migrationLog.touchedRows }} 条记录、
        {{ migrationLog.touchedModules.length }} 个模块；结果已落到对应模块的待处理清单。
        重复点「重新提交迁移」只返回现有记录，不会再记第二遍。
      </p>
      <p v-if="rerunHint" class="page-desc">{{ rerunHint }}</p>
    </section>

    <section v-if="quarantine.length" class="migration-panel">
      <h3>无法识别的结构（隔离保留，未删除）</h3>
      <table class="data-table">
        <thead>
          <tr><th>类型</th><th>归属</th><th>原因说明</th><th>隔离时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in quarantine" :key="item.id">
            <td>{{ reasonLabel(item.reason) }}</td>
            <td>{{ item.module ?? '—' }}</td>
            <td>{{ item.detail }}</td>
            <td>{{ item.createdAt }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里（{{ storageKey }}，结构 v{{ report.version }}），换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  allIssues,
  getMigrationReport,
  loadOverview,
  rerunMigration,
  storageKey,
} from '@/api/local-service'
import { MODULES } from '@/data/modules'
import type { OverviewResult } from '@/data/types'
import type { QuarantineItem } from '@/data/storage-schema'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const report = ref(getMigrationReport())
const rerunHint = ref('')

const migrationLog = computed(() => report.value.log)
const quarantine = computed<QuarantineItem[]>(() => report.value.quarantine)

const issueCountByModule = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  for (const item of allIssues()) {
    const meta = MODULES.find((module) => module.key === item.module)
    if (!meta) {
      continue
    }
    counts[meta.name] = (counts[meta.name] ?? 0) + 1
  }
  return counts
})

const REASON_LABELS: Record<QuarantineItem['reason'], string> = {
  'unknown-module': '不认识的模块',
  'module-not-array': '模块内容不是记录列表',
  'row-not-object': '单条记录不是对象',
  'version-newer': '结构版本高于当前程序',
  'json-unparsable': '存储内容无法解析',
}

function reasonLabel(reason: QuarantineItem['reason']): string {
  return REASON_LABELS[reason] ?? reason
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  report.value = getMigrationReport()
}

function rerun() {
  report.value = rerunMigration()
  rerunHint.value = '迁移已执行过，本次为重复提交：只回读现有结果，未重复记账。'
}

onMounted(refresh)
</script>
