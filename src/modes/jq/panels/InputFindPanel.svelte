<script lang="ts">
  /**
   * 입력 JSON 안에서 키·값 찾기. 결과를 고르면 textarea 의 해당 구간을 선택하고 스크롤한다.
   *
   * 2MB 를 넘으면 스캐너가 포기하므로(포지션 스캔이 O(n) 메모리다) 대신 같은 일을 하는
   * jq 쿼리를 쿼리 패널에 넣어 준다 — 원본 `InputPanel.ts:performFindSearch` 의 동작.
   */
  import { dismissable } from '../../../lib/ui/dismiss'
  import { filterEntries, scanJson, type JsonEntry } from '../utils/json-position-scanner'
  import { decodeStringified } from '../utils/stringified-fields'
  import { load, save } from '../../../lib/util/storage'

  interface Props {
    /** 검색 대상 textarea — 선택·스크롤을 직접 조작한다 */
    textarea: HTMLTextAreaElement | null
    text: string
    onClose: () => void
    /** 2MB 초과 시 쿼리 패널에 주입할 쿼리 */
    onInjectQuery: (query: string) => void
    /** ↧ 버튼 — 이 경로만 unstringify 하도록 Transform 을 연다 */
    onUnstringify: (path: string) => void
    /** 바깥 클릭 판정에서 제외할 앵커 버튼 */
    anchor?: HTMLElement | null
  }
  let { textarea, text, onClose, onInjectQuery, onUnstringify, anchor }: Props = $props()

  const MAX_DISPLAY = 200
  const SCAN_LIMIT = 2 * 1024 * 1024

  let term = $state('')
  let keys = $state(true)
  let values = $state(true)
  let regex = $state<boolean>(load('jq.inputFindRegex', true))
  let inputEl = $state<HTMLInputElement | null>(null)
  let activeIdx = $state(-1)
  let debounce: ReturnType<typeof setTimeout> | null = null
  let applied = $state('')
  let injected = $state(false)

  let entries = $state.raw<JsonEntry[]>([])

  const tooLarge = $derived(text.length > SCAN_LIMIT)

  const regexError = $derived.by(() => {
    if (!regex || !applied.trim()) return false
    try {
      new RegExp(applied)
      return false
    } catch {
      return true
    }
  })

  const results = $derived.by(() => {
    if (tooLarge || regexError) return []
    return filterEntries(entries, applied, keys, values, regex)
  })

  const shown = $derived(results.slice(0, MAX_DISPLAY))
  const overflow = $derived(results.length > MAX_DISPLAY)

  function onInput(): void {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      applied = term
    }, 200)
  }

  function toggleRegex(): void {
    regex = !regex
    save('jq.inputFindRegex', regex)
  }

  /** 2MB 초과 시 — 범용 패턴 검색 쿼리를 만들어 쿼리 패널로 보낸다 */
  function injectBigQuery(): void {
    const t = term.trim()
    if (!t) return
    const escaped = t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    onInjectQuery(
      `"${escaped}" as $pattern |\n` +
        `[ paths(scalars) as $p |\n` +
        `  select(\n` +
        `    (getpath($p) | tostring | (. != "") and test($pattern; "i")) or\n` +
        `    ($p | last | tostring | test($pattern; "i")) // false\n` +
        `  ) |\n` +
        `  { ($p | map(tostring) | join(".")): getpath($p) }\n` +
        `] | add`,
    )
    injected = true
  }

  function goto(e: JsonEntry, i: number): void {
    if (!textarea) return
    const hasKey = e.key !== null && e.keyStart < e.keyEnd
    const start = hasKey ? e.keyStart : e.valueStart
    const end = hasKey ? e.keyEnd : e.valueEnd
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 18
    const lineNum = textarea.value.substring(0, start).split('\n').length - 1
    textarea.focus()
    textarea.setSelectionRange(start, end)
    textarea.scrollTop = Math.max(0, lineNum * lineHeight - textarea.clientHeight / 2)
    activeIdx = i
  }

  /** 이 값이 문자열로 감싸인 JSON인지 — 맞으면 ↧ 버튼을 보여 준다 */
  function unstringifiable(e: JsonEntry): boolean {
    const literal = text.slice(e.valueStart, e.valueEnd)
    if (!literal.startsWith('"')) return false
    try {
      const s: unknown = JSON.parse(literal)
      return typeof s === 'string' && decodeStringified(s) !== null
    } catch {
      return false
    }
  }

  /** 검색어 매치 부분을 <mark> 로 쪼갠다 */
  function segments(value: string): { t: string; hit: boolean }[] {
    if (!applied) return [{ t: value, hit: false }]
    let re: RegExp
    try {
      re = regex
        ? new RegExp(applied, 'gi')
        : new RegExp(applied.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    } catch {
      return [{ t: value, hit: false }]
    }
    const out: { t: string; hit: boolean }[] = []
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(value)) !== null) {
      if (m.index > last) out.push({ t: value.slice(last, m.index), hit: false })
      out.push({ t: m[0], hit: true })
      last = m.index + m[0].length
      if (m[0].length === 0) re.lastIndex++
    }
    if (last < value.length) out.push({ t: value.slice(last), hit: false })
    return out
  }

  /** Escape로 닫힐 때 입력으로 포커스를 되돌린다 */
  function closeAndRefocus(): void {
    onClose()
    textarea?.focus()
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (tooLarge) injectBigQuery()
      else if (shown[0]) goto(shown[0], 0)
    }
  }

  // 텍스트가 바뀌면 스캔 캐시를 버린다
  $effect(() => {
    entries = tooLarge ? [] : scanJson(text)
  })

  $effect(() => {
    inputEl?.focus()
    inputEl?.select()
  })
</script>

<div class="find pop" {@attach dismissable(closeAndRefocus, { ignore: () => [anchor] })}>
  <div class="find-head">
    <input
      bind:this={inputEl}
      class="field"
      type="text"
      placeholder={regex ? '정규식 패턴...' : '키·값 검색...'}
      bind:value={term}
      oninput={onInput}
      onkeydown={onKeydown}
    />
    <label class="chk"><input type="checkbox" bind:checked={keys} /> 키</label>
    <label class="chk"><input type="checkbox" bind:checked={values} /> 값</label>
    <button class="btn outline" class:on={regex} onclick={toggleRegex} title="정규식 사용">.*</button>
    <span class="count">
      {#if tooLarge}2MB+{:else if regexError}정규식 오류{:else if applied.trim()}{overflow
          ? MAX_DISPLAY + '+'
          : results.length}개{/if}
    </span>
    <button class="btn icon" onclick={onClose} title="닫기 (Esc)">×</button>
  </div>

  <div class="find-list">
    {#if tooLarge}
      <p class="empty">
        입력이 2MB를 넘어 위치 스캔을 쓸 수 없습니다.
        {#if injected}
          쿼리 패널에 범용 검색 쿼리를 넣었습니다.
        {:else}
          검색어를 입력하고 Enter를 누르면 같은 일을 하는 jq 쿼리를 넣어 드립니다.
        {/if}
      </p>
    {:else if regexError}
      <p class="empty">정규식 오류: 올바른 패턴을 입력하세요</p>
    {:else if !applied.trim()}
      <p class="empty">
        {entries.length > 0 ? `${entries.length}개 항목. 검색어를 입력하세요.` : 'JSON 항목이 없습니다'}
      </p>
    {:else if shown.length === 0}
      <p class="empty">일치하는 항목 없음</p>
    {:else}
      {#each shown as e, i (e.path + ':' + e.valueStart)}
        <div class="row" class:active={i === activeIdx}>
          <button class="row-main" onclick={() => goto(e, i)}>
            <span class="path">
              {#each segments(e.path) as s}{#if s.hit}<mark>{s.t}</mark>{:else}{s.t}{/if}{/each}
            </span>
            <span class="value">
              {#each segments(e.value) as s}{#if s.hit}<mark>{s.t}</mark>{:else}{s.t}{/if}{/each}
            </span>
          </button>
          {#if unstringifiable(e)}
            <button class="btn icon" title="이 필드만 unstringify" onclick={() => onUnstringify(e.path)}>
              ↧
            </button>
          {/if}
        </div>
      {/each}
      {#if overflow}
        <p class="empty">결과가 200개로 제한되었습니다. 검색어를 구체화하세요.</p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .find {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: var(--z-popover);
    width: min(620px, 92vw);
    display: flex;
    flex-direction: column;
    max-height: 60vh;
  }
  .find-head {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px;
    border-bottom: 1px solid var(--border-soft);
  }
  .find-head .field {
    flex: 1;
    min-width: 0;
  }
  .chk {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--fs-label);
    color: var(--text-dim);
    white-space: nowrap;
  }
  .count {
    min-width: 46px;
    text-align: right;
    font-size: var(--fs-label);
    color: var(--text-faint);
  }
  .find-list {
    overflow-y: auto;
    padding: 4px;
  }
  .empty {
    margin: 0;
    padding: 16px;
    text-align: center;
    color: var(--text-faint);
    line-height: 1.6;
  }
  .row {
    display: flex;
    align-items: center;
    border-radius: 5px;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.active {
    background: var(--accent-soft);
  }
  .row-main {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    gap: 10px;
    padding: 4px 7px;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .path {
    color: var(--accent);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .value {
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  mark {
    background: var(--find-bg);
    color: var(--find-text);
    border-radius: 2px;
  }
</style>
