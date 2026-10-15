/**
 * CSV 문서 저장/불러오기 API.
 *
 * IndexedDB 배관(연결·트랜잭션·에러 정규화)은 `idb.ts`에 있고, 이 파일은 CSV 문서 스토어
 * 두 개만 다룬다. 메타(`docMeta`)와 본문(`docBody`)을 나눈 이유: 문서 목록은 28MB급
 * 페이로드를 역직렬화하지 않고 이름·시각·행수·크기만 읽어야 한다. `putDoc`이 둘을 한
 * 트랜잭션에 쓰는 것도 중요하다 — 용량 초과로 abort되면 반쪽 레코드가 남지 않는다.
 *
 * 콘솔에는 아무것도 쓰지 않는다(`idb.ts` 규약과 동일).
 */

import type { DocBody, DocMeta } from './docSnapshot'
import { STORES, req, withTx } from './idb'

export { DocStoreError, idbUsable, newDocId, storageInfo, type DocStoreErrorCode } from './idb'

const STORE_META = STORES.csvDocMeta
const STORE_BODY = STORES.csvDocBody
const IDX_UPDATED = 'by_updated'

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

/** 본문은 건드리지 않고 메타만 갱신한다 — 같은 내용을 다시 올렸을 때 항목을 최근으로 끌어올린다. */
export async function putDocMeta(meta: DocMeta): Promise<void> {
  await withTx([STORE_META], 'readwrite', (tx) => {
    tx.objectStore(STORE_META).put(meta)
  })
}

/**
 * 문서 수가 `max`를 넘으면 가장 오래 갱신되지 않은 것부터 지운다. `protect`에 든 id는 남긴다
 * (지금 열려 있는 문서·같은 통합 문서의 시트). 지운 개수를 돌려준다.
 */
export async function pruneDocs(max: number, protect: ReadonlySet<string>): Promise<number> {
  try {
    const metas = await listDocs() // 최신 우선
    const victims = metas.slice(max).filter((m) => !protect.has(m.id))
    if (victims.length === 0) return 0
    await withTx([STORE_META, STORE_BODY], 'readwrite', (tx) => {
      for (const m of victims) {
        tx.objectStore(STORE_META).delete(m.id)
        tx.objectStore(STORE_BODY).delete(m.id)
      }
    })
    return victims.length
  } catch {
    return 0
  }
}
