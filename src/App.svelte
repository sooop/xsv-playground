<script lang="ts">
  import { parseClipboardTable, writeTable } from './lib/data/clipboard'
  import { Dataset } from './lib/data/dataset.svelte'
  import { buildMatrix, runExport } from './lib/data/export'
  import type { ReplacePlan } from './lib/data/find'
  import { FindStore } from './lib/data/findState.svelte'
  import { History } from './lib/data/history.svelte'
  import { SelectionStore } from './lib/data/selection.svelte'
  import { toggleSort } from './lib/data/sort'
  import { planJoin, planSplitToCols, planSplitToRows } from './lib/data/transform'
  import type { ExportOptions, Op, Selection } from './lib/data/types'
  import { View } from './lib/data/view.svelte'
  import { parseChunked } from './lib/parse/csv'
  import { decodeAs, decodeBytes, detectDelimiter, finalize } from './lib/parse/detect'
  import { isSheetJSLoaded } from './lib/parse/xlsx'
  import ColumnFilterMenu from './lib/ui/ColumnFilterMenu.svelte'
  import ColumnManager from './lib/ui/ColumnManager.svelte'
  import ContextMenu, { type MenuItem } from './lib/ui/ContextMenu.svelte'
  import DropZone from './lib/ui/DropZone.svelte'
  import { dialogs } from './lib/ui/dialog/dialog.svelte'
  import DialogHost from './lib/ui/dialog/DialogHost.svelte'
  import ExportDialog from './lib/ui/ExportDialog.svelte'
  import FindPanel from './lib/ui/FindPanel.svelte'
  import Grid from './lib/ui/Grid.svelte'
  import JoinDialog, { type JoinResult } from './lib/ui/JoinDialog.svelte'
  import ReplaceDialog from './lib/ui/ReplaceDialog.svelte'
  import ShortcutHelp from './lib/ui/ShortcutHelp.svelte'
  import SmartFilter from './lib/ui/SmartFilter.svelte'
  import SplitDialog, { type SplitResult } from './lib/ui/SplitDialog.svelte'
  import StatusBar from './lib/ui/StatusBar.svelte'
  import Toast, { type ToastItem } from './lib/ui/Toast.svelte'
  import { num } from './lib/util/format'
  import { load, save } from './lib/util/storage'

  const ds = new Dataset()
  const view = new View(ds)
  const sel = new SelectionStore()
  const history = new History(ds)
  const find = new FindStore(ds, view, sel)

  /** 정규식 모드는 세션 간 기억한다 (SmartFilter의 Alt+R이 저장한다) */
  view.regexMode = load('regexMode', false)

  let grid = $state<Grid | null>(null)
  let filterBar = $state<SmartFilter | null>(null)

  const hasData = $derived(ds.colCount > 0)
  /** 화면에 보이는 칼럼 수. 선택 범위는 뷰 좌표계라 ds.colCount와 다를 수 있다(숨김). */
  const viewColCount = $derived(view.viewCols.length)

  // --- 테마 ---
  //
  // 저장하는 것은 **선호(system/light/dark)**이고, `data-theme`에는 항상 **해석된 값**을 쓴다.
  // 이렇게 두면 CSS는 명시적인 두 블록(dark 기본 + [data-theme='light'])만 있으면 되고,
  // prefers-color-scheme 미디어쿼리용으로 라이트 토큰을 한 번 더 복제할 필요가 없다.
  type ThemePref = 'system' | 'light' | 'dark'
  const THEME_CYCLE: ThemePref[] = ['system', 'light', 'dark']
  const THEME_LABEL: Record<ThemePref, string> = {
    system: '시스템 설정 따름',
    light: '라이트',
    dark: '다크',
  }

  let themePref = $state<ThemePref>(load('themePref', 'system'))
  let systemDark = $state(true)

  $effect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark = mq.matches
    const onChange = (e: MediaQueryListEvent) => (systemDark = e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  })

  const theme = $derived(themePref === 'system' ? (systemDark ? 'dark' : 'light') : themePref)

  $effect(() => {
    document.documentElement.dataset.theme = theme
    save('themePref', themePref)
  })

  function cycleTheme(): void {
    themePref = THEME_CYCLE[(THEME_CYCLE.indexOf(themePref) + 1) % THEME_CYCLE.length]
  }

  // --- 토스트 ---
  let toasts = $state<ToastItem[]>([])
  let toastSeq = 0
  function toast(msg: string, kind: ToastItem['kind'] = 'info'): void {
    const id = ++toastSeq
    toasts = [...toasts, { id, msg, kind }]
    setTimeout(() => dismiss(id), kind === 'warn' ? 6000 : 3200)
  }
  function dismiss(id: number): void {
    toasts = toasts.filter((t) => t.id !== id)
  }

  // --- 로딩 ---
  let progress = $state<number | null>(null)
  let progressLabel = $state('')
  let encoding = $state('utf-8')
  /** 인코딩 폴백을 위해 마지막 파일의 원시 바이트를 들고 있는다 */
  let lastBuffer: ArrayBuffer | null = null
  let encodingBanner = $state(false)

  async function loadFiles(files: FileList): Promise<void> {
    const file = files[0]
    if (!file) return
    progress = 0
    progressLabel = `${file.name} 읽는 중…`
    await tick()
    try {
      const buf = await file.arrayBuffer()
      lastBuffer = buf
      const dec = decodeBytes(buf)
      encoding = dec.encoding
      encodingBanner = dec.suspect
      await loadText(dec.text, file.name)
    } catch (e) {
      progress = null
      toast(`파일을 읽지 못했습니다: ${e instanceof Error ? e.message : e}`, 'warn')
    }
  }

  /** cp949 폴백 배너에서 다시 읽기 */
  async function reloadAs(enc: string): Promise<void> {
    if (!lastBuffer) return
    encodingBanner = false
    progress = 0
    progressLabel = `${enc}로 다시 읽는 중…`
    await tick()
    try {
      encoding = enc
      await loadText(decodeAs(lastBuffer, enc), ds.fileName)
    } catch {
      toast(`${enc}로 디코딩할 수 없습니다`, 'warn')
      progress = null
    }
  }

  async function loadText(text: string, fileName: string): Promise<void> {
    progress = 0
    progressLabel = '구분자 인식 중…'
    await tick()

    const delim = detectDelimiter(text.slice(0, 64 << 10))
    const raw = await parseChunked(text, delim, (ratio, rows) => {
      progress = ratio * 0.9
      progressLabel = `${num(rows)}행 파싱…`
    })

    progressLabel = '정리 중…'
    progress = 0.95
    await tick()

    const result = finalize(raw, delim, null, encodingBanner)
    ds.loadParsed(result, fileName)

    view.clearAll()
    sel.clear()
    history.clear()
    progress = null

    if (result.rows.length === 0) {
      toast('데이터 행이 없습니다', 'warn')
      return
    }
    const bits = [`${num(result.rows.length)}행 × ${result.width}열`]
    if (result.raggedRows > 0) bits.push(`불규칙 행 ${num(result.raggedRows)}개 패딩`)
    if (!result.hasHeader) bits.push('헤더 없음으로 판단')
    toast(bits.join(' · '), 'ok')

    // 그리드가 즉시 키보드를 받도록
    await tick()
    grid?.focusGrid()
  }

  function loadPastedText(text: string): void {
    lastBuffer = null
    encoding = 'utf-8'
    encodingBanner = false
    void loadText(text, '')
  }

  function tick(): Promise<void> {
    // 진행률 오버레이가 실제로 그려질 프레임을 확보한다
    return new Promise((r) => requestAnimationFrame(() => r()))
  }

  const SAMPLE = `주문번호,고객명,상품,수량,단가,주문일,상태
ORD-1001,김하늘,무선 이어폰,2,89000,2026-01-14,배송완료
ORD-1002,이준호,USB-C 허브,1,42500,2026-01-15,배송중
ORD-1003,박서연,"모니터 27"" QHD",1,289000,2026-01-15,배송완료
ORD-1004,최민준,기계식 키보드,3,132000,2026-01-16,결제대기
ORD-1005,정다은,노트북 스탠드,1,38000,2026-01-17,배송완료
ORD-1006,김하늘,"케이블, 1.5m",5,7900,2026-01-18,취소
ORD-1007,윤재현,웹캠 1080p,2,64000,2026-01-18,배송중
ORD-1008,장미르,외장 SSD 1TB,1,118000,2026-01-19,배송완료
ORD-1009,이준호,마우스패드,4,12000,2026-01-20,결제대기
ORD-1010,한소진,노이즈캔슬링 헤드폰,1,349000,2026-01-21,배송중`

  function loadSample(): void {
    loadPastedText(SAMPLE)
  }

  // --- 편집 연산 ---

  /**
   * 연산을 히스토리에 기록하며 적용한다.
   * @param clearSelection 구조가 바뀌어 뷰 좌표의 의미가 사라지는 경우
   */
  function pushOp(op: Op, clearSelection = false): void {
    const before = sel.snapshot()
    const res = history.push(op, before, clearSelection ? null : before)
    if (res.structural || clearSelection) sel.clear()

    // 숨김 집합은 source 인덱스로 저장되므로, 행이 삽입·삭제·재배치되면 어긋난다.
    // 칼럼 쪽은 삭제 시 remapHiddenColsAfterDelete로 정확히 보정하고,
    // 행 쪽은 재매핑 비용 대비 실익이 없어 숨김을 해제하고 알린다.
    if (op.t === 'insertRows' || op.t === 'deleteRows' || op.t === 'placeRows') {
      if (view.hiddenRowCount > 0) {
        view.showAllRows()
        toast('행 구조가 바뀌어 행 숨김이 해제되었습니다', 'warn')
      }
    }
    sel.clampTo(view.visibleCount, viewColCount)
  }

  function commitCell(srcRow: number, srcCol: number, value: string): void {
    const before = ds.rows[srcRow]?.[srcCol] ?? ''
    if (before === value) return
    pushOp({ t: 'cells', changes: [{ r: srcRow, c: srcCol, before, after: value }] })
  }

  function renameHeader(srcCol: number, name: string): void {
    pushOp({ t: 'renameCol', c: srcCol, before: ds.header[srcCol] ?? '', after: name })
  }

  /**
   * 열 순서 변경. 인자는 **뷰** 칼럼 인덱스다.
   *
   * 숨은 칼럼이 섞여 있으면 뷰 위치와 `colOrder` 위치가 어긋나므로, 보이는 칼럼들의 순서만
   * 재배열한 뒤 숨은 칼럼은 원래 `colOrder` 자리에 그대로 남기는 방식으로 전체 순서를 다시 만든다.
   */
  function moveCol(fromView: number, toView: number): void {
    const before = ds.colOrder.slice()
    const visible = view.viewCols.slice()
    if (fromView < 0 || fromView >= visible.length) return

    // 보이는 칼럼 순서만 재배열
    const reordered = visible.slice()
    const [moved] = reordered.splice(fromView, 1)
    reordered.splice(Math.max(0, Math.min(reordered.length, toView)), 0, moved)

    // 전체 순서 재구성: colOrder를 훑으며 보이는 자리에는 새 순서를, 숨은 칼럼은 제자리에
    const hidden = view.hiddenCols
    const after: number[] = []
    let k = 0
    for (const c of before) {
      after.push(hidden.has(c) ? c : reordered[k++])
    }
    if (after.length !== before.length) return // 방어

    pushOp({ t: 'setColOrder', before, after })

    // 선택 재매핑: 이전 뷰 인덱스 → 새 뷰 인덱스
    const inverse: number[] = new Array(visible.length)
    for (let i = 0; i < visible.length; i++) inverse[i] = reordered.indexOf(visible[i])
    sel.remapCols(inverse)
  }

  function moveRows(viewRows: number[], toViewRow: number): void {
    if (view.isSorted) {
      toast('정렬을 해제해야 행 순서를 바꿀 수 있습니다', 'warn')
      return
    }
    const picks = viewRows.map((r) => view.viewRows[r]).filter((v) => v !== undefined)
    if (picks.length === 0) return
    picks.sort((a, b) => a - b)

    // 목표 지점의 source 인덱스. 맨 끝이면 rowCount.
    const toSrc =
      toViewRow >= view.viewRows.length ? ds.rowCount : (view.viewRows[toViewRow] ?? ds.rowCount)

    // 제거 후 삽입 위치 보정 — toSrc 앞에서 빠져나간 개수만큼 당겨진다
    const before = picks.filter((i) => i < toSrc).length
    const at = toSrc - before
    const dests = picks.map((_, k) => at + k)
    if (dests.every((d, k) => d === picks[k])) return // 제자리

    pushOp({ t: 'placeRows', picks, dests }, true)
  }

  /** 선택 영역의 (source) 셀 좌표를 중복 없이 모은다 */
  function selectedSourceCells(): { r: number; c: number }[] {
    const seen = new Set<number>()
    const out: { r: number; c: number }[] = []
    const stride = ds.colCount
    for (const rg of sel.ranges) {
      for (let r = rg.r0; r <= rg.r1; r++) {
        const src = view.viewRows[r]
        if (src === undefined) continue
        for (let c = rg.c0; c <= rg.c1; c++) {
          const sc = view.srcCol(c)
          if (sc === undefined) continue
          const key = src * stride + sc
          if (seen.has(key)) continue
          seen.add(key)
          out.push({ r: src, c: sc })
        }
      }
    }
    return out
  }

  function deleteContents(): void {
    const cells = selectedSourceCells()
    const changes: { r: number; c: number; before: string; after: string }[] = []
    for (const { r, c } of cells) {
      const before = ds.rows[r]?.[c] ?? ''
      if (before !== '') changes.push({ r, c, before, after: '' })
    }
    if (changes.length === 0) return
    pushOp({ t: 'cells', changes })
  }

  async function copySelection(): Promise<void> {
    if (sel.ranges.length === 0) {
      toast('복사할 선택이 없습니다')
      return
    }
    const { matrix, truncatedFromMultiRange } = buildMatrix(ds, view, sel, {
      scope: 'selection',
      format: 'tsv',
      target: 'clipboard',
      includeHeader: false,
      applyColOrder: true,
      quoting: 'minimal',
      newline: '\n',
      bom: false,
    })
    if (matrix.length === 0) return
    await writeTable(matrix, { headerRow: false })
    if (truncatedFromMultiRange) {
      toast('여러 범위를 감싸는 사각형으로 복사했습니다 (선택 밖은 빈 값)', 'warn')
    } else {
      toast(`${num(matrix.length)}행 × ${matrix[0].length}열 복사`, 'ok')
    }
  }

  /**
   * 붙여넣기 — 선택 좌상단부터 블록을 덮어쓴다.
   * 기존 격자 경계를 넘으면 잘라내고 알린다. 칼럼을 몰래 늘려 스키마를 바꾸지 않는다.
   */
  function pasteText(text: string): void {
    if (!hasData) {
      loadPastedText(text)
      return
    }
    const block = parseClipboardTable(text)
    if (block.length === 0) return

    let r0 = sel.ranges.length > 0 ? Math.min(...sel.ranges.map((r) => r.r0)) : 0
    let c0 = sel.ranges.length > 0 ? Math.min(...sel.ranges.map((r) => r.c0)) : 0
    r0 = Math.max(0, r0)
    c0 = Math.max(0, c0)

    const maxR = view.viewRows.length
    const maxC = view.viewCols.length
    const fitRows = Math.min(block.length, maxR - r0)
    const fitCols = Math.min(block[0].length, maxC - c0)
    if (fitRows <= 0 || fitCols <= 0) {
      toast('붙여넣을 공간이 없습니다', 'warn')
      return
    }

    const changes: { r: number; c: number; before: string; after: string }[] = []
    for (let i = 0; i < fitRows; i++) {
      const src = view.viewRows[r0 + i]
      if (src === undefined) continue
      for (let j = 0; j < fitCols; j++) {
        const sc = view.srcCol(c0 + j)
        const before = ds.rows[src]?.[sc] ?? ''
        const after = block[i][j] ?? ''
        if (before !== after) changes.push({ r: src, c: sc, before, after })
      }
    }

    if (changes.length > 0) {
      const snap = sel.snapshot()
      history.push({ t: 'cells', changes }, snap, snap)
    }

    // 붙여넣은 블록을 선택 상태로 남긴다
    sel.ranges = [{ r0, r1: r0 + fitRows - 1, c0, c1: c0 + fitCols - 1, kind: 'cell' }]
    sel.anchor = { r: r0, c: c0 }
    sel.active = { r: r0, c: c0 }

    const cutR = block.length - fitRows
    const cutC = block[0].length - fitCols
    if (cutR > 0 || cutC > 0) {
      const parts: string[] = []
      if (cutR > 0) parts.push(`${num(cutR)}행`)
      if (cutC > 0) parts.push(`${num(cutC)}열`)
      toast(`격자 밖 ${parts.join(' · ')}은 잘렸습니다`, 'warn')
    } else if (changes.length === 0) {
      toast('값이 모두 동일해 변경 없음')
    } else {
      toast(`${num(fitRows)}행 × ${num(fitCols)}열 붙여넣기`, 'ok')
    }
  }

  /**
   * 되돌리기/다시하기 공통 후처리.
   *
   * 구조가 바뀌는 연산을 되돌리면 source 인덱스가 다시 이동한다. 정방향에서는 삭제 폭을 알기에
   * 숨김을 정확히 보정할 수 있지만 역방향까지 추적하면 복잡도만 커지므로, 이때는 숨김을 모두
   * 풀고 사용자에게 알린다 — 데이터가 사라지는 방향이 아니라 드러나는 방향이라 안전하다.
   */
  function afterHistory(r: { selection: Selection | null; structural: boolean } | null): void {
    if (!r) return
    if (r.structural && view.hasHidden) {
      view.showAll()
      toast('구조 변경을 되돌려 숨김이 해제되었습니다', 'warn')
    }
    sel.restore(r.selection)
    sel.clampTo(view.visibleCount, viewColCount)
  }

  function doUndo(): void {
    afterHistory(history.undo())
  }

  function doRedo(): void {
    afterHistory(history.redo())
  }

  function sortByCol(srcCol: number, additive: boolean): void {
    view.sorts = toggleSort(view.sorts, srcCol, additive)
    sel.clear() // 뷰 좌표의 의미가 바뀐다
  }

  function toggleHeaderRow(): void {
    const had = history.canUndo
    ds.toggleHeader()
    view.clearColumnFilters()
    sel.clear()
    history.clear()
    if (had) toast('헤더를 바꿨습니다 — 실행 취소 기록이 초기화되었습니다', 'warn')
  }

  // --- 행/열 구조 조작 ---

  function blankRow(): string[] {
    return new Array(ds.colCount).fill('')
  }

  function insertRows(where: 'above' | 'below'): void {
    const rows = sel.fullySelectedRows(viewColCount - 1)
    const viewRows = rows.length > 0 ? rows : [sel.active.r]
    const srcs = viewRows.map((r) => view.viewRows[r]).filter((v) => v !== undefined)
    if (srcs.length === 0) {
      pushOp({ t: 'insertRows', at: [ds.rowCount], rows: [blankRow()] }, true)
      return
    }
    srcs.sort((a, b) => a - b)
    const base = where === 'above' ? srcs[0] : srcs[srcs.length - 1] + 1
    const at = srcs.map((_, k) => base + k)
    pushOp({ t: 'insertRows', at, rows: srcs.map(() => blankRow()) }, true)
  }

  /** 이 개수를 넘는 파괴적 조작은 확인을 받는다 (되돌릴 수 있지만 실수로 누르기 쉽다) */
  const CONFIRM_THRESHOLD = 20

  async function deleteSelectedRows(): Promise<void> {
    const viewRows = sel.fullySelectedRows(viewColCount - 1)
    if (viewRows.length === 0) return
    const at = viewRows.map((r) => view.viewRows[r]).filter((v) => v !== undefined)
    at.sort((a, b) => a - b)
    if (at.length === 0) return

    if (at.length > CONFIRM_THRESHOLD) {
      const ok = await dialogs.confirm({
        message: `${num(at.length)}행을 삭제할까요?`,
        detail: 'Ctrl+Z로 되돌릴 수 있습니다.',
        okLabel: '삭제',
        danger: true,
      })
      if (!ok) return
    }
    pushOp({ t: 'deleteRows', at, rows: at.map((i) => ds.rows[i].slice()) }, true)
    toast(`${num(at.length)}행 삭제`, 'ok')
  }

  function duplicateSelectedRows(): void {
    const viewRows = sel.fullySelectedRows(viewColCount - 1)
    if (viewRows.length === 0) return
    const srcs = viewRows.map((r) => view.viewRows[r]).filter((v) => v !== undefined)
    srcs.sort((a, b) => a - b)
    if (srcs.length === 0) return
    const base = srcs[srcs.length - 1] + 1
    pushOp(
      {
        t: 'insertRows',
        at: srcs.map((_, k) => base + k),
        rows: srcs.map((i) => ds.rows[i].slice()),
      },
      true,
    )
  }

  /**
   * 새 source 칼럼을 **뷰 위치** `viewPos`에 놓는 `colOrder`를 만든다.
   * 숨은 칼럼이 섞여 있으면 뷰 위치와 colOrder 위치가 다르므로 변환이 필요하다.
   */
  function insertIntoOrder(newSrc: number, viewPos: number): number[] {
    const order = ds.colOrder
    const hidden = view.hiddenCols
    const out: number[] = []
    let seen = 0 // 지금까지 지나온 보이는 칼럼 수
    let placed = false
    for (const c of order) {
      if (!hidden.has(c)) {
        if (seen === viewPos && !placed) {
          out.push(newSrc)
          placed = true
        }
        seen++
      }
      out.push(c)
    }
    if (!placed) out.push(newSrc)
    return out
  }

  /**
   * 열 삽입. 새 칼럼을 **source 배열 끝에 붙이고** 뷰 순서(colOrder)로 원하는 자리에 놓는다.
   * 기존 source 인덱스가 밀리지 않아 되돌리기와 좌표 계산이 단순해진다.
   */
  function insertCol(where: 'left' | 'right'): void {
    const viewPos = where === 'left' ? sel.active.c : sel.active.c + 1
    const newSrc = ds.colCount
    const orderAfter = insertIntoOrder(newSrc, viewPos)
    pushOp(
      {
        t: 'insertCols',
        at: [newSrc],
        names: ['새 칼럼'],
        values: ds.rows.map(() => ['']),
        orderBefore: ds.colOrder.slice(),
        orderAfter,
      },
      true,
    )
  }

  /**
   * source 칼럼들을 삭제한다. 삭제로 뒤쪽 source 인덱스가 당겨지므로 `colOrder`와
   * 숨김 집합을 함께 보정한다.
   */
  function deleteColsBySrc(srcCols: readonly number[]): void {
    const at = [...new Set(srcCols)].sort((a, b) => a - b)
    if (at.length === 0) return
    if (at.length >= ds.colCount) {
      toast('모든 열을 지울 수는 없습니다', 'warn')
      return
    }
    const del = new Set(at)
    // 남는 칼럼의 source 인덱스는 앞에서 빠진 개수만큼 당겨진다
    const shift = (c: number) => c - at.filter((d) => d < c).length
    const orderAfter = ds.colOrder.filter((c) => !del.has(c)).map(shift)

    pushOp(
      {
        t: 'deleteCols',
        at,
        names: at.map((c) => ds.header[c] ?? ''),
        values: ds.rows.map((row) => at.map((c) => row[c] ?? '')),
        orderBefore: ds.colOrder.slice(),
        orderAfter,
      },
      true,
    )
    // 숨김 집합도 같은 규칙으로 당겨 준다 (숨긴 칼럼을 지운 경우 포함)
    view.remapHiddenColsAfterDelete(at)
    // 칼럼 필터는 source 인덱스를 키로 쓰므로 어긋나지 않게 정리한다
    view.clearColumnFilters()
    toast(`${num(at.length)}열 삭제`, 'ok')
  }

  async function deleteSelectedCols(): Promise<void> {
    const viewCols = sel.fullySelectedCols(view.visibleCount - 1)
    if (viewCols.length === 0) return
    const srcCols = viewCols.map((c) => view.srcCol(c))
    if (srcCols.length > 1) {
      const names = srcCols.map((c) => ds.header[c] ?? '').join(', ')
      const ok = await dialogs.confirm({
        message: `${num(srcCols.length)}개 열을 삭제할까요?`,
        detail: names,
        okLabel: '삭제',
        danger: true,
      })
      if (!ok) return
    }
    deleteColsBySrc(srcCols)
  }

  async function deleteEmptyCols(): Promise<void> {
    const empty = ds.emptyCols()
    if (empty.length === 0) {
      await dialogs.alert({ message: '빈 열이 없습니다' })
      return
    }
    const ok = await dialogs.confirm({
      message: `빈 열 ${num(empty.length)}개를 삭제할까요?`,
      detail: empty.map((c) => ds.header[c] ?? '').join(', '),
      okLabel: '삭제',
      danger: true,
    })
    if (!ok) return
    deleteColsBySrc(empty)
  }

  // --- 숨기기 (뷰 상태 — 편집 히스토리와 무관) ---

  function hideSelectedCols(): void {
    const viewCols = sel.fullySelectedCols(view.visibleCount - 1)
    if (viewCols.length === 0) return
    const srcCols = viewCols.map((c) => view.srcCol(c))
    if (!view.hideCols(srcCols)) {
      toast('모든 열을 숨길 수는 없습니다', 'warn')
      return
    }
    sel.clear()
    toast(`${num(srcCols.length)}열 숨김`, 'ok')
  }

  function hideEmptyCols(): void {
    const empty = ds.emptyCols()
    const fresh = empty.filter((c) => !view.hiddenCols.has(c))
    if (fresh.length === 0) {
      toast(empty.length === 0 ? '빈 열이 없습니다' : '빈 열은 이미 모두 숨겨져 있습니다')
      return
    }
    if (!view.hideCols(fresh)) {
      toast('모든 열이 비어 있어 숨길 수 없습니다', 'warn')
      return
    }
    sel.clear()
    toast(`빈 열 ${num(fresh.length)}개 숨김`, 'ok')
  }

  function hideSelectedRows(): void {
    const viewRows = sel.fullySelectedRows(viewColCount - 1)
    if (viewRows.length === 0) return
    const srcRows = viewRows.map((r) => view.viewRows[r]).filter((v) => v !== undefined)
    if (srcRows.length === 0) return
    view.hideRows(srcRows)
    sel.clear()
    toast(`${num(srcRows.length)}행 숨김`, 'ok')
  }

  function showAllHidden(): void {
    const c = view.hiddenColCount
    const r = view.hiddenRowCount
    if (c === 0 && r === 0) return
    view.showAll()
    const parts: string[] = []
    if (c > 0) parts.push(`${num(c)}열`)
    if (r > 0) parts.push(`${num(r)}행`)
    toast(`${parts.join(' · ')} 숨김 해제`, 'ok')
  }

  function duplicateCol(): void {
    const viewPos = sel.active.c
    const srcCol = view.srcCol(viewPos)
    if (srcCol === undefined) return
    const newSrc = ds.colCount
    const orderAfter = insertIntoOrder(newSrc, viewPos + 1)
    pushOp(
      {
        t: 'insertCols',
        at: [newSrc],
        names: [`${ds.header[srcCol]} 사본`],
        values: ds.rows.map((row) => [row[srcCol] ?? '']),
        orderBefore: ds.colOrder.slice(),
        orderAfter,
      },
      true,
    )
  }

  // --- 컨텍스트 메뉴 ---

  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null)

  function openContextMenu(e: MouseEvent): void {
    const rowSel = sel.fullySelectedRows(viewColCount - 1)
    const colSel = sel.fullySelectedCols(view.visibleCount - 1)
    const hasSel = sel.ranges.length > 0
    const n = (k: number) => (k > 1 ? ` (${k})` : '')
    const emptyCount = ds.emptyCols().filter((c) => !view.hiddenCols.has(c)).length
    const hiddenTotal = view.hiddenColCount + view.hiddenRowCount

    menu = {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: '복사', accel: 'c', hint: 'Ctrl C', disabled: !hasSel, run: () => void copySelection() },
        { label: '내용 지우기', accel: 'e', hint: 'Del', disabled: !hasSel, run: deleteContents },
        { label: '', sep: true },
        { label: '위에 행 삽입', accel: 'a', run: () => insertRows('above') },
        { label: '아래에 행 삽입', accel: 'b', run: () => insertRows('below') },
        {
          label: `행 복제${n(rowSel.length)}`,
          accel: 'w',
          disabled: rowSel.length === 0,
          run: duplicateSelectedRows,
        },
        {
          label: `행 숨기기${n(rowSel.length)}`,
          accel: 'h',
          disabled: rowSel.length === 0,
          run: hideSelectedRows,
        },
        {
          label: `행 삭제${n(rowSel.length)}`,
          accel: 'd',
          disabled: rowSel.length === 0,
          danger: true,
          run: () => void deleteSelectedRows(),
        },
        { label: '', sep: true },
        { label: '왼쪽에 열 삽입', accel: 'l', run: () => insertCol('left') },
        { label: '오른쪽에 열 삽입', accel: 'r', run: () => insertCol('right') },
        { label: '열 복제', accel: 'p', run: duplicateCol },
        {
          label: `열 숨기기${n(colSel.length)}`,
          accel: 'i',
          disabled: colSel.length === 0,
          run: hideSelectedCols,
        },
        {
          label: `열 삭제${n(colSel.length)}`,
          accel: 'x',
          disabled: colSel.length === 0,
          danger: true,
          run: () => void deleteSelectedCols(),
        },
        { label: '', sep: true },
        {
          label: `빈 열 모두 숨기기${emptyCount > 0 ? ` (${emptyCount})` : ''}`,
          accel: 'n',
          disabled: emptyCount === 0,
          run: hideEmptyCols,
        },
        {
          label: `빈 열 모두 삭제${emptyCount > 0 ? ` (${emptyCount})` : ''}`,
          accel: 'm',
          disabled: emptyCount === 0,
          danger: true,
          run: () => void deleteEmptyCols(),
        },
        { label: '', sep: true },
        {
          label: '열 나누기…',
          accel: 's',
          disabled: colSel.length > 1,
          run: openSplit,
        },
        {
          label: `열 결합…${colSel.length >= 2 ? ` (${colSel.length})` : ''}`,
          accel: 'j',
          disabled: colSel.length < 2,
          run: openJoin,
        },
        {
          label: `숨김 모두 해제${hiddenTotal > 0 ? ` (${hiddenTotal})` : ''}`,
          accel: 'u',
          disabled: hiddenTotal === 0,
          run: showAllHidden,
        },
      ],
    }
  }

  // --- 칼럼 필터 드롭다운 ---
  let colMenu = $state<{ col: number; anchor: HTMLElement } | null>(null)

  // --- 다이얼로그 ---
  let showExport = $state(false)
  let showHelp = $state(false)

  // --- 도구: 찾기 / 바꾸기 / 나누기 / 결합 ---

  let findPanel = $state<FindPanel | null>(null)
  let showReplace = $state(false)
  let splitTarget = $state<number | null>(null)
  let joinTargets = $state<number[] | null>(null)
  let toolsMenu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null)
  let colManagerAnchor = $state<HTMLElement | null>(null)

  function openFind(): void {
    find.open = true
    // 패널이 그려진 뒤에 포커스를 준다
    requestAnimationFrame(() => findPanel?.focus())
  }

  function closeFind(): void {
    find.open = false
    find.reset()
    grid?.focusGrid()
  }

  /** 찾기 결과로 이동 — 활성 셀을 옮기고 화면에 보이게 한다 */
  function gotoHit(hit: { r: number; c: number } | null): void {
    if (!hit) return
    sel.selectCell(hit.r, hit.c)
    grid?.scrollToCell(hit.r, hit.c)
  }

  function applyReplace(plan: ReplacePlan, label: string): void {
    showReplace = false
    if (plan.changes.length === 0) return
    pushOp({ t: 'cells', changes: plan.changes })
    toast(label, 'ok')
  }

  /** 나누기 대상 열 결정 — 선택된 열이 하나면 그것, 없으면 활성 셀의 열 */
  function resolveSplitTarget(): number | null {
    const cols = sel.fullySelectedCols(view.visibleCount - 1)
    if (cols.length > 1) return null
    const viewCol = cols.length === 1 ? cols[0] : sel.active.c
    const srcCol = view.srcCol(viewCol)
    return srcCol === undefined ? null : srcCol
  }

  function openSplit(): void {
    const t = resolveSplitTarget()
    if (t === null) {
      toast('나눌 열 하나를 선택하세요', 'warn')
      return
    }
    splitTarget = t
  }

  async function applySplit(res: SplitResult): Promise<void> {
    const col = splitTarget
    splitTarget = null
    if (col === null) return

    if (res.mode === 'cols') {
      const plan = planSplitToCols(ds, col, res.spec)
      if (plan.error || plan.count <= 1) return

      // 새 칼럼은 source 배열 끝에 붙이고, 뷰에서는 원본 열 바로 뒤에 놓는다
      const base = ds.colCount
      const at = Array.from({ length: plan.count }, (_, k) => base + k)
      const viewPos = view.viewCols.indexOf(col)
      let orderAfter = ds.colOrder.slice()
      const insertAt =
        viewPos < 0 ? orderAfter.length : orderAfter.indexOf(col) + 1
      orderAfter.splice(insertAt, 0, ...at)

      pushOp(
        {
          t: 'insertCols',
          at,
          names: plan.names,
          values: plan.values,
          orderBefore: ds.colOrder.slice(),
          orderAfter,
        },
        true,
      )

      if (!res.keepSource) {
        // 삽입 후 원본 열의 source 인덱스는 그대로다(끝에 붙였으므로)
        deleteColsBySrc([col])
      }
      toast(`${plan.count}개 열로 나눔${plan.cappedRows > 0 ? ` · ${num(plan.cappedRows)}행 상한 적용` : ''}`, 'ok')
      return
    }

    // 행으로 분리 — 행 수가 크게 늘 수 있어 미리 확인을 받는다
    const plan = planSplitToRows(ds, col, res.spec)
    if (plan.error || plan.expandedRows === 0) return
    const grew = plan.rowCount - ds.rowCount
    if (grew > 20_000) {
      const ok = await dialogs.confirm({
        title: '행이 크게 늘어납니다',
        message: `${num(ds.rowCount)}행 → ${num(plan.rowCount)}행 (${num(grew)}행 증가)`,
        detail: '되돌리기를 위해 변경 전후를 모두 보관하므로 메모리를 많이 씁니다. 계속할까요?',
        okLabel: '계속',
        tone: 'warn',
      })
      if (!ok) return
    }
    pushOp({ t: 'replaceRows', before: ds.rows.map((r) => r.slice()), after: plan.after }, true)
    toast(`${num(plan.expandedRows)}행이 ${num(plan.rowCount)}행으로 나뉨`, 'ok')
  }

  function openJoin(): void {
    const cols = sel.fullySelectedCols(view.visibleCount - 1)
    if (cols.length < 2) {
      toast('결합할 열을 둘 이상 선택하세요 (헤더 클릭 후 Ctrl·Shift+클릭)', 'warn')
      return
    }
    joinTargets = cols.map((c) => view.srcCol(c))
  }

  function applyJoin(res: JoinResult): void {
    const cols = joinTargets
    joinTargets = null
    if (!cols || cols.length < 2) return

    const plan = planJoin(ds, cols, res.spec)
    const newSrc = ds.colCount
    // 결합한 열 중 가장 오른쪽(뷰 기준) 바로 뒤에 새 열을 놓는다
    const order = ds.colOrder
    let lastPos = -1
    for (const c of cols) lastPos = Math.max(lastPos, order.indexOf(c))
    const orderAfter = order.slice()
    orderAfter.splice(lastPos + 1, 0, newSrc)

    pushOp(
      {
        t: 'insertCols',
        at: [newSrc],
        names: [res.name],
        values: plan.values,
        orderBefore: order.slice(),
        orderAfter,
      },
      true,
    )

    if (res.removeSources) deleteColsBySrc(cols)
    toast(`${cols.length}개 열을 "${res.name}"으로 결합`, 'ok')
  }

  function openToolsMenu(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const colSel = sel.fullySelectedCols(view.visibleCount - 1)
    toolsMenu = {
      x: r.left,
      y: r.bottom + 4,
      items: [
        { label: '찾기…', accel: 'f', hint: 'Ctrl F', run: openFind },
        { label: '바꾸기…', accel: 'h', hint: 'Ctrl H', run: () => (showReplace = true) },
        { label: '', sep: true },
        {
          label: '열 나누기…',
          accel: 's',
          hint: colSel.length > 1 ? '열 하나만' : '',
          disabled: colSel.length > 1,
          run: openSplit,
        },
        {
          label: `열 결합…${colSel.length >= 2 ? ` (${colSel.length})` : ''}`,
          accel: 'j',
          hint: colSel.length < 2 ? '열 2개 이상' : '',
          disabled: colSel.length < 2,
          run: openJoin,
        },
      ],
    }
  }

  async function doExport(opts: ExportOptions): Promise<void> {
    showExport = false
    // xlsx는 SheetJS를 CDN에서 처음 받아오는 동안 다른 형식보다 오래 걸릴 수 있어 미리 안내한다
    // (이미 받아와 있으면 매번 뜨는 게 소음이라 최초 1회만 보여준다)
    if (opts.format === 'xlsx' && !isSheetJSLoaded()) toast('xlsx 준비 중 (SheetJS를 CDN에서 받는 중)…')
    try {
      const msg = await runExport(ds, view, sel, opts)
      toast(msg, 'ok')
    } catch (e) {
      toast(`내보내기 실패: ${e instanceof Error ? e.message : e}`, 'warn')
    }
  }

  let fileInput = $state<HTMLInputElement | null>(null)

  // --- 전역 단축키 ---

  function inEditable(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
  }

  /**
   * 전역 단축키. **캡처 단계**에서 처리한다.
   *
   * 버블 단계로 두면 그리드의 keydown이 먼저 실행되어 `/`나 `?`를 "인쇄 가능한 문자"로 보고
   * 셀 편집을 시작해 버린다(그리고 곧바로 포커스를 잃으며 그 문자가 셀에 저장된다).
   * 여기서 가로채고 `stopPropagation`으로 아래로 내려보내지 않는 것이 유일하게 확실한 방법이다.
   */
  function onGlobalKeyDown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey
    const editable = inEditable(e.target)
    const take = () => {
      e.preventDefault()
      e.stopPropagation()
    }

    // 입력란 안에서는 문자로 들어가야 하므로 가로채지 않는다
    if (!editable && !mod && !e.altKey) {
      if (e.key === '/') {
        take()
        filterBar?.focus()
        return
      }
      if (e.key === '?') {
        take()
        showHelp = !showHelp
        return
      }
    }
    // Ctrl+F는 보편적인 "찾기" 관례를 따른다. 스마트 필터는 `/`가 담당한다.
    if (mod && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
      take()
      if (hasData) {
        if (find.open) findPanel?.focus()
        else openFind()
      }
      return
    }
    if (mod && (e.key === 'h' || e.key === 'H')) {
      take()
      if (hasData) showReplace = true
      return
    }
    // 패널이 닫혀 있어도 F3으로 다음/이전 매치를 순회할 수 있게 한다
    if (e.key === 'F3' && find.open) {
      take()
      gotoHit(find.step(e.shiftKey ? -1 : 1))
      return
    }
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      take()
      if (e.shiftKey) doRedo()
      else doUndo()
      return
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      take()
      doRedo()
      return
    }
    if (mod && (e.key === 'e' || e.key === 'E')) {
      take()
      if (hasData) showExport = true
      return
    }
    if (mod && (e.key === 'o' || e.key === 'O')) {
      take()
      fileInput?.click()
      return
    }
    if (e.key === 'Escape') {
      // 열려 있는 오버레이를 위에서부터 하나씩 닫는다
      if (menu || toolsMenu) {
        take()
        menu = null
        toolsMenu = null
      } else if (showExport || showHelp || showReplace || splitTarget !== null || joinTargets) {
        take()
        showExport = false
        showHelp = false
        showReplace = false
        splitTarget = null
        joinTargets = null
      } else if (find.open) {
        take()
        closeFind()
      }
    }
  }

  $effect(() => {
    window.addEventListener('keydown', onGlobalKeyDown, true)
    return () => window.removeEventListener('keydown', onGlobalKeyDown, true)
  })

  /** 창 전체에 파일을 떨어뜨려도 열리게 한다 */
  let dragDepth = $state(0)
  function onWindowDragOver(e: DragEvent): void {
    if (!hasData) return
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault()
      dragDepth = 1
    }
  }
  function onWindowDrop(e: DragEvent): void {
    if (!hasData) return
    dragDepth = 0
    const files = e.dataTransfer?.files
    if (files?.length) {
      e.preventDefault()
      void loadFiles(files)
    }
  }
</script>

<svelte:window
  ondragover={onWindowDragOver}
  ondragleave={() => (dragDepth = 0)}
  ondrop={onWindowDrop}
/>

<div class="app">
  {#if hasData}
    <header class="toolbar">
      <button class="brand" onclick={() => (showHelp = true)} title="단축키 (?)">xsv</button>

      <span class="divider"></span>

      <button class="btn" onclick={() => fileInput?.click()} title="파일 열기 (Ctrl+O)">열기</button>

      <button
        class="btn"
        class:on={ds.hasHeader}
        onclick={toggleHeaderRow}
        title="첫 행을 헤더로 다룰지 전환"
      >
        헤더행
      </button>

      <span class="divider"></span>

      <button
        class="btn icon"
        disabled={!history.canUndo}
        onclick={doUndo}
        title="실행 취소 (Ctrl+Z)"
        aria-label="실행 취소"
      >
        <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
          <path d="M4 4.5H8.6a3.4 3.4 0 010 6.8H4.5" fill="none" stroke="currentColor"
            stroke-width="1.4" stroke-linecap="round" />
          <path d="M6 2L3.4 4.5 6 7" fill="none" stroke="currentColor" stroke-width="1.4"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button
        class="btn icon"
        disabled={!history.canRedo}
        onclick={doRedo}
        title="다시 실행 (Ctrl+Shift+Z)"
        aria-label="다시 실행"
      >
        <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
          <path d="M10 4.5H5.4a3.4 3.4 0 000 6.8h4.1" fill="none" stroke="currentColor"
            stroke-width="1.4" stroke-linecap="round" />
          <path d="M8 2l2.6 2.5L8 7" fill="none" stroke="currentColor" stroke-width="1.4"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <span class="divider"></span>

      <SmartFilter bind:this={filterBar} {view} totalRows={ds.rowCount} />

      {#if view.sorts.length > 0 || view.activeColumnFilterCount > 0}
        <button
          class="btn"
          onclick={() => {
            view.sorts = []
            view.clearColumnFilters()
            sel.clear()
          }}
          title="정렬과 칼럼 필터를 모두 해제"
        >
          초기화
        </button>
      {/if}

      <span class="divider"></span>

      <button
        class="btn"
        class:on={view.hiddenColCount > 0}
        onclick={(e) => (colManagerAnchor = colManagerAnchor ? null : (e.currentTarget as HTMLElement))}
        title="열 관리 — 열을 켜고 끄기"
      >
        열 관리{view.hiddenColCount > 0 ? ` ${view.hiddenColCount}` : ''}
      </button>

      <button class="btn" class:on={find.open} onclick={openToolsMenu} title="찾기·바꾸기·나누기·결합">
        도구
        <svg viewBox="0 0 8 5" width="7" height="5" aria-hidden="true"><path d="M0 0l4 4.4L8 0z" fill="currentColor" /></svg>
      </button>

      <button class="btn outline" onclick={() => (showExport = true)} title="내보내기 (Ctrl+E)">
        내보내기
      </button>

      <button
        class="btn icon"
        onclick={cycleTheme}
        title="테마: {THEME_LABEL[themePref]}{themePref === 'system' ? ` (현재 ${theme === 'dark' ? '다크' : '라이트'})` : ''} — 클릭하면 전환"
        aria-label="테마: {THEME_LABEL[themePref]}"
      >
        {#if themePref === 'system'}
          <!-- 반쪽 원: 시스템 설정을 따름 -->
          <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.3" />
            <path d="M7 2a5 5 0 010 10z" fill="currentColor" />
          </svg>
        {:else if themePref === 'light'}
          <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
            <circle cx="7" cy="7" r="3" fill="currentColor" />
            <path d="M7 1v1.6M7 11.4V13M1 7h1.6M11.4 7H13M2.8 2.8l1.1 1.1M10.1 10.1l1.1 1.1M11.2 2.8l-1.1 1.1M3.9 10.1l-1.1 1.1"
              stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        {:else}
          <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
            <path d="M11.5 8.6A5 5 0 015.4 2.5 5 5 0 107 12a5 5 0 004.5-3.4z" fill="currentColor" />
          </svg>
        {/if}
      </button>
    </header>

    {#if encodingBanner}
      <div class="banner">
        <span>글자가 깨져 보이나요? 이 파일은 UTF-8이 아닐 수 있습니다.</span>
        <button class="btn outline" onclick={() => void reloadAs('euc-kr')}>cp949로 다시 읽기</button>
        <button class="btn" onclick={() => (encodingBanner = false)}>무시</button>
      </div>
    {/if}

    <main>
      <Grid
        bind:this={grid}
        {ds}
        {view}
        {sel}
        {find}
        onCommitCell={commitCell}
        onRenameHeader={renameHeader}
        onMoveCol={moveCol}
        onMoveRows={moveRows}
        onSortToggle={sortByCol}
        onOpenColumnFilter={(col, anchor) => (colMenu = { col, anchor })}
        onContextMenu={openContextMenu}
        onCopy={() => void copySelection()}
        onPasteText={pasteText}
        onDeleteContents={deleteContents}
        onNotice={(m) => toast(m, 'warn')}
      />
      {#if view.visibleCount === 0 && ds.rowCount > 0}
        <div class="empty-filter">
          <p>조건에 맞는 행이 없습니다</p>
          <button class="btn outline" onclick={() => { view.clearAll(); filterBar?.clear() }}>
            필터 모두 해제
          </button>
        </div>
      {/if}
      {#if dragDepth > 0}
        <div class="drop-hint">놓으면 새 파일을 엽니다</div>
      {/if}

      <!-- 찾기 패널은 그리드 위에 겹쳐 뜨는 별도 레이어다 -->
      {#if find.open}
        <FindPanel
          bind:this={findPanel}
          {ds}
          {view}
          {find}
          onGoto={gotoHit}
          onClose={closeFind}
          onOpenReplace={() => (showReplace = true)}
        />
      {/if}
    </main>

    <StatusBar {ds} {view} {sel} {encoding} onShowAllHidden={showAllHidden} />
  {:else}
    <DropZone
      onFiles={(f) => void loadFiles(f)}
      onPasteText={loadPastedText}
      onSample={loadSample}
      {progress}
      {progressLabel}
    />
  {/if}
</div>

<input
  bind:this={fileInput}
  type="file"
  accept=".csv,.tsv,.txt,.tab,text/csv,text/plain"
  hidden
  onchange={(e) => {
    const f = e.currentTarget.files
    if (f?.length) void loadFiles(f)
    e.currentTarget.value = ''
  }}
/>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}

{#if colMenu}
  <ColumnFilterMenu
    {ds}
    {view}
    col={colMenu.col}
    anchor={colMenu.anchor}
    onClose={() => {
      colMenu = null
      sel.clear()
    }}
  />
{/if}

{#if colManagerAnchor}
  <ColumnManager
    {ds}
    {view}
    anchor={colManagerAnchor}
    onClose={() => (colManagerAnchor = null)}
    onNotice={(m, k) => toast(m, k ?? 'info')}
  />
{/if}

{#if toolsMenu}
  <ContextMenu
    x={toolsMenu.x}
    y={toolsMenu.y}
    items={toolsMenu.items}
    onClose={() => (toolsMenu = null)}
  />
{/if}

{#if showExport}
  <ExportDialog {ds} {view} {sel} onRun={(o) => void doExport(o)} onClose={() => (showExport = false)} />
{/if}

{#if showReplace}
  <ReplaceDialog
    {ds}
    {view}
    {sel}
    initialQuery={find.query}
    initialRegex={find.regex}
    onApply={applyReplace}
    onClose={() => (showReplace = false)}
  />
{/if}

{#if splitTarget !== null}
  <SplitDialog
    {ds}
    col={splitTarget}
    onApply={(r) => void applySplit(r)}
    onClose={() => (splitTarget = null)}
  />
{/if}

{#if joinTargets}
  <JoinDialog {ds} cols={joinTargets} onApply={applyJoin} onClose={() => (joinTargets = null)} />
{/if}

{#if showHelp}
  <ShortcutHelp onClose={() => (showHelp = false)} />
{/if}

<Toast items={toasts} onDismiss={dismiss} />

<!-- 공통 다이얼로그 렌더러 — alert/confirm/prompt가 여기서 그려진다 -->
<DialogHost />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 5px;
    flex: none;
    height: var(--toolbar-h);
    padding: 0 9px;
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
  }

  .brand {
    padding: 0 4px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-indent: 0.16em;
    color: var(--text);
    transition: color var(--dur) var(--ease);
  }
  .brand:hover {
    color: var(--accent);
  }

  .btn.on {
    color: var(--accent);
    background: var(--accent-soft);
  }

  main {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 6px 10px;
    background: var(--accent-soft);
    border-bottom: 1px solid var(--accent-line);
    color: var(--accent);
    font-size: 11.5px;
  }
  .banner span {
    flex: 1;
  }

  .empty-filter {
    position: absolute;
    inset: var(--header-h) 0 0 var(--gutter-w);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: var(--bg);
    pointer-events: auto;
  }
  .empty-filter p {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
  }

  .drop-hint {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    border: 2px dashed var(--accent);
    color: var(--accent);
    font-size: 13px;
    letter-spacing: 0.04em;
    pointer-events: none;
    z-index: 30;
  }
</style>
