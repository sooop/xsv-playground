<script lang="ts">
  import { mdState } from '../mdState.svelte'
  import type { Heading } from './TocPanel.svelte'

  interface Props {
    headings?: Heading[]
  }
  let { headings = [] }: Props = $props()

  let query = $state('')
  let selectedIdx = $state(0)
  let inputEl = $state<HTMLInputElement | null>(null)

  const filtered = $derived.by((): Heading[] => {
    if (!query.trim()) return headings
    const q = query.toLowerCase()
    return headings.filter((h) => {
      let qi = 0
      for (const c of h.text.toLowerCase()) {
        if (c === q[qi]) qi++
        if (qi === q.length) return true
      }
      return false
    })
  })

  $effect(() => {
    if (mdState.paletteOpen) {
      query = ''
      selectedIdx = 0
      setTimeout(() => inputEl?.focus(), 10)
    }
  })

  function close(): void {
    mdState.togglePalette(false)
  }

  function select(h: Heading | undefined): void {
    if (!h) return
    close()
    setTimeout(() => {
      document
        .getElementById(h.id)
        ?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    }, 50)
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1)
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedIdx = Math.max(selectedIdx - 1, 0)
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      select(filtered[selectedIdx])
    }
    // Esc는 셸이 넘기는 MdMode.handleKeydown이 처리한다
  }

  $effect(() => {
    void filtered
    selectedIdx = 0
  })
</script>

{#if mdState.paletteOpen}
  <div class="backdrop" role="presentation" onclick={close}></div>
  <div class="palette pop" role="dialog" aria-label="헤딩으로 이동" aria-modal="true">
    <div class="input-wrap">
      <span class="icon-slot" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 0-6" />
        </svg>
      </span>
      <input
        bind:this={inputEl}
        type="text"
        placeholder="헤딩 이름으로 이동..."
        bind:value={query}
        onkeydown={handleKeydown}
        aria-label="헤딩 검색"
        aria-controls="md-palette-list"
        aria-autocomplete="list"
      />
    </div>
    <ul id="md-palette-list" class="list" role="listbox" aria-label="헤딩 목록">
      {#each filtered as h, i (h.id)}
        <li
          class="item"
          class:selected={i === selectedIdx}
          role="option"
          aria-selected={i === selectedIdx}
          style="padding-left:{(h.level - 1) * 12 + 12}px"
          onclick={() => select(h)}
          onkeydown={(e) => {
            if (e.key === 'Enter') select(h)
          }}
          tabindex="0"
        >
          <span class="level">H{h.level}</span>
          <span class="text">{h.text}</span>
        </li>
      {/each}
      {#if filtered.length === 0}
        <li class="empty">헤딩을 찾을 수 없습니다</li>
      {/if}
    </ul>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: var(--bg-overlay);
  }
  .palette {
    position: fixed;
    top: 15vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(520px, 90vw);
    max-height: 58vh;
    z-index: 91;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .input-wrap {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }
  .icon-slot {
    flex-shrink: 0;
    color: var(--text-faint);
    display: flex;
  }
  .input-wrap input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text);
    font-size: 14px;
    font-family: inherit;
  }
  .list {
    list-style: none;
    overflow-y: auto;
    padding: 5px 0;
    margin: 0;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 12px;
    font-size: 12.5px;
    color: var(--text-dim);
    transition: background var(--dur) var(--ease);
  }
  .item:hover,
  .item.selected,
  .item:focus-visible {
    background: var(--bg-hover);
    color: var(--text);
    outline: none;
  }
  .level {
    flex-shrink: 0;
    min-width: 20px;
    font-size: 9.5px;
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    padding: 14px;
    color: var(--text-faint);
    font-size: 12px;
    text-align: center;
  }
</style>
