import { MODULE_BY_KEY, MODULES } from '@/data/modules'
import { validateFieldValue } from '@/data/field-rules'
import {
  allRows,
  appendRow,
  listIssues,
  listMigrations,
  listQuarantine,
  listRows,
  migrationReport,
  nextRowId,
  resetRows,
  saveRows,
  storageKey,
  type MigrationReport,
} from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import type { QuarantineItem, RowIssue } from '@/data/storage-schema'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/**
 * 登记新记录：逐字段按规则校验，任何一个字段长度非法或缺填都整单退回，
 * 返回第一条不通过的原因，不写入存储。
 */
export function createEntry(key: string, form: Record<string, string>): ActionResult {
  const meta = moduleMeta(key)
  for (const field of meta.fields) {
    const message = validateFieldValue(field, form[field] ?? '')
    if (message) {
      return { ok: false, message }
    }
  }
  const row: EntryRow = {
    id: nextRowId(key),
    status: meta.statuses[0],
    pending: true,
    abnormal: false,
  }
  for (const field of meta.fields) {
    row[field] = String(form[field]).trim()
  }
  appendRow(key, row)
  return { ok: true, message: `${meta.entity}已登记，当前状态「${meta.statuses[0]}」` }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/** 复位只回到当前业务模块的示例数据，其他模块登记内容不受影响。 */
export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// ---------- 迁移结果：各模块待处理清单 + 不认识结构的隔离说明 ----------

export function moduleIssues(key: string): RowIssue[] {
  return listIssues(key)
}

/** 迁移触碰过的记录编号：这些行进了本模块待处理清单，需要人工逐条复核。 */
export function pendingMigrationRowIds(key: string): Set<string> {
  return new Set(moduleIssues(key).map((item) => String(item.rowId)))
}

export function allIssues(): RowIssue[] {
  return listIssues()
}

export function quarantineItems(): QuarantineItem[] {
  return listQuarantine()
}

export function getMigrationReport(): MigrationReport {
  return migrationReport()
}

export function rerunMigration(): MigrationReport {
  return migrationReport()
}

export { listMigrations, storageKey }

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

/** 模块清单与本地存储取同一份键：页面与存储都只认 MODULES。 */
export function knownModuleKeys(): string[] {
  return MODULES.map((item) => item.key)
}
