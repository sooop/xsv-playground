<script lang="ts">
  import { mdState } from '../mdState.svelte'

  export interface Heading {
    id: string
    text: string
    level: number
  }

  interface TocNode extends Heading {
    relLevel: number
    children: TocNode[]
  }

  interface Props {
    headings?: Heading[]
    activeId?: string
  }
  let { headings = [], activeId = '' }: Props = $props()

  const nested = $derived.by((): TocNode[] => {
    if (!headings.length) return []
    const minLevel = headings.reduce((m, h) => Math.min(m, h.level), 6)
    const nodes: TocNode[] = headings.map((h) => ({ ...h, relLevel: h.level - minLevel, children: [] }))
    const root: TocNode[] = []
    const stack: TocNode[] = []
    for (const node of nodes) {
      while (stack.length > 0 && stack[stack.length - 1].relLevel >= node.relLevel) stack.pop()
      if (stack.length === 0) root.push(node)
      else stack[stack.length - 1].children.push(node)
      stack.push(node)
    }
    return root
  })

  function scrollTo(id: string): void {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
</script>

<nav class="toc-panel" aria-label="목차" class:hidden={!mdState.tocOpen || headings.length < 2}>
  <p class="label toc-title">목차</p>
  <div class="toc-list">
    {#each nested as node (node.id)}
      {@render tocNode(node)}
    {/each}
  </div>
</nav>

{#snippet tocNode(node: TocNode)}
  <div class="toc-node">
    <a
      class="toc-item"
      class:active={node.id === activeId}
      href="#{node.id}"
      style="padding-left:{node.relLevel * 12 + 12}px; opacity:{1 - node.relLevel * 0.08}"
      onclick={(e) => {
        e.preventDefault()
        scrollTo(node.id)
      }}
      title={node.text}
    >
      {node.text}
    </a>
    {#if node.children.length > 0}
      <div class="toc-children">
        {#each node.children as child (child.id)}
          {@render tocNode(child)}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<style>
  .toc-panel {
    width: 200px;
    min-width: 200px;
    overflow-y: auto;
    padding: 20px 0;
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }
  .toc-panel.hidden {
    width: 0;
    min-width: 0;
    border: none;
    padding: 0;
    overflow: hidden;
  }
  .toc-title {
    margin-bottom: 8px;
    padding-left: 14px;
  }
  .toc-item {
    display: block;
    padding: 4px 10px 4px 0;
    font-size: 11.5px;
    color: var(--text-dim);
    text-decoration: none;
    border-left: 2px solid transparent;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition:
      color var(--dur) var(--ease),
      border-color var(--dur) var(--ease),
      background var(--dur) var(--ease);
  }
  .toc-item:hover {
    color: var(--text);
    background: var(--bg-hover);
    opacity: 1 !important;
  }
  .toc-item.active {
    color: var(--accent);
    font-weight: 600;
    border-left-color: var(--accent);
    background: var(--accent-soft);
    opacity: 1 !important;
  }
  .toc-node {
    display: flex;
    flex-direction: column;
  }
  .toc-children {
    border-left: 1px solid var(--border-soft);
    margin-left: 18px;
  }
</style>
