<script lang="ts">
  import { mdState } from '../mdState.svelte'

  interface Props {
    onLoad: (id: number) => void
    onDelete: (id: number) => void
  }
  let { onLoad, onDelete }: Props = $props()
</script>

<nav id="md-sidebar" aria-label="최근 파일" class:collapsed={!mdState.sidebarOpen}>
  <div class="md-sidebar-header">
    <p class="label">Recent files</p>
  </div>
  <div class="md-history-list" role="list">
    {#if mdState.history.length === 0}
      <div class="md-empty-history" aria-live="polite">파일을 열면<br />여기에 기록됩니다</div>
    {:else}
      {#each mdState.history as f (f.id)}
        <button
          class="history-item"
          class:active={mdState.currentDoc?.id === f.id}
          aria-label="{f.name} 열기"
          onclick={() => onLoad(f.id as number)}
        >
          <span class="hi-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
              <path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />
            </svg>
          </span>
          <span class="hi-name" title={f.name}>{f.name}</span>
          <span
            class="hi-del"
            role="button"
            tabindex="0"
            aria-label="{f.name} 삭제"
            title="삭제"
            onclick={(e) => {
              e.stopPropagation()
              onDelete(f.id as number)
            }}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onDelete(f.id as number)
              }
            }}
          >
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </span>
        </button>
      {/each}
    {/if}
  </div>
</nav>

<style>
  #md-sidebar {
    width: 220px;
    min-width: 220px;
    background: var(--bg-header);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition:
      width var(--dur) var(--ease),
      min-width var(--dur) var(--ease);
  }
  #md-sidebar.collapsed {
    width: 0;
    min-width: 0;
    border-right: none;
  }
  .md-sidebar-header {
    padding: 14px 14px 10px;
    border-bottom: 1px solid var(--border-soft);
    flex-shrink: 0;
  }
  .md-history-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
  }
  .md-empty-history {
    padding: 20px 12px;
    font-size: 11.5px;
    color: var(--text-faint);
    text-align: center;
    line-height: 1.6;
  }
  .history-item {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 7px 8px;
    border-radius: 5px;
    color: var(--text-dim);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-align: left;
    transition: background var(--dur) var(--ease);
  }
  .history-item:hover,
  .history-item:focus-visible {
    background: var(--bg-hover);
    outline: none;
  }
  .history-item.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .hi-icon {
    flex-shrink: 0;
    opacity: 0.7;
  }
  .hi-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hi-del {
    flex-shrink: 0;
    opacity: 0;
    padding: 3px;
    border-radius: 4px;
    color: var(--text-faint);
    transition: opacity var(--dur) var(--ease);
  }
  .history-item:hover .hi-del,
  .history-item:focus-within .hi-del {
    opacity: 1;
  }
  .hi-del:hover {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 16%, transparent);
  }
</style>
