<script lang="ts">
  // 문서 전체를 세로로 축소해 보여주는 미니맵. 스크롤 요소(.editor-wrap)의 오른쪽 끝에 fixed 로 붙는다.
  import { layoutBars, thumbBox, scrollTopForPointer, kindOf, type Bar, type BlockBox } from '../minimap';

  interface Props {
    /** 스크롤 요소(.editor-wrap) */
    wrap: HTMLElement | null;
    /** 편집 중이면 입력 성능을 위해 갱신을 더 늦게 한다 */
    editing?: boolean;
  }
  let { wrap, editing = false }: Props = $props();

  const W = 44;
  let bars = $state<Bar[]>([]);
  let thumb = $state({ y: 0, h: 0 });
  let box = $state({ left: 0, top: 0, height: 0 });
  let visible = $state(false);
  let total = 0;
  let trackEl = $state<HTMLDivElement | null>(null);
  let dragging = false;

  function findPm(): HTMLElement | null {
    return wrap?.querySelector<HTMLElement>('.milkdown .ProseMirror') ?? null;
  }

  /** 위치·썸만 갱신(스크롤 시 가벼운 경로) */
  function updatePos(): void {
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const ch = wrap.clientHeight;
    total = wrap.scrollHeight;
    const pm = findPm();
    const pr = pm?.getBoundingClientRect();
    const left = r.left + wrap.clientWidth - W;
    // 본문 글자 영역(.ProseMirror 의 좌우 padding 48px 안쪽)과 겹치면 숨긴다
    const overlap = pr ? pr.right - 48 > left - 4 : false;
    visible = !!pm && total > ch + 1 && !overlap && r.height > 0;
    box = { left, top: r.top, height: ch };
    thumb = thumbBox(wrap.scrollTop, ch, total, ch);
  }

  /** 블록 배치까지 다시 계산(문서 변경·크기 변경 시) */
  function rebuild(): void {
    updatePos();
    const pm = findPm();
    if (!wrap || !pm || !visible) { bars = []; return; }
    const base = wrap.getBoundingClientRect().top - wrap.scrollTop;
    const blocks: BlockBox[] = [];
    for (const el of Array.from(pm.children)) {
      const r = el.getBoundingClientRect();
      if (r.height <= 0) continue;
      blocks.push({ top: r.top - base, height: r.height, kind: kindOf(el) });
    }
    bars = layoutBars(blocks, total, box.height);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(rebuild, editing ? 300 : 100);
  }

  $effect(() => {
    const el = wrap;
    void editing;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; updatePos(); });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    let observedPm: HTMLElement | null = null;
    const observePm = () => {
      const pm = findPm();
      if (pm && pm !== observedPm) { if (observedPm) ro.unobserve(observedPm); ro.observe(pm); observedPm = pm; }
    };
    // 에디터는 비동기로 생성되고 문서가 바뀌면 다시 만들어지므로 하위 변경을 보고 다시 찾는다.
    // 미니맵은 el 밖에 있어 자기 변경에 반응하지 않는다.
    const mo = new MutationObserver(() => { observePm(); schedule(); });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', schedule);
    observePm();
    rebuild();
    return () => {
      clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
      mo.disconnect();
    };
  });

  function seek(e: PointerEvent): void {
    if (!wrap || !trackEl) return;
    const r = trackEl.getBoundingClientRect();
    wrap.scrollTop = scrollTopForPointer(e.clientY - r.top, r.height, wrap.clientHeight, wrap.scrollHeight);
  }
  function onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seek(e);
  }
  function onMove(e: PointerEvent): void { if (dragging) seek(e); }
  function onUp(): void { dragging = false; }

  function onKey(e: KeyboardEvent): void {
    if (!wrap) return;
    const page = wrap.clientHeight * 0.9;
    const map: Record<string, number> = { ArrowUp: -48, ArrowDown: 48, PageUp: -page, PageDown: page };
    if (e.key in map) { e.preventDefault(); wrap.scrollTop += map[e.key]; }
    else if (e.key === 'Home') { e.preventDefault(); wrap.scrollTop = 0; }
    else if (e.key === 'End') { e.preventDefault(); wrap.scrollTop = wrap.scrollHeight; }
  }
</script>

{#if visible}
  <div
    class="mm"
    bind:this={trackEl}
    role="slider"
    aria-label="문서 미니맵"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round((thumb.y / Math.max(1, box.height - thumb.h)) * 100) || 0}
    tabindex="0"
    style:left="{box.left}px"
    style:top="{box.top}px"
    style:height="{box.height}px"
    style:width="{W}px"
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    onkeydown={onKey}
  >
    {#each bars as b}
      <i class="bar {b.kind}" style:top="{b.y}px" style:height="{b.h}px"></i>
    {/each}
    <div class="thumb" style:top="{thumb.y}px" style:height="{thumb.h}px"></div>
  </div>
{/if}

<style>
  .mm {
    position: fixed;
    z-index: 5;
    background: var(--bg);
    border-left: 1px solid var(--border);
    cursor: pointer;
    touch-action: none;
    user-select: none;
    overflow: hidden;
  }
  .mm:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .bar {
    position: absolute;
    left: 8px;
    right: 8px;
    border-radius: 1px;
    background: var(--muted);
    opacity: 0.35;
    pointer-events: none;
  }
  .bar.heading { left: 5px; background: var(--accent); opacity: 0.8; }
  .bar.code { background: var(--text); opacity: 0.25; left: 6px; right: 6px; }
  .bar.table { background: var(--text); opacity: 0.3; left: 6px; right: 6px; }
  .bar.image { background: var(--accent); opacity: 0.4; left: 6px; right: 6px; }
  .bar.quote { left: 12px; opacity: 0.45; }
  .thumb {
    position: absolute;
    left: 0;
    right: 0;
    background: var(--accent);
    opacity: 0.18;
    border-top: 1px solid var(--accent);
    border-bottom: 1px solid var(--accent);
    pointer-events: none;
  }
  .mm:hover .thumb { opacity: 0.28; }
</style>
