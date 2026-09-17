/**
 * md 문서 저장소 — `lib/data/kvStore.ts` 위에 얹은 얇은 CRUD.
 *
 * `createMdDb`가 스토어를 주입받는 형태라 실제 IndexedDB 없이도(단위 테스트 환경) 가짜 스토어로
 * 로직만 검증할 수 있다. 앱 코드는 `mdDb` 싱글턴을 쓴다. 콘솔에는 아무것도 쓰지 않는다
 * (`lib/data/idb.ts` 규약 — kvStore가 이미 지킨다).
 */
import { STORES } from '../../../lib/data/idb'
import { kvStore, type KvStore } from '../../../lib/data/kvStore'

export type MdFileSource = 'file' | 'paste' | 'shell'

export interface MdFileRecord {
  id?: number
  name: string
  content: string
  source: MdFileSource
  /** 마지막으로 열람한 시각(ms) — LRU 판단 기준(`by_opened` 인덱스) */
  openedAt: number
  updatedAt: number
  /** 리더 스크롤 위치 비율(0~1) */
  scrollPos: number
}

/** 열람 이력 상한. 초과분은 가장 오래 전에 연 것부터 지운다(현재 열린 문서는 보호). */
export const MD_MAX_FILES = 20

export interface MdDb {
  getAll(): Promise<MdFileRecord[]>
  getById(id: number): Promise<MdFileRecord | null>
  /**
   * 같은 name+source 레코드가 있으면 내용을 갱신하고, 없으면 새로 만든다.
   * 새로 만든 경우에만 LRU 상한을 적용한다(갱신은 총 개수를 늘리지 않는다).
   */
  saveFile(name: string, content: string, source?: MdFileSource, protectId?: number): Promise<number>
  saveScrollPos(id: number, ratio: number): Promise<void>
  updateContent(id: number, content: string): Promise<void>
  updateName(id: number, name: string): Promise<void>
  deleteFile(id: number): Promise<void>
}

export function createMdDb(store: KvStore<MdFileRecord>): MdDb {
  return {
    async getAll() {
      const all = await store.list()
      return [...all].sort((a, b) => b.openedAt - a.openedAt)
    },

    async getById(id) {
      return store.get(id)
    },

    async saveFile(name, content, source = 'file', protectId) {
      const all = await store.list()
      const existing = all.find((f) => f.name === name && f.source === source)
      const now = Date.now()

      if (existing) {
        await store.put({ ...existing, content, openedAt: now, updatedAt: now })
        return existing.id as number
      }

      const id = await store.put({ name, content, source, openedAt: now, updatedAt: now, scrollPos: 0 })
      const protect = protectId != null ? [protectId, id] : [id]
      await store.enforceLimit(MD_MAX_FILES, 'by_opened', protect)
      return id
    },

    async saveScrollPos(id, ratio) {
      const rec = await store.get(id)
      if (rec) await store.put({ ...rec, scrollPos: ratio })
    },

    async updateContent(id, content) {
      const rec = await store.get(id)
      if (rec) await store.put({ ...rec, content, updatedAt: Date.now() })
    },

    async updateName(id, name) {
      const rec = await store.get(id)
      if (rec) await store.put({ ...rec, name, updatedAt: Date.now() })
    },

    async deleteFile(id) {
      await store.del(id)
    },
  }
}

export const mdDb: MdDb = createMdDb(kvStore<MdFileRecord>(STORES.mdFiles))
