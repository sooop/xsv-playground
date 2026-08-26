<script lang="ts">
  import { DOC_SCHEMA_V, type DocMeta } from '../data/docSnapshot'
  import { ago, bytes, num } from '../util/format'

  interface Props {
    docs: DocMeta[]
    /** 지금 열려 있는 문서 — 목록에서 "현재" 배지를 붙인다 */
    currentId: string | null
    onOpen: (id: string) => void
    onDelete: (id: string, name: string) => void
    onClose: () => void
  }
  let { docs, currentId, onOpen, onDelete, onClose }: Props = $props()

  let search = $state('')
  let searchEl = $state<HTMLInputElement | null>(null)
  let cursor = $state(0)

  $effect(() => {
    requestAnimationFrame(() => searchEl?.focus())
  })

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase()
    return q === '' ? docs : docs.filter((d) => d.name.toLowerCase().includes(q))
  })

  const totalBytes = $derived(docs.reduce((sum, d) => sum + d.bytes, 0))

  // 목록이 바뀌면(검색·삭제) 커서가 범위를 벗어나지 않게 고정한다
  $effect(() => {
    if (cursor >= filtered.length) cursor = Math.max(0, filtered.length - 1)
  })

  function openAt(i: number): void {
    const d = filtered[i]
    if (!d || d.v > DOC_SCHEMA_V) return
    onOpen(d.id)
  }

  function onKeyDown(e: KeyboardEvent): void {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    // 검색 입력 안에서는 위/아래·삭제만 가로채고, 나머지 문자 입력은 그대로 흘려보낸다
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      cursor = Math.min(filtered.length - 1, cursor + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      cursor = Math.max(0, cursor - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      openAt(cursor)
    } else if (e.key === 'Delete' && document.activeElement !== searchEl) {
      e.preventDefault()
      const d = filtered[cursor]
      if (d) onDelete(d.id, d.name)
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div class="scrim" role="presentation" onclick={onClose}></div>

<div
  class="dlg pop"
  role="dialog"
  aria-modal="true"
  aria-label="저장된 문서"
  tabindex="-1"
  onkeydown={onKeyDown}
>
  <header>
    <h2>저장된 문서</h2>
    <button class="btn icon" onclick={onClose} aria-label="닫기">✕</button>
  </header>

  <div class="search">
    <input
      bind:this={searchEl}
      bind:value={search}
      placeholder="문서 이름 검색…"
      spellcheck="false"
      autocomplete="off"
      aria-label="문서 이름 검색"
    />
  </div>

  <div class="list">
    {#each filtered as d, i (d.id)}
      {@const incompatible = d.v > DOC_SCHEMA_V}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="row"
        class:cursor={i === cursor}
        onpointerenter={() => (cursor = i)}
      >
        <button
          class="main"
          disabled={incompatible}
          onclick={() => openAt(i)}
          title={incompatible ? '더 새 버전에서 저장된 문서입니다' : `저장 시각: ${new Date(d.updatedAt).toLocaleString('ko-KR')}`}
        >
          <span class="name-line">
            <span class="name">{d.name}</span>
            {#if d.id === currentId}<span class="tag">현재</span>{/if}
            {#if incompatible}<span class="tag warn">호환되지 않음</span>{/if}
          </span>
          <span class="meta-line">
            {num(d.rowCount)}행 × {num(d.colCount)}열 · {bytes(d.bytes)} · {ago(d.updatedAt)}
          </span>
        </button>
        <button
          class="del"
          onclick={(e) => {
            e.stopPropagation()
            onDelete(d.id, d.name)
          }}
          title="삭제"
          aria-label="{d.name} 삭제"
        >
          ✕
        </button>
      </div>
    {:else}
      <p class="none">
        {docs.length === 0 ? '저장된 문서가 없습니다' : '일치하는 문서가 없습니다'}
      </p>
    {/each}
  </div>

  <footer>
    <span class="sum">{num(docs.length)}개 문서 · 합계 {bytes(totalBytes)}</span>
    <button class="btn" onclick={onClose}>닫기</button>
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
    width: min(440px, calc(100vw - 32px));
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
    align-items: center;
    padding: 11px 8px 11px 14px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .search {
    padding: 10px 14px 6px;
  }
  .search input {
    width: 100%;
    height: 28px;
    padding: 0 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: inherit;
    font-size: 11.5px;
    outline: none;
  }
  .search input:focus {
    border-color: var(--accent-line);
  }

  .list {
    flex: 1;
    min-height: 60px;
    overflow-y: auto;
    padding: 4px 8px 8px;
  }

  .row {
    display: flex;
    align-items: stretch;
    gap: 2px;
    border-radius: 6px;
  }
  .row.cursor {
    background: var(--bg-hover);
  }

  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 9px;
    text-align: left;
    border-radius: 6px;
  }
  .main:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .name-line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .tag {
    flex: none;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 9.5px;
  }
  .tag.warn {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    color: var(--danger);
  }
  .meta-line {
    color: var(--text-faint);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .del {
    flex: none;
    align-self: center;
    width: 26px;
    height: 26px;
    margin-right: 4px;
    border-radius: 5px;
    color: var(--text-faint);
    font-size: 11px;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .del:hover {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    color: var(--danger);
  }

  .none {
    margin: 20px 0;
    text-align: center;
    color: var(--text-faint);
    font-size: 11.5px;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-header);
    border-radius: 0 0 8px 8px;
  }
  .sum {
    flex: 1;
    color: var(--text-faint);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
</style>
