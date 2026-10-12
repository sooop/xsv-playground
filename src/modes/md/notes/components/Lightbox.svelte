<script lang="ts">
  // 읽기 모드에서 본문 이미지를 클릭하면 전체 화면으로 확대한다. 편집 모드에서는 개입하지 않는다.
  import { tick } from 'svelte';

  interface Props {
    /** 이미지 클릭을 들을 영역(.editor-wrap) */
    root: HTMLElement | null;
    /** 읽기 모드일 때만 true */
    enabled: boolean;
  }
  let { root, enabled }: Props = $props();

  let src = $state<string | null>(null);
  let scale = $state(1);
  let closeBtn = $state<HTMLButtonElement | null>(null);
  let opener: HTMLElement | null = null;

  async function open(img: HTMLImageElement): Promise<void> {
    const url = img.currentSrc || img.src;
    if (!url) return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    scale = 1;
    src = url;
    await tick();
    closeBtn?.focus();
  }
  function close(): void {
    if (src === null) return;
    src = null;
    opener?.focus?.();
    opener = null;
  }

  $effect(() => {
    if (!root || !enabled) { src = null; return; }
    const el = root;
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.defaultPrevented) return;
      const img = (e.target as Element | null)?.closest?.('img');
      if (!img || !img.closest('.milkdown .ProseMirror')) return;
      e.preventDefault();
      e.stopPropagation();
      void open(img as HTMLImageElement);
    };
    el.addEventListener('click', onClick, true);
    return () => { el.removeEventListener('click', onClick, true); src = null; };
  });

  $effect(() => {
    if (src === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Tab') { e.preventDefault(); closeBtn?.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    scale = Math.max(0.5, Math.min(5, scale - e.deltaY * 0.002));
  }
</script>

{#if src !== null}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="lb-backdrop" role="dialog" aria-modal="true" aria-label="이미지 확대 보기" tabindex="-1" onclick={close} onwheel={onWheel}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
    <img class="lb-img" {src} alt="확대 이미지" style:transform="scale({scale})" onclick={(e) => e.stopPropagation()} />
    <button bind:this={closeBtn} type="button" class="lb-close" aria-label="닫기" onclick={close}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
    </button>
  </div>
{/if}

<style>
  .lb-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 1000);
    /* 테마와 무관하게 뒤 콘텐츠를 완전히 가리는 진한 스크림 */
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: zoom-out;
  }
  .lb-img {
    max-width: 90vw;
    max-height: 90vh;
    object-fit: contain;
    border-radius: 4px;
    transform-origin: center;
    cursor: default;
  }
  .lb-close {
    position: fixed;
    top: 16px;
    right: 20px;
    width: 36px;
    height: 36px;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 0;
    background: rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.92);
    cursor: pointer;
  }
  .lb-close:hover { background: rgba(255, 255, 255, 0.3); }
  .lb-close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
