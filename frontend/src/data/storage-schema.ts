/**
 * 本地数据层的持久化结构。
 *
 * 早期版本直接把 Record<模块key, EntryRow[]> 裸写进 localStorage，行结构改了之后
 * 老数据无法识别，只能整份丢掉。现在外层加版本信封，按版本迁移存量数据：
 * - v0：无版本号的裸结构（上一版线上口径）
 * - v1：带 version 的版本信封，即当前结构
 */
import type { EntryRow } from './types'

export const STORAGE_VERSION = 1

/** 行内的固定字段：不属于任何业务模块的 fields 清单。 */
export const RESERVED_FIELDS = ['id', 'status', 'pending', 'abnormal'] as const

export type RowIssueKind =
  | 'missing-field' // 缺业务字段：按原顺序回填空串
  | 'missing-reserved' // 缺固定字段（status/pending/abnormal）：回填默认值
  | 'invalid-id' // id 缺失/非法：补临时 id
  | 'length-invalid' // 字段长度非法：保留原值，退回人工重填
  | 'extra-field' // 多出不在清单里的字段：原样保留，提示确认
  | 'invalid-status' // 状态不在模块状态清单里：保留原值，提示处理
  | 'row-unparsable' // 整行不是对象：无法逐字段迁移，移入隔离区

export type RowIssue = {
  module: string
  rowId: string
  kind: RowIssueKind
  field?: string
  message: string
}

/** 无法按正常模块/行迁移的结构，单独隔离保留，附原因，不整片丢掉。 */
export type QuarantineItem = {
  id: string
  reason: 'unknown-module' | 'module-not-array' | 'row-not-object' | 'version-newer' | 'json-unparsable'
  module?: string
  detail: string
  payload: unknown
  createdAt: string
}

export type MigrationLog = {
  from: number
  to: number
  migratedAt: string
  touchedModules: string[]
  /** 本次迁移新回填/修复的行数，落进对应模块的待处理清单。 */
  touchedRows: number
}

export type StorageEnvelope = {
  version: number
  entries: Record<string, EntryRow[]>
  issues: RowIssue[]
  quarantine: QuarantineItem[]
  migrations: MigrationLog[]
}
