<script lang="ts">
  import type { DocMeta } from '../data/docSnapshot'
  import { ago, num } from '../util/format'

  interface Props {
    onFiles: (files: FileList) => void
    onPasteText: (text: string) => void
    onSample: () => void
    /** 로딩 진행률 0..1 (null이면 대기 상태) */
    progress: number | null
    progressLabel: string
    /** 브라우저(IndexedDB)에 저장된 문서 — 최신 순. IDB 불가이거나 없으면 빈 배열 */
    savedDocs: DocMeta[]
    onOpenDoc: (id: string) => void
    onBrowseDocs: () => void
  }
  let { onFiles, onPasteText, onSample, progress, progressLabel, savedDocs, onOpenDoc, onBrowseDocs }: Props =
    $props()

  let over = $state(false)
  let pasteMode = $state(false)
  let pasteText = $state('')
  let pasteEl = $state<HTMLTextAreaElement | null>(null)
  let fileEl = $state<HTMLInputElement | null>(null)

  function onDrop(e: DragEvent): void {
    e.preventDefault()
    over = false
    const files = e.dataTransfer?.files
    if (files?.length) onFiles(files)
  }

  function onPaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData('text/plain')
    if (text && text.trim() !== '') {
      e.preventDefault()
      onPasteText(text)
    }
  }

  function submitPaste(): void {
    if (pasteText.trim() !== '') onPasteText(pasteText)
  }

  $effect(() => {
    if (pasteMode) pasteEl?.focus()
  })
</script>

<svelte:window onpaste={onPaste} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="zone"
  class:over
  ondragover={(e) => {
    e.preventDefault()
    over = true
  }}
  ondragleave={() => (over = false)}
  ondrop={onDrop}
>
  <div class="inner">
    <div class="mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" width="40" height="40">
        <rect x="2" y="6" width="36" height="28" rx="2" fill="none" stroke="currentColor"
          stroke-width="1.2" opacity="0.5" />
        <path d="M2 14h36M13 14v20M25 14v20" stroke="currentColor" stroke-width="1.2"
          opacity="0.5" />
        <path d="M2 22h36M2 28h36" stroke="currentColor" stroke-width="1" opacity="0.25" />
      </svg>
    </div>

    <h1>xsv</h1>
    <p class="tag">CSV · TSV 워크벤치</p>

    {#if progress !== null}
      <div class="prog" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
        <div class="bar" style="width:{progress * 100}%"></div>
      </div>
      <p class="prog-label">{progressLabel}</p>
    {:else if pasteMode}
      <textarea
        bind:this={pasteEl}
        bind:value={pasteText}
        placeholder="여기에 붙여넣으세요 (Ctrl+V)"
        spellcheck="false"
      ></textarea>
      <div class="acts">
        <button class="btn outline" onclick={() => (pasteMode = false)}>취소</button>
        <button class="btn primary" onclick={submitPaste} disabled={pasteText.trim() === ''}>
          불러오기
        </button>
      </div>
    {:else}
      <p class="hint">
        파일을 끌어다 놓거나 <span class="kbd">Ctrl</span><span class="kbd">V</span>로 붙여넣기
      </p>
      <div class="acts">
        <button class="btn outline" onclick={() => fileEl?.click()}>파일 열기…</button>
        <button class="btn outline" onclick={() => (pasteMode = true)}>텍스트 붙여넣기</button>
        <button class="btn" onclick={onSample}>샘플 데이터</button>
      </div>

      {#if savedDocs.length > 0}
        <div class="docs">
          <p class="docs-title">저장된 문서</p>
          <div class="docs-list">
            {#each savedDocs.slice(0, 5) as d (d.id)}
              <button class="doc-item" onclick={() => onOpenDoc(d.id)}>
                <span class="doc-name" title={d.name}>{d.name}</span>
                <span class="doc-meta">{num(d.rowCount)}행 · {ago(d.updatedAt)}</span>
              </button>
            {/each}
          </div>
          {#if savedDocs.length > 5}
            <button class="docs-more" onclick={onBrowseDocs}>전체 {savedDocs.length}개 보기…</button>
          {/if}
        </div>
      {/if}

      <p class="note">모든 처리는 이 브라우저 안에서만 일어납니다 · 서버 전송 없음</p>
    {/if}
  </div>

  <input
    bind:this={fileEl}
    type="file"
    accept=".csv,.tsv,.txt,.tab,text/csv,text/plain"
    hidden
    onchange={(e) => {
      const f = e.currentTarget.files
      if (f?.length) onFiles(f)
      e.currentTarget.value = ''
    }}
  />
</div>

<style>
  .zone {
    position: relative;
    display: grid;
    place-items: center;
    height: 100%;
    /* 미세한 격자 배경 — 표라는 대상을 배경으로 암시한다 */
    background-image:
      linear-gradient(var(--border-soft) 1px, transparent 1px),
      linear-gradient(90deg, var(--border-soft) 1px, transparent 1px);
    background-size: 28px 28px;
    background-position: -1px -1px;
    transition: background-color var(--dur) var(--ease);
  }
  .zone::after {
    /* 중앙만 밝게 남기는 비네트 */
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 60% 55% at 50% 45%, transparent, var(--bg) 78%);
    pointer-events: none;
  }
  .zone.over {
    background-color: var(--accent-soft);
  }

  .inner {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(460px, calc(100vw - 48px));
    padding: 34px 30px 30px;
    border: 1px dashed var(--border-strong);
    border-radius: 12px;
    background: color-mix(in srgb, var(--bg) 86%, transparent);
    backdrop-filter: blur(2px);
    text-align: center;
    transition: border-color var(--dur) var(--ease);
  }
  .over .inner {
    border-color: var(--accent);
    border-style: solid;
  }

  .mark {
    color: var(--text-dim);
    margin-bottom: 14px;
  }
  .over .mark {
    color: var(--accent);
  }

  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-indent: 0.22em;
    line-height: 1;
  }
  .tag {
    margin: 7px 0 0;
    font-size: var(--fs-label);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .hint {
    margin: 24px 0 16px;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.7;
  }
  .hint .kbd {
    margin: 0 1px;
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }

  .note {
    margin: 20px 0 0;
    color: var(--text-faint);
    font-size: 10.5px;
    letter-spacing: 0.02em;
  }

  .docs {
    width: 100%;
    margin-top: 22px;
    padding-top: 16px;
    border-top: 1px solid var(--border-soft);
  }
  .docs-title {
    margin: 0 0 7px;
    font-size: var(--fs-label);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .docs-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .doc-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    text-align: left;
    transition:
      border-color var(--dur) var(--ease),
      background var(--dur) var(--ease);
  }
  .doc-item:hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }
  .doc-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
  }
  .doc-meta {
    flex: none;
    color: var(--text-faint);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
  .docs-more {
    margin-top: 6px;
    color: var(--text-faint);
    font-size: 10.5px;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .docs-more:hover {
    color: var(--text-dim);
  }

  textarea {
    width: 100%;
    height: 128px;
    margin: 20px 0 12px;
    padding: 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-family: inherit;
    font-size: 11.5px;
    line-height: 1.5;
    resize: vertical;
    outline: none;
  }
  textarea:focus {
    border-color: var(--accent-line);
  }

  .prog {
    width: 100%;
    height: 3px;
    margin: 26px 0 10px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--accent);
    transition: width 90ms linear;
  }
  .prog-label {
    margin: 0;
    color: var(--text-dim);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
</style>
