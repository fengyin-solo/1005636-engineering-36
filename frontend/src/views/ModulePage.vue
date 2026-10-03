<template>
  <section class="page" :data-module="meta.key">
    <header class="page-head">
      <div>
        <h2>{{ meta.name }}管理</h2>
        <p class="page-desc">{{ meta.desc }}</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记{{ meta.entity }}</button>
        <button class="btn" type="button" @click="exportRows">导出{{ meta.name }}清单</button>
        <button class="btn ghost" type="button" @click="resetCurrent">复位本模块</button>
      </div>
    </header>

    <div v-if="moduleIssues.length" class="notice-bar">
      <strong>存量数据迁移提示（{{ moduleIssues.length }} 条，已进入待处理清单）：</strong>
      <ul>
        <li v-for="(issue, index) in dedupIssues" :key="index">
          <template v-if="issue.rowId !== undefined">编号 {{ issue.rowId }}：</template>{{ issue.reason }}
        </li>
      </ul>
    </div>
    <div v-if="quarantineCount" class="notice-bar warn">
      本模块有 {{ quarantineCount }} 处无法识别的结构被单独隔离保留，未并入清单，请到运营概览查看原因。
    </div>

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
      <label class="filter-item pending-toggle">
        <input v-model="onlyPending" type="checkbox" @change="reload" />
        <span>只看待处理（{{ pendingCount }}）</span>
      </label>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>待处理</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span v-if="row.pending" class="badge pending">待处理</span>
            <span v-else class="badge done">已结案</span>
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
          <td :colspan="columns.length + 3" class="empty-state">
            暂无{{ meta.name }}数据，可先登记{{ meta.entity }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条{{ meta.name }}记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3>登记{{ meta.entity }}</h3>
        <p class="page-desc">字段按模块清单顺序填写，单个字段最长 {{ fieldMaxLength }} 字，超长会退回重填。</p>
        <label v-for="field in columns" :key="field" class="form-item">
          <span>{{ field }}</span>
          <input
            v-model="draft[field]"
            :maxlength="fieldMaxLength"
            :placeholder="`请输入${field}`"
          />
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="submit">提交登记</button>
          <button class="btn ghost" type="button" @click="closeCreate">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createEntry,
  downloadEntries,
  listEntries,
  migrationSummary,
  moduleMeta,
  resetModule,
  runAction as applyAction,
} from '@/api/local-service'
import { FIELD_MAX_LENGTH } from '@/data/types'
import type { EntryRow } from '@/data/types'

const props = defineProps<{ moduleKey: string }>()

// 页面结构全部取模块清单这一份：字段、动作、状态、指标都不在页面里另写。
const meta = moduleMeta(props.moduleKey)
const columns = meta.fields
const actions = meta.actions
const fieldMaxLength = FIELD_MAX_LENGTH

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const onlyPending = ref(false)
const filterFields = columns.slice(0, 3)

const summary = migrationSummary()
const moduleIssues = computed(() => summary.issues.filter((issue) => issue.scope === meta.key))
const dedupIssues = computed(() => {
  const seen = new Set<string>()
  return moduleIssues.value.filter((issue) => {
    const key = `${String(issue.rowId ?? '')}-${issue.reason}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
})
const quarantineCount = computed(() => summary.quarantineByModule[meta.key] ?? 0)
const pendingCount = computed(() => rows.value.filter((row) => row.pending).length)

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 指标卡取值：指标名里带哪个状态就统计哪个状态，带不上就显示总量，口径与清单同源。
const stats = computed(() =>
  meta.metrics.map((label) => {
    const matched = meta.statuses.find((status) => label.includes(status))
    return {
      label,
      value: matched
        ? rows.value.filter((row) => String(row.status) === matched).length
        : rows.value.length,
    }
  }),
)

const creating = ref(false)
const draft = reactive<Record<string, string>>({})
const formError = ref('')

function resetFilters() {
  filters.value = {}
  onlyPending.value = false
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  for (const field of columns) {
    draft[field] = ''
  }
  formError.value = ''
  creating.value = true
}

function closeCreate() {
  creating.value = false
}

function submitCreate() {
  const result = createEntry(meta.key, { ...draft })
  if (!result.ok) {
    // 字段长度等非法值：不入库、不关窗，直接标红让用户退回重填。
    formError.value = result.message
    return
  }
  creating.value = false
  reload()
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

function resetCurrent() {
  errorMessage.value = ''
  const ok = window.confirm(`复位只会清空「${meta.name}」本模块的数据并回到示例，其它模块不受影响，确认继续？`)
  if (!ok) {
    return
  }
  const payload = resetModule(meta.key)
  rows.value = payload.items
  total.value = payload.total
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    const items = onlyPending.value ? payload.items.filter((row) => row.pending) : payload.items
    rows.value = items
    total.value = items.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : `${meta.name}列表读取失败`
  }
}

onMounted(reload)
</script>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
}
.notice-bar {
  background: #fff7ed;
  border: 1px solid #fdba74;
  color: #9a3412;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
}
.notice-bar.warn {
  background: #fef2f2;
  border-color: #fca5a5;
  color: #991b1b;
}
.notice-bar ul {
  margin: 6px 0 0;
  padding-left: 18px;
}
.pending-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}
.pending-toggle input {
  margin: 0;
}
.badge {
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
}
.badge.pending {
  background: #fef3c7;
  color: #92400e;
}
.badge.done {
  background: #dcfce7;
  color: #166534;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  width: 460px;
  max-height: 80vh;
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
}
.modal-card h3 {
  margin: 0 0 4px;
}
.form-item {
  display: block;
  margin: 8px 0;
}
.form-item span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 2px;
}
.form-item input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
