import { checkStoredLength } from './field-rules'
import { MODULE_BY_KEY, MODULES } from './modules'
import { SEED_ROWS } from './seed'
import {
  RESERVED_FIELDS,
  STORAGE_VERSION,
  type MigrationLog,
  type QuarantineItem,
  type RowIssue,
  type StorageEnvelope,
} from './storage-schema'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// key 沿用既有口径，外层结构从「裸 Record」升级为「带版本的信封」，靠版本号迁移存量。
const STORAGE_KEY = 'district-heating:entries'
// 主存储解析失败时先把原文备份到这里，避免一次解析失败把用户登记的数据冲掉。
const RAW_BACKUP_KEY = `${STORAGE_KEY}:raw-backup`

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowText(): string {
  return new Date().toISOString()
}

let issueSeq = 0

function nextQuarantineId(): string {
  issueSeq += 1
  return `Q-${Date.now().toString(36)}-${issueSeq}`
}

function quarantineItem(
  reason: QuarantineItem['reason'],
  detail: string,
  payload: unknown,
  module?: string,
): QuarantineItem {
  return { id: nextQuarantineId(), reason, detail, payload, module, createdAt: nowText() }
}

function issue(
  module: string,
  rowId: string,
  kind: RowIssue['kind'],
  message: string,
  field?: string,
): RowIssue {
  return { module, rowId, kind, message, field }
}

/** 迁移结果报告：迁移执行一次后固定，重复提交只读取，不再新记。 */
export type MigrationReport = {
  version: number
  migrated: boolean
  log: MigrationLog | null
  issues: RowIssue[]
  quarantine: QuarantineItem[]
}

// ---------- 播种 ----------

/** 播种只认模块清单这一处：存储层不自己维护第二份模块键。 */
export function seedEnvelope(): StorageEnvelope {
  const entries: Record<string, EntryRow[]> = {}
  for (const meta of MODULES) {
    entries[meta.key] = clone(SEED_ROWS[meta.key] ?? [])
  }
  return { version: STORAGE_VERSION, entries, issues: [], quarantine: [], migrations: [] }
}

// ---------- v0（无版本号裸结构）→ v1 ----------

type V0Migration = {
  envelope: StorageEnvelope
  log: MigrationLog
}

function migrateRowV0(
  moduleKey: string,
  raw: unknown,
  resolvedId: { value: number; repaired: boolean },
  issues: RowIssue[],
): EntryRow | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    // 无法逐字段迁移的行返回 null，由调用方按模块隔离保留。
    return null
  }
  const source = raw as Record<string, unknown>
  const meta = MODULE_BY_KEY.get(moduleKey)!
  const rowIssues: RowIssue[] = []

  // id 由调用方统一分配：老数据丢了 id 会拿到不与现有行冲突的临时编号。
  const id = resolvedId.value
  const rowId = String(id)
  if (resolvedId.repaired) {
    rowIssues.push(issue(moduleKey, rowId, 'invalid-id', '记录编号缺失或非法，已补临时编号，请核对'))
  }

  // 固定字段按既有顺序 id/status/pending/abnormal 回填。
  let pending: boolean
  if (typeof source.pending === 'boolean') {
    pending = source.pending
  } else {
    pending = true
    rowIssues.push(issue(moduleKey, rowId, 'missing-reserved', '待处理标记缺失，已先放入待处理清单，请核对', 'pending'))
  }
  let abnormal: boolean
  if (typeof source.abnormal === 'boolean') {
    abnormal = source.abnormal
  } else {
    // 老版本整列丢失 abnormal 时走这里：结构变了的行先按异常候选对待处理复核。
    abnormal = false
    pending = true
    rowIssues.push(issue(moduleKey, rowId, 'missing-reserved', '异常标记缺失，已回填为「否」并列入待处理复核', 'abnormal'))
  }

  let status: string
  if (typeof source.status === 'string' && source.status.trim() !== '') {
    status = source.status
  } else {
    status = meta.statuses[0]
    pending = true
    rowIssues.push(issue(moduleKey, rowId, 'missing-reserved', '「当前状态」缺失，已按初始状态回填，请核对', 'status'))
  }
  if (!meta.statuses.includes(status)) {
    // 状态不在清单里：原值保留，行进待处理人工确认。
    pending = true
    rowIssues.push(issue(moduleKey, rowId, 'invalid-status', `状态「${status}」不在本模块状态清单里，原值已保留，请人工确认`, 'status'))
  }

  const rebuilt: Record<string, string | number | boolean> = { id, status, pending, abnormal }

  // 业务字段按模块清单原顺序回填，保证换台机器打开列顺序一致。
  for (const field of meta.fields) {
    const value = source[field]
    if (value === undefined || value === null) {
      rebuilt[field] = ''
      pending = true
      rowIssues.push(issue(moduleKey, rowId, 'missing-field', `字段「${field}」在旧版数据中不存在，已按原顺序回填空值，请补登`, field))
    } else if (typeof value === 'object') {
      rebuilt[field] = ''
      pending = true
      rowIssues.push(issue(moduleKey, rowId, 'missing-field', `字段「${field}」旧值结构无法识别，已清空待重填`, field))
    } else {
      const stored = value as string | number | boolean
      rebuilt[field] = stored
      const lengthIssue = checkStoredLength(field, stored)
      if (lengthIssue) {
        pending = true
        rowIssues.push(issue(moduleKey, rowId, 'length-invalid', lengthIssue, field))
      }
    }
  }

  // 清单外字段不删：单独标注原因，原值跟在本行后面，人工确认后再处理。
  for (const [field, value] of Object.entries(source)) {
    if (RESERVED_FIELDS.includes(field as (typeof RESERVED_FIELDS)[number]) || meta.fields.includes(field)) {
      continue
    }
    rebuilt[field] =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : JSON.stringify(value)
    rowIssues.push(issue(moduleKey, rowId, 'extra-field', `旧版多出的字段「${field}」不在当前清单中，原值已保留，请确认是否删除`, field))
  }

  rebuilt.pending = pending
  issues.push(...rowIssues)
  return rebuilt as EntryRow
}

export function migrateV0(raw: unknown): V0Migration {
  const issues: RowIssue[] = []
  const quarantine: QuarantineItem[] = []
  const entries: Record<string, EntryRow[]> = {}
  const touchedModules = new Set<string>()

  let source: Record<string, unknown>
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    source = raw as Record<string, unknown>
  } else {
    source = {}
    quarantine.push(quarantineItem('json-unparsable', '旧版存储不是「模块 → 记录列表」的对象结构，无法按模块迁移，已整体隔离', raw))
  }

  for (const meta of MODULES) {
    const rawRows = source[meta.key]
    if (rawRows === undefined) {
      // 老用户比当前版本少整个模块：直接播种，不算迁移触碰。
      entries[meta.key] = clone(SEED_ROWS[meta.key] ?? [])
      continue
    }
    if (!Array.isArray(rawRows)) {
      quarantine.push(
        quarantineItem('module-not-array', `模块「${meta.name}」的存量不是记录列表，已隔离其原值并改用示例数据`, rawRows, meta.key),
      )
      entries[meta.key] = clone(SEED_ROWS[meta.key] ?? [])
      touchedModules.add(meta.key)
      continue
    }
    const rows: EntryRow[] = []
    // 两遍分配 id：先统计合法 id 的最大值，坏 id 再顺延补号，保证不与任何现有行撞号。
    const usedIds = new Set<number>()
    for (const rawRow of rawRows) {
      if (typeof rawRow === 'object' && rawRow !== null && !Array.isArray(rawRow)) {
        const candidate = Number((rawRow as Record<string, unknown>).id)
        if (Number.isFinite(candidate)) {
          usedIds.add(candidate)
        }
      }
    }
    let nextId = usedIds.size ? Math.max(...usedIds) : 0
    rawRows.forEach((rawRow, index) => {
      const original =
        typeof rawRow === 'object' && rawRow !== null && !Array.isArray(rawRow)
          ? Number((rawRow as Record<string, unknown>).id)
          : NaN
      const repaired = !Number.isFinite(original)
      const resolvedId = repaired ? (() => {
        nextId += 1
        while (usedIds.has(nextId)) {
          nextId += 1
        }
        usedIds.add(nextId)
        return nextId
      })() : original
      const migrated = migrateRowV0(meta.key, rawRow, { value: resolvedId, repaired }, issues)
      if (migrated === null) {
        quarantine.push(
          quarantineItem('row-not-object', `模块「${meta.name}」第 ${index + 1} 条记录不是结构化对象，无法逐字段迁移，已单独隔离`, rawRow, meta.key),
        )
        touchedModules.add(meta.key)
        return
      }
      rows.push(migrated)
    })
    if (rows.length !== rawRows.length || issues.some((item) => item.module === meta.key)) {
      touchedModules.add(meta.key)
    }
    entries[meta.key] = rows
  }

  // 清单外的模块键不并入取数：单独说明后隔离保留，不整片丢掉。
  for (const [key, value] of Object.entries(source)) {
    if (MODULE_BY_KEY.has(key) || RESERVED_FIELDS.includes(key as (typeof RESERVED_FIELDS)[number])) {
      continue
    }
    quarantine.push(
      quarantineItem('unknown-module', `存储里的「${key}」不属于当前版本登记的业务模块，无法挂到任何清单，已隔离保留`, value, key),
    )
  }

  const touchedRows = new Set(issues.filter((item) => item.module).map((item) => `${item.module}#${item.rowId}`)).size
  const log: MigrationLog = {
    from: 0,
    to: STORAGE_VERSION,
    migratedAt: nowText(),
    touchedModules: [...touchedModules],
    touchedRows,
  }
  return { envelope: { version: STORAGE_VERSION, entries, issues, quarantine, migrations: [log] }, log }
}

// ---------- 读取与落盘 ----------

function backupRawStorage(raw: string): void {
  try {
    if (window.localStorage.getItem(RAW_BACKUP_KEY) === null) {
      window.localStorage.setItem(RAW_BACKUP_KEY, raw)
    }
  } catch {
    // 备份失败不阻断主流程
  }
}

function loadFromStorage(): { envelope: StorageEnvelope; report: MigrationReport | null } {
  const fallback = seedEnvelope()
  if (typeof window === 'undefined' || !window.localStorage) {
    return { envelope: fallback, report: null }
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === null) {
    persist(fallback)
    return { envelope: fallback, report: null }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 原文先备份：这是用户登记过的数据，不能因为一次解析失败就覆盖掉。
    backupRawStorage(raw)
    const envelope = seedEnvelope()
    const item = quarantineItem(
      'json-unparsable',
      `本地存储内容无法解析（可能写入中断或被其他工具改动），原文已备份到 ${RAW_BACKUP_KEY}，当前先使用示例数据`,
      raw.slice(0, 500),
    )
    envelope.quarantine.push(item)
    persist(envelope)
    return {
      envelope,
      report: {
        version: STORAGE_VERSION,
        migrated: true,
        log: null,
        issues: [],
        quarantine: [item],
      },
    }
  }

  // v0：无版本号的裸结构。
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || !('version' in parsed)) {
    const { envelope, log } = migrateV0(parsed)
    persist(envelope)
    return {
      envelope,
      report: { version: STORAGE_VERSION, migrated: true, log, issues: envelope.issues, quarantine: envelope.quarantine },
    }
  }

  const candidate = parsed as Partial<StorageEnvelope>
  if (typeof candidate.version !== 'number') {
    const envelope = fallback
    envelope.quarantine.push(
      quarantineItem('version-newer', '存储信封缺少有效的版本号，无法确认结构，已隔离并使用示例数据', parsed),
    )
    persist(envelope)
    return { envelope, report: { version: STORAGE_VERSION, migrated: true, log: null, issues: [], quarantine: envelope.quarantine } }
  }
  if (candidate.version > STORAGE_VERSION) {
    // 高版本（换台机器打开了更新版本写出的数据）：不解析、不覆盖、不拼接。
    const item = quarantineItem(
      'version-newer',
      `本地存储结构版本为 v${candidate.version}，高于当前程序支持的 v${STORAGE_VERSION}，数据保持原样不做合并，请升级程序后再打开`,
      parsed,
    )
    const envelope = clone(fallback)
    envelope.quarantine.push(item)
    // 不落盘覆盖原始高版本数据，仅本次会话隔离展示。
    return { envelope, report: { version: STORAGE_VERSION, migrated: true, log: null, issues: [], quarantine: [item] } }
  }
  if (typeof candidate.entries !== 'object' || candidate.entries === null) {
    const envelope = clone(fallback)
    envelope.quarantine.push(
      quarantineItem('json-unparsable', '存储信封里的 entries 不是对象，无法取数，已隔离并使用示例数据', parsed),
    )
    persist(envelope)
    return { envelope, report: { version: STORAGE_VERSION, migrated: true, log: null, issues: [], quarantine: envelope.quarantine } }
  }

  // 同版本：只认模块清单里的键，其余隔离说明，杜绝两套结构拼接。
  const entries: Record<string, EntryRow[]> = {}
  const quarantine: QuarantineItem[] = Array.isArray(candidate.quarantine) ? clone(candidate.quarantine) : []
  const quarantinedModules = new Set(
    quarantine.filter((item) => item.reason === 'unknown-module' || item.reason === 'module-not-array').map((item) => item.module),
  )
  let normalized = false
  for (const meta of MODULES) {
    const rows = (candidate.entries as Record<string, unknown>)[meta.key]
    if (Array.isArray(rows)) {
      entries[meta.key] = clone(rows) as EntryRow[]
    } else {
      // 同版本但单模块内容损坏：隔离说明后播种，不影响其他模块。
      entries[meta.key] = clone(SEED_ROWS[meta.key] ?? [])
      if (!quarantinedModules.has(meta.key)) {
        quarantine.push(
          quarantineItem('module-not-array', `模块「${meta.name}」的存量不是记录列表，已隔离其原值并改用示例数据`, rows, meta.key),
        )
        quarantinedModules.add(meta.key)
        normalized = true
      }
    }
  }
  for (const [key, value] of Object.entries(candidate.entries as Record<string, unknown>)) {
    if (!MODULE_BY_KEY.has(key) && !quarantinedModules.has(key)) {
      quarantine.push(
        quarantineItem('unknown-module', `存储里的「${key}」不属于当前版本登记的业务模块，已隔离保留`, value, key),
      )
      quarantinedModules.add(key)
      normalized = true
    }
  }
  const envelope: StorageEnvelope = {
    version: STORAGE_VERSION,
    entries,
    issues: Array.isArray(candidate.issues) ? clone(candidate.issues) : [],
    quarantine,
    migrations: Array.isArray(candidate.migrations) ? clone(candidate.migrations) : [],
  }
  if (normalized) {
    // 新发现的隔离项要落盘，否则下次打开又重复发现一遍。
    persist(envelope)
  }
  return { envelope, report: null }
}

function persist(envelope: StorageEnvelope): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope))
  } catch {
    // 配额满等情况下静默保留内存态，与既有「能存则存」口径一致
  }
}

let cache: StorageEnvelope | null = null
let lastReport: MigrationReport | null = null

function envelope(): StorageEnvelope {
  if (cache === null) {
    const loaded = loadFromStorage()
    cache = loaded.envelope
    lastReport = loaded.report
  }
  return cache
}

// ---------- 对外取数 / 写入 ----------

export function allRows(): Record<string, EntryRow[]> {
  return envelope().entries
}

export function listRows(key: string): EntryRow[] {
  return envelope().entries[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const current = envelope()
  current.entries[key] = rows
  persist(current)
}

/** 复位只清当前业务模块：其他模块登记数据、迁移记录、隔离区一律不动。 */
export function resetRows(key: string): EntryRow[] {
  const current = envelope()
  const rows = clone(SEED_ROWS[key] ?? [])
  current.entries[key] = rows
  // 本模块的迁移待办随复位一并清空（已经回到示例数据，旧待办没有对应行）。
  current.issues = current.issues.filter((item) => item.module !== key)
  persist(current)
  return rows
}

export function appendRow(key: string, row: EntryRow): void {
  const current = envelope()
  const rows = current.entries[key] ?? []
  current.entries[key] = [...rows, row]
  persist(current)
}

export function nextRowId(key: string): number {
  const rows = listRows(key)
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export function listIssues(moduleKey?: string): RowIssue[] {
  const issues = envelope().issues
  return moduleKey ? issues.filter((item) => item.module === moduleKey) : issues
}

export function listQuarantine(): QuarantineItem[] {
  return envelope().quarantine
}

export function listMigrations(): MigrationLog[] {
  return envelope().migrations
}

/**
 * 迁移状态：首次读取时迁移已经执行并落盘，之后（含手工重复点「重新迁移」）
 * 只返回已有记录，不会再记第二遍。
 */
export function migrationReport(): MigrationReport {
  const current = envelope()
  if (lastReport) {
    return lastReport
  }
  const log = current.migrations.find((item) => item.to === STORAGE_VERSION) ?? null
  return {
    version: current.version,
    migrated: log !== null || current.issues.length > 0 || current.quarantine.length > 0,
    log,
    issues: current.issues,
    quarantine: current.quarantine,
  }
}

/** 重复提交迁移：已在当前版本就是无操作，只回现状，不重复记账。 */
export function rerunMigration(): MigrationReport {
  return migrationReport()
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function rawBackupKey(): string {
  return RAW_BACKUP_KEY
}
