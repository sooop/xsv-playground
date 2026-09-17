import { describe, expect, it } from 'vitest'
import type { KvStore } from '../src/lib/data/kvStore'
import { createMdDb, MD_MAX_FILES, type MdFileRecord } from '../src/modes/md/lib/db'

/**
 * 메모리 위의 가짜 kvStore. IndexedDB가 없는 vitest 환경에서 `db.ts`의 로직(name+source 중복
 * 판정, LRU 보호)만 순수하게 검증한다 — `enforceLimit`은 실제 `kvStore.ts` 구현과 같은 규칙
 * (오래된 것부터, protect는 건너뜀)을 흉내 낸다.
 */
function fakeStore(): { store: KvStore<MdFileRecord>; rows: Map<number, MdFileRecord> } {
  const rows = new Map<number, MdFileRecord>()
  let seq = 0
  const store: KvStore<MdFileRecord> = {
    async list(index) {
      const all = [...rows.values()]
      if (index === 'by_opened') return all.sort((a, b) => a.openedAt - b.openedAt)
      if (index === 'by_name') return all.sort((a, b) => a.name.localeCompare(b.name))
      return all
    },
    async get(id) {
      return rows.get(id) ?? null
    },
    async findBy(index, value) {
      const key = index === 'by_name' ? 'name' : index
      return [...rows.values()].find((r) => (r as unknown as Record<string, unknown>)[key] === value) ?? null
    },
    async put(value) {
      const id = value.id ?? ++seq
      rows.set(id, { ...value, id })
      return id
    },
    async del(id) {
      rows.delete(id)
    },
    async clear() {
      rows.clear()
    },
    async count() {
      return rows.size
    },
    async enforceLimit(max, index, protect) {
      const keep = new Set(protect ?? [])
      const all = await store.list(index)
      let excess = all.length - max
      if (excess <= 0) return 0
      let removed = 0
      for (const r of all) {
        if (excess <= 0) break
        if (r.id == null || keep.has(r.id)) continue
        rows.delete(r.id)
        removed++
        excess--
      }
      return removed
    },
  }
  return { store, rows }
}

describe('saveFile — name+source 중복 판정', () => {
  it('처음 보는 name+source는 새 레코드를 만든다', async () => {
    const { store } = fakeStore()
    const db = createMdDb(store)
    const id = await db.saveFile('a.md', '# A', 'file')
    const rec = await db.getById(id)
    expect(rec?.name).toBe('a.md')
    expect(rec?.content).toBe('# A')
    expect(rec?.source).toBe('file')
    expect(rec?.scrollPos).toBe(0)
  })

  it('같은 name+source로 다시 저장하면 같은 id를 갱신한다(개수가 늘지 않는다)', async () => {
    const { store } = fakeStore()
    const db = createMdDb(store)
    const id1 = await db.saveFile('a.md', '# A', 'file')
    const id2 = await db.saveFile('a.md', '# A v2', 'file')
    expect(id2).toBe(id1)
    const rec = await db.getById(id1)
    expect(rec?.content).toBe('# A v2')
    expect(await store.count()).toBe(1)
  })

  it('같은 name이라도 source가 다르면 별개 레코드로 취급한다', async () => {
    const { store } = fakeStore()
    const db = createMdDb(store)
    const id1 = await db.saveFile('doc', '파일 내용', 'file')
    const id2 = await db.saveFile('doc', '붙여넣기 내용', 'paste')
    expect(id2).not.toBe(id1)
    expect(await store.count()).toBe(2)
  })

  it('source 기본값은 file이다', async () => {
    const { store } = fakeStore()
    const db = createMdDb(store)
    const id = await db.saveFile('no-source.md', '내용')
    const rec = await db.getById(id)
    expect(rec?.source).toBe('file')
  })
})

describe('LRU 상한 (MAX_FILES)', () => {
  it(`레코드가 ${MD_MAX_FILES}개를 넘으면 가장 오래전에 연 것부터 지운다`, async () => {
    const { store } = fakeStore()
    const db = createMdDb(store)
    // 시각을 명시적으로 통제하기 위해 store에 직접 시드한다(과거 openedAt으로)
    for (let i = 0; i < MD_MAX_FILES; i++) {
      await store.put({ name: `f${i}.md`, content: '', source: 'file', openedAt: i, updatedAt: i, scrollPos: 0 })
    }
    expect(await store.count()).toBe(MD_MAX_FILES)

    const newId = await db.saveFile('new.md', '새 문서', 'file')

    expect(await store.count()).toBe(MD_MAX_FILES)
    const survivors = await db.getAll()
    // 가장 오래된 f0가 사라지고 새 문서는 남아 있어야 한다
    expect(survivors.some((r) => r.name === 'f0.md')).toBe(false)
    expect(survivors.some((r) => r.id === newId)).toBe(true)
  })

  it('protectId로 지정한 레코드는 가장 오래됐어도 삭제되지 않는다', async () => {
    const { store } = fakeStore()
    const db = createMdDb(store)
    const protectedId = await store.put({
      name: 'protected.md',
      content: '',
      source: 'file',
      openedAt: 0, // 가장 오래됨
      updatedAt: 0,
      scrollPos: 0,
    })
    for (let i = 1; i < MD_MAX_FILES; i++) {
      await store.put({ name: `f${i}.md`, content: '', source: 'file', openedAt: i, updatedAt: i, scrollPos: 0 })
    }
    expect(await store.count()).toBe(MD_MAX_FILES)

    await db.saveFile('new.md', '새 문서', 'file', protectedId)

    const survivors = await db.getAll()
    expect(survivors.some((r) => r.id === protectedId)).toBe(true)
    // protected를 지켰으니 그 다음으로 오래된 f1이 대신 지워진다
    expect(survivors.some((r) => r.name === 'f1.md')).toBe(false)
  })

  it('갱신(같은 name+source)은 상한 검사를 다시 하지 않는다 — 개수가 그대로다', async () => {
    const { store } = fakeStore()
    const db = createMdDb(store)
    for (let i = 0; i < MD_MAX_FILES; i++) {
      await store.put({ name: `f${i}.md`, content: '', source: 'file', openedAt: i, updatedAt: i, scrollPos: 0 })
    }
    await db.saveFile('f0.md', '갱신된 내용', 'file')
    expect(await store.count()).toBe(MD_MAX_FILES)
    expect((await db.getAll()).find((r) => r.name === 'f0.md')?.content).toBe('갱신된 내용')
  })
})

describe('scrollPos / content / name 갱신', () => {
  it('saveScrollPos는 다른 필드를 건드리지 않고 scrollPos만 바꾼다', async () => {
    const { store } = fakeStore()
    const db = createMdDb(store)
    const id = await db.saveFile('a.md', '# A', 'file')
    await db.saveScrollPos(id, 0.42)
    const rec = await db.getById(id)
    expect(rec?.scrollPos).toBeCloseTo(0.42)
    expect(rec?.content).toBe('# A')
  })

  it('updateContent는 content와 updatedAt을 갱신한다', async () => {
    const { store } = fakeStore()
    const db = createMdDb(store)
    const id = await db.saveFile('a.md', '# A', 'file')
    const before = (await db.getById(id))?.updatedAt ?? 0
    await new Promise((r) => setTimeout(r, 2))
    await db.updateContent(id, '# A 수정')
    const rec = await db.getById(id)
    expect(rec?.content).toBe('# A 수정')
    expect(rec?.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('updateName은 name만 바꾸고 content는 그대로 둔다', async () => {
    const { store } = fakeStore()
    const db = createMdDb(store)
    const id = await db.saveFile('old.md', '내용', 'file')
    await db.updateName(id, 'new.md')
    const rec = await db.getById(id)
    expect(rec?.name).toBe('new.md')
    expect(rec?.content).toBe('내용')
  })

  it('존재하지 않는 id에 대한 갱신은 조용히 아무 일도 하지 않는다', async () => {
    const { store } = fakeStore()
    const db = createMdDb(store)
    await expect(db.updateContent(999, 'x')).resolves.toBeUndefined()
    await expect(db.updateName(999, 'x')).resolves.toBeUndefined()
    await expect(db.saveScrollPos(999, 0.5)).resolves.toBeUndefined()
  })
})

describe('getAll / deleteFile', () => {
  it('openedAt 내림차순(최신 열람 먼저)으로 돌려준다', async () => {
    const { store } = fakeStore()
    const db = createMdDb(store)
    await store.put({ name: 'old', content: '', source: 'file', openedAt: 1, updatedAt: 1, scrollPos: 0 })
    await store.put({ name: 'newest', content: '', source: 'file', openedAt: 3, updatedAt: 3, scrollPos: 0 })
    await store.put({ name: 'mid', content: '', source: 'file', openedAt: 2, updatedAt: 2, scrollPos: 0 })
    const all = await db.getAll()
    expect(all.map((r) => r.name)).toEqual(['newest', 'mid', 'old'])
  })

  it('deleteFile은 해당 레코드만 지운다', async () => {
    const { store } = fakeStore()
    const db = createMdDb(store)
    const id1 = await db.saveFile('a.md', 'a', 'file')
    const id2 = await db.saveFile('b.md', 'b', 'file')
    await db.deleteFile(id1)
    expect(await db.getById(id1)).toBeNull()
    expect((await db.getById(id2))?.name).toBe('b.md')
  })
})
