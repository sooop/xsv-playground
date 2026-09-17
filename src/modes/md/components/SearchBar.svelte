<script lang="ts">
  import { tick } from 'svelte'
  import { isValidRegex } from '../lib/search'
  import { mdState } from '../mdState.svelte'

  interface Props {
    count?: number
    index?: number
    snippets?: string[]
    onnext: () => void
    onprev: () => void
    onsearch: () => void
    onjump: (i: number) => void
  }
  let { count = 0, index = -1, snippets = [], onnext, onprev, onsearch, onjump }: Props = $props()

  let inputEl = $state<HTMLInputElement | null>(null)
  let showList = $state(false)

  const regexInvalid = $derived(
    mdState.searchOptions.regex && mdState.searchOptions.term !== '' && !isValidRegex(mdState.searchOptions.term),
  )

  $effect(() => {
    if (mdState.searchOpen) void tick().then(() => inputEl?.focus())
  })

  function handleInput(e: Event): void {
    mdState.setSearchOption('term', (e.currentTarget as HTMLInputElement).value)
    onsearch()
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.shiftKey ? onprev() : onnext()
    }
    // Esc는 셸이 넘기는 MdMode.handleKeydown이 우선순위대로 처리한다(여기서는 다루지 않는다)
    if (e.altKey) {
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        toggle('regex')
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        toggle('caseSensitive')
      }
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault()
        toggle('wholeWord')
      }
    }
  }

  export function focus(): void {
    inputEl?.focus()
  }

  function toggle(key: 'regex' | 'caseSensitive' | 'wholeWord'): void {
    mdState.setSearchOption(key, !mdState.searchOptions[key])
    onsearch()
  }
</script>

{#if mdState.searchOpen}
  <div class="toolbar" role="search" aria-label="문서 내 검색">
    <input
      bind:this={inputEl}
      type="text"
      class="field"
      placeholder="문서 내 검색..."
      value={mdState.searchOptions.term}
      oninput={handleInput}
      onkeydown={handleKeydown}
      class:invalid={regexInvalid}
      aria-label="검색어 입력"
      aria-describedby="md-search-count"
    />

    <button
      class="btn sb-btn"
      class:on={mdState.searchOptions.regex}
      onclick={() => toggle('regex')}
      aria-pressed={mdState.searchOptions.regex}
      aria-label="정규식 검색"
      title="정규식 (Alt+R)"
    >
      .*
    </button>
    <button
      class="btn sb-btn"
      class:on={mdState.searchOptions.caseSensitive}
      onclick={() => toggle('caseSensitive')}
      aria-pressed={mdState.searchOptions.caseSensitive}
      aria-label="대소문자 구분"
      title="대소문자 구분 (Alt+C)"
    >
      Aa
    </button>
    <button
      class="btn sb-btn"
      class:on={mdState.searchOptions.wholeWord}
      onclick={() => toggle('wholeWord')}
      aria-pressed={mdState.searchOptions.wholeWord}
      aria-label="단어 단위 검색"
      title="단어 단위 (Alt+W)"
    >
      |ab|
    </button>

    <span id="md-search-count" class="label" aria-live="polite">
      {#if regexInvalid}
        잘못된 정규식
      {:else if mdState.searchOptions.term}
        {count === 0 ? '없음' : `${index + 1} / ${count}`}
      {/if}
    </span>

    {#if count > 1}
      <button
        class="btn icon"
        onclick={() => (showList = !showList)}
        aria-label="검색 결과 목록"
        title="결과 목록"
        aria-pressed={showList}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12h.01" /><path d="M3 18h.01" /><path d="M3 6h.01" />
          <path d="M8 12h13" /><path d="M8 18h13" /><path d="M8 6h13" />
        </svg>
      </button>
    {/if}

    <button class="btn icon" onclick={onprev} aria-label="이전 검색 결과" title="이전 (Shift+Enter / Shift+F3)">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6" /></svg>
    </button>
    <button class="btn icon" onclick={onnext} aria-label="다음 검색 결과" title="다음 (Enter / F3)">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <button class="btn icon" onclick={() => mdState.toggleSearch(false)} aria-label="검색 닫기" title="닫기 (Esc)">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
    </button>
  </div>

  {#if showList && snippets.length > 0}
    <div class="results-panel" role="listbox" aria-label="검색 결과 목록">
      {#each snippets as snippet, i (i)}
        <button class="sr-item" class:active={i === index} role="option" aria-selected={i === index} onclick={() => onjump(i)}>
          <span class="sr-num">{i + 1}</span>
          <span class="sr-snippet">{snippet}</span>
        </button>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .field {
    flex: 1;
    min-width: 120px;
  }
  .field.invalid {
    border-color: var(--danger);
  }
  #md-search-count {
    flex-shrink: 0;
    min-width: 52px;
    text-align: center;
  }
  .sb-btn {
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .results-panel {
    max-height: 180px;
    overflow-y: auto;
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .sr-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 14px;
    color: var(--text-dim);
    font-size: 11.5px;
    text-align: left;
    transition: background var(--dur) var(--ease);
  }
  .sr-item:hover,
  .sr-item:focus-visible,
  .sr-item.active {
    background: var(--bg-hover);
    color: var(--text);
    outline: none;
  }
  .sr-num {
    flex-shrink: 0;
    min-width: 22px;
    text-align: right;
    color: var(--text-faint);
    font-size: 10.5px;
  }
  .sr-snippet {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
