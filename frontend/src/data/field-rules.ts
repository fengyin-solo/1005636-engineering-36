/**
 * 字段录入规则：登记提交与存量迁移共用同一份口径。
 * - 提交新记录时违反规则：整单退回重填，不落库
 * - 迁移存量数据时违反规则：原值保留，记入该模块待处理清单，由人工改
 */

export const DEFAULT_MAX_LENGTH = 50

const DATE_MAX_LENGTH = 20

const LONG_TEXT_FIELDS = new Set(['服务内容', '停暖原因', '处理建议', '养护措施', '处理结果'])

const LONG_TEXT_MAX_LENGTH = 200

/** 取值按数字登记的字段：提交时必须能解析成数字。 */
const NUMERIC_FIELDS = new Set(['漏点数量', '应缴金额'])

const DATE_FIELD_PATTERN = /(日期|时间)$/

export function maxLengthForField(field: string): number {
  if (LONG_TEXT_FIELDS.has(field)) {
    return LONG_TEXT_MAX_LENGTH
  }
  if (DATE_FIELD_PATTERN.test(field)) {
    return DATE_MAX_LENGTH
  }
  return DEFAULT_MAX_LENGTH
}

export function isNumericField(field: string): boolean {
  return NUMERIC_FIELDS.has(field)
}

/** 校验单个字段值；合法返回 null，非法返回可直接展示的退回原因。 */
export function validateFieldValue(field: string, value: unknown): string | null {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return `「${field}」不是有效数字，请退回重填`
    }
    return null
  }
  const text = String(value ?? '').trim()
  if (text === '') {
    return `请填写「${field}」后再提交`
  }
  if (isNumericField(field)) {
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) {
      return `「${field}」必须是数字，请退回重填`
    }
  }
  const max = maxLengthForField(field)
  if (text.length > max) {
    return `「${field}」长度不能超过 ${max} 个字符（当前 ${text.length} 个），请退回重填`
  }
  return null
}

/** 迁移存量数据时只做长度检查：空值由缺字段回填逻辑负责，数字字段不拦历史值。 */
export function checkStoredLength(field: string, value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const max = maxLengthForField(field)
  if (value.length > max) {
    return `「${field}」长度 ${value.length} 个字符，超过上限 ${max}，原值已保留，请退回重填`
  }
  return null
}
