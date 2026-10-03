/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 单个业务字段允许填写的最大长度，登记/迁移时超过一律退回重填。 */
export const FIELD_MAX_LENGTH = 50

/** 数据行 id 与字段值允许的基本类型。 */
export type EntryValue = string | number | boolean

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: EntryValue
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 迁移/读取过程中发现的问题：按模块落到待处理清单里，不静默丢数据。 */
export type StorageIssue = {
  /** 问题来源：模块 key、unknown（无法识别的容器）、storage（整包解析失败）。 */
  scope: string
  /** 来源模块名（已知模块时用清单里的名称，便于页面展示）。 */
  scopeName?: string
  /** 数据行编号；容器级问题时为空。 */
  rowId?: number | string
  /** 问题原因，单独说明，不整片丢掉。 */
  reason: string
  /** 问题发生的环节：migrate（存量迁移）或 validate（登记校验）。 */
  stage: 'migrate' | 'validate'
}

/** 无法识别的结构：原件保留并写明原因，等人工核对后再决定去向。 */
export type QuarantineItem = {
  /** 来源：模块 key、unknown、storage。 */
  source: string
  /** 无法识别的原因说明。 */
  reason: string
  /** 原始数据的 JSON 文本，保证不丢。 */
  raw: string
  /** 隔离时间（ISO 字符串）。 */
  at: string
}

/** 一次结构迁移的结果记录，落到各模块的待处理清单。 */
export type MigrationReport = {
  /** 迁移前的结构版本。 */
  fromVersion: number
  /** 迁移到的结构版本。 */
  toVersion: number
  /** 迁移时间（ISO 字符串）。 */
  at: string
  /** 每个模块迁移了多少行、回填了多少字段。 */
  modules: { key: string; name: string; migratedRows: number; backfilledFields: number }[]
  /** 本次迁移发现的问题。 */
  issues: StorageIssue[]
}

/** 本地存储的带版本信封：v2 起统一是这个形状。 */
export type StorageEnvelope = {
  schemaVersion: number
  data: Record<string, EntryRow[]>
  quarantine: QuarantineItem[]
  migrationLog: MigrationReport[]
  migratedAt: string
}
