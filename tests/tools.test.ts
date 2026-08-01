/**
 * 찾기 · 바꾸기 · 나누기 · 결합 로직 테스트.
 * UI와 분리된 순수 함수라 좌표 변환과 경계 조건을 정밀하게 확인할 수 있다.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { Dataset } from '../src/lib/data/dataset.svelte'
import { View } from '../src/lib/data/view.svelte'
import {
  FIND_LIMIT,
  buildHitSet,
  hitKey,
  planReplace,
  runFind,
  stepIndex,
  type FindSpec,
  type ReplaceSpec,
} from '../src/lib/data/find'
import {
  planJoin,
  planSplitToCols,
  planSplitToRows,
  splitCell,
  type JoinSpec,
  type SplitSpec,
} from '../src/lib/data/transform'
import { parseAll } from '../src/lib/parse/csv'
import { finalize } from '../src/lib/parse/detect'

const CSV = `id,name,tags,qty
1,kim,"a;b;c",30
2,lee,"d;e",10
3,park,f,20
4,choi,,40
5,KIM,"g;h;i;j",50`

let ds: Dataset
let view: View

beforeEach(() => {
  ds = new Dataset()
  view = new View(ds)
  ds.loadParsed(finalize(parseAll(CSV, ','), ',', null, false))
})

function load(csv: string): { ds: Dataset; view: View } {
  const d = new Dataset()
  const v = new View(d)
  d.loadParsed(finalize(parseAll(csv, ','), ',', null, false))
  return { ds: d, view: v }
}

const spec = (o: Partial<FindSpec> = {}): FindSpec => ({
  query: '',
  regex: false,
  caseSensitive: false,
  wholeCell: false,
  ...o,
})

// ===========================================================================
describe('runFind', () => {
  it('빈 쿼리는 결과 없음', () => {
    expect(runFind(ds, view, spec()).hits).toEqual([])
  })

  it('부분 문자열 매치 (대소문자 무시)', () => {
    const r = runFind(ds, view, spec({ query: 'kim' }))
    expect(r.hits).toHaveLength(2) // kim, KIM
    expect(r.hits.map((h) => h.text)).toEqual(['kim', 'KIM'])
  })

  it('대소문자 구분', () => {
    const r = runFind(ds, view, spec({ query: 'kim', caseSensitive: true }))
    expect(r.hits.map((h) => h.text)).toEqual(['kim'])
  })

  it('행 우선 순서로 반환', () => {
    const r = runFind(ds, view, spec({ query: '0' }))
    // qty 칼럼의 30,10,20,40,50 → 행 순서대로
    expect(r.hits.map((h) => h.r)).toEqual([0, 1, 2, 3, 4])
  })

  it('매치 구간 위치를 담는다', () => {
    const r = runFind(ds, view, spec({ query: 'b' }))
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0].text).toBe('a;b;c')
    expect(r.hits[0].at).toBe(2)
    expect(r.hits[0].len).toBe(1)
  })

  it('셀 전체 일치 옵션', () => {
    expect(runFind(ds, view, spec({ query: 'kim' })).hits).toHaveLength(2)
    expect(runFind(ds, view, spec({ query: 'ki', wholeCell: true })).hits).toHaveLength(0)
    expect(runFind(ds, view, spec({ query: 'kim', wholeCell: true })).hits).toHaveLength(2)
  })

  it('일반 모드에서 정규식 특수문자는 리터럴로 취급', () => {
    const t = load('a\nx.y\nxzy')
    // '.'을 정규식으로 보면 xzy도 매치되지만, 일반 모드에서는 x.y만 매치돼야 한다
    const r = runFind(t.ds, t.view, spec({ query: 'x.y' }))
    expect(r.hits.map((h) => h.text)).toEqual(['x.y'])
  })

  it('정규식 모드', () => {
    const r = runFind(ds, view, spec({ query: '^[0-9]0$', regex: true }))
    expect(r.hits).toHaveLength(5) // qty 전부
  })

  it('잘못된 정규식은 error를 담는다', () => {
    const r = runFind(ds, view, spec({ query: '([', regex: true }))
    expect(r.error).not.toBeNull()
    expect(r.hits).toEqual([])
  })

  it('필터가 걸리면 보이는 범위만 찾는다', () => {
    view.query = 'kim'
    const r = runFind(ds, view, spec({ query: '0' }))
    expect(r.hits).toHaveLength(2) // 30, 50 (kim/KIM 행)
  })

  it('숨긴 열은 찾지 않는다', () => {
    const tagsCol = ds.header.indexOf('tags')
    expect(runFind(ds, view, spec({ query: 'a;b' })).hits).toHaveLength(1)
    view.hideCols([tagsCol])
    expect(runFind(ds, view, spec({ query: 'a;b' })).hits).toHaveLength(0)
  })

  it('숨긴 행은 찾지 않는다', () => {
    expect(runFind(ds, view, spec({ query: 'park' })).hits).toHaveLength(1)
    view.hideRows([2])
    expect(runFind(ds, view, spec({ query: 'park' })).hits).toHaveLength(0)
  })

  it('반환 좌표가 뷰 좌표다 (정렬 반영)', () => {
    view.sorts = [{ col: ds.header.indexOf('qty'), dir: 'desc' }]
    const r = runFind(ds, view, spec({ query: 'KIM', caseSensitive: true }))
    expect(r.hits).toHaveLength(1)
    // qty 50인 KIM 행이 내림차순에서 첫 행
    expect(r.hits[0].r).toBe(0)
  })

  it('범위 제한', () => {
    const r = runFind(ds, view, spec({ query: '0' }), { r0: 1, r1: 2, c0: 0, c1: 3 })
    expect(r.hits.map((h) => h.r)).toEqual([1, 2])
  })

  it('상한을 넘으면 truncated', () => {
    // 모든 셀에 'x'가 들어간 큰 데이터
    const rows = Array.from({ length: 800 }, () => 'x,x,x,x').join('\n')
    const t = load('a,b,c,d\n' + rows)
    const r = runFind(t.ds, t.view, spec({ query: 'x' }))
    expect(r.truncated).toBe(true)
    expect(r.hits).toHaveLength(FIND_LIMIT)
  })

  it('빈 셀은 건너뛴다', () => {
    const r = runFind(ds, view, spec({ query: '', regex: false }))
    expect(r.hits).toEqual([])
  })
})

describe('stepIndex', () => {
  const hits = [
    { r: 0, c: 1, text: '', at: 0, len: 1 },
    { r: 2, c: 0, text: '', at: 0, len: 1 },
    { r: 2, c: 3, text: '', at: 0, len: 1 },
  ]

  it('다음 매치', () => {
    expect(stepIndex(hits, { r: 0, c: 0 }, 1)).toBe(0)
    expect(stepIndex(hits, { r: 0, c: 1 }, 1)).toBe(1)
    expect(stepIndex(hits, { r: 2, c: 0 }, 1)).toBe(2)
  })

  it('끝을 넘으면 처음으로 순환', () => {
    expect(stepIndex(hits, { r: 9, c: 9 }, 1)).toBe(0)
  })

  it('이전 매치', () => {
    expect(stepIndex(hits, { r: 2, c: 3 }, -1)).toBe(1)
    expect(stepIndex(hits, { r: 2, c: 0 }, -1)).toBe(0)
  })

  it('처음보다 앞이면 마지막으로 순환', () => {
    expect(stepIndex(hits, { r: 0, c: 0 }, -1)).toBe(2)
  })

  it('매치가 없으면 -1', () => {
    expect(stepIndex([], { r: 0, c: 0 }, 1)).toBe(-1)
  })
})

describe('buildHitSet', () => {
  it('좌표 조회', () => {
    const s = buildHitSet([{ r: 3, c: 7, text: '', at: 0, len: 1 }])
    expect(s.has(hitKey(3, 7))).toBe(true)
    expect(s.has(hitKey(7, 3))).toBe(false)
  })
})

// ===========================================================================
describe('planReplace', () => {
  const rspec = (o: Partial<ReplaceSpec> = {}): ReplaceSpec => ({
    query: '',
    replacement: '',
    regex: false,
    caseSensitive: false,
    wholeCell: false,
    ...o,
  })

  it('빈 쿼리는 변경 없음', () => {
    expect(planReplace(ds, view, rspec(), 'all').changes).toEqual([])
  })

  it('전체 범위 치환', () => {
    const p = planReplace(ds, view, rspec({ query: ';', replacement: '|' }), 'all')
    expect(p.cells).toBe(3) // ';'를 포함한 셀은 a;b;c / d;e / g;h;i;j 세 개
    expect(p.occurrences).toBe(2 + 1 + 3)
  })

  it('대소문자 무시가 기본', () => {
    const p = planReplace(ds, view, rspec({ query: 'kim', replacement: 'X' }), 'all')
    expect(p.cells).toBe(2)
  })

  it('대소문자 구분', () => {
    const p = planReplace(
      ds,
      view,
      rspec({ query: 'kim', replacement: 'X', caseSensitive: true }),
      'all',
    )
    expect(p.cells).toBe(1)
  })

  it('일반 모드에서 $는 리터럴', () => {
    const t = load('a\nfoo')
    const p = planReplace(t.ds, t.view, rspec({ query: 'foo', replacement: '$1' }), 'all')
    expect(p.changes[0].after).toBe('$1')
  })

  it('정규식 역참조', () => {
    const t = load('a\n2026-01-14')
    const p = planReplace(
      t.ds,
      t.view,
      rspec({ query: '(\\d{4})-(\\d{2})-(\\d{2})', replacement: '$3/$2/$1', regex: true }),
      'all',
    )
    expect(p.changes[0].after).toBe('14/01/2026')
  })

  it('일반 모드에서 정규식 특수문자는 리터럴', () => {
    const t = load('a\nx.y\nxzy')
    const p = planReplace(t.ds, t.view, rspec({ query: '.', replacement: '-' }), 'all')
    // '.'를 리터럴로 보면 x.y 한 셀만 바뀐다
    expect(p.cells).toBe(1)
    expect(p.changes[0].after).toBe('x-y')
  })

  it('셀 전체 일치', () => {
    const p = planReplace(
      ds,
      view,
      rspec({ query: 'f', replacement: 'FF', wholeCell: true }),
      'all',
    )
    expect(p.cells).toBe(1)
    expect(p.changes[0].after).toBe('FF')
  })

  it('보이는 범위는 필터를 따른다', () => {
    view.query = 'lee'
    const p = planReplace(ds, view, rspec({ query: ';', replacement: '|' }), 'view')
    expect(p.cells).toBe(1) // d;e만
  })

  it('전체 범위는 필터를 무시한다', () => {
    view.query = 'lee'
    const p = planReplace(ds, view, rspec({ query: ';', replacement: '|' }), 'all')
    expect(p.cells).toBe(3)
  })

  it('선택 영역만', () => {
    const p = planReplace(ds, view, rspec({ query: 'e', replacement: 'E' }), 'selection', [
      { r0: 1, r1: 1, c0: 1, c1: 2 },
    ])
    // 행1의 name(lee) + tags(d;e)
    expect(p.cells).toBe(2)
  })

  it('겹치는 선택 범위에서 같은 셀을 두 번 세지 않는다', () => {
    const p = planReplace(ds, view, rspec({ query: 'e', replacement: 'E' }), 'selection', [
      { r0: 1, r1: 1, c0: 1, c1: 2 },
      { r0: 1, r1: 1, c0: 2, c1: 3 },
    ])
    expect(p.cells).toBe(2)
    const keys = p.changes.map((c) => c.r + ':' + c.c)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('잘못된 정규식은 error', () => {
    const p = planReplace(ds, view, rspec({ query: '([', replacement: '', regex: true }), 'all')
    expect(p.error).not.toBeNull()
  })

  it('값이 그대로면 변경에 포함하지 않는다', () => {
    const p = planReplace(ds, view, rspec({ query: ';', replacement: ';' }), 'all')
    expect(p.changes).toEqual([])
  })

  it('계획을 적용하면 실제로 바뀐다', () => {
    const p = planReplace(ds, view, rspec({ query: ';', replacement: '|' }), 'all')
    ds.apply({ t: 'cells', changes: p.changes })
    expect(ds.rows[0][2]).toBe('a|b|c')
    expect(ds.rows[4][2]).toBe('g|h|i|j')
  })
})

// ===========================================================================
describe('splitCell', () => {
  it('기본 분리', () => {
    expect(splitCell('a;b;c', /;/, false, 99)).toEqual(['a', 'b', 'c'])
  })

  it('trim', () => {
    expect(splitCell('a ; b', /;/, true, 99)).toEqual(['a', 'b'])
    expect(splitCell('a ; b', /;/, false, 99)).toEqual(['a ', ' b'])
  })

  it('상한을 넘으면 나머지를 마지막 조각에 남긴다 (데이터 손실 없음)', () => {
    expect(splitCell('a;b;c;d', /;/, false, 2)).toEqual(['a', 'b;c;d'])
    expect(splitCell('a;b;c;d', /;/, false, 3)).toEqual(['a', 'b', 'c;d'])
  })

  it('구분자가 없으면 한 조각', () => {
    expect(splitCell('abc', /;/, false, 99)).toEqual(['abc'])
  })

  it('빈 문자열', () => {
    expect(splitCell('', /;/, false, 99)).toEqual([''])
  })

  it('정규식 구분자', () => {
    expect(splitCell('a1b22c', /\d+/, false, 99)).toEqual(['a', 'b', 'c'])
  })
})

describe('planSplitToCols', () => {
  const sspec = (o: Partial<SplitSpec> = {}): SplitSpec => ({
    delimiter: ';',
    regex: false,
    trim: true,
    maxParts: 10,
    ...o,
  })

  it('최대 조각 수만큼 칼럼을 만든다', () => {
    const p = planSplitToCols(ds, 2, sspec())
    expect(p.count).toBe(4) // g;h;i;j
    expect(p.names).toEqual(['tags 1', 'tags 2', 'tags 3', 'tags 4'])
  })

  it('모든 행이 같은 길이로 패딩된다', () => {
    const p = planSplitToCols(ds, 2, sspec())
    expect(p.values.every((v) => v.length === 4)).toBe(true)
    expect(p.values[0]).toEqual(['a', 'b', 'c', ''])
    expect(p.values[2]).toEqual(['f', '', '', ''])
    expect(p.values[3]).toEqual(['', '', '', ''])
  })

  it('구분자가 비면 에러', () => {
    expect(planSplitToCols(ds, 2, sspec({ delimiter: '' })).error).not.toBeNull()
  })

  it('잘못된 정규식은 에러', () => {
    expect(planSplitToCols(ds, 2, sspec({ delimiter: '([', regex: true })).error).not.toBeNull()
  })

  it('maxParts 상한과 cappedRows 보고', () => {
    const p = planSplitToCols(ds, 2, sspec({ maxParts: 2 }))
    expect(p.count).toBe(2)
    expect(p.cappedRows).toBe(2) // a;b;c 와 g;h;i;j
    expect(p.values[0]).toEqual(['a', 'b;c'])
  })

  it('정규식 구분자', () => {
    const t = load('a\nx1y\np22q')
    const p = planSplitToCols(t.ds, 0, sspec({ delimiter: '\\d+', regex: true }))
    expect(p.values[0]).toEqual(['x', 'y'])
    expect(p.values[1]).toEqual(['p', 'q'])
  })
})

describe('planSplitToRows', () => {
  const sspec = (o: Partial<SplitSpec> = {}): SplitSpec => ({
    delimiter: ';',
    regex: false,
    trim: true,
    maxParts: 10,
    ...o,
  })

  it('조각 수만큼 행이 늘고 다른 열은 복제된다', () => {
    const p = planSplitToRows(ds, 2, sspec())
    // a;b;c=3, d;e=2, f=1, ''=1, g;h;i;j=4 → 11행
    expect(p.rowCount).toBe(11)
    expect(p.expandedRows).toBe(3)

    // 첫 행이 3개로 늘고 id/name/qty가 그대로 복제됐는지
    expect(p.after.slice(0, 3)).toEqual([
      ['1', 'kim', 'a', '30'],
      ['1', 'kim', 'b', '30'],
      ['1', 'kim', 'c', '30'],
    ])
  })

  it('조각이 하나인 행은 그대로', () => {
    const p = planSplitToRows(ds, 2, sspec())
    expect(p.after).toContainEqual(['3', 'park', 'f', '20'])
    expect(p.after).toContainEqual(['4', 'choi', '', '40'])
  })

  it('구분자가 없으면 행 수가 그대로', () => {
    const p = planSplitToRows(ds, 1, sspec())
    expect(p.rowCount).toBe(5)
    expect(p.expandedRows).toBe(0)
  })

  it('replaceRows op으로 적용·되돌리기', () => {
    const before = ds.rows.map((r) => r.slice())
    const p = planSplitToRows(ds, 2, sspec())
    ds.apply({ t: 'replaceRows', before, after: p.after })
    expect(ds.rowCount).toBe(11)
    expect(ds.searchIndex).toHaveLength(11)

    ds.apply({ t: 'replaceRows', before: p.after, after: before })
    expect(ds.rowCount).toBe(5)
    expect(ds.rows).toEqual(before)
    expect(ds.searchIndex).toHaveLength(5)
  })
})

describe('planJoin', () => {
  const jspec = (o: Partial<JoinSpec> = {}): JoinSpec => ({
    separator: ' ',
    skipEmpty: true,
    trim: true,
    ...o,
  })

  it('기본은 공백 결합', () => {
    const p = planJoin(ds, [1, 3], jspec())
    expect(p.values[0]).toEqual(['kim 30'])
    expect(p.values[1]).toEqual(['lee 10'])
  })

  it('칼럼 이름 제안', () => {
    expect(planJoin(ds, [1, 3], jspec()).suggestedName).toBe('name_qty')
  })

  it('구분자 지정', () => {
    const p = planJoin(ds, [1, 3], jspec({ separator: ' / ' }))
    expect(p.values[0]).toEqual(['kim / 30'])
  })

  it('빈 값 건너뛰기', () => {
    const p = planJoin(ds, [2, 1], jspec({ skipEmpty: true }))
    // 4행의 tags는 비어 있으므로 name만 남는다
    expect(p.values[3]).toEqual(['choi'])
  })

  it('빈 값 유지', () => {
    const p = planJoin(ds, [2, 1], jspec({ skipEmpty: false }))
    expect(p.values[3]).toEqual([' choi'])
  })

  it('세 개 이상 결합', () => {
    const p = planJoin(ds, [0, 1, 3], jspec({ separator: '-' }))
    expect(p.values[0]).toEqual(['1-kim-30'])
  })

  it('순서를 따른다', () => {
    const p = planJoin(ds, [3, 1], jspec())
    expect(p.values[0]).toEqual(['30 kim'])
  })

  it('미리보기는 앞 5행', () => {
    expect(planJoin(ds, [1, 3], jspec()).preview).toHaveLength(5)
  })

  it('insertCols op으로 적용', () => {
    const p = planJoin(ds, [1, 3], jspec())
    const newSrc = ds.colCount
    ds.apply({
      t: 'insertCols',
      at: [newSrc],
      names: [p.suggestedName],
      values: p.values,
      orderBefore: ds.colOrder.slice(),
      orderAfter: [...ds.colOrder, newSrc],
    })
    expect(ds.header).toEqual(['id', 'name', 'tags', 'qty', 'name_qty'])
    expect(ds.rows[0][4]).toBe('kim 30')
  })
})
