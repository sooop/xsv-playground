/**
 * 리더 본문 검색 엔진.
 *
 * 두 백엔드:
 *  1. CSS Custom Highlight API(`CSS.highlights`) — DOM을 건드리지 않는다. 인라인 요소 경계를
 *     넘나드는 매치·텍스트 노드 분할 없음을 지원하는 최신 브라우저용.
 *  2. `<mark>` 폴백 — 매치를 mark 요소로 감싼다. 지울 때 `normalize()`가 필요하다.
 *
 * Custom Highlight 이름은 `md-` 접두를 붙여 다른 모드와 겹치지 않게 한다.
 */
import { supportsCustomHighlight } from './markdown'

const HL_SEARCH = 'md-search-match'
const HL_ACTIVE = 'md-search-active'

export type SearchBackend = 'css' | 'mark' | 'none'

export interface SearchOptions {
  term: string
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
}

export interface SearchState {
  backend: SearchBackend
  /** backend별로 css는 Range[], mark는 HTMLElement[] */
  matches: (Range | HTMLElement)[]
  count: number
  index: number
}

// ── CSS Highlight API 백엔드 ──────────────────────────────────────────────────
function cssClear(): void {
  CSS.highlights.delete(HL_SEARCH)
  CSS.highlights.delete(HL_ACTIVE)
}

function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent && node.textContent.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    },
  })
  let n: Node | null
  while ((n = walker.nextNode())) nodes.push(n as Text)
  return nodes
}

interface FlatIndexEntry {
  node: Text
  nodeStart: number
}

function buildFlatIndex(textNodes: Text[]): { flat: string; map: FlatIndexEntry[] } {
  let flat = ''
  const map: FlatIndexEntry[] = []
  for (const node of textNodes) {
    const start = flat.length
    flat += node.textContent ?? ''
    map.push({ node, nodeStart: start })
  }
  return { flat, map }
}

function flatPosToRange(map: FlatIndexEntry[], absStart: number, absEnd: number): Range | null {
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0
  for (const { node, nodeStart } of map) {
    const nodeEnd = nodeStart + (node.textContent?.length ?? 0)
    if (startNode === null && absStart < nodeEnd) {
      startNode = node
      startOffset = absStart - nodeStart
    }
    if (absEnd <= nodeEnd) {
      endNode = node
      endOffset = absEnd - nodeStart
      break
    }
  }
  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

function cssSearch(container: HTMLElement, re: RegExp): Range[] {
  const { flat, map } = buildFlatIndex(collectTextNodes(container))
  const ranges: Range[] = []

  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(flat)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    const range = flatPosToRange(map, m.index, m.index + m[0].length)
    if (range) ranges.push(range)
    if (!re.global) break
  }

  if (ranges.length) CSS.highlights.set(HL_SEARCH, new Highlight(...ranges))
  return ranges
}

function cssActivate(ranges: Range[], idx: number): void {
  CSS.highlights.delete(HL_ACTIVE)
  const range = ranges[idx]
  if (!range) return
  CSS.highlights.set(HL_ACTIVE, new Highlight(range))
  const startNode = range.startContainer
  const anchor = startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : (startNode as Element)
  anchor?.scrollIntoView({ block: 'center', behavior: motionBehavior() })
}

// ── <mark> 폴백 백엔드 ────────────────────────────────────────────────────────
function markClear(container: HTMLElement): void {
  const parents = new Set<Node>()
  container.querySelectorAll('mark.md-sh').forEach((m) => {
    if (m.parentNode) parents.add(m.parentNode)
    m.replaceWith(document.createTextNode(m.textContent ?? ''))
  })
  parents.forEach((p) => (p as Element).normalize())
}

function markSearch(container: HTMLElement, re: RegExp): HTMLElement[] {
  const marks: HTMLElement[] = []

  function walkText(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      const matches = [...text.matchAll(re)]
      if (!matches.length) return
      const frag = document.createDocumentFragment()
      let last = 0
      for (const m of matches) {
        if (m[0].length === 0 || m.index === undefined) continue
        frag.appendChild(document.createTextNode(text.slice(last, m.index)))
        const mark = document.createElement('mark')
        mark.className = 'md-sh'
        mark.textContent = m[0]
        frag.appendChild(mark)
        marks.push(mark)
        last = m.index + m[0].length
      }
      frag.appendChild(document.createTextNode(text.slice(last)))
      node.parentNode?.replaceChild(frag, node)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName
      if (tag === 'SCRIPT' || tag === 'STYLE') return
      for (const child of [...node.childNodes]) walkText(child)
    }
  }

  walkText(container)
  return marks
}

function markActivate(marks: HTMLElement[], idx: number): void {
  marks.forEach((m, i) => m.classList.toggle('active', i === idx))
  marks[idx]?.scrollIntoView({ block: 'center', behavior: motionBehavior() })
}

// ── 모션 도우미 ────────────────────────────────────────────────────────────────
/** 리더 쪽 스크롤 이동(헤딩 이동 등)도 함께 쓰는 공용 헬퍼 — 시스템의 "동작 줄이기" 설정을 따른다. */
export function motionBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
}

// ── 정규식 빌더 ────────────────────────────────────────────────────────────────
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildRegex(options: SearchOptions): RegExp | null {
  const { term, regex, caseSensitive, wholeWord } = options
  if (!term) return null
  let pattern = regex ? term : escapeRe(term)
  if (wholeWord) pattern = `\\b${pattern}\\b`
  const flags = 'g' + (caseSensitive ? '' : 'i')
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null // 잘못된 정규식
  }
}

export function isValidRegex(term: string): boolean {
  try {
    new RegExp(term)
    return true
  } catch {
    return false
  }
}

// ── 공개 API ───────────────────────────────────────────────────────────────────
export function doSearch(container: HTMLElement, options: SearchOptions): SearchState {
  const re = buildRegex(options)
  if (!re) return { backend: 'none', matches: [], count: 0, index: -1 }

  if (supportsCustomHighlight) {
    cssClear()
    const ranges = cssSearch(container, re)
    return { backend: 'css', matches: ranges, count: ranges.length, index: ranges.length > 0 ? 0 : -1 }
  }
  markClear(container)
  const marks = markSearch(container, re)
  return { backend: 'mark', matches: marks, count: marks.length, index: marks.length > 0 ? 0 : -1 }
}

export function clearSearch(container: HTMLElement, state: SearchState | null): void {
  if (!state) return
  if (supportsCustomHighlight) cssClear()
  else markClear(container)
}

export function activateMatch(state: SearchState, idx: number): number {
  if (!state.matches.length) return -1
  const i = ((idx % state.count) + state.count) % state.count
  if (state.backend === 'css') cssActivate(state.matches as Range[], i)
  else if (state.backend === 'mark') markActivate(state.matches as HTMLElement[], i)
  return i
}

export function nextMatch(state: SearchState): number {
  return activateMatch(state, state.index + 1)
}

export function prevMatch(state: SearchState): number {
  return activateMatch(state, state.index - 1 + state.count)
}

/** 검색 결과 목록 패널용 — 매치 주변 텍스트 스니펫을 만든다. */
export function getSnippets(state: SearchState, contextLen = 20): string[] {
  if (state.backend === 'css') {
    return (state.matches as Range[]).map((range) => {
      const container = range.startContainer
      const text = container.textContent ?? ''
      const start = Math.max(0, range.startOffset - contextLen)
      const end = Math.min(text.length, range.endOffset + contextLen)
      return '…' + text.slice(start, end) + '…'
    })
  }
  return (state.matches as HTMLElement[]).map((m) => {
    const parent = m.parentNode
    const full = parent?.textContent ?? ''
    const idx = full.indexOf(m.textContent ?? '')
    if (idx === -1) return m.textContent ?? ''
    const start = Math.max(0, idx - contextLen)
    const end = Math.min(full.length, idx + (m.textContent?.length ?? 0) + contextLen)
    return '…' + full.slice(start, end) + '…'
  })
}
