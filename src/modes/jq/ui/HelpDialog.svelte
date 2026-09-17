<script lang="ts">
  /** 단축키 안내. 목록은 등록된 keymap 에서 그대로 뽑아 오므로 코드와 어긋나지 않는다. */
  import type { KeymapEntry } from '../utils/keymap'

  interface Props {
    entries: readonly KeymapEntry[]
    onClose: () => void
  }
  let { entries, onClose }: Props = $props()

  /** 패널 안에서만 듣는 단축키 — keymap 에 없으므로 따로 적는다 */
  const panelKeys: { keys: string; label: string }[] = [
    { keys: 'Ctrl+Enter', label: '쿼리 실행 (입력·쿼리 패널)' },
    { keys: 'Ctrl+Shift+F', label: '입력 JSON 포맷 / 쿼리 정돈' },
    { keys: 'Ctrl+F', label: '입력에서 찾기 · 출력에서 찾기' },
    { keys: 'Tab / Shift+Tab', label: '들여쓰기 · 내어쓰기, 자동완성 순환' },
    { keys: 'Esc', label: '자동완성 취소(원래 단어 복원) · 팝업 닫기' },
  ]
</script>

<div
  class="overlay"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose()
  }}
>
  <div class="modal pop" role="dialog" aria-modal="true" aria-label="jq 단축키">
    <header class="head">
      <h2>jq 모드 단축키</h2>
      <button class="btn icon" onclick={onClose} title="닫기 (Esc)">×</button>
    </header>
    <div class="body">
      <h3 class="label">모드 전역</h3>
      {#each entries as e (e.id)}
        <div class="row">
          <span class="kbd">{e.keys}</span>
          <span class="desc">{e.label}{#if e.description} — {e.description}{/if}</span>
        </div>
      {/each}

      <h3 class="label">패널 안에서</h3>
      {#each panelKeys as k (k.keys)}
        <div class="row">
          <span class="kbd">{k.keys}</span>
          <span class="desc">{k.label}</span>
        </div>
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
    width: min(520px, 94vw);
    max-height: 86vh;
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
  h3 {
    margin: 12px 0 6px;
  }
  .body {
    overflow-y: auto;
    padding: 4px 12px 14px;
  }
  .row {
    display: grid;
    grid-template-columns: 130px minmax(0, 1fr);
    align-items: baseline;
    gap: 10px;
    padding: 3px 0;
  }
  .desc {
    color: var(--text-dim);
    line-height: 1.5;
  }
</style>
