<script lang="ts">
  import { themeCtl } from '../../../shell/theme.svelte'
  import { mdDb } from '../lib/db'
  import { parseMarkdown } from '../lib/markdown'
  import { renderExtras } from '../lib/render-extras'
  import { mdState } from '../mdState.svelte'

  interface Props {
    docId: number | undefined
    onRender?: (html: string) => void
  }
  let { docId, onRender }: Props = $props()

  let rawContent = $state(mdState.currentDoc?.content ?? '')
  const preview = $derived(parseMarkdown(rawContent))
  let previewEl = $state<HTMLDivElement | null>(null)

  let saveTimer: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    void docId // 문서가 바뀌면 원문을 그 문서 내용으로 되돌린다
    rawContent = mdState.currentDoc?.content ?? ''
  })

  $effect(() => {
    onRender?.(preview)
    if (previewEl) setTimeout(() => void renderExtras(previewEl, themeCtl.theme), 0)
  })

  function handleInput(e: Event): void {
    rawContent = (e.currentTarget as HTMLTextAreaElement).value
    mdState.setDirty(true)
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (docId == null) return
      mdState.setSaveStatus('saving')
      void mdDb.updateContent(docId, rawContent).then(() => {
        mdState.setSaveStatus('saved')
        mdState.setDirty(false)
        setTimeout(() => mdState.setSaveStatus(''), 1500)
      })
    }, 800)
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget as HTMLTextAreaElement
      const start = ta.selectionStart
      const end = ta.selectionEnd
      rawContent = rawContent.slice(0, start) + '  ' + rawContent.slice(end)
      setTimeout(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      }, 0)
    }
  }
</script>

<div class="editor-wrap">
  <div class="editor-pane">
    <p class="label pane-label">편집</p>
    <textarea
      class="editor-ta"
      value={rawContent}
      oninput={handleInput}
      onkeydown={handleKeydown}
      spellcheck="false"
      aria-label="마크다운 편집"
    ></textarea>
  </div>
  <div class="editor-pane preview-pane">
    <p class="label pane-label">미리보기</p>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    <div bind:this={previewEl} class="editor-preview" id="md-reader-content">{@html preview}</div>
  </div>
</div>

<style>
  .editor-wrap {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .editor-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--border);
  }
  .editor-pane:last-child {
    border-right: none;
  }
  .pane-label {
    padding: 6px 12px;
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .editor-ta {
    flex: 1;
    resize: none;
    border: none;
    outline: none;
    padding: 18px;
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.7;
    background: var(--bg);
    color: var(--text);
    tab-size: 2;
  }
  .editor-preview {
    flex: 1;
    overflow-y: auto;
    padding: 28px 36px;
  }
</style>
