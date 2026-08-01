/**
 * 스토어 계층 통합 테스트.
 *
 * 개별 함수가 아니라 Dataset + View + Selection + History가 함께 만드는 동작을 검증한다.
 * 뷰 좌표 ↔ source 좌표 변환이 필터·정렬·편집·되돌리기를 거쳐도 일관한지가 핵심이다.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { Dataset } from '../src/lib/data/dataset.svelte'
import { History } from '../src/lib/data/history.svelte'
import { SelectionStore } from '../src/lib/data/selection.svelte'
import { toggleSort } from '../src/lib/data/sort'
import { View } from '../src/lib/data/view.svelte'
import { finalize } from '../src/lib/parse/detect'
import { parseAll } from '../src/lib/parse/csv'
import { buildMatrix } from '../src/lib/data/export'
import type { ExportOptions, Op } from '../src/lib/data/types'

const CSV = `id,name,city,qty
1,kim,서울,30
2,lee,부산,10
3,park,서울,20
4,choi,대구,40
5,kim,부산,50`

let ds: Dataset
let view: View
let sel: SelectionStore
let history: History

beforeEach(() => {
  ds = new Dataset()
  view = new View(ds)
  sel = new SelectionStore()
  history = new History(ds)
  ds.loadParsed(finalize(parseAll(CSV, ','), ',', null, false))
})

/** 현재 뷰를 사람이 읽을 수 있는 행 배열로 (칼럼 순서 반영) */
function visible(): string[][] {
  const out: string[][] = []
  for (let i = 0; i < view.viewRows.length; i++) {
    const row = ds.rows[view.viewRows[i]]
    out.push(ds.colOrder.map((c) => row[c]))
  }
  return out
}
function col(name: string): number {
  return ds.header.indexOf(name)
}

describe('로드', () => {
  it('헤더와 행을 인식한다', () => {
    expect(ds.header).toEqual(['id', 'name', 'city', 'qty'])
    expect(ds.rowCount).toBe(5)
    expect(ds.colTypes[col('id')]).toBe('number')
    expect(ds.colTypes[col('qty')]).toBe('number')
    expect(ds.colTypes[col('name')]).toBe('string')
  })

  it('필터가 없으면 전체가 보인다', () => {
    expect(view.visibleCount).toBe(5)
  })

  it('칼럼 폭이 추정된다', () => {
    expect(ds.colWidths).toHaveLength(4)
    expect(ds.colWidths.every((w) => w > 0)).toBe(true)
  })
})

describe('스마트 필터', () => {
  it('부분 문자열로 행을 좁힌다', () => {
    view.query = 'kim'
    expect(view.visibleCount).toBe(2)
    expect(visible().map((r) => r[0])).toEqual(['1', '5'])
  })

  it('AND 조합', () => {
    view.query = 'kim,부산'
    expect(visible().map((r) => r[0])).toEqual(['5'])
  })

  it('OR 조합', () => {
    view.query = '대구 서울'
    expect(view.visibleCount).toBe(3)
  })

  it('정규식', () => {
    view.regexMode = true
    view.query = '^[35]0$'
    expect(view.visibleCount).toBe(2)
  })

  it('쿼리를 비우면 전체로 복귀', () => {
    view.query = 'kim'
    expect(view.visibleCount).toBe(2)
    view.query = ''
    expect(view.visibleCount).toBe(5)
  })

  it('잘못된 정규식은 필터를 적용하지 않는다', () => {
    view.regexMode = true
    view.query = '(['
    expect(view.matcher.error).not.toBeNull()
    expect(view.visibleCount).toBe(5)
  })
})

describe('칼럼 필터', () => {
  it('값 제외', () => {
    view.setColumnFilter(col('city'), { mode: 'values', excluded: new Set(['서울']) })
    expect(view.visibleCount).toBe(3)
    expect(visible().every((r) => r[2] !== '서울')).toBe(true)
  })

  it('숫자 조건', () => {
    view.setColumnFilter(col('qty'), {
      mode: 'text',
      query: '>=30',
      regex: false,
      negate: false,
    })
    expect(visible().map((r) => r[3]).sort()).toEqual(['30', '40', '50'])
  })

  it('스마트 필터와 교집합', () => {
    view.setColumnFilter(col('city'), { mode: 'values', excluded: new Set(['대구']) })
    view.query = 'kim'
    expect(view.visibleCount).toBe(2)
  })

  it('columnFiltered는 스마트 필터를 반영하지 않는다', () => {
    view.query = 'kim'
    expect(view.columnFiltered.length).toBe(5)
    expect(view.viewRows.length).toBe(2)
  })

  it('전체 해제', () => {
    view.setColumnFilter(col('city'), { mode: 'values', excluded: new Set(['서울']) })
    view.clearColumnFilters()
    expect(view.visibleCount).toBe(5)
  })
})

describe('정렬', () => {
  it('숫자 내림차순', () => {
    view.sorts = [{ col: col('qty'), dir: 'desc' }]
    expect(visible().map((r) => r[3])).toEqual(['50', '40', '30', '20', '10'])
  })

  it('문자열 오름차순', () => {
    view.sorts = [{ col: col('name'), dir: 'asc' }]
    expect(visible().map((r) => r[1])).toEqual(['choi', 'kim', 'kim', 'lee', 'park'])
  })

  it('다중 정렬', () => {
    view.sorts = [
      { col: col('city'), dir: 'asc' },
      { col: col('qty'), dir: 'desc' },
    ]
    expect(visible().map((r) => `${r[2]}/${r[3]}`)).toEqual([
      '대구/40',
      '부산/50',
      '부산/10',
      '서울/30',
      '서울/20',
    ])
  })

  it('필터와 정렬을 함께', () => {
    view.query = 'kim'
    view.sorts = [{ col: col('qty'), dir: 'desc' }]
    expect(visible().map((r) => r[3])).toEqual(['50', '30'])
  })

  it('toggleSort로 해제하면 원래 순서', () => {
    const c = col('qty')
    view.sorts = toggleSort(view.sorts, c, false)
    view.sorts = toggleSort(view.sorts, c, false)
    view.sorts = toggleSort(view.sorts, c, false)
    expect(view.sorts).toEqual([])
    expect(visible().map((r) => r[0])).toEqual(['1', '2', '3', '4', '5'])
  })
})

describe('편집 — 뷰 좌표 ↔ source 좌표', () => {
  /** App.pushOp과 동일한 흐름 */
  function push(op: Op, clearSel = false): void {
    const before = sel.snapshot()
    const res = history.push(op, before, clearSel ? null : before)
    if (res.structural || clearSel) sel.clear()
    sel.clampTo(view.visibleCount, ds.colCount)
  }

  it('정렬된 상태에서 편집하면 올바른 원본 행이 바뀐다', () => {
    view.sorts = [{ col: col('qty'), dir: 'desc' }]
    // 뷰 0행 = qty 50 = source 4 (id 5)
    const srcRow = view.viewRows[0]
    expect(ds.rows[srcRow][col('id')]).toBe('5')

    push({
      t: 'cells',
      changes: [{ r: srcRow, c: col('name'), before: 'kim', after: 'KIM' }],
    })
    expect(ds.rows[4][col('name')]).toBe('KIM')
    expect(ds.rows[0][col('name')]).toBe('kim') // 다른 행은 그대로
  })

  it('칼럼 순서를 바꾼 뒤 편집해도 올바른 칼럼이 바뀐다', () => {
    ds.apply({ t: 'setColOrder', before: [0, 1, 2, 3], after: [1, 2, 3, 0] }) // id를 맨 뒤로
    expect(ds.colOrder).toEqual([1, 2, 3, 0])
    // 뷰 0열 = source 1열 (name)
    expect(ds.srcCol(0)).toBe(1)
    push({ t: 'cells', changes: [{ r: 0, c: ds.srcCol(0), before: 'kim', after: 'X' }] })
    expect(ds.rows[0]).toEqual(['1', 'X', '서울', '30'])
  })

  it('필터가 걸린 상태에서 편집하면 필터 결과가 갱신된다', () => {
    view.query = 'kim'
    expect(view.visibleCount).toBe(2)
    const srcRow = view.viewRows[0]
    push({ t: 'cells', changes: [{ r: srcRow, c: col('name'), before: 'kim', after: 'zzz' }] })
    // 이제 kim에 맞는 행이 하나 줄어든다
    expect(view.visibleCount).toBe(1)
  })

  it('편집이 검색 인덱스를 갱신해 새 값으로도 찾을 수 있다', () => {
    push({ t: 'cells', changes: [{ r: 0, c: col('name'), before: 'kim', after: '홍길동' }] })
    view.query = '홍길동'
    expect(view.visibleCount).toBe(1)
  })
})

describe('Undo / Redo', () => {
  function push(op: Op, clearSel = false): void {
    const before = sel.snapshot()
    const res = history.push(op, before, clearSel ? null : before)
    if (res.structural || clearSel) sel.clear()
  }

  it('셀 편집 되돌리기/다시하기', () => {
    push({ t: 'cells', changes: [{ r: 0, c: 1, before: 'kim', after: 'X' }] })
    expect(ds.rows[0][1]).toBe('X')
    expect(history.canUndo).toBe(true)

    history.undo()
    expect(ds.rows[0][1]).toBe('kim')
    expect(history.canRedo).toBe(true)

    history.redo()
    expect(ds.rows[0][1]).toBe('X')
  })

  it('되돌린 뒤 새 편집을 하면 redo 분기가 버려진다', () => {
    push({ t: 'cells', changes: [{ r: 0, c: 1, before: 'kim', after: 'A' }] })
    history.undo()
    expect(history.canRedo).toBe(true)
    push({ t: 'cells', changes: [{ r: 0, c: 1, before: 'kim', after: 'B' }] })
    expect(history.canRedo).toBe(false)
    expect(ds.rows[0][1]).toBe('B')
  })

  it('행 삭제 되돌리기가 데이터와 검색 인덱스를 모두 복구한다', () => {
    push({ t: 'deleteRows', at: [1, 3], rows: [ds.rows[1].slice(), ds.rows[3].slice()] }, true)
    expect(ds.rowCount).toBe(3)
    expect(ds.rows.map((r) => r[0])).toEqual(['1', '3', '5'])

    history.undo()
    expect(ds.rowCount).toBe(5)
    expect(ds.rows.map((r) => r[0])).toEqual(['1', '2', '3', '4', '5'])
    // 복구된 행도 검색으로 찾을 수 있어야 한다
    view.query = 'choi'
    expect(view.visibleCount).toBe(1)
  })

  it('열 삭제 되돌리기가 칼럼 순서까지 복구한다', () => {
    ds.apply({ t: 'setColOrder', before: [0, 1, 2, 3], after: [1, 2, 0, 3] })
    const orderBefore = ds.colOrder.slice()
    expect(orderBefore).toEqual([1, 2, 0, 3])

    // 뷰 0번(source 1 = name) 삭제
    const at = [1]
    push(
      {
        t: 'deleteCols',
        at,
        names: ['name'],
        values: ds.rows.map((r) => [r[1]]),
        orderBefore,
        orderAfter: [1, 0, 2], // city, id, qty
      },
      true,
    )
    expect(ds.header).toEqual(['id', 'city', 'qty'])
    expect(ds.colOrder).toEqual([1, 0, 2])

    history.undo()
    expect(ds.header).toEqual(['id', 'name', 'city', 'qty'])
    expect(ds.colOrder).toEqual(orderBefore)
    expect(ds.rows[0]).toEqual(['1', 'kim', '서울', '30'])
  })

  it('되돌리기가 선택 상태를 복원한다', () => {
    sel.selectCell(2, 1)
    const before = sel.snapshot()
    history.push({ t: 'cells', changes: [{ r: 2, c: 1, before: 'park', after: 'Z' }] }, before, before)
    sel.clear()
    expect(sel.isEmpty).toBe(true)

    const r = history.undo()
    sel.restore(r!.selection)
    expect(sel.ranges).toHaveLength(1)
    expect(sel.active).toEqual({ r: 2, c: 1 })
  })

  it('연속 편집을 순서대로 되돌린다', () => {
    for (let i = 0; i < 5; i++) {
      push({ t: 'cells', changes: [{ r: i, c: 1, before: ds.rows[i][1], after: `v${i}` }] })
    }
    expect(ds.rows.map((r) => r[1])).toEqual(['v0', 'v1', 'v2', 'v3', 'v4'])
    for (let i = 0; i < 5; i++) history.undo()
    expect(ds.rows.map((r) => r[1])).toEqual(['kim', 'lee', 'park', 'choi', 'kim'])
    expect(history.canUndo).toBe(false)
  })
})

describe('선택 → source 셀 매핑', () => {
  it('정렬된 뷰에서 선택한 범위가 올바른 원본 셀을 가리킨다', () => {
    view.sorts = [{ col: col('qty'), dir: 'asc' }]
    // 뷰 0~1행 = qty 10, 20 = source 1, 2
    sel.selectCell(0, 0)
    sel.extendTo(1, 3)
    const srcRows = [view.viewRows[0], view.viewRows[1]]
    expect(srcRows).toEqual([1, 2])
    expect(ds.rows[srcRows[0]][col('qty')]).toBe('10')
    expect(ds.rows[srcRows[1]][col('qty')]).toBe('20')
  })

  it('뷰가 줄어들면 clampTo가 선택을 자른다', () => {
    sel.selectAll(4, 3)
    view.query = 'kim' // 2행만 남는다
    sel.clampTo(view.visibleCount, ds.colCount)
    expect(sel.ranges[0].r1).toBe(1)
    expect(sel.active.r).toBeLessThan(2)
  })

  it('행 단위 선택 판정', () => {
    sel.selectRows(1, 2, 3, 'set')
    expect(sel.fullySelectedRows(3)).toEqual([1, 2])
    expect(sel.isRowFullySelected(1, 3)).toBe(true)
    expect(sel.isRowFullySelected(0, 3)).toBe(false)
  })

  it('열 단위 선택 판정', () => {
    sel.selectCols(1, 2, 4, 'set')
    expect(sel.fullySelectedCols(4)).toEqual([1, 2])
    expect(sel.isColFullySelected(2, 4)).toBe(true)
  })

  it('Ctrl 클릭 멀티 선택', () => {
    sel.selectCell(0, 0)
    sel.addCell(2, 2)
    sel.addCell(4, 1)
    expect(sel.ranges).toHaveLength(3)
    expect(sel.cellCount).toBe(3)
  })

  it('겹치는 다중 범위는 근사 표시', () => {
    sel.selectCell(0, 0)
    sel.extendTo(2, 2)
    sel.addCell(1, 1) // 첫 범위 안쪽
    expect(sel.countIsApprox).toBe(true)
  })
})

describe('내보내기 범위', () => {
  const base: ExportOptions = {
    scope: 'all',
    format: 'csv',
    target: 'file',
    includeHeader: true,
    applyColOrder: true,
    quoting: 'minimal',
    newline: '\n',
    bom: false,
  }

  it('전체는 필터를 무시한다', () => {
    view.query = 'kim'
    const { matrix } = buildMatrix(ds, view, sel, { ...base, scope: 'all' })
    expect(matrix).toHaveLength(6) // 헤더 + 5행
  })

  it('보이는 부분은 필터와 정렬을 반영한다', () => {
    view.query = 'kim'
    view.sorts = [{ col: col('qty'), dir: 'desc' }]
    const { matrix } = buildMatrix(ds, view, sel, { ...base, scope: 'view' })
    expect(matrix).toEqual([
      ['id', 'name', 'city', 'qty'],
      ['5', 'kim', '부산', '50'],
      ['1', 'kim', '서울', '30'],
    ])
  })

  it('선택 영역만', () => {
    sel.selectCell(1, 1)
    sel.extendTo(2, 2)
    const { matrix } = buildMatrix(ds, view, sel, {
      ...base,
      scope: 'selection',
      includeHeader: false,
    })
    expect(matrix).toEqual([
      ['lee', '부산'],
      ['park', '서울'],
    ])
  })

  it('선택 영역 + 헤더', () => {
    sel.selectCell(0, 2)
    sel.extendTo(1, 3)
    const { matrix } = buildMatrix(ds, view, sel, { ...base, scope: 'selection' })
    expect(matrix[0]).toEqual(['city', 'qty'])
  })

  it('칼럼 순서를 적용/무시', () => {
    ds.apply({ t: 'setColOrder', before: [0, 1, 2, 3], after: [1, 2, 3, 0] })
    const applied = buildMatrix(ds, view, sel, { ...base, applyColOrder: true }).matrix
    expect(applied[0]).toEqual(['name', 'city', 'qty', 'id'])
    const raw = buildMatrix(ds, view, sel, { ...base, applyColOrder: false }).matrix
    expect(raw[0]).toEqual(['id', 'name', 'city', 'qty'])
  })

  it('다중 범위는 바운딩 사각형이고 밖은 빈 값', () => {
    sel.selectCell(0, 0)
    sel.addCell(2, 2)
    const { matrix, truncatedFromMultiRange } = buildMatrix(ds, view, sel, {
      ...base,
      scope: 'selection',
      includeHeader: false,
    })
    expect(truncatedFromMultiRange).toBe(true)
    expect(matrix).toEqual([
      ['1', '', ''],
      ['', '', ''],
      ['', '', '서울'],
    ])
  })
})

describe('헤더 행 토글', () => {
  it('헤더를 데이터로 내리고 다시 올린다', () => {
    expect(ds.hasHeader).toBe(true)
    expect(ds.rowCount).toBe(5)

    ds.toggleHeader()
    expect(ds.hasHeader).toBe(false)
    expect(ds.header).toEqual(['A', 'B', 'C', 'D'])
    expect(ds.rowCount).toBe(6)
    expect(ds.rows[0]).toEqual(['id', 'name', 'city', 'qty'])

    ds.toggleHeader()
    expect(ds.hasHeader).toBe(true)
    expect(ds.header).toEqual(['id', 'name', 'city', 'qty'])
    expect(ds.rowCount).toBe(5)
    expect(ds.rows[0]).toEqual(['1', 'kim', '서울', '30'])
  })

  it('토글 후에도 검색 인덱스가 맞다', () => {
    ds.toggleHeader()
    view.query = 'city'
    expect(view.visibleCount).toBe(1) // 헤더가 데이터 행이 되었으므로 검색된다
  })
})

describe('열/행 숨기기', () => {
  it('열을 숨기면 viewCols에서 빠지고 colOrder는 그대로', () => {
    view.hideCols([col('city')])
    expect(view.viewCols).toEqual([0, 1, 3])
    expect(ds.colOrder).toEqual([0, 1, 2, 3]) // 전체 순서는 보존
    expect(view.hiddenColCount).toBe(1)
  })

  it('숨긴 열은 뷰 칼럼 인덱스에서 건너뛴다', () => {
    view.hideCols([col('name')])
    // 뷰 0=id, 1=city, 2=qty
    expect(view.srcCol(0)).toBe(col('id'))
    expect(view.srcCol(1)).toBe(col('city'))
    expect(view.srcCol(2)).toBe(col('qty'))
  })

  it('숨김을 풀면 원래 자리로 돌아온다', () => {
    view.hideCols([col('name')])
    expect(view.viewCols).toEqual([0, 2, 3])
    view.showAllCols()
    expect(view.viewCols).toEqual([0, 1, 2, 3])
  })

  it('모든 열을 숨기려 하면 거부한다', () => {
    expect(view.hideCols([0, 1, 2, 3])).toBe(false)
    expect(view.hiddenColCount).toBe(0)
  })

  it('행을 숨기면 파이프라인에서 제외된다', () => {
    view.hideRows([1, 3])
    expect(view.visibleCount).toBe(3)
    expect(visible().map((r) => r[0])).toEqual(['1', '3', '5'])
  })

  it('숨긴 행은 필터·정렬과 함께 동작한다', () => {
    view.hideRows([0]) // id 1 (kim)
    view.query = 'kim'
    expect(view.visibleCount).toBe(1) // id 5만 남는다
    expect(visible()[0][0]).toBe('5')
  })

  it('행 숨김 해제', () => {
    view.hideRows([0, 1])
    expect(view.visibleCount).toBe(3)
    view.showAllRows()
    expect(view.visibleCount).toBe(5)
  })

  it('칼럼 필터의 고유값 집계는 숨긴 행을 제외한다', () => {
    view.hideRows([0, 2]) // 서울 두 건 제거
    expect(view.columnFiltered.length).toBe(3)
  })

  it('빈 열 탐지', () => {
    const ds2 = new Dataset()
    ds2.loadParsed(
      finalize(parseAll('a,b,c\n1,,x\n2,,y\n3,,z', ','), ',', null, false),
    )
    expect(ds2.emptyCols()).toEqual([1])
  })

  it('빈 열이 없으면 빈 배열', () => {
    expect(ds.emptyCols()).toEqual([])
  })

  it('전부 빈 여러 열을 모두 찾는다', () => {
    const ds2 = new Dataset()
    ds2.loadParsed(finalize(parseAll('a,b,c,d\n1,,x,\n2,,y,', ','), ',', null, false))
    expect(ds2.emptyCols()).toEqual([1, 3])
  })

  it('칼럼 삭제 후 숨김 인덱스가 당겨진다', () => {
    // city(2)를 숨긴 상태에서 name(1)을 삭제하면 city는 source 1이 된다
    view.hideCols([2])
    view.remapHiddenColsAfterDelete([1])
    expect([...view.hiddenCols]).toEqual([1])
  })

  it('숨긴 칼럼 자체를 삭제하면 숨김 집합에서 빠진다', () => {
    view.hideCols([1, 3])
    view.remapHiddenColsAfterDelete([1])
    // 1은 삭제됐고 3은 하나 당겨져 2가 된다
    expect([...view.hiddenCols].sort((a, b) => a - b)).toEqual([2])
  })

  it('clearAll이 숨김까지 해제한다', () => {
    view.hideCols([1])
    view.hideRows([0])
    view.clearAll()
    expect(view.hasHidden).toBe(false)
    expect(view.visibleCount).toBe(5)
  })
})

describe('숨김 상태의 내보내기', () => {
  const base: ExportOptions = {
    scope: 'view',
    format: 'csv',
    target: 'file',
    includeHeader: true,
    applyColOrder: true,
    quoting: 'minimal',
    newline: '\n',
    bom: false,
  }

  it('보이는 부분은 숨긴 열·행을 제외한다', () => {
    view.hideCols([col('city')])
    view.hideRows([0])
    const { matrix } = buildMatrix(ds, view, sel, base)
    expect(matrix[0]).toEqual(['id', 'name', 'qty'])
    expect(matrix).toHaveLength(5) // 헤더 + 4행
  })

  it('전체 + 칼럼순서 미적용은 숨김을 무시한다', () => {
    view.hideCols([col('city')])
    view.hideRows([0])
    const { matrix } = buildMatrix(ds, view, sel, {
      ...base,
      scope: 'all',
      applyColOrder: false,
    })
    expect(matrix[0]).toEqual(['id', 'name', 'city', 'qty'])
    expect(matrix).toHaveLength(6) // 헤더 + 5행 전부
  })

  it('선택 영역은 숨김 이후의 뷰 좌표를 따른다', () => {
    view.hideCols([col('name')]) // 뷰: id, city, qty
    sel.selectCell(0, 0)
    sel.extendTo(0, 1)
    const { matrix } = buildMatrix(ds, view, sel, {
      ...base,
      scope: 'selection',
      includeHeader: false,
    })
    expect(matrix).toEqual([['1', '서울']])
  })
})

describe('행 순서 변경 (placeRows)', () => {
  it('연속 블록을 아래로 옮긴다', () => {
    ds.apply({ t: 'placeRows', picks: [0, 1], dests: [3, 4] })
    expect(ds.rows.map((r) => r[0])).toEqual(['3', '4', '5', '1', '2'])
  })

  it('비연속 선택을 옮긴 뒤 되돌리면 원상복구', () => {
    const before = ds.rows.map((r) => r[0])
    const op: Op = { t: 'placeRows', picks: [0, 4], dests: [0, 1] }
    ds.apply(op)
    expect(ds.rows.map((r) => r[0])).toEqual(['1', '5', '2', '3', '4'])
    ds.apply({ t: 'placeRows', picks: [0, 1], dests: [0, 4] })
    expect(ds.rows.map((r) => r[0])).toEqual(before)
  })

  it('옮긴 뒤에도 검색 인덱스가 행과 짝을 유지한다', () => {
    ds.apply({ t: 'placeRows', picks: [4], dests: [0] })
    view.query = 'choi'
    const hit = view.viewRows[0]
    expect(ds.rows[hit][1]).toBe('choi')
  })
})
