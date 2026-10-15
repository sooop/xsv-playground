/**
 * 테두리 문자로 그린 텍스트 표 파서 — 터미널(Claude Code 등)이 출력하는 표를 붙여넣었을 때 쓴다.
 *
 * 지원하는 모양:
 *   ┌───┬───┐        +---+---+
 *   │ a │ b │        | a | b |
 *   ├───┼───┤        +---+---+
 *   │ 1 │ 2 │        | 1 | 2 |
 *   └───┴───┘        +---+---+
 *
 * - 둥근/굵은/이중선 테두리(╭ ┏ ╔ …)와 세로선 `│ ┃ ║`를 같은 것으로 취급한다.
 * - 줄 앞의 들여쓰기·표 앞뒤의 설명 문장은 무시하고 첫 번째 표 블록만 읽는다.
 * - 행 사이에 구분선이 있는 표는 구분선 사이의 여러 줄을 한 행으로 합친다(긴 셀이 줄바꿈된 경우).
 *   구분선이 머리글 아래에만 있으면 데이터 줄 하나가 한 행이다.
 * - ASCII `|` 표는 `+---+` 테두리가 있을 때만 인정한다 — 테두리 없는 `|` 표는 마크다운 표와 구분되지 않는다.
 */

const VERT = '│┃║'
/** 구분선 줄을 이루는 문자 (유니코드 테두리 + ASCII +-=) */
const BORDER_LINE = /^[\s┌┬┐├┼┤└┴┘╭╮╰╯┏┳┓┣╋┫┗┻┛╔╦╗╠╬╣╚╩╝─━═│┃║+\-=]+$/

function isVert(ch: string): boolean {
  return VERT.includes(ch)
}

/**
 * 구분선 줄인가 — 모서리(┌ ├ └ ╭ … +)로 시작해야 한다. 셀 내용이 `-`뿐인 데이터 줄(`│ - │ - │`)은
 * 세로선으로 시작하므로 구분선으로 오인하지 않는다.
 */
function isBorder(line: string): boolean {
  return BORDER_LINE.test(line) && /^[┌├└╭╰┏┣┗╔╠╚+]/.test(line)
}

function isDataLine(line: string): boolean {
  if (line.length < 3) return false
  const first = line[0]
  const last = line[line.length - 1]
  return (isVert(first) && isVert(last)) || (first === '|' && last === '|')
}

function splitCells(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  for (let i = 1; i < line.length - 1; i++) {
    const ch = line[i]
    if (isVert(ch) || ch === '|') {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

/**
 * 텍스트에서 첫 번째 테두리 표를 찾아 2차원 배열로 돌려준다. 표가 아니면 null.
 * 모든 행은 최대 열 수로 패딩된다(첫 행이 머리글인지는 호출부가 판단한다).
 */
export function parseBoxTable(text: string): string[][] | null {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())

  // 첫 표 블록: 구분선·데이터 줄이 이어진 구간
  const block: string[] = []
  let started = false
  for (const l of lines) {
    const tableLine = isDataLine(l) || isBorder(l)
    if (tableLine) {
      started = true
      block.push(l)
    } else if (started) {
      break
    }
  }
  if (block.length < 3) return null

  const data = block.filter((l) => isDataLine(l) && !isBorder(l))
  const borders = block.filter((l) => isBorder(l))
  if (data.length < 2) return null

  // ASCII 표는 `+` 테두리가 있을 때만
  const unicode = block.some((l) => /[│┃║┌┐└┘├┤┬┴┼╭╮╰╯┏┓┗┛╔╗╚╝]/.test(l))
  if (!unicode && !borders.some((l) => l.includes('+'))) return null

  // 데이터 줄 사이에 구분선이 두 번 이상 끼어 있으면 행마다 구분선이 있는 표 → 여러 줄을 한 행으로 합친다
  let inner = 0
  let seenData = false
  let lastWasBorder = false
  for (const l of block) {
    if (isBorder(l)) {
      if (seenData && !lastWasBorder) inner++
      lastWasBorder = true
    } else {
      seenData = true
      lastWasBorder = false
    }
  }
  // 마지막(아래 테두리)은 안쪽 구분선이 아니다
  if (isBorder(block[block.length - 1])) inner--
  const grouped = inner >= 2

  const rows: string[][] = []
  if (grouped) {
    let pending: string[][] = []
    const flush = () => {
      if (pending.length === 0) return
      const width = Math.max(...pending.map((r) => r.length))
      const row: string[] = []
      for (let c = 0; c < width; c++) {
        row.push(
          pending
            .map((r) => r[c] ?? '')
            .filter((v) => v !== '')
            .join(' '),
        )
      }
      rows.push(row)
      pending = []
    }
    for (const l of block) {
      if (isBorder(l)) flush()
      else pending.push(splitCells(l))
    }
    flush()
  } else {
    for (const l of data) rows.push(splitCells(l))
  }

  let width = 0
  for (const r of rows) if (r.length > width) width = r.length
  if (rows.length < 2 || width < 2) return null
  for (const r of rows) while (r.length < width) r.push('')
  return rows
}
