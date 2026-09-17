<script lang="ts">
  interface Marker {
    top: number
    i: number
  }

  interface Props {
    scrollEl: HTMLElement | null
    searchMatches?: (Range | HTMLElement)[]
    searchIndex?: number
    onjump: (i: number) => void
  }
  let { scrollEl, searchMatches = [], searchIndex = -1, onjump }: Props = $props()

  let trackEl = $state<HTMLDivElement | null>(null)
  let markers = $state<Marker[]>([])
  let thumbStyle = $state('')
  let ro: ResizeObserver | undefined

  function computeMarkers(): void {
    if (!scrollEl) return
    const total = scrollEl.scrollHeight
    if (!total) return
    markers = searchMatches.map((match, i) => {
      let top = 0
      try {
        if (match instanceof Range) {
          const rect = match.getBoundingClientRect()
          const scrollRect = scrollEl!.getBoundingClientRect()
          top = ((scrollEl!.scrollTop + rect.top - scrollRect.top) / total) * 100
        } else {
          top = (match.offsetTop / total) * 100
        }
      } catch {
        top = 0
      }
      return { top: Math.max(0, Math.min(99, top)), i }
    })
  }

  function computeThumb(): void {
    if (!scrollEl) return
    const { scrollTop, scrollHeight, clientHeight } = scrollEl
    if (scrollHeight <= clientHeight) {
      thumbStyle = ''
      return
    }
    const ratio = clientHeight / scrollHeight
    const pos = scrollTop / scrollHeight
    thumbStyle = `top:${pos * 100}%;height:${ratio * 100}%`
  }

  function onTrackClick(e: MouseEvent): void {
    if (!scrollEl || !trackEl) return
    const { top, height } = trackEl.getBoundingClientRect()
    const ratio = (e.clientY - top) / height
    scrollEl.scrollTop = ratio * scrollEl.scrollHeight
  }

  $effect(() => {
    void searchMatches
    computeMarkers()
  })

  $effect(() => {
    if (!scrollEl) return
    const onScroll = () => computeThumb()
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    computeThumb()
    ro = new ResizeObserver(() => {
      computeMarkers()
      computeThumb()
    })
    ro.observe(scrollEl)
    return () => {
      scrollEl?.removeEventListener('scroll', onScroll)
      ro?.disconnect()
    }
  })
</script>

{#if markers.length > 0}
  <div class="minimap" bind:this={trackEl} onclick={onTrackClick} role="presentation" aria-label="검색 결과 분포">
    {#if thumbStyle}
      <div class="minimap-thumb" style={thumbStyle}></div>
    {/if}
    {#each markers as m (m.i)}
      <button
        class="minimap-marker"
        class:active={m.i === searchIndex}
        style="top:{m.top}%"
        onclick={(e) => {
          e.stopPropagation()
          onjump(m.i)
        }}
        aria-label="검색 결과 {m.i + 1}번으로 이동"
        tabindex="-1"
      ></button>
    {/each}
  </div>
{/if}

<style>
  .minimap {
    width: 7px;
    flex-shrink: 0;
    position: relative;
    cursor: pointer;
    background: var(--bg-gutter);
    border-left: 1px solid var(--border);
  }
  .minimap-thumb {
    position: absolute;
    left: 0;
    right: 0;
    background: color-mix(in srgb, var(--text-faint) 35%, transparent);
    border-radius: 2px;
    pointer-events: none;
  }
  .minimap-marker {
    position: absolute;
    left: 1px;
    right: 1px;
    height: 3px;
    background: var(--find-line);
    border-radius: 1px;
    transform: translateY(-50%);
    cursor: pointer;
    padding: 0;
    transition: background var(--dur) var(--ease);
  }
  .minimap-marker.active {
    background: var(--find-cur);
  }
</style>
