<script lang="ts">
  import { dismissable } from '../../../lib/ui/dismiss'
  import { shell } from '../../../shell/shell.svelte'
  import { mdState } from '../mdState.svelte'

  interface Props {
    onExport: () => void
    onRename: (name: string) => Promise<void>
  }
  let { onExport, onRename }: Props = $props()

  let showTypo = $state(false)
  let titleDraft = $state('')
  let titleTimer: ReturnType<typeof setTimeout> | undefined
  let typoToggleBtn = $state<HTMLButtonElement | null>(null)
  let typoFirstBtn = $state<HTMLButtonElement | null>(null)

  $effect(() => {
    titleDraft = mdState.currentDoc?.name ?? ''
  })

  function closeTypo(): void {
    showTypo = false
  }

  // 열릴 때 팝오버 첫 버튼으로 포커스를 옮긴다
  $effect(() => {
    if (!showTypo) return
    const raf = requestAnimationFrame(() => typoFirstBtn?.focus())
    return () => cancelAnimationFrame(raf)
  })

  const widthPresets = ['640px', '720px', '900px', '100%']
  const fontSizes = [13, 14, 15.5, 17, 19]
  const curWidthIdx = $derived(widthPresets.indexOf(mdState.typography.width))
  const curFontIdx = $derived(fontSizes.indexOf(mdState.typography.fontSize))

  function changeWidth(delta: number): void {
    const idx = Math.max(0, Math.min(widthPresets.length - 1, curWidthIdx + delta))
    mdState.setTypography({ width: widthPresets[idx] })
  }

  function changeFont(delta: number): void {
    const idx = Math.max(0, Math.min(fontSizes.length - 1, curFontIdx + delta))
    mdState.setTypography({ fontSize: fontSizes[idx] })
  }

  function scheduleTitleSave(raw: string): void {
    clearTimeout(titleTimer)
    titleTimer = setTimeout(() => {
      const name = raw.trim()
      if (!name || !mdState.currentDoc || name === mdState.currentDoc.name) return
      mdState.setSaveStatus('saving')
      void onRename(name).then(() => {
        mdState.setSaveStatus('saved')
        setTimeout(() => mdState.setSaveStatus(''), 1500)
      })
    }, 600)
  }

  function handleTitleInput(e: Event): void {
    titleDraft = (e.currentTarget as HTMLInputElement).value
    scheduleTitleSave(titleDraft)
  }

  function commitTitle(): void {
    clearTimeout(titleTimer)
    const name = titleDraft.trim()
    if (!name) {
      titleDraft = mdState.currentDoc?.name ?? ''
      return
    }
    if (mdState.currentDoc && name !== mdState.currentDoc.name) {
      mdState.setSaveStatus('saving')
      void onRename(name).then(() => {
        mdState.setSaveStatus('saved')
        setTimeout(() => mdState.setSaveStatus(''), 1500)
      })
    }
  }

  function handleTitleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitTitle()
      ;(e.currentTarget as HTMLInputElement).blur()
    }
    if (e.key === 'Escape') {
      titleDraft = mdState.currentDoc?.name ?? ''
      ;(e.currentTarget as HTMLInputElement).blur()
    }
  }
</script>

<header class="toolbar">
  <button
    class="btn icon"
    class:on={mdState.sidebarOpen}
    onclick={() => mdState.toggleSidebar()}
    aria-label={mdState.sidebarOpen ? '사이드바 닫기' : '사이드바 열기'}
    aria-pressed={mdState.sidebarOpen}
    title="사이드바 토글"
  >
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  </button>

  <button class="btn" onclick={() => shell.requestOpen()} title="파일 열기 (Ctrl+O)">열기</button>

  <span class="divider"></span>

  {#if mdState.currentDoc && mdState.editMode}
    <input
      class="field doc-title-input"
      type="text"
      value={titleDraft}
      oninput={handleTitleInput}
      onblur={commitTitle}
      onkeydown={handleTitleKeydown}
      aria-label="문서 제목"
      placeholder="문서 제목"
    />
  {:else}
    <span class="doc-title" class:empty={!mdState.currentDoc}>
      {mdState.currentDoc ? mdState.currentDoc.name : '마크다운 파일을 열어주세요'}
    </span>
  {/if}

  {#if mdState.currentDoc}
    {#if mdState.saveStatus === 'saving'}
      <span class="save-status">저장 중…</span>
    {:else if mdState.saveStatus === 'saved'}
      <span class="save-status ok">저장됨</span>
    {:else if mdState.dirty}
      <span class="save-status dirty">●</span>
    {/if}
  {/if}

  {#if mdState.currentDoc}
    <button
      class="btn icon"
      onclick={() => mdState.toggleEdit()}
      aria-label={mdState.editMode ? '읽기 모드' : '편집 모드'}
      aria-pressed={mdState.editMode}
      title="편집 모드 전환"
    >
      {#if mdState.editMode}
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path
            d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path
            d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
          <path d="m15 5 4 4" />
        </svg>
      {/if}
    </button>

    <button class="btn icon" onclick={onExport} aria-label="마크다운으로 내보내기" title="내보내기 (.md)">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="m7 10 5 5 5-5" />
        <path d="M12 15V3" />
      </svg>
    </button>
  {/if}

  <button
    class="btn icon"
    class:on={mdState.searchOpen}
    onclick={() => mdState.toggleSearch()}
    aria-label="문서 내 검색 (Ctrl+F)"
    aria-pressed={mdState.searchOpen}
    title="검색 (Ctrl+F)"
  >
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  </button>

  <button
    class="btn icon"
    class:on={mdState.tocOpen}
    onclick={() => mdState.toggleToc()}
    aria-label={mdState.tocOpen ? '목차 닫기' : '목차 열기'}
    aria-pressed={mdState.tocOpen}
    title="목차 토글"
  >
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12h.01" /><path d="M3 18h.01" /><path d="M3 6h.01" />
      <path d="M8 12h13" /><path d="M8 18h13" /><path d="M8 6h13" />
    </svg>
  </button>

  <div class="typo-wrap">
    <button
      bind:this={typoToggleBtn}
      class="btn icon"
      class:on={showTypo}
      onclick={() => (showTypo = !showTypo)}
      aria-label="글자 크기/폭 설정"
      aria-pressed={showTypo}
      title="타이포그래피"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 7 4 4 20 4 20 7" />
        <line x1="9" x2="15" y1="20" y2="20" />
        <line x1="12" x2="12" y1="4" y2="20" />
      </svg>
    </button>
    {#if showTypo}
      <div
        class="typo-popover pop"
        role="dialog"
        aria-label="본문 폭·글자 크기"
        {@attach dismissable(closeTypo, { ignore: () => [typoToggleBtn] })}
      >
        <div class="typo-row">
          <span>폭</span>
          <button
            bind:this={typoFirstBtn}
            class="typo-btn"
            onclick={() => changeWidth(-1)}
            disabled={curWidthIdx <= 0}
            aria-label="폭 좁게"
          >
            −
          </button>
          <span class="typo-val">{mdState.typography.width}</span>
          <button
            class="typo-btn"
            onclick={() => changeWidth(1)}
            disabled={curWidthIdx >= widthPresets.length - 1}
            aria-label="폭 넓게"
          >
            +
          </button>
        </div>
        <div class="typo-row">
          <span>글자</span>
          <button class="typo-btn" onclick={() => changeFont(-1)} disabled={curFontIdx <= 0} aria-label="글자 작게">
            −
          </button>
          <span class="typo-val">{mdState.typography.fontSize}px</span>
          <button
            class="typo-btn"
            onclick={() => changeFont(1)}
            disabled={curFontIdx >= fontSizes.length - 1}
            aria-label="글자 크게"
          >
            +
          </button>
        </div>
      </div>
    {/if}
  </div>
</header>

<style>
  .doc-title,
  .doc-title-input {
    flex: 1;
    min-width: 0;
  }
  .doc-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text);
  }
  .doc-title.empty {
    color: var(--text-faint);
    font-weight: 400;
  }
  .save-status {
    flex-shrink: 0;
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .save-status.dirty {
    color: var(--accent);
  }
  .save-status.ok {
    color: var(--ok);
  }
  .typo-wrap {
    position: relative;
  }
  .typo-popover {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: var(--z-popover);
    min-width: 176px;
    padding: 10px;
  }
  .typo-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-label);
    color: var(--text-dim);
  }
  .typo-row + .typo-row {
    margin-top: 6px;
  }
  .typo-row > span:first-child {
    min-width: 26px;
  }
  .typo-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    transition: background var(--dur) var(--ease);
  }
  .typo-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .typo-btn:disabled {
    opacity: 0.35;
  }
  .typo-val {
    flex: 1;
    text-align: center;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
</style>
