import { MODULE_BY_KEY, MODULES } from '@/data/modules'
import {
  allRows,
  currentSchemaVersion,
  listIssues,
  listPendingRows,
  listQuarantine,
  listRows,
  migrationReports,
  resetRows,
  runMigration,
  saveRows,
} from '@/data/local-store'
import { FIELD_MAX_LENGTH } from '@/data/types'
import type {
  ActionResult,
  EntryRow,
  MigrationReport,
  ModuleMeta,
  OverviewResult,
  PageResult,
  QuarantineItem,
  StorageIssue,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 字段长度校验：登记、迁移共用同一条上限，超长一律退回重填，不截断入库。
export function validateEntry(
  meta: ModuleMeta,
  values: Record<string, unknown>,
): { ok: boolean; message: string } {
  for (const field of meta.fields) {
    const value = values[field]
    if (typeof value === 'string' && value.length > FIELD_MAX_LENGTH) {
      return {
        ok: false,
        message: `「${field}」长度为 ${value.length}，超过上限 ${FIELD_MAX_LENGTH}，请退回重填`,
      }
    }
    if (
      value !== undefined &&
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      return { ok: false, message: `「${field}」的值不是可登记的文本/数字，请退回重填` }
    }
  }
  return { ok: true, message: '' }
}

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

// 待处理清单：迁移落进来的存量数据和流转中未结案的行都在这里。
export function listPendingEntries(key: string): PageResult {
  const items = listPendingRows(key)
  return { items, total: items.length, page: 1, size: items.length }
}

// 登记新行：按模块清单的字段顺序落库，长度等非法值直接退回重填。
export function createEntry(key: string, values: Record<string, unknown>): ActionResult {
  const meta = moduleMeta(key)
  const invalid = validateEntry(meta, values)
  if (!invalid.ok) {
    return invalid
  }
  const rows = listRows(key)
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const ordered: EntryRow = { id, status: meta.statuses[0], pending: true, abnormal: false }
  for (const field of meta.fields) {
    const value = values[field]
    ordered[field] =
      typeof value === 'string' ? value.trim() : ((value ?? '') as string | number | boolean)
  }
  saveRows(key, [...rows, ordered])
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

// 复位只清当前业务模块：其它模块登记的数据、隔离区、迁移记录都不动。
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
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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

export type MigrationSummary = {
  schemaVersion: number
  reports: MigrationReport[]
  /** 按模块归并的待处理问题，直接挂到各模块的待处理清单上。 */
  issues: (StorageIssue & { scopeName: string })[]
  quarantine: QuarantineItem[]
  /** 隔离区里属于某个模块的条目数。 */
  quarantineByModule: Record<string, number>
}

export function migrationSummary(): MigrationSummary {
  const reports = migrationReports()
  const issues = listIssues().map((issue) => ({
    ...issue,
    scopeName: issue.scopeName ?? MODULE_BY_KEY.get(issue.scope)?.name ?? '未知来源',
  }))
  const quarantine = listQuarantine()
  const quarantineByModule: Record<string, number> = {}
  for (const item of quarantine) {
    quarantineByModule[item.source] = (quarantineByModule[item.source] ?? 0) + 1
  }
  return { schemaVersion: currentSchemaVersion(), reports, issues, quarantine, quarantineByModule }
}

/** 手动触发迁移；没有存量可迁或已迁过都只返回既有记录，重复提交只记一遍。 */
export function triggerMigration(): MigrationReport | null {
  return runMigration()
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = MODULES.map((meta) => {
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
