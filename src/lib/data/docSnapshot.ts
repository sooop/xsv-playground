import { parseChunked } from '../parse/csv'
import { serialize } from '../parse/serialize'
import { baseName } from '../util/format'
import type { ColType, Delimiter, ParseResult } from './types'

/** 저장 레코드의 스키마 버전. 형태를 바꿀 때 올리고 {@link migrateBody}에 이행 경로를 더한다. */
export const DOC_SCHEMA_V = 1

/**
 * 저장 페이로드 전용 구분자. `ds.delimiter`(표시·내보내기용)와는 별개다.
 * 콤마보다 셀 값에 등장할 확률이 훨씬 낮아 minimal 인용이 실제로 minimal하게 유지된다.
 */
export const PAYLOAD_DELIM = '\t'

/** 문서가 내역에 들어온 경로 — 목록의 배지와 필터에 쓴다. */
export type DocSource = 'file' | 'paste' | 'md' | 'jq'

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
  /** 들어온 경로. 이전 버전 레코드에는 없다 */
  source?: DocSource
  /** 같은 통합 문서(xlsx)에서 나온 시트들이 공유하는 id */
  groupId?: string
  /** 통합 문서의 시트 이름 */
  sheet?: string
  /** 헤더+페이로드의 해시 — 같은 내용을 다시 올릴 때 새 문서를 만들지 않으려고 쓴다 */
  contentHash?: string
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

/** `packDoc`이 읽는 최소 표면 — `Dataset`이 그대로 만족하고, 그리드에 올리지 않은 시트도 만들 수 있다. */
export interface PackSource {
  rows: string[][]
  header: string[]
  firstRow: readonly string[] | null
  colOrder: number[]
  colWidths: number[]
  colTypes: ColType[]
  delimiter: Delimiter
  hasHeader: boolean
  fileName: string
  rowCount: number
  colCount: number
}

/**
 * 파싱 결과를 그리드(`Dataset`)에 올리지 않고 바로 저장할 수 있는 형태로 만든다. 열 폭·타입은
 * 비워 둔다 — 여는 쪽(`Dataset.loadSnapshot`)이 길이가 맞지 않으면 재계산으로 폴백한다.
 */
export function packableFromParsed(r: ParseResult, fileName: string): PackSource {
  return {
    rows: r.rows,
    header: r.header,
    firstRow: r.firstRow,
    colOrder: r.header.map((_, i) => i),
    colWidths: [],
    colTypes: [],
    delimiter: r.delimiter,
    hasHeader: r.hasHeader,
    fileName,
    rowCount: r.rows.length,
    colCount: r.header.length,
  }
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
  ds: PackSource,
  at: {
    id: string
    name: string
    createdAt: number
    now: number
    source?: DocSource
    groupId?: string
    sheet?: string
  },
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
    contentHash: hashDoc(body.header, payload),
  }
  if (at.source) meta.source = at.source
  if (at.groupId) meta.groupId = at.groupId
  if (at.sheet) meta.sheet = at.sheet
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

/**
 * 헤더와 페이로드의 FNV-1a(32비트) 해시. 암호학적 강도는 필요 없다 — 중복 판정은 행·열 수와
 * 바이트 수까지 함께 비교하므로 충돌해도 다른 문서를 같은 것으로 착각할 확률은 무시할 만하다.
 */
export function hashDoc(header: readonly string[], payload: Uint8Array): string {
  let h = 0x811c9dc5
  const head = new TextEncoder().encode(header.join(''))
  for (let i = 0; i < head.length; i++) h = Math.imul(h ^ head[i], 0x01000193)
  for (let i = 0; i < payload.length; i++) h = Math.imul(h ^ payload[i], 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
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
