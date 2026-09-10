<script lang="ts">
  import type { SheetSummary } from '../parse/xlsx'
  import { num } from '../util/format'

  interface Props {
    /** 통합 문서 파일명 — 어느 파일의 시트인지 헤더에 보여준다 */
    fileName: string
    sheets: SheetSummary[]
    /** 지금 보고 있는 시트 (처음 열 때는 null) */
    current: string | null
    onPick: (name: string) => void
    onClose: () => void
  }
  let { fileName, sheets, current, onPick, onClose }: Props = $props()

  /** 키보드 이동용 커서. 현재 보고 있는 시트에서 시작한다. */
  let cursor = $state(0)
  let listEl = $state<HTMLDivElement | null>(null)

  $effect(() => {
    const at = sheets.findIndex((s) => s.name === current)
    if (at >= 0) cursor = at
    listEl?.focus()
  })

  function pick(i: number): void {
    const s = sheets[i]
    if (!s || s.rows === 0) return
    onPick(s.name)
  }

  function move(delta: number): void {
    const n = sheets.length
    if (n === 0) return
    cursor = (cursor + delta + n) % n
    listEl?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  function onKeyDown(e: KeyboardEvent): void {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      pick(cursor)
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onClose}></div>

<div class="dlg pop" role="dialog" aria-modal="true" aria-label="시트 선택">
  <header>
    <h2>시트 선택</h2>
    <span class="file" title={fileName}>{fileName}</span>
    <button class="btn icon" onclick={onClose} aria-label="닫기">✕</button>
  </header>

  <div
    class="list"
    bind:this={listEl}
    role="listbox"
    aria-label="시트 목록"
    tabindex="0"
    onkeydown={onKeyDown}
  >
    {#each sheets as s, i (s.name)}
      <button
        class="item"
        class:cur={s.name === current}
        class:at={i === cursor}
        role="option"
        aria-selected={s.name === current}
        data-i={i}
        disabled={s.rows === 0}
        onmouseenter={() => (cursor = i)}
        onclick={() => pick(i)}
      >
        <span class="name" title={s.name}>{s.name}</span>
        <span class="dims">
          {#if s.rows === 0}빈 시트{:else}{num(s.rows)} × {num(s.cols)}{/if}
        </span>
        {#if s.name === current}<span class="badge">보는 중</span>{/if}
      </button>
    {/each}
  </div>

  <footer>
    <span class="hint">↑↓ 이동 · Enter 열기 · Esc 닫기</span>
    <button class="btn" onclick={onClose}>취소</button>
  </footer>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--bg-overlay);
    z-index: 70;
    animation: fade 140ms var(--ease);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  .dlg {
    position: fixed;
    z-index: 71;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    animation: rise 180ms var(--ease);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-50% + 8px));
    }
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 11px 8px 11px 14px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
  }
  .file {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-faint);
    font-size: 10.5px;
  }

  .list {
    padding: 6px;
    overflow-y: auto;
    outline: none;
  }
  .item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 7px 9px;
    border: 1px solid transparent;
    border-radius: 6px;
    text-align: left;
  }
  .item.at:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }
  .item.cur .name {
    color: var(--accent);
    font-weight: 600;
  }
  .item:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
  }
  .dims {
    flex: none;
    color: var(--text-faint);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
  .badge {
    flex: none;
    padding: 1px 5px;
    border-radius: 8px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 9.5px;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-header);
    border-radius: 0 0 8px 8px;
  }
  .hint {
    flex: 1;
    color: var(--text-faint);
    font-size: 10px;
  }
</style>
