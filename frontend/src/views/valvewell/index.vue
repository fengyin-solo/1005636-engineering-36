<template>
  <section class="page" data-module="valvewell">
    <header class="page-head">
      <div>
        <h2>阀门井维护管理</h2>
        <p class="page-desc">维护阀门井，围绕井编号、所属管段、井盖状况、阀门型号做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记阀门井</button>
        <button class="btn" type="button" @click="exportRows">导出阀门井维护清单</button>
        <button class="btn ghost danger" type="button" @click="resetCurrent">复位本模块数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'migrated-row': migrationRowIds.has(String(row.id)) }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}
            <span v-if="migrationRowIds.has(String(row.id))" class="migrate-badge">待迁移复核</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无阀门井维护数据，可先登记阀门井</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条阀门井维护记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
    <ModulePendingPanel :module-key="meta.key" :issues="issues" />
    <EntryCreateDialog v-model:open="dialogOpen" :module-key="meta.key" @saved="onSaved" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import EntryCreateDialog from '@/components/EntryCreateDialog.vue'
import ModulePendingPanel from '@/components/ModulePendingPanel.vue'
import {
  downloadEntries,
  listEntries,
  moduleIssues,
  moduleMeta,
  runAction as applyAction,
  resetModule,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('valvewell')
const columns = meta.fields
const actions = meta.actions
const statuses = meta.statuses
const stats = meta.metrics.map((label) => ({ label, value: 0 }))

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const issues = ref(moduleIssues(meta.key))
const migrationRowIds = computed(
  () => new Set(issues.value.map((item) => String(item.rowId))),
)
const dialogOpen = ref(false)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  dialogOpen.value = true
}

function onSaved() {
  dialogOpen.value = false
  errorMessage.value = ''
  reload()
}

// 复位只动当前业务模块：其他模块登记的数据、迁移记录与隔离内容都不受影响。
function resetCurrent() {
  if (
    !window.confirm(
      `确定只复位「${meta.name}」？该模块将恢复为示例数据，其他模块不受影响。`,
    )
  ) {
    return
  }
  const payload = resetModule(meta.key)
  rows.value = payload.items
  total.value = payload.total
  issues.value = moduleIssues(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    issues.value = moduleIssues(meta.key)
  } catch (error) {
    errorMessage.value = error instanceof Error
      ? error.message
      : '阀门井维护列表读取失败'
  }
}

onMounted(reload)
</script>
