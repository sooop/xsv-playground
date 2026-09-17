<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte'
  import { shell } from '../../../shell/shell.svelte'
  import { themeCtl } from '../../../shell/theme.svelte'
  import { mdDb } from '../lib/db'
  import { attachHighlightObserver, disconnectHighlightObserver } from '../lib/highlight'
  import { CHECK_SVG, COPY_SVG } from '../lib/icons'
  import { decodeCodeText } from '../lib/markdown'
  import { renderExtras, rerenderMermaid } from '../lib/render-extras'
  import {
    activateMatch,
    clearSearch,
    doSearch,
    getSnippets,
    motionBehavior,
    nextMatch,
    prevMatch,
    type SearchState,
  } from '../lib/search'
  import { mdState } from '../mdState.svelte'
  import type { Heading } from './TocPanel.svelte'

  interface Props {
    html?: string
    onHeadings?: (h: Heading[]) => void
    onSearchState?: (s: { state: SearchState; snippets: string[] } | null) => void
    onProgress?: (p: number) => void
    onHeadingChange?: (id: string) => void
  }
  let { html = '', onHeadings, onSearchState, onProgress, onHeadingChange }: Props = $props()

  let scrollEl = $state<HTMLDivElement | null>(null)
  let contentEl = $state<HTMLDivElement | null>(null)
  let ticking = false
  let scrollSaveTimer: ReturnType<typeof setTimeout> | undefined
  let headingIoObserver: IntersectionObserver | undefined

  let searchState = $state<SearchState | null>(null)
  let snippets = $state<string[]>([])

  // ── 헤딩 추출 ──────────────────────────────────────────────────────────────
  function extractHeadings(): Heading[] {
    if (!contentEl) return []
    return [...contentEl.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({
      id: h.id,
      text: (h.textContent ?? '').replace(/\s*#\s*$/, '').trim(),
      level: parseInt(h.tagName[1] ?? '1', 10),
    }))
  }

  // ── 활성 헤딩 IntersectionObserver ─────────────────────────────────────────
  function setupHeadingObserver(): void {
    headingIoObserver?.disconnect()
    if (!contentEl || !scrollEl) return
    const headingEls = [...contentEl.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    if (!headingEls.length) return

    let lastVisible: Element | null = null
    headingIoObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) lastVisible = entry.target
        }
        if (lastVisible) onHeadingChange?.(lastVisible.id)
      },
      { root: scrollEl, rootMargin: '0px 0px -80% 0px' },
    )
    headingEls.forEach((h) => headingIoObserver?.observe(h))
  }

  // ── 스크롤 핸들러 ────────────────────────────────────────────────────────────
  function onScroll(): void {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      if (!scrollEl) return
      const { scrollTop, scrollHeight, clientHeight } = scrollEl
      const p = scrollHeight <= clientHeight ? 100 : (scrollTop / (scrollHeight - clientHeight)) * 100
      onProgress?.(p)
      clearTimeout(scrollSaveTimer)
      scrollSaveTimer = setTimeout(() => {
        const id = mdState.currentDoc?.id
        if (id != null) {
          const ratio = scrollHeight <= clientHeight ? 1 : scrollTop / (scrollHeight - clientHeight)
          void mdDb.saveScrollPos(id, ratio)
        }
      }, 300)
      ticking = false
    })
  }

  // ── 라이트박스 + 복사 + 코드블록 열기 델리게이션 ───────────────────────────────
  function onContentClick(e: MouseEvent): void {
    const target = e.target as HTMLElement

    const img = target.closest<HTMLImageElement>('img[data-lightbox]')
    if (img) {
      e.preventDefault()
      mdState.openLightbox(img.src)
      return
    }

    const openBtn = target.closest<HTMLButtonElement>('.md-code-open-btn')
    if (openBtn) {
      e.preventDefault()
      const lang = openBtn.dataset.openLang ?? ''
      const text = decodeCodeText(openBtn.dataset.code ?? '')
      const to = lang === 'json' ? 'jq' : 'csv'
      void shell.sendTo(to, { kind: 'text', text, name: `코드블록.${lang}`, from: 'md' })
      return
    }

    const copyBtn = target.closest<HTMLButtonElement>('.md-code-copy-btn')
    if (copyBtn) {
      e.preventDefault()
      const text = decodeCodeText(copyBtn.dataset.code ?? '')
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
      else fallbackCopy(text)
      copyBtn.innerHTML = CHECK_SVG
      setTimeout(() => {
        copyBtn.innerHTML = COPY_SVG
      }, 1500)
    }
  }

  function fallbackCopy(text: string): void {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } catch {
      /* 클립보드 API도 execCommand도 실패 — 조용히 포기한다 */
    }
    document.body.removeChild(ta)
  }

  // ── 검색 ─────────────────────────────────────────────────────────────────
  function runSearch(): void {
    if (!contentEl) return
    if (!mdState.searchOpen || !mdState.searchOptions.term) {
      clearSearch(contentEl, searchState)
      searchState = null
      snippets = []
      onSearchState?.(null)
      return
    }
    clearSearch(contentEl, searchState)
    let next = doSearch(contentEl, mdState.searchOptions)
    if (next.count > 0) next = { ...next, index: activateMatch(next, 0) }
    searchState = next
    snippets = getSnippets(next)
    onSearchState?.({ state: next, snippets })
  }

  export function searchNext(): void {
    if (!searchState) return
    const idx = nextMatch(searchState)
    searchState = { ...searchState, index: idx }
    onSearchState?.({ state: searchState, snippets })
  }

  export function searchPrev(): void {
    if (!searchState) return
    const idx = prevMatch(searchState)
    searchState = { ...searchState, index: idx }
    onSearchState?.({ state: searchState, snippets })
  }

  export function searchJump(idx: number): void {
    if (!searchState) return
    const i = activateMatch(searchState, idx)
    searchState = { ...searchState, index: i }
    onSearchState?.({ state: searchState, snippets })
  }

  /** App(=MdMode)가 검색 옵션이 바뀔 때 명시적으로 호출한다. */
  export function triggerSearch(): void {
    runSearch()
  }

  /** Minimap이 스크롤/리사이즈를 직접 구독하기 위해 컨테이너 참조가 필요하다. */
  export function getScrollEl(): HTMLElement | null {
    return scrollEl
  }

  /** g / G 단축키 — 맨 위/맨 아래로 스크롤. */
  export function scrollToEdge(edge: 'top' | 'bottom'): void {
    if (!scrollEl) return
    scrollEl.scrollTop = edge === 'top' ? 0 : scrollEl.scrollHeight
  }

  /** j/k, n/p 단축키 — 현재 스크롤 위치 기준 다음/이전 헤딩으로 이동. */
  export function navigateHeading(dir: 1 | -1, headings: Heading[]): void {
    if (!scrollEl || !headings.length) return
    const rsRect = scrollEl.getBoundingClientRect()
    const all = headings.map((h) => document.getElementById(h.id)).filter((el): el is HTMLElement => el !== null)
    if (!all.length) return
    const idx = all.findIndex((h) => h.getBoundingClientRect().top >= rsRect.top + 10)
    const target = dir === 1 ? all[idx === -1 ? 0 : idx] : all[Math.max(0, (idx === -1 ? all.length : idx) - 1)]
    target?.scrollIntoView({ behavior: motionBehavior() })
  }

  // ── 스크롤 복원 ───────────────────────────────────────────────────────────
  function restoreScroll(scrollPos: number): void {
    if (!scrollEl || scrollPos <= 0) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!scrollEl) return
        const { scrollHeight, clientHeight } = scrollEl
        scrollEl.scrollTop = scrollPos * (scrollHeight - clientHeight)
      })
    })
  }

  // ── html 변경 반영 ────────────────────────────────────────────────────────
  $effect(() => {
    void html // 추적 대상 의존값
    if (!contentEl) return
    disconnectHighlightObserver()
    // untrack: searchState 읽기/쓰기가 이 effect의 의존성이 되지 않게 한다.
    // 그렇지 않으면 runSearch()의 searchState 갱신이 이 effect를 다시 돌려 방금 그린 하이라이트를 지운다.
    untrack(() => {
      if (searchState) clearSearch(contentEl!, searchState)
      searchState = null
      snippets = []
      onSearchState?.(null)
    })
    setTimeout(() => {
      if (!contentEl) return
      // 복사 버튼 SVG를 직접 주입한다 — DOMPurify가 svg 자식을 지우므로 렌더러 출력만으로는 안 보인다
      contentEl.querySelectorAll<HTMLButtonElement>('.md-code-copy-btn').forEach((btn) => {
        btn.innerHTML = COPY_SVG
      })
      attachHighlightObserver(contentEl)
      setupHeadingObserver()
      onHeadings?.(extractHeadings())
      const scrollPos = mdState.currentDoc?.scrollPos ?? 0
      if (scrollPos > 0) restoreScroll(scrollPos)
      else if (scrollEl) scrollEl.scrollTop = 0
      void renderExtras(contentEl, themeCtl.theme)
    }, 0)
  })

  // 테마가 바뀌면 Mermaid 다이어그램을 다시 그린다
  $effect(() => {
    const theme = themeCtl.theme
    if (contentEl) void rerenderMermaid(contentEl, theme)
  })

  onMount(() => {
    scrollEl?.addEventListener('scroll', onScroll, { passive: true })
    contentEl?.addEventListener('click', onContentClick)
    if (contentEl) {
      attachHighlightObserver(contentEl)
      setupHeadingObserver()
      onHeadings?.(extractHeadings())
    }
  })

  onDestroy(() => {
    scrollEl?.removeEventListener('scroll', onScroll)
    contentEl?.removeEventListener('click', onContentClick)
    disconnectHighlightObserver()
    headingIoObserver?.disconnect()
    clearTimeout(scrollSaveTimer)
  })
</script>

<div class="reader-scroll" bind:this={scrollEl}>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  <div id="md-reader-content" bind:this={contentEl}>{@html html}</div>
</div>

<style>
  .reader-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 36px 44px;
  }
  #md-reader-content {
    max-width: var(--reader-width, 720px);
    margin: 0 auto;
    font-size: var(--reader-font, 15.5px);
  }

  /* {@html}로 삽입되는 본문은 Svelte 스코핑을 타지 않으므로 `.md-mode` 앵커로 전역 누출을 막는다 */
  :global(.md-mode #md-reader-content h1, .md-mode #md-reader-content h2, .md-mode #md-reader-content h3,
    .md-mode #md-reader-content h4, .md-mode #md-reader-content h5, .md-mode #md-reader-content h6) {
    color: var(--text);
    font-weight: 600;
    line-height: 1.35;
    margin: 1.7em 0 0.6em;
    scroll-margin-top: 60px;
    position: relative;
  }
  :global(.md-mode #md-reader-content h1) {
    font-size: 1.9em;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.4em;
  }
  :global(.md-mode #md-reader-content h2) {
    font-size: 1.4em;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.3em;
  }
  :global(.md-mode #md-reader-content h3) {
    font-size: 1.18em;
  }
  :global(.md-mode #md-reader-content h4) {
    font-size: 1.04em;
  }
  :global(.md-mode #md-reader-content p) {
    margin: 0.9em 0;
    line-height: 1.75;
  }
  :global(.md-mode #md-reader-content ul, .md-mode #md-reader-content ol) {
    margin: 0.8em 0;
    padding-left: 1.8em;
  }
  :global(.md-mode #md-reader-content li) {
    margin: 0.35em 0;
    line-height: 1.7;
  }
  :global(.md-mode #md-reader-content a) {
    color: var(--accent);
    text-decoration: none;
  }
  :global(.md-mode #md-reader-content a:hover) {
    text-decoration: underline;
  }
  :global(.md-mode #md-reader-content blockquote) {
    border-left: 3px solid var(--accent);
    margin: 1.2em 0;
    padding: 0.8em 1.2em;
    background: var(--accent-soft);
    border-radius: 0 8px 8px 0;
    color: var(--text-dim);
  }
  :global(.md-mode #md-reader-content blockquote p) {
    margin: 0;
  }
  :global(.md-mode #md-reader-content code) {
    font-family: var(--font-mono);
    font-size: 0.875em;
    background: var(--bg-gutter);
    padding: 0.15em 0.35em;
    border-radius: 4px;
    color: var(--text);
  }
  :global(.md-mode #md-reader-content pre) {
    background: var(--bg-gutter);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow-x: auto;
    margin: 0;
  }
  :global(.md-mode #md-reader-content pre code) {
    background: none;
    padding: 1em 1.1em;
    border-radius: 0;
    display: block;
    font-size: 0.82em;
    line-height: 1.6;
  }
  :global(.md-mode #md-reader-content table) {
    border-collapse: collapse;
    margin: 1.2em 0;
    font-size: 0.92em;
    display: block;
    overflow-x: auto;
    max-width: 100%;
  }
  :global(.md-mode #md-reader-content th) {
    background: var(--bg-header);
    font-weight: 600;
  }
  :global(.md-mode #md-reader-content th, .md-mode #md-reader-content td) {
    border: 1px solid var(--border);
    padding: 0.55em 0.85em;
    text-align: left;
  }
  :global(.md-mode #md-reader-content tr:nth-child(even)) {
    background: var(--bg-zebra);
  }
  :global(.md-mode #md-reader-content img) {
    max-width: 100%;
    border-radius: 8px;
    margin: 1em 0;
    cursor: zoom-in;
  }
  :global(.md-mode #md-reader-content hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 2em 0;
  }
  :global(.md-mode #md-reader-content input[type='checkbox']) {
    margin-right: 0.4em;
  }

  /* 헤딩 앵커 */
  :global(.md-mode .md-heading-anchor) {
    font-size: 0.75em;
    margin-right: 0.4em;
    opacity: 0;
    color: var(--text-faint);
    text-decoration: none;
    transition: opacity var(--dur) var(--ease);
    vertical-align: middle;
  }
  :global(.md-mode h1:hover .md-heading-anchor, .md-mode h2:hover .md-heading-anchor,
    .md-mode h3:hover .md-heading-anchor, .md-mode h4:hover .md-heading-anchor) {
    opacity: 1;
  }

  /* 코드블록 헤더 바 */
  :global(.md-mode .md-code-block) {
    margin: 1.2em 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  :global(.md-mode .md-code-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 7px 4px 11px;
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
  }
  :global(.md-mode .md-code-lang) {
    font-size: 9.5px;
    font-family: var(--font-mono);
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  :global(.md-mode .md-code-actions) {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  :global(.md-mode .md-code-block pre) {
    margin: 0;
    border: none;
    border-radius: 0;
  }
  :global(.md-mode .md-code-open-btn) {
    height: 22px;
    padding: 0 7px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-raised);
    color: var(--text-dim);
    font-size: 10px;
    white-space: nowrap;
    opacity: 0;
    transition:
      opacity var(--dur) var(--ease),
      color var(--dur) var(--ease),
      border-color var(--dur) var(--ease);
  }
  :global(.md-mode .md-code-block:hover .md-code-open-btn) {
    opacity: 1;
  }
  :global(.md-mode .md-code-open-btn:hover) {
    color: var(--accent);
    border-color: var(--accent-line);
  }
  :global(.md-mode .md-code-copy-btn) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--border);
    background: var(--bg-raised);
    border-radius: 4px;
    color: var(--text-faint);
    opacity: 0;
    transition:
      opacity var(--dur) var(--ease),
      color var(--dur) var(--ease),
      background var(--dur) var(--ease);
  }
  :global(.md-mode .md-code-block:hover .md-code-copy-btn) {
    opacity: 1;
  }
  :global(.md-mode .md-code-copy-btn:hover) {
    background: var(--bg-hover);
    color: var(--accent);
  }

  /* Mermaid 블록 */
  :global(.md-mode pre.md-mermaid) {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin: 1.2em 0;
    overflow-x: auto;
    text-align: center;
  }

  /* hljs 채색 — 별도 스타일시트 대신 xsv 토큰에 매핑한다 */
  :global(.md-mode .hljs) {
    background: transparent !important;
  }
  :global(.md-mode .hljs-comment, .md-mode .hljs-quote) {
    color: var(--text-faint);
  }
  :global(.md-mode .hljs-string, .md-mode .hljs-regexp, .md-mode .hljs-addition) {
    color: var(--c-filter);
  }
  :global(.md-mode .hljs-number, .md-mode .hljs-literal) {
    color: var(--c-num);
  }
  :global(.md-mode .hljs-keyword, .md-mode .hljs-built_in, .md-mode .hljs-type, .md-mode .hljs-selector-tag) {
    color: var(--accent);
  }
  :global(.md-mode .hljs-attr, .md-mode .hljs-attribute, .md-mode .hljs-symbol) {
    color: var(--c-date);
  }
  :global(.md-mode .hljs-title, .md-mode .hljs-name, .md-mode .hljs-section) {
    color: var(--text);
    font-weight: 600;
  }
  :global(.md-mode .hljs-deletion) {
    color: var(--danger);
  }

  /* CSS Custom Highlight 검색 */
  :global(.md-mode ::highlight(md-search-match)) {
    background: var(--find-bg);
    color: var(--find-text);
  }
  :global(.md-mode ::highlight(md-search-active)) {
    background: var(--find-cur);
    color: var(--find-on-text);
  }
  /* mark 폴백 */
  :global(.md-mode mark.md-sh) {
    background: var(--find-bg);
    color: var(--find-text);
    border-radius: 2px;
  }
  :global(.md-mode mark.md-sh.active) {
    background: var(--find-cur);
    color: var(--find-on-text);
  }
</style>
