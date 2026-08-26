import { parseChunked } from '../parse/csv'
import { serialize } from '../parse/serialize'
import { baseName } from '../util/format'
import type { Dataset } from './dataset.svelte'
import type { ColType, Delimiter } from './types'

/** 저장 레코드의 스키마 버전. 형태를 바꿀 때 올리고 {@link migrateBody}에 이행 경로를 더한다. */
export const DOC_SCHEMA_V = 1

/**
 * 저장 페이로드 전용 구분자. `ds.delimiter`(표시·내보내기용)와는 별개다.
 * 콤마보다 셀 값에 등장할 확률이 훨씬 낮아 minimal 인용이 실제로 minimal하게 유지된다.
 */
export const PAYLOAD_DELIM = '\t'

/** 문서 목록에 필요한 가벼운 메타데이터 — 페이로드를 역직렬화하지 않고 읽는다. */
export interface DocMeta {
  id: string
  v: number
  name: string
  createdAt: number
  updatedAt: number
  rowCount: number
  colCount: number
  /** 페이로드 UTF-8 바이트 수 */
  bytes: number
  fileName: string
  delimiter: Delimiter
}

/** 문서 전체 — 열 때만 읽는다. */
export interface DocBody {
  id: string
  v: number
  /** 데이터 행만 담은 UTF-8 직렬화 (PAYLOAD_DELIM 구분). 문자열로 두면 한글이 2배 크기로 적재된다. */
  payload: Uint8Array
  header: string[]
  /** 헤더 토글 왕복용 원본 1행. 헤더 없는 문서는 null. */
  firstRow: string[] | null
  colOrder: number[]
  colWidths: number[]
  colTypes: ColType[]
  delimiter: Delimiter
  hasHeader: boolean
  fileName: string
  rowCount: number
}

/** `Dataset.loadSnapshot`의 입력 — 페이로드를 다시 파싱해 데이터 행과 열 상태를 합친 것. */
export interface DocSnapshot {
  rows: string[][]
  header: string[]
  firstRow: string[] | null
  colOrder: number[]
  colWidths: number[]
  colTypes: ColType[]
  delimiter: Delimiter
  hasHeader: boolean
  fileName: string
}

/**
 * 현재 데이터셋을 저장 레코드로 직렬화한다.
 *
 * `rows`를 structured clone으로 그대로 저장하지 않고 텍스트로 직렬화하는 이유: 10만 행급에서
 * `IDBObjectStore.put()`은 2.5M개 문자열 그래프를 **동기적으로** clone하므로 진행률을 끼워 넣을
 * 방법이 없다(수 초간 완전 정지). 텍스트 경로는 이미 내보내기가 쓰는 `serialize()` + 네이티브
 * `TextEncoder` 한 패스로 끝나고, 여는 쪽에서는 파일 열기와 똑같은 `parseChunked` 진행률을 그대로
 * 재사용할 수 있다.
 *
 * `header`/`firstRow`/`colOrder`/`colWidths`/`colTypes`는 페이로드에 넣지 않고 별도 필드로 둔다 —
 * 그래야 여는 쪽이 `finalize`/`normalizeHeader`를 다시 타지 않고, 사용자가 손으로 바꾼 칼럼명
 * (중복·빈 이름 포함)이 글자 그대로 복원된다.
 */
export function packDoc(
  ds: Dataset,
  at: { id: string; name: string; createdAt: number; now: number },
): { meta: DocMeta; body: DocBody } {
  // 1열 표는 유일하게 위험하다: CsvParser.endRow()는 인용 안 된 단일 빈 필드 행을
  // 빈 줄로 보고 버린다. 열이 2개 이상이면 전부 빈 행도 구분자가 남아 필드 수가 2 이상이라
  // 살아남지만, 1열은 그렇지 않으므로 그때만 항상 인용해 빈 행을 `""`로 지켜낸다.
  const quoting = ds.colCount === 1 ? 'always' : 'minimal'
  const text = serialize(ds.rows, { delimiter: PAYLOAD_DELIM, quoting, newline: '\n' })
  const payload = new TextEncoder().encode(text)

  const body: DocBody = {
    id: at.id,
    v: DOC_SCHEMA_V,
    payload,
    header: ds.header.slice(),
    firstRow: ds.firstRow ? ds.firstRow.slice() : null,
    colOrder: ds.colOrder.slice(),
    colWidths: ds.colWidths.slice(),
    colTypes: ds.colTypes.slice(),
    delimiter: ds.delimiter,
    hasHeader: ds.hasHeader,
    fileName: ds.fileName,
    rowCount: ds.rowCount,
  }
  const meta: DocMeta = {
    id: at.id,
    v: DOC_SCHEMA_V,
    name: at.name,
    createdAt: at.createdAt,
    updatedAt: at.now,
    rowCount: ds.rowCount,
    colCount: ds.colCount,
    bytes: payload.byteLength,
    fileName: ds.fileName,
    delimiter: ds.delimiter,
  }
  return { meta, body }
}

/**
 * 저장 레코드를 데이터셋 스냅샷으로 복원한다.
 *
 * `lostRows`는 정상 동작에서 항상 0이다 — `packDoc`의 인용 규칙이 지켜지는 한 행이 유실될 수
 * 없으므로, 0이 아니면 직렬화 규약이 깨졌다는 뜻이다(장래 회귀를 잡는 무료 어서션).
 */
export async function unpackDoc(
  body: DocBody,
  onProgress?: (ratio: number, rows: number) => void,
): Promise<{ snapshot: DocSnapshot; lostRows: number }> {
  const text = new TextDecoder('utf-8').decode(body.payload)
  const width = body.header.length
  const parsed = await parseChunked(text, PAYLOAD_DELIM, onProgress)

  const rows: string[][] = new Array(parsed.length)
  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i]
    if (r.length === width) {
      rows[i] = r
      continue
    }
    // 열 개수의 권위는 항상 header.length다 — 어긋나면 패딩/절단한다
    const fixed = r.slice(0, width)
    while (fixed.length < width) fixed.push('')
    rows[i] = fixed
  }

  const lostRows = Math.max(0, body.rowCount - parsed.length)

  return {
    snapshot: {
      rows,
      header: body.header.slice(),
      firstRow: body.firstRow ? body.firstRow.slice() : null,
      colOrder: body.colOrder.slice(),
      colWidths: body.colWidths.slice(),
      colTypes: body.colTypes.slice(),
      delimiter: body.delimiter,
      hasHeader: body.hasHeader,
      fileName: body.fileName,
    },
    lostRows,
  }
}

/** 저장 프롬프트 기본값. 파일명 stem을 쓰고, 없으면(붙여넣기) 날짜·시각을 붙인 이름을 만든다. */
export function defaultDocName(fileName: string, now: number): string {
  const stem = baseName(fileName, '')
  if (stem) return stem
  const d = new Date(now)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `무제 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 저장된 레코드를 현재 스키마로 이행한다. v1은 통과만 한다 — 스키마가 바뀌면
 * 여기에 `switch (body.v)`로 단계별 이행을 추가한다.
 */
export function migrateBody(body: DocBody): DocBody {
  return body
}
