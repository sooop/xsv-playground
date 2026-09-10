/**
 * SheetJS 래퍼.
 *
 * 라이브러리 의존을 이 파일 하나에 격리한다. 읽기(통합 문서 열기)와 쓰기(xlsx 내보내기)를
 * 모두 여기서 담당한다.
 *
 * SheetJS는 최종 HTML에 포함하지 않고, 엑셀 파일을 실제로 열거나 XLSX로 내보내는 시점에
 * CDN에서 내려받는다 — 이 기능을 한 번도 안 쓰면 번들이 ~1MB 가벼워지고, 쓰는 순간에만
 * 인터넷 연결이 필요하다(CSV/TSV 관련 모든 기능은 완전히 오프라인으로 동작한다). 타입은
 * `xlsx`를 `import type`으로만 가져오므로 빌드 산출물에는 실행 코드가 전혀 섞이지 않는다.
 */
import type * as XLSXTypes from 'xlsx'

/** 버전은 `package.json`의 `xlsx` 타입 의존성과 맞춰 둔다. */
const CDN_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'

declare global {
  interface Window {
    XLSX?: typeof XLSXTypes
  }
}

let loading: Promise<typeof XLSXTypes> | null = null

/** UMD 스크립트를 주입해 `window.XLSX`를 채운다. 같은 세션에서는 한 번만 내려받는다. */
function loadSheetJS(): Promise<typeof XLSXTypes> {
  if (window.XLSX) return Promise.resolve(window.XLSX)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CDN_URL
    script.async = true
    script.onload = () => {
      if (window.XLSX) resolve(window.XLSX)
      else reject(new Error('SheetJS를 불러왔지만 초기화에 실패했습니다'))
    }
    script.onerror = () => {
      loading = null // 재시도할 수 있도록 캐시를 비운다 (예: 그 사이 온라인 상태가 됨)
      reject(new Error('SheetJS를 CDN에서 가져오지 못했습니다. 인터넷 연결을 확인하세요.'))
    }
    document.head.appendChild(script)
  })
  return loading
}

/** 이 이상이면 xlsx 생성이 수 초 이상 걸려 사전 경고가 필요하다. */
export const XLSX_WARN_ROWS = 200_000

// ---------------------------------------------------------------------------
// 읽기
// ---------------------------------------------------------------------------

/** 통합 문서 안의 시트 한 장 — 목록 UI가 변환 없이 보여줄 수 있는 만큼의 요약. */
export interface SheetSummary {
  name: string
  /** `!ref` 기준 행 수 (헤더 분리 전) */
  rows: number
  cols: number
}

/** 열린 통합 문서. 시트 변환은 실제로 그 시트를 볼 때까지 미룬다. */
export interface WorkbookHandle {
  sheets: SheetSummary[]
  /** 시트를 2차원 문자열 배열로. 없는 이름이면 빈 배열. */
  toMatrix(name: string): string[][]
}

/**
 * 통합 문서를 연다.
 *
 * 모든 셀을 **엑셀에 보이는 그대로의 문자열**로 읽는다(`raw: false` → 서식이 적용된 `w` 값).
 * `1,234원`·`2026-01-14`·`12.5%`가 원시 숫자로 풀려 화면이 엑셀과 달라지는 일을 막는 것이
 * 이 도구의 용도(엑셀 없는 기기에서 내용 확인)에 맞다. 수식 셀은 마지막으로 계산되어
 * 저장된 값이 들어간다 — 이 도구는 수식을 재계산하지 않는다.
 */
export async function readWorkbook(buf: ArrayBuffer): Promise<WorkbookHandle> {
  const XLSX = await loadSheetJS()
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true })

  const names = wb.SheetNames.filter((n) => wb.Sheets[n])
  if (names.length === 0) throw new Error('통합 문서에 시트가 없습니다')

  const sheets: SheetSummary[] = names.map((name) => {
    const ref = wb.Sheets[name]['!ref']
    if (!ref) return { name, rows: 0, cols: 0 }
    const r = XLSX.utils.decode_range(ref)
    return { name, rows: r.e.r - r.s.r + 1, cols: r.e.c - r.s.c + 1 }
  })

  return {
    sheets,
    toMatrix(name: string): string[][] {
      const ws = wb.Sheets[name]
      if (!ws) return []
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        raw: false,
        defval: '',
        blankrows: true,
      })
      return trimMatrix(aoa.map((row) => row.map(toCellText)))
    },
  }
}

function toCellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'string' ? v : String(v)
}

/**
 * 끝쪽의 빈 행·빈 열을 떼어낸다.
 *
 * 엑셀 시트의 `!ref`는 한 번이라도 서식을 건드린 셀까지 포함해 실제 데이터보다 훨씬 넓은
 * 경우가 흔하다. 그대로 두면 빈 열 수백 개짜리 표가 열린다. 중간의 빈 행/열은 원본 배치가
 * 정보일 수 있으므로 건드리지 않는다.
 */
export function trimMatrix(rows: string[][]): string[][] {
  let last = -1
  let width = 0
  for (let r = 0; r < rows.length; r++) {
    let rowLast = -1
    const row = rows[r]
    for (let c = 0; c < row.length; c++) if (row[c] !== '') rowLast = c
    if (rowLast >= 0) {
      last = r
      if (rowLast + 1 > width) width = rowLast + 1
    }
  }
  if (last < 0) return []
  const out = rows.slice(0, last + 1)
  for (let r = 0; r < out.length; r++) {
    if (out[r].length > width) out[r] = out[r].slice(0, width)
  }
  return out
}

/** 이미 CDN에서 받아와 있는지 — 호출부가 "다운로드 중" 안내를 반복 표시하지 않으려 쓴다. */
export function isSheetJSLoaded(): boolean {
  return !!window.XLSX
}

/**
 * 2차원 배열을 xlsx 바이트로 만든다.
 *
 * 모든 값을 문자열 그대로 넣는다(`aoa_to_sheet`의 자동 타입 추론에 맡기지 않는다) — CSV에서
 * 읽은 `007`이나 `1-2`가 숫자·날짜로 바뀌어 원본이 훼손되는 일을 막는 것이 우선이다.
 */
export async function buildXlsx(matrix: readonly string[][], sheetName = 'Sheet1'): Promise<Uint8Array> {
  const { utils, write } = await loadSheetJS()
  const ws = utils.aoa_to_sheet(matrix as string[][], { cellDates: false })

  // aoa_to_sheet이 추론한 타입을 문자열로 되돌린다
  const ref = ws['!ref']
  if (ref) {
    const range = utils.decode_range(ref)
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = utils.encode_cell({ r, c })
        const cell = ws[addr]
        if (cell && cell.t !== 's') {
          cell.t = 's'
          cell.v = String(cell.w ?? cell.v ?? '')
          delete cell.w
          delete cell.z
        }
      }
    }
  }

  const wb = utils.book_new()
  // 시트명 제약: 31자 이하, : \ / ? * [ ] 불가
  utils.book_append_sheet(wb, ws, sanitizeSheetName(sheetName))
  return write(wb, { bookType: 'xlsx', type: 'array' }) as Uint8Array
}

function sanitizeSheetName(name: string): string {
  const clean = name.replace(/[:\\/?*[\]]/g, '_').slice(0, 31)
  return clean || 'Sheet1'
}
