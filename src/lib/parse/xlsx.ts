/**
 * SheetJS 래퍼.
 *
 * 라이브러리 의존을 이 파일 하나에 격리한다. 최종 단일 HTML 크기를 줄여야 하면
 * `xlsx/dist/xlsx.mini.min.js`로 교체하거나 자체 최소 XLSX 라이터로 바꿀 수 있고,
 * 그때 손댈 곳은 여기뿐이다. **쓰기 경로만** 사용한다(읽기는 지원하지 않는다).
 */
import { utils, write } from 'xlsx'

/** 이 이상이면 xlsx 생성이 수 초 이상 걸려 사전 경고가 필요하다. */
export const XLSX_WARN_ROWS = 200_000

/**
 * 2차원 배열을 xlsx 바이트로 만든다.
 *
 * 모든 값을 문자열 그대로 넣는다(`aoa_to_sheet`의 자동 타입 추론에 맡기지 않는다) — CSV에서
 * 읽은 `007`이나 `1-2`가 숫자·날짜로 바뀌어 원본이 훼손되는 일을 막는 것이 우선이다.
 */
export function buildXlsx(matrix: readonly string[][], sheetName = 'Sheet1'): Uint8Array {
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
