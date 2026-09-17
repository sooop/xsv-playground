<script lang="ts">
  /** jq 문법 치트시트. 항목을 고르면 현재 쿼리 뒤에 파이프로 잇는다. */
  import { CHEATSHEET_CATEGORIES } from '../data/cheatsheet'
  import { INPUT_TYPE_INFO } from '../core/jq-functions'

  interface Props {
    onPick: (query: string) => void
    onClose: () => void
  }
  let { onPick, onClose }: Props = $props()

  const keys = Object.keys(CHEATSHEET_CATEGORIES)
  let active = $state(keys[0]!)

  const items = $derived(CHEATSHEET_CATEGORIES[active]?.items ?? [])
</script>

<div
  class="overlay"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose()
  }}
>
  <div class="modal pop" role="dialog" aria-modal="true" aria-label="jq 문법 참조">
    <header class="head">
      <h2>jq 문법 참조</h2>
      <button class="btn icon" onclick={onClose} title="닫기 (Esc)">×</button>
    </header>

    <nav class="tabs">
      {#each keys as k (k)}
        <button class="btn" class:on={active === k} onclick={() => (active = k)}>
          {CHEATSHEET_CATEGORIES[k]!.title}
        </button>
      {/each}
    </nav>

    <div class="body">
      {#each items as item (item.query)}
        {@const info = item.inputType ? INPUT_TYPE_INFO[item.inputType] : null}
        <button class="item" onclick={() => onPick(item.query)}>
          <span class="q">
            <code>{item.query}</code>
            {#if info}<span class="ty {info.cls}">{info.label}</span>{/if}
          </span>
          <span class="d">{item.desc}</span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    padding: 20px;
    background: var(--bg-overlay);
  }
  .modal {
    display: flex;
    flex-direction: column;
    width: min(900px, 96vw);
    max-height: 88vh;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 12px;
    border-bottom: 1px solid var(--border-soft);
  }
  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-soft);
  }
  .tabs :global(.btn) {
    height: 24px;
    padding: 0 8px;
    font-size: var(--fs-label);
  }
  .body {
    overflow-y: auto;
    padding: 6px;
  }
  .item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: baseline;
    gap: 12px;
    width: 100%;
    padding: 5px 8px;
    border-radius: 5px;
    text-align: left;
  }
  .item:hover {
    background: var(--bg-hover);
  }
  .q {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--accent);
    white-space: pre-wrap;
    word-break: break-all;
  }
  .ty {
    flex: none;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 3px;
    font-size: 9.5px;
    line-height: 14px;
    color: var(--text-dim);
  }
  .ty.ty-field {
    color: var(--accent);
    border-color: var(--accent-line);
  }
  .ty.ty-array,
  .ty.ty-object {
    color: var(--c-num);
  }
  .d {
    color: var(--text-dim);
    font-size: var(--fs-label);
  }
</style>
