/**
 * IndexedDB 배관 — 문서 저장/불러오기의 유일한 저장소 접근 지점.
 *
 * `src/lib/util/storage.ts`(localStorage 래퍼)와 같은 문체를 따른다: 모든 접근을 try/catch로
 * 감싸고, 실패는 값으로 돌려주거나(`idbUsable`) 정규화된 에러로 던진다. **콘솔에는 아무것도
 * 쓰지 않는다** — `tests/e2e.mjs`가 콘솔 에러 1건에도 실패하도록 감시하기 때문에 이건 스타일이
 * 아니라 강제 규칙이다.
 *
 * 메타(`docMeta`)와 본문(`docBody`)을 스토어 두 개로 나눈 이유: 문서 목록은 28MB급 페이로드를
 * 역직렬화하지 않고 이름·시각·행수·크기만 읽어야 한다. `putDoc`이 둘을 한 트랜잭션에 쓰는 것도
 * 중요하다 — 용량 초과로 abort되면 반쪽 레코드가 남지 않는다.
 *
 * 참고: Chrome은 `file://` 페이지를 전부 같은 origin으로 취급한다. 여기 저장한 문서는 사용자가
 * 로컬에서 여는 다른 HTML 파일에도 그대로 보인다 — 단일 HTML 배포 형태에서 감수한 트레이드오프.
 */

import type { DocBody, DocMeta } from './docSnapshot'

const DB_NAME = 'xsv'
const DB_VERSION = 1
const STORE_META = 'docMeta'
const STORE_BODY = 'docBody'
const IDX_UPDATED = 'by_updated'

export type DocStoreErrorCode = 'unavailable' | 'quota' | 'io'

export class DocStoreError extends Error {
  code: DocStoreErrorCode
  constructor(code: DocStoreErrorCode, message: string) {
    super(message)
    this.name = 'DocStoreError'
    this.code = code
  }
}

function normalizeError(e: unknown): DocStoreError {
  if (e instanceof DocStoreError) return e
  const name = e instanceof Error ? e.name : ''
  // Chrome은 용량 초과를 커밋 시점의 트랜잭션 abort로 던지는 경우가 있어, request와 tx
  // 양쪽에서 온 에러를 여기 한 곳에서 정규화한다.
  if (name === 'QuotaExceededError') return new DocStoreError('quota', '저장 공간이 부족합니다')
  const msg = e instanceof Error ? e.message : String(e)
  return new DocStoreError('io', msg)
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (e) {
      reject(normalizeError(e))
      return
    }
    // idempotent — DB_VERSION을 올려도 이미 있는 스토어는 건드리지 않고 새 스토어만 추가되게 한다
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_META)) {
        const store = db.createObjectStore(STORE_META, { keyPath: 'id' })
        store.createIndex(IDX_UPDATED, 'updatedAt')
      }
      if (!db.objectStoreNames.contains(STORE_BODY)) {
        db.createObjectStore(STORE_BODY, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(normalizeError(req.error))
  })
  dbPromise = p
  // 실패한 연결을 캐시해두면 이후 모든 호출이 영원히 실패한다 — 다음 호출이 다시 시도하게 한다
  p.catch(() => {
    dbPromise = null
  })
  return p
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(normalizeError(r.error))
  })
}

function withTx<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let tx: IDBTransaction
        try {
          tx = db.transaction(storeNames, mode)
        } catch (e) {
          reject(normalizeError(e))
          return
        }
        let result: T
        let settled = false
        const fail = (e: unknown) => {
          if (settled) return
          settled = true
          reject(normalizeError(e))
        }
        // onerror와 onabort 둘 다에서 reject한다 — Chrome은 용량 초과를 abort로만 알리기도 한다
        tx.onerror = () => fail(tx.error)
        tx.onabort = () => fail(tx.error ?? new Error('transaction aborted'))
        tx.oncomplete = () => {
          if (!settled) {
            settled = true
            resolve(result)
          }
        }
        Promise.resolve(fn(tx))
          .then((r) => {
            result = r
          })
          .catch(fail)
      }),
  )
}

/** UUID 생성 — 지원 안 하는 환경(구형 브라우저)은 타임스탬프+랜덤으로 폴백한다. */
export function newDocId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

let usableCache: Promise<boolean> | null = null

/**
 * IndexedDB를 실제로 쓸 수 있는지. 메모이즈되어 앱 부팅 시 한 번만 확인한다.
 * Firefox 프라이빗 모드 등 이벤트가 아예 안 오는 환경을 대비해 타임아웃을 둔다.
 */
export function idbUsable(): Promise<boolean> {
  if (usableCache) return usableCache
  usableCache = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(false)
      return
    }
    const timer = setTimeout(() => resolve(false), 3000)
    openDb()
      .then(() => {
        clearTimeout(timer)
        resolve(true)
      })
      .catch(() => {
        clearTimeout(timer)
        resolve(false)
      })
  })
  return usableCache
}

/** 최신 순 문서 목록. 페이로드를 읽지 않으므로 빠르다. */
export async function listDocs(): Promise<DocMeta[]> {
  try {
    const metas = await withTx([STORE_META], 'readonly', (tx) =>
      req(tx.objectStore(STORE_META).index(IDX_UPDATED).getAll()),
    )
    return metas.slice().reverse() // 인덱스는 updatedAt 오름차순 — 최신 우선으로 뒤집는다
  } catch {
    return []
  }
}

export async function getDocMeta(id: string): Promise<DocMeta | null> {
  const v = await withTx([STORE_META], 'readonly', (tx) => req(tx.objectStore(STORE_META).get(id)))
  return v ?? null
}

export async function getDocBody(id: string): Promise<DocBody | null> {
  const v = await withTx([STORE_BODY], 'readonly', (tx) => req(tx.objectStore(STORE_BODY).get(id)))
  return v ?? null
}

/** meta+body를 한 트랜잭션에 쓴다 — 용량 초과로 abort되어도 반쪽 레코드가 남지 않는다. */
export async function putDoc(meta: DocMeta, body: DocBody): Promise<void> {
  await withTx([STORE_META, STORE_BODY], 'readwrite', (tx) => {
    tx.objectStore(STORE_META).put(meta)
    tx.objectStore(STORE_BODY).put(body)
  })
}

export async function deleteDoc(id: string): Promise<void> {
  await withTx([STORE_META, STORE_BODY], 'readwrite', (tx) => {
    tx.objectStore(STORE_META).delete(id)
    tx.objectStore(STORE_BODY).delete(id)
  })
}

/** 브라우저가 보고하는 사용량/할당량. 지원하지 않으면 null. */
export async function storageInfo(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const { usage, quota } = await navigator.storage.estimate()
    if (usage === undefined || quota === undefined) return null
    return { usage, quota }
  } catch {
    return null
  }
}
