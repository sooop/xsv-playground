<script lang="ts">
  /**
   * Markdown 모드 — 셸 계약(ModeHandle)은 `src/shell/mode.ts` 참고.
   *
   * md-viewer의 App.svelte 역할을 이 컴포넌트가 그대로 진다: DB/이력 로드, 문서 열기 3경로(파일·
   * 붙여넣기·다른 모드에서 전달), 검색·팔레트·라이트박스·타이포그래피 오버레이, 전역 단축키.
   * 창 전체 드롭/일반 keydown 캡처는 셸이 대신 처리하므로 여기서는 자체 드롭존의 드롭과
   * `isActive`일 때의 붙여넣기만 다룬다.
   */
  import { toasts } from '../../lib/ui/toasts.svelte'
  import type { ModePayload } from '../../shell/mode'
  import { shell } from '../../shell/shell.svelte'
  import CommandPalette from './components/CommandPalette.svelte'
  import Editor from './components/Editor.svelte'
  import Minimap from './components/Minimap.svelte'
  import Reader from './components/Reader.svelte'
  import SearchBar from './components/SearchBar.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import type { Heading } from './components/TocPanel.svelte'
  import TocPanel from './components/TocPanel.svelte'
  import Toolbar from './components/Toolbar.svelte'
  import { mdDb, type MdFileSource } from './lib/db'
  import { parseMarkdown } from './lib/markdown'
  import type { SearchState } from './lib/search'
  import { mdState, type MdDocRecord } from './mdState.svelte'

  interface Props {
    /** 셸이 이 모드를 보여주고 있는지. false면 팝업을 닫고 단축키를 받지 않는다. */
    isActive: boolean
  }
  let { isActive }: Props = $props()

  // ── 문서/렌더 상태 ────────────────────────────────────────────────────────
  let renderedHtml = $state('')
  let headings = $state<Heading[]>([])
  let searchInfo = $state<{ state: SearchState; snippets: string[] } | null>(null)
  let progress = $state(0)
  let activeHeadingId = $state('')

  let readerEl = $state<Reader | null>(null)
  let searchBarEl = $state<SearchBar | null>(null)
  let readerScrollEl = $state<HTMLElement | null>(null)
  let lightboxCloseBtn = $state<HTMLButtonElement | null>(null)
  $effect(() => {
    readerScrollEl = readerEl?.getScrollEl() ?? null
  })

  // 라이트박스가 열리면 닫기 버튼에 초기 포커스를 준다
  $effect(() => {
    if (!mdState.lightboxSrc) return
    const raf = requestAnimationFrame(() => lightboxCloseBtn?.focus())
    return () => cancelAnimationFrame(raf)
  })

  // ── 불러오기 ──────────────────────────────────────────────────────────────
  let loadSeq = 0

  async function refreshHistory(): Promise<void> {
    mdState.setHistory(await mdDb.getAll())
  }

  async function loadRaw(name: string, content: string, source: MdFileSource): Promise<void> {
    const mySeq = ++loadSeq
    try {
      const id = await mdDb.saveFile(name, content, source, mdState.currentDoc?.id)
      if (mySeq !== loadSeq) return
      const rec = await mdDb.getById(id)
      if (mySeq !== loadSeq) return
      mdState.resetForNewDoc()
      mdState.setCurrentDoc((rec ?? { id, name, content, source, scrollPos: 0, openedAt: Date.now(), updatedAt: Date.now() }) as MdDocRecord)
      renderedHtml = parseMarkdown(content)
      await refreshHistory()
      toasts.push(`${name} 불러왔습니다`, 'ok')
    } catch (err) {
      if (mySeq !== loadSeq) return
      toasts.push(`파일을 불러올 수 없습니다: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    }
  }

  async function loadById(id: number): Promise<void> {
    const mySeq = ++loadSeq
    try {
      const rec = await mdDb.getById(id)
      if (mySeq !== loadSeq || !rec) return
      mdState.resetForNewDoc()
      mdState.setCurrentDoc(rec as MdDocRecord)
      renderedHtml = parseMarkdown(rec.content)
      await refreshHistory()
    } catch (err) {
      toasts.push(`불러오기 실패: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    }
  }

  async function deleteHistory(id: number): Promise<void> {
    const rec = await mdDb.getById(id)
    await mdDb.deleteFile(id)
    if (mdState.currentDoc?.id === id) {
      mdState.setCurrentDoc(null)
      renderedHtml = ''
      headings = []
    }
    await refreshHistory()
    toasts.push(`${rec?.name ?? '파일'} 삭제됨`, 'info')
  }

  async function handleRename(name: string): Promise<void> {
    const id = mdState.currentDoc?.id
    if (id == null) return
    await mdDb.updateName(id, name)
    mdState.patchCurrentDoc({ name })
  }

  // ── 표 → 마크다운 표 변환 (다른 모드에서 전달받은 표) ─────────────────────────
  function escapeCell(v: string): string {
    return v.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
  }
  function tableToMarkdown(header: string[], rows: string[][]): string {
    const head = `| ${header.map(escapeCell).join(' | ')} |`
    const sep = `| ${header.map(() => '---').join(' | ')} |`
    const body = rows.map((r) => `| ${r.map(escapeCell).join(' | ')} |`).join('\n')
    return [head, sep, body].filter((l) => l !== '').join('\n')
  }

  // ── 내보내기 ──────────────────────────────────────────────────────────────
  function exportMarkdown(): void {
    if (!mdState.currentDoc) return
    const blob = new Blob([mdState.currentDoc.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = mdState.currentDoc.name || 'document.md'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toasts.push('내보내기 완료', 'ok')
  }

  // ── 검색 열기/닫기 ────────────────────────────────────────────────────────
  let lastFocusBeforeSearch: HTMLElement | null = null

  function openSearch(): void {
    lastFocusBeforeSearch = document.activeElement as HTMLElement | null
    mdState.toggleSearch(true)
    setTimeout(() => {
      searchBarEl?.focus()
      readerEl?.triggerSearch()
    }, 10)
  }

  function closeSearch(): void {
    mdState.toggleSearch(false)
    mdState.setSearchOption('term', '')
    readerEl?.triggerSearch()
    lastFocusBeforeSearch?.focus()
    lastFocusBeforeSearch = null
  }

  // ── 드롭존(빈 상태) ───────────────────────────────────────────────────────
  let dropHover = $state(false)
  function onZoneDrop(e: DragEvent): void {
    e.preventDefault()
    dropHover = false
    void shell.openFiles(e.dataTransfer?.files)
  }

  // ── 붙여넣기 ──────────────────────────────────────────────────────────────
  function handlePaste(e: ClipboardEvent): void {
    if (!isActive) return
    if (e.target instanceof Element && e.target.closest('input,textarea')) return
    const text = e.clipboardData?.getData('text/plain')
    if (!text || !text.trim()) return
    e.preventDefault()
    const name = `붙여넣은 문서 ${new Date().toLocaleTimeString('ko-KR')}`
    void loadRaw(name, text, 'paste')
  }

  // ── 라이트박스 확대/축소 ──────────────────────────────────────────────────
  function handleLightboxWheel(e: WheelEvent): void {
    e.preventDefault()
    const img = (e.currentTarget as HTMLElement).querySelector('img')
    if (!img) return
    const cur = parseFloat(img.dataset.scale ?? '1')
    const next = Math.max(0.5, Math.min(5, cur - e.deltaY * 0.002))
    img.dataset.scale = String(next)
    img.style.transform = `scale(${next})`
  }

  // ── 전역 단축키 ───────────────────────────────────────────────────────────
  function inEditable(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null
    if (!el) return false
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
  }

  function onGlobalKeyDown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey
    const editable = inEditable(e.target)
    const take = (): void => {
      e.preventDefault()
      e.stopPropagation()
    }

    if (mod && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
      take()
      openSearch()
      return
    }
    if (mod && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      take()
      mdState.togglePalette()
      return
    }
    if (e.key === 'F3') {
      take()
      if (!mdState.searchOpen) {
        openSearch()
        return
      }
      e.shiftKey ? readerEl?.searchPrev() : readerEl?.searchNext()
      return
    }
    if (e.key === 'Escape') {
      if (mdState.lightboxSrc) {
        take()
        mdState.closeLightbox()
      } else if (mdState.searchOpen) {
        take()
        closeSearch()
      }
      // 팔레트의 Esc는 Modal이 modals 스택에 등록해 셸이 처리한다
      return
    }
    if (!editable && !mod && !e.altKey) {
      if (e.key === 'j' || e.key === 'n') {
        take()
        readerEl?.navigateHeading(1, headings)
        return
      }
      if (e.key === 'k' || e.key === 'p') {
        take()
        readerEl?.navigateHeading(-1, headings)
        return
      }
      if (e.key === 'g') {
        take()
        readerEl?.scrollToEdge(e.shiftKey ? 'bottom' : 'top')
        return
      }
    }
  }

  // ── ModeHandle (셸 계약) ───────────────────────────────────────────────────

  export async function openFile(file: File): Promise<void> {
    try {
      const text = await file.text()
      await loadRaw(file.name, text, 'file')
    } catch (err) {
      toasts.push(`파일 읽기 실패: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    }
  }

  export async function openText(text: string, name: string): Promise<void> {
    await loadRaw(name, text, 'shell')
  }

  export async function receive(p: ModePayload): Promise<void> {
    if (p.kind === 'text') {
      await openText(p.text, p.name)
      return
    }
    await loadRaw(p.name, tableToMarkdown(p.header, p.rows), 'shell')
  }

  export function focusMode(): void {
    if (mdState.searchOpen) searchBarEl?.focus()
  }

  /** 셸이 활성 모드에만 넘겨주는 단축키 진입점(ModeHandle). */
  export function handleKeydown(e: KeyboardEvent): boolean {
    onGlobalKeyDown(e)
    return e.defaultPrevented
  }

  // 비활성으로 바뀌면 떠 있던 오버레이를 모두 닫는다 — 숨은 페인에 팔레트·검색·라이트박스가
  // 남아 있으면 안 된다.
  $effect(() => {
    if (isActive) return
    mdState.togglePalette(false)
    mdState.toggleSearch(false)
    mdState.closeLightbox()
  })

  // 탭바가 읽는 요약 상태
  $effect(() => {
    shell.status.md = {
      hasDocument: mdState.currentDoc !== null,
      isDirty: mdState.dirty,
      label: mdState.currentDoc?.name ?? '',
    }
  })
</script>

<svelte:window onpaste={handlePaste} />

<section
  class="mode md-mode"
  style:--reader-width={mdState.typography.width}
  style:--reader-font="{mdState.typography.fontSize}px"
>
  <div class="md-progress-bar" style="width:{progress}%" aria-hidden="true"></div>

  <div class="layout">
    <Sidebar onLoad={loadById} onDelete={deleteHistory} />

    <div class="main-col">
      <Toolbar onExport={exportMarkdown} onRename={handleRename} />
      <SearchBar
        bind:this={searchBarEl}
        count={searchInfo?.state.count ?? 0}
        index={searchInfo?.state.index ?? -1}
        snippets={searchInfo?.snippets ?? []}
        onnext={() => readerEl?.searchNext()}
        onprev={() => readerEl?.searchPrev()}
        onsearch={() => readerEl?.triggerSearch()}
        onjump={(i) => readerEl?.searchJump(i)}
      />

      <div class="content-area">
        {#if !mdState.currentDoc}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="drop-zone"
            class:over={dropHover}
            role="button"
            tabindex="0"
            aria-label="마크다운 파일을 드래그하거나 클릭해서 열기"
            ondragover={(e) => {
              e.preventDefault()
              dropHover = true
            }}
            ondragleave={() => (dropHover = false)}
            ondrop={onZoneDrop}
            onclick={() => shell.requestOpen()}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                shell.requestOpen()
              }
            }}
          >
            <div class="dz-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <h1>마크다운 파일 열기</h1>
            <p>
              파일을 이곳에 드래그하거나 아래 버튼으로 선택하세요<br />
              <span class="label">Ctrl+V로 클립보드 마크다운 붙여넣기 가능</span>
            </p>
            <button class="btn outline" onclick={(e) => { e.stopPropagation(); shell.requestOpen() }}>
              파일 열기…
            </button>
          </div>
        {:else}
          <div class="reader-wrap">
            {#if mdState.editMode}
              <Editor docId={mdState.currentDoc.id} onRender={(html) => (renderedHtml = html)} />
            {:else}
              <Reader
                bind:this={readerEl}
                html={renderedHtml}
                onHeadings={(h) => (headings = h)}
                onSearchState={(s) => (searchInfo = s)}
                onProgress={(p) => (progress = p)}
                onHeadingChange={(id) => (activeHeadingId = id)}
              />
              <TocPanel {headings} activeId={activeHeadingId} />
            {/if}
            {#if (searchInfo?.state.count ?? 0) > 0 && !mdState.editMode}
              <Minimap
                scrollEl={readerScrollEl}
                searchMatches={searchInfo?.state.matches ?? []}
                searchIndex={searchInfo?.state.index ?? -1}
                onjump={(i) => readerEl?.searchJump(i)}
              />
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if mdState.lightboxSrc}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- 키보드 닫기는 handleKeydown의 전역 Escape 처리가 맡는다(이중 처리 방지로 여기서는 제거) -->
    <div
      class="lightbox-backdrop"
      role="dialog"
      aria-label="이미지 확대 보기"
      aria-modal="true"
      tabindex="-1"
      onclick={() => mdState.closeLightbox()}
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="lightbox-img-wrap" role="presentation" onclick={(e) => e.stopPropagation()} onwheel={handleLightboxWheel}>
        <img src={mdState.lightboxSrc} alt="확대 이미지" class="lightbox-img" />
      </div>
      <button
        bind:this={lightboxCloseBtn}
        class="btn icon lightbox-close"
        onclick={() => mdState.closeLightbox()}
        aria-label="닫기"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
      </button>
    </div>
  {/if}

  <CommandPalette {headings} />
</section>

<style>
  .mode {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .md-progress-bar {
    position: absolute;
    top: 0;
    left: 0;
    height: 2px;
    background: var(--accent);
    z-index: 20;
    transition: width 90ms linear;
    pointer-events: none;
  }

  .layout {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .main-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }
  .content-area {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  .drop-zone {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin: 28px;
    padding: 34px;
    border: 2px dashed var(--border-strong);
    border-radius: 12px;
    color: var(--text-dim);
    transition:
      border-color var(--dur) var(--ease),
      background var(--dur) var(--ease);
  }
  .drop-zone:hover,
  .drop-zone:focus-visible,
  .drop-zone.over {
    border-color: var(--accent);
    background: var(--accent-soft);
    outline: none;
  }
  .dz-icon {
    opacity: 0.4;
  }
  .drop-zone h1 {
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
    margin: 0;
  }
  .drop-zone p {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
    text-align: center;
    line-height: 1.7;
  }

  .reader-wrap {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .lightbox-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    /* 이미지 뷰어는 뒤 콘텐츠를 완전히 가려야 하므로 --bg-overlay 대신 진한 스크림을 고정한다 */
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: zoom-out;
  }
  .lightbox-img-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: default;
    max-width: 90vw;
    max-height: 90vh;
    overflow: hidden;
  }
  .lightbox-img {
    max-width: 90vw;
    max-height: 90vh;
    object-fit: contain;
    border-radius: 4px;
    transform-origin: center;
    display: block;
  }
  .lightbox-close {
    position: fixed;
    z-index: calc(var(--z-modal) + 1);
    top: 16px;
    right: 20px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.15);
    /* 항상 어두운 오버레이 위에 뜨므로 테마와 무관하게 밝은 색 고정 — hex 대신 rgba로 표기 */
    color: rgba(255, 255, 255, 0.92);
  }
  .lightbox-close:hover {
    background: rgba(255, 255, 255, 0.3);
  }
</style>
