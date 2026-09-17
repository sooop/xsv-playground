<script lang="ts">
  import { DOC_SCHEMA_V, type DocMeta } from '../data/docSnapshot'
  import { ago, bytes, num } from '../util/format'
  import Modal from './Modal.svelte'

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

  function onKeydown(e: KeyboardEvent): void {
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

<Modal
  label="저장된 문서"
  title="저장된 문서"
  width="440px"
  initialFocus={() => searchEl}
  plainBody
  {onClose}
  onKeydown={onKeydown}
>
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

  {#snippet footer()}
    <span class="sum">{num(docs.length)}개 문서 · 합계 {bytes(totalBytes)}</span>
    <button class="btn" onclick={onClose}>닫기</button>
  {/snippet}
</Modal>

<style>
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

  .sum {
    flex: 1;
    color: var(--text-faint);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
</style>
