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
