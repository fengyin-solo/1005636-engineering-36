// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MODULE_BY_KEY, MODULES } from './modules'

const STORAGE_KEY = 'district-heating:entries'

type Store = typeof import('./local-store')
type Service = typeof import('@/api/local-service')

function seedLegacy(raw: unknown): void {
  window.localStorage.setItem(STORAGE_KEY, typeof raw === 'string' ? raw : JSON.stringify(raw))
}

function stored(): any {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) as string)
}

async function freshStore(): Promise<Store> {
  vi.resetModules()
  return import('./local-store')
}

describe('本地存储结构版本与迁移', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('首次打开按当前版本播种信封', async () => {
    const store = await freshStore()
    expect(store.currentSchemaVersion()).toBe(2)
    expect(Array.isArray(store.listRows('heatstation'))).toBe(true)
    expect(stored().schemaVersion).toBe(2)
    expect(Array.isArray(stored().data.heatstation)).toBe(true)
    expect(store.migrationReports()).toHaveLength(0)
  })

  it('按版本迁移 v1 存量数据，缺失字段按清单顺序回填', async () => {
    const meta = MODULE_BY_KEY.get('heatstation') as (typeof MODULES)[number]
    seedLegacy({ heatstation: [{ id: 99, 站名: '文化路站' }] })

    const store = await freshStore()
    const rows = store.listRows('heatstation')

    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.id).toBe(99)
    expect(row.站名).toBe('文化路站')
    // 字段顺序与清单一致
    expect(Object.keys(row).slice(4)).toEqual(meta.fields)
    for (const field of meta.fields.slice(1)) {
      expect(row[field]).toBe('')
    }
    // 缺 status 时回填为初始状态；迁移行进入待处理清单
    expect(row.status).toBe(meta.statuses[0])
    expect(row.pending).toBe(true)
    expect(row.abnormal).toBe(false)
    expect(store.listPendingRows('heatstation')).toHaveLength(1)

    const report = store.migrationReports()[0]
    expect(report.fromVersion).toBe(1)
    expect(report.toVersion).toBe(2)
    expect(report.modules[0]).toMatchObject({ key: 'heatstation', migratedRows: 1 })
    expect(report.modules[0].backfilledFields).toBeGreaterThan(0)

    // 落盘已经是 v2 信封，不再是两套结构拼出来的裸对象
    expect(stored().schemaVersion).toBe(2)
  })

  it('已经是新结构的数据不被重算：abnormal 列保留、pending 状态保留', async () => {
    seedLegacy({
      schemaVersion: 2,
      data: {
        heatstation: [
          {
            id: 5,
            status: '运行中',
            pending: false,
            abnormal: true,
            站名: '老站',
            所属片区: '城东',
            供热面积: '',
            换热机组数: '',
            投运日期: '',
            站长: '',
            设计负荷: '',
            站点状态: '',
          },
        ],
      },
      quarantine: [],
      migrationLog: [],
      migratedAt: '',
    })
    const store = await freshStore()
    const row = store.listRows('heatstation')[0]
    expect(row.abnormal).toBe(true)
    expect(row.pending).toBe(false)
    expect(store.migrationReports()).toHaveLength(0)
  })

  it('不认识的模块/行单独隔离并写明原因，不整片丢掉、不混入清单', async () => {
    seedLegacy({
      heatstation: [
        { id: 1, 站名: '合法站' },
        { id: 'x', 站名: '编号非法的站' },
        { id: 3, 站名: 'x'.repeat(51) },
      ],
      ghostmodule: [{ id: 1 }],
    })
    const store = await freshStore()

    expect(store.listRows('heatstation')).toHaveLength(1)
    expect(store.allRows().ghostmodule).toBeUndefined()

    const quarantine = store.listQuarantine()
    const sources = quarantine.map((item) => item.source).sort()
    expect(sources).toEqual(['ghostmodule', 'heatstation', 'heatstation'])
    for (const item of quarantine) {
      expect(item.reason.length).toBeGreaterThan(0)
      expect(item.raw).toBeTruthy()
    }
    expect(store.listIssues().map((issue) => issue.stage)).toContain('migrate')
  })

  it('整包非法 JSON 时原件保留隔离，业务回到示例数据', async () => {
    seedLegacy('{bad json')
    const store = await freshStore()
    expect(store.listRows('heatstation').length).toBeGreaterThan(0)
    expect(store.listQuarantine()[0].source).toBe('storage')
    expect(store.listQuarantine()[0].raw).toContain('{bad')
  })

  it('比当前更高的结构版本整包隔离，不强行拼接', async () => {
    seedLegacy({ schemaVersion: 99, data: { heatstation: [] } })
    const store = await freshStore()
    expect(store.listQuarantine()[0].reason).toContain('v99')
  })

  it('复位只清当前业务模块', async () => {
    seedLegacy({
      heatstation: [{ id: 7, 站名: '甲登记的站' }],
      primarynet: [{ id: 8, 管段编号: 'PRIM-0099' }],
    })
    const store = await freshStore()
    store.resetRows('heatstation')

    expect(store.listRows('heatstation').every((row) => row.id !== 7)).toBe(true)
    // 别的模块登记好的数据不动
    expect(store.listRows('primarynet')[0].id).toBe(8)
  })

  it('重复提交迁移只记一遍', async () => {
    seedLegacy({ heatstation: [{ id: 1, 站名: '站' }] })
    const store = await freshStore()
    const first = store.runMigration()
    const second = store.runMigration()
    expect(store.migrationReports()).toHaveLength(1)
    expect(first).toEqual(second)
  })

  it('拒绝向清单外的模块写入或复位', async () => {
    const store = await freshStore()
    expect(() => store.saveRows('not-a-module', [])).toThrow()
    expect(() => store.resetRows('not-a-module')).toThrow()
  })
})

describe('登记校验：字段长度非法退回重填', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('字段超长不入库并返回原因', async () => {
    vi.resetModules()
    const service: Service = await import('@/api/local-service')
    const before = service.listEntries('heatstation').total
    const result = service.createEntry('heatstation', {
      站名: '超'.repeat(51),
      所属片区: '城东',
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('超过上限')
    // 非法行没有入库，条目数不增加
    expect(service.listEntries('heatstation').total).toBe(before)
  })
})
