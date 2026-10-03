<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常；存量数据迁移结果按模块列在下方。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="runMigrationNow">重新执行迁移</button>
        <button class="btn" type="button" @click="refresh">重新统计</button>
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
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <section v-if="migration.reports.length" class="panel">
      <h3>结构迁移记录（本地数据结构版本 v{{ migration.schemaVersion }}）</h3>
      <p class="page-desc">迁移补齐的缺失字段已按清单原顺序回填；迁移上来的行进入各模块待处理清单，重复执行不会重复登记。</p>
      <table class="data-table">
        <thead>
          <tr><th>模块</th><th>迁移行数</th><th>回填字段数</th></tr>
        </thead>
        <tbody>
          <template v-for="report in migration.reports" :key="report.at">
            <tr v-for="item in report.modules" :key="`${report.at}-${item.key}`">
              <td>{{ item.name }}</td>
              <td>{{ item.migratedRows }}</td>
              <td>{{ item.backfilledFields }}</td>
            </tr>
          </template>
        </tbody>
      </table>
    </section>

    <section v-if="migration.issues.length" class="panel">
      <h3>待处理清单（{{ migration.issues.length }}）</h3>
      <table class="data-table">
        <thead>
          <tr><th>来源模块</th><th>行编号</th><th>环节</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="(issue, index) in dedupIssues" :key="index">
            <td>{{ issue.scopeName }}</td>
            <td>{{ issue.rowId ?? '—' }}</td>
            <td>{{ issue.stage === 'migrate' ? '存量迁移' : '登记校验' }}</td>
            <td>{{ issue.reason }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="migration.quarantine.length" class="panel warn-panel">
      <h3>无法识别的结构（{{ migration.quarantine.length }}，已单独保留，未整片丢弃）</h3>
      <table class="data-table">
        <thead>
          <tr><th>来源</th><th>原因</th><th>原始内容</th></tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in migration.quarantine" :key="index">
            <td>{{ item.source }}</td>
            <td>{{ item.reason }}</td>
            <td><code>{{ item.raw.length > 200 ? `${item.raw.slice(0, 200)}…` : item.raw }}</code></td>
          </tr>
        </tbody>
      </table>
    </section>

    <p v-else-if="!migration.issues.length && !migration.reports.length" class="page-desc">
      首次使用示例数据，没有需要迁移的存量数据。
    </p>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里（按结构版本管理），换浏览器或清缓存会回到示例数据</span>
      <span v-if="migrationNote" class="migration-note">{{ migrationNote }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { loadOverview, migrationSummary, triggerMigration } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const migration = ref(migrationSummary())
const migrationNote = ref('')

const dedupIssues = computed(() => {
  const seen = new Set<string>()
  return migration.value.issues.filter((issue) => {
    const key = `${issue.scope}-${String(issue.rowId ?? '')}-${issue.reason}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
})

function runMigrationNow() {
  const report = triggerMigration()
  migration.value = migrationSummary()
  migrationNote.value = report ? '迁移此前已执行过，未重复登记' : '没有待迁移的存量数据'
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  migration.value = migrationSummary()
}

onMounted(refresh)
</script>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
}
.panel {
  margin-top: 16px;
}
.panel h3 {
  margin: 0 0 8px;
  font-size: 15px;
}
.warn-panel h3 {
  color: #991b1b;
}
.panel code {
  font-size: 12px;
  word-break: break-all;
}
.migration-note {
  color: var(--brand);
}
</style>
