/**
 * SheetJS 래퍼.
 *
 * 라이브러리 의존을 이 파일 하나에 격리한다. **쓰기 경로만** 사용한다(읽기는 지원하지 않는다).
 *
 * SheetJS는 최종 HTML에 포함하지 않고, XLSX 내보내기를 실제로 선택한 시점에 CDN에서
 * 내려받는다 — 이 기능을 한 번도 안 쓰면 번들이 ~1MB 가벼워지고, 쓰는 순간에만 인터넷 연결이
 * 필요하다(그 외 모든 기능은 완전히 오프라인으로 동작한다). 타입은 `xlsx`를 `import type`으로만
 * 가져오므로 빌드 산출물에는 실행 코드가 전혀 섞이지 않는다.
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
