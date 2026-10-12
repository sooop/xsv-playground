import { describe, expect, it } from 'vitest'
import { undo, redo, history } from '@milkdown/kit/prose/history'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { tableNodes } from '@milkdown/kit/prose/tables'
import { detectPasteTable, toMarkdownTable } from '../src/modes/md/notes/pasteTable'
import { createPasteTablePlugin } from '../src/modes/md/notes/pasteTablePlugin'

const det = (text: string, html?: string) => detectPasteTable({ text, html })

describe('detectPasteTable', () => {
  it('TSV: 2줄 이상, 열 수 동일이면 변환', () => {
    const t = det('이름\t나이\n철수\t10\n영희\t20\n')
    expect(t?.kind).toBe('tsv')
    expect(t?.rows).toEqual([['이름', '나이'], ['철수', '10'], ['영희', '20']])
    expect(det('a\tb\nc\td')?.rows).toHaveLength(2)
  })
  it('TSV: 열 수 불일치/한 줄/들여쓰기 코드는 변환하지 않음', () => {
    expect(det('a\tb\nc\td\te')).toBeNull()
    expect(det('a\tb')).toBeNull()
    expect(det('\tfoo\n\tbar')).toBeNull()
  })
  it('CSV: 2줄은 미변환, 3줄은 변환', () => {
    expect(det('a,b\n1,2')).toBeNull()
    const t = det('a,b\n1,2\n3,4')
    expect(t?.kind).toBe('csv')
    expect(t?.rows).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
  })
  it('CSV: 따옴표 필드와 필드 안 쉼표·줄바꿈·이중 따옴표', () => {
    const t = det('name,note\n"Kim, A","line1\nline2"\n"Lee","say ""hi"""')
    expect(t?.rows).toEqual([['name', 'note'], ['Kim, A', 'line1\nline2'], ['Lee', 'say "hi"']])
  })
  it('CSV: 문장 속 쉼표·열 수 불일치·빈 줄·긴 첫 줄은 오탐 방지', () => {
    expect(det('안녕하세요, 반갑습니다.\n오늘은, 날씨가 좋네요.')).toBeNull()
    expect(det('사과, 배\n포도, 딸기, 수박\n귤, 감')).toBeNull()
    expect(det('a,b\n\n1,2\n3,4')).toBeNull()
    expect(det(`${'긴 문장 '.repeat(30)}, 끝\n1,2\n3,4`)).toBeNull()
  })
  it('HTML 표가 있으면 개입하지 않음(엑셀/시트 복사)', () => {
    expect(det('a\tb\nc\td', '<table><tr><td>a</td></tr></table>')).toBeNull()
    expect(det('a\tb\nc\td', '<p>x</p>')?.kind).toBe('tsv')
  })
  it('이미 마크다운 표면 개입하지 않음', () => {
    expect(det('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBeNull()
  })
})

describe('toMarkdownTable', () => {
  const rows = [['a|b', 'c'], ['1', 'x\ny']]
  it('파이프 이스케이프, 셀 줄바꿈 <br>, 머리글 유무', () => {
    expect(toMarkdownTable(rows, true)).toBe('| a\\|b | c |\n| --- | --- |\n| 1 | x<br>y |')
    expect(toMarkdownTable(rows, false)).toBe('|  |  |\n| --- | --- |\n| a\\|b | c |\n| 1 | x<br>y |')
  })
})

// ── 플러그인: 실제 prosemirror 상태 + 이력 위에서 동작 확인 (DOM 없이 가짜 view) ─────────────
// 노드 이름은 Milkdown gfm 스키마와 같게 맞춘다
function makeSchema() {
  const t = tableNodes({ tableGroup: 'block', cellContent: 'paragraph', cellAttributes: {} })
  return new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
      hardbreak: { inline: true, group: 'inline', attrs: { isInline: { default: false } }, toDOM: () => ['br'] },
      text: { group: 'inline' },
      table: { ...t.table, content: 'table_header_row table_row+' },
      table_header_row: { ...t.table_row, content: '(table_header)*' },
      table_row: t.table_row,
      table_header: t.table_header,
      table_cell: t.table_cell,
    },
  })
}

function setup(ask: () => Promise<boolean>, text = 'before') {
  const s = makeSchema()
  const plugin = createPasteTablePlugin(ask)
  const doc = s.node('doc', null, [s.node('paragraph', null, text ? [s.text(text)] : [])])
  let state = EditorState.create({ doc, plugins: [history(), plugin] })
  state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)))
  const view = {
    get state() { return state },
    dispatch(tr: Transaction) { state = state.apply(tr) },
    editable: true,
    isDestroyed: false,
    props: {},
    focus() {},
  }
  const paste = (data: Record<string, string>) => {
    let prevented = false
    const event = {
      clipboardData: { files: [], getData: (k: string) => data[k] ?? '' },
      preventDefault: () => { prevented = true },
    }
    const handled = (plugin.props.handleDOMEvents!.paste as (v: unknown, e: unknown) => boolean)(view, event)
    return { handled, prevented }
  }
  const run = (fn: typeof undo) => fn(state, (tr) => { state = state.apply(tr) })
  return { view, paste, run, get state() { return state } }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('createPasteTablePlugin', () => {
  it('TSV 붙여넣기 → 표로 변환되고 Ctrl+Z 는 원문, 한 번 더는 붙여넣기 전', async () => {
    const h = setup(async () => true)
    const { handled, prevented } = h.paste({ 'text/plain': 'a\tb\nc\td' })
    expect(handled && prevented).toBe(true)
    await flush()
    const doc = h.state.doc
    const table = doc.lastChild!
    expect(table.type.name).toBe('table')
    expect(doc.firstChild!.textContent).toBe('before')
    expect(table.child(0).type.name).toBe('table_header_row')
    expect(table.child(0).child(0).type.name).toBe('table_header')
    expect(table.child(0).textContent).toBe('ab')
    expect(table.child(1).textContent).toBe('cd')

    h.run(undo)
    expect(h.state.doc.lastChild!.type.name).toBe('paragraph')
    expect(h.state.doc.textContent).toContain('a\tb\nc\td')

    h.run(undo)
    expect(h.state.doc.childCount).toBe(1)
    expect(h.state.doc.textContent).toBe('before')

    h.run(redo)
    expect(h.state.doc.textContent).toContain('a\tb\nc\td')
  })

  it('빈 문단에 붙여넣기: 문단이 표로 교체된다', async () => {
    const h = setup(async () => true, '')
    h.paste({ 'text/plain': 'a\tb\nc\td' })
    await flush()
    expect(h.state.doc.childCount).toBe(1)
    expect(h.state.doc.child(0).type.name).toBe('table')
    h.run(undo)
    expect(h.state.doc.child(0).type.name).toBe('paragraph')
    h.run(undo)
    expect(h.state.doc.textContent).toBe('')
  })

  it('머리글 없이: 빈 머리글 행이 위에 추가된다', async () => {
    const h = setup(async () => false, '')
    h.paste({ 'text/plain': 'a\tb\nc\td' })
    await flush()
    const t = h.state.doc.child(0)
    expect(t.childCount).toBe(3)
    expect(t.child(0).textContent).toBe('')
    expect(t.child(0).childCount).toBe(2)
    expect(t.child(1).textContent).toBe('ab')
  })

  it('셀 안 줄바꿈은 hardbreak, 파이프는 그대로 텍스트', async () => {
    const h = setup(async () => true, '')
    h.paste({ 'text/plain': 'n,m\n"a|b","x\ny"\n1,2' })
    await flush()
    const t = h.state.doc.child(0)
    expect(t.child(1).child(0).textContent).toBe('a|b')
    const cell = t.child(1).child(1).firstChild!
    expect(cell.childCount).toBe(3)
    expect(cell.child(1).type.name).toBe('hardbreak')
  })

  it('대화상자 대기 중 문서가 바뀌면 원문 텍스트만 삽입한다', async () => {
    let resolve!: (v: boolean) => void
    const h = setup(() => new Promise<boolean>((r) => { resolve = r }))
    h.paste({ 'text/plain': 'a\tb\nc\td' })
    h.view.dispatch(h.state.tr.insertText('X', 1))
    resolve(true)
    await flush()
    expect(h.state.doc.childCount).toBe(1)
    expect(h.state.doc.textContent).toContain('a\tb\nc\td')
  })

  it('개입하지 않는 경우: HTML 표, 읽기 전용, vscode, 변환 대상 아님', () => {
    const ask = async () => true
    expect(setup(ask).paste({ 'text/plain': 'a\tb\nc\td', 'text/html': '<table></table>' }).handled).toBe(false)
    expect(setup(ask).paste({ 'text/plain': 'a,b\n1,2' }).handled).toBe(false)
    const ro = setup(ask)
    ro.view.editable = false
    expect(ro.paste({ 'text/plain': 'a\tb\nc\td' }).handled).toBe(false)
    expect(setup(ask).paste({ 'text/plain': 'a\tb\nc\td', 'vscode-editor-data': '{}' }).handled).toBe(false)
  })
})
