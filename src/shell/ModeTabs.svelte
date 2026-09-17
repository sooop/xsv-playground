<script lang="ts">
  import { MODE_IDS, MODE_LABEL } from './mode'
  import { shell } from './shell.svelte'
  import { THEME_LABEL, themeCtl } from './theme.svelte'

  const SHORTCUT: Record<string, string> = { csv: '1', jq: '2', md: '3' }
</script>

<nav class="modebar" aria-label="도구">
  <div class="tablist" role="tablist">
    {#each MODE_IDS as m (m)}
      {@const st = shell.status[m]}
      <button
        class="tab"
        role="tab"
        aria-selected={shell.active === m}
        class:active={shell.active === m}
        onclick={() => shell.activate(m)}
        title="{MODE_LABEL[m]} (Ctrl+Shift+{SHORTCUT[m]})"
      >
        <span class="name">{MODE_LABEL[m]}</span>
        {#if st.label}
          <span class="doc" title={st.label}>{st.label}</span>
        {/if}
        {#if st.isDirty}
          <span class="dirty" aria-label="저장되지 않음"></span>
        {:else if st.hasDocument}
          <span class="dot" aria-hidden="true"></span>
        {/if}
      </button>
    {/each}
  </div>

  <div class="spacer"></div>

  <button
    class="btn icon"
    onclick={() => themeCtl.cycle()}
    title="테마: {THEME_LABEL[themeCtl.pref]}{themeCtl.pref === 'system' ? ` (현재 ${themeCtl.theme === 'dark' ? '다크' : '라이트'})` : ''} — 클릭하면 전환"
    aria-label="테마: {THEME_LABEL[themeCtl.pref]}"
  >
    {#if themeCtl.pref === 'system'}
      <!-- 반쪽 원: 시스템 설정을 따름 -->
      <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.3" />
        <path d="M7 2a5 5 0 010 10z" fill="currentColor" />
      </svg>
    {:else if themeCtl.pref === 'light'}
      <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
        <circle cx="7" cy="7" r="3" fill="currentColor" />
        <path d="M7 1v1.6M7 11.4V13M1 7h1.6M11.4 7H13M2.8 2.8l1.1 1.1M10.1 10.1l1.1 1.1M11.2 2.8l-1.1 1.1M3.9 10.1l-1.1 1.1"
          stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
      </svg>
    {:else}
      <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
        <path d="M11.5 8.6A5 5 0 015.4 2.5 5 5 0 107 12a5 5 0 004.5-3.4z" fill="currentColor" />
      </svg>
    {/if}
  </button>
</nav>

<style>
  .modebar {
    display: flex;
    align-items: stretch;
    flex: none;
    height: var(--tabbar-h);
    padding: 0 9px 0 6px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }

  .tablist {
    display: flex;
    align-items: stretch;
    gap: 2px;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 11px;
    color: var(--text-dim);
    border-bottom: 2px solid transparent;
    /* 아래 경계선과 겹치게 1px 내려 활성 탭이 툴바와 이어져 보이게 한다 */
    margin-bottom: -1px;
    transition:
      color var(--dur) var(--ease),
      border-color var(--dur) var(--ease);
  }
  .tab:hover {
    color: var(--text);
  }
  .tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .name {
    font-size: var(--fs-ui);
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .doc {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-label);
    color: var(--text-faint);
  }

  .dot,
  .dirty {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex: none;
  }
  .dot {
    background: var(--text-faint);
  }
  .dirty {
    background: var(--accent);
  }

  .spacer {
    flex: 1;
  }

  .modebar > .btn {
    align-self: center;
  }
</style>
