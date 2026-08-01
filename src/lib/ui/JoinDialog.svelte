<script lang="ts">
  import type { Dataset } from '../data/dataset.svelte'
  import { planJoin, type JoinSpec } from '../data/transform'
  import { num } from '../util/format'
  import { load, save } from '../util/storage'

  export interface JoinResult {
    spec: JoinSpec
    name: string
    /** 결합한 원본 열을 삭제할지 */
    removeSources: boolean
  }

  interface Props {
    ds: Dataset
    /** 결합할 source 칼럼 인덱스 — 화면에 보이는 순서 */
    cols: number[]
    onApply: (result: JoinResult) => void
    onClose: () => void
  }
  let { ds, cols, onApply, onClose }: Props = $props()

  let separator = $state<string>(load('joinSeparator', ' '))
  let skipEmpty = $state<boolean>(load('joinSkipEmpty', true))
  let trim = $state<boolean>(load('joinTrim', true))
  let removeSources = $state(false)
  /** 사용자가 이름을 직접 고쳤는지 — 그 뒤로는 자동 제안으로 덮어쓰지 않는다 */
  let nameTouched = $state(false)
  let name = $state('')

  let sepEl = $state<HTMLInputElement | null>(null)
  $effect(() => {
    sepEl?.focus()
    sepEl?.select()
  })

  const spec = $derived<JoinSpec>({ separator, skipEmpty, trim })

  const plan = $derived.by(() => {
    void ds.version
    return planJoin(ds, cols, spec)
  })

  // 이름을 직접 고치기 전까지는 제안 이름을 따라간다
  $effect(() => {
    if (!nameTouched) name = plan.suggestedName
  })

  const colNames = $derived(cols.map((c) => ds.header[c] ?? ''))
  const valid = $derived(cols.length >= 2 && name.trim() !== '')

  function apply(): void {
    if (!valid) return
    save('joinSeparator', separator)
    save('joinSkipEmpty', skipEmpty)
    save('joinTrim', trim)
    onApply({ spec, name: name.trim(), removeSources })
  }

  function onKeyDown(e: KeyboardEvent): void {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      apply()
    }
  }

  /** 눈에 보이지 않는 구분자를 알아볼 수 있게 라벨을 붙인다 */
  const presets: { label: string; value: string }[] = [
    { label: '공백', value: ' ' },
    { label: ',', value: ',' },
    { label: ', ', value: ', ' },
    { label: '-', value: '-' },
    { label: '_', value: '_' },
    { label: '없음', value: '' },
  ]
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onClose}></div>

<div class="dlg pop" role="dialog" aria-modal="true" aria-label="열 결합" tabindex="-1"
  onkeydown={onKeyDown}>
  <header>
    <h2>열 결합</h2>
    <button class="btn icon" onclick={onClose} aria-label="닫기">✕</button>
  </header>

  <div class="body">
    <div class="sources">
      <span class="label">결합할 열 ({num(cols.length)})</span>
      <div class="chips">
        {#each colNames as n, i (i)}
          <span class="src">{n}</span>{#if i < colNames.length - 1}<span class="plus"
              aria-hidden="true">+</span
            >{/if}
        {/each}
      </div>
      <p class="hint">화면에 보이는 왼쪽→오른쪽 순서로 결합됩니다.</p>
    </div>

    <label class="row">
      <span class="label">구분자</span>
      <input
        bind:this={sepEl}
        bind:value={separator}
        class="field"
        placeholder="비우면 붙여서 결합"
        spellcheck="false"
        autocomplete="off"
      />
    </label>
    <div class="presets">
      {#each presets as p (p.label)}
        <button class="chip" class:on={separator === p.value} onclick={() => (separator = p.value)}>
          {p.label}
        </button>
      {/each}
    </div>

    <label class="row">
      <span class="label">새 열 이름</span>
      <input
        bind:value={name}
        oninput={() => (nameTouched = true)}
        class="field"
        class:error={name.trim() === ''}
        spellcheck="false"
        autocomplete="off"
      />
    </label>

    <div class="togs">
      <button class="tog" class:on={skipEmpty} onclick={() => (skipEmpty = !skipEmpty)}>
        빈 값 건너뛰기
      </button>
      <button class="tog" class:on={trim} onclick={() => (trim = !trim)}>앞뒤 공백 제거</button>
      <button class="tog danger" class:on={removeSources}
        onclick={() => (removeSources = !removeSources)}>원본 열 삭제</button
      >
    </div>

    <div class="preview">
      <span class="label">미리보기</span>
      {#each plan.preview as v, i (i)}
        <div class="pv" class:empty={v === ''}>{v === '' ? '(빈 값)' : v}</div>
      {/each}
      {#if ds.rowCount > plan.preview.length}
        <p class="more">그 외 {num(ds.rowCount - plan.preview.length)}행</p>
      {/if}
    </div>

    <p class="scope-note">모든 행에 적용됩니다 (필터·숨김과 무관).</p>
  </div>

  <footer>
    <button class="btn" onclick={onClose}>취소</button>
    <button class="btn primary" disabled={!valid} onclick={apply}>결합</button>
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
    width: min(460px, calc(100vw - 32px));
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
  }

  .body {
    padding: 12px 14px;
    overflow-y: auto;
  }

  .label {
    display: block;
    margin-bottom: 4px;
  }

  .sources {
    margin-bottom: 12px;
  }
  .chips {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }
  .src {
    padding: 2px 7px;
    background: var(--accent-soft);
    border: 1px solid var(--accent-line);
    border-radius: 4px;
    color: var(--accent);
    font-size: 11px;
  }
  .plus {
    color: var(--text-faint);
    font-size: 10px;
  }
  .hint {
    margin: 6px 0 0;
    color: var(--text-faint);
    font-size: 10.5px;
  }

  .row {
    display: block;
    margin-bottom: 4px;
  }
  .row .field {
    width: 100%;
  }
  .field.error {
    border-color: var(--danger);
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 6px 0 11px;
  }
  .chip {
    height: 21px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 11px;
    color: var(--text-faint);
    font-size: 10.5px;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .chip:hover {
    color: var(--text-dim);
    border-color: var(--border-strong);
  }
  .chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }

  .togs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
  }
  .tog {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-faint);
    font-size: 11px;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease),
      border-color var(--dur) var(--ease);
  }
  .tog:hover {
    color: var(--text-dim);
    border-color: var(--border-strong);
  }
  .tog.on {
    background: var(--sel);
    border-color: var(--sel);
    color: #fff;
    font-weight: 600;
  }
  .tog.danger.on {
    background: var(--danger);
    border-color: var(--danger);
  }

  .preview {
    margin-top: 12px;
    padding: 8px 9px;
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: 6px;
  }
  .pv {
    font-size: 11px;
    line-height: 1.75;
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pv.empty {
    color: var(--text-faint);
  }
  .more {
    margin: 4px 0 0;
    color: var(--text-faint);
    font-size: 10px;
  }

  .scope-note {
    margin: 10px 0 0;
    color: var(--text-faint);
    font-size: 10px;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    padding: 10px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-header);
    border-radius: 0 0 8px 8px;
  }
</style>
