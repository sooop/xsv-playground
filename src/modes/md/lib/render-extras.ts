/**
 * Mermaid + KaTeX CDN 지연 로더.
 *
 * 둘 다 번들에 넣지 않고 처음 필요할 때(문서에 실제로 있을 때만) CDN에서 받아온다. Promise를
 * 캐시해 두어 왕복은 세션당 한 번만 일어난다. `/* @vite-ignore *\/` 동적 import는 `inlineDynamicImports`
 * 빌드 설정과 충돌하지 않는다(정적 분석 대상이 아닌 순수 런타임 URL이라서).
 *
 * 실패(오프라인 등)해도 조용히 그 블록만 원문 그대로 남는다 — 콘솔에는 아무것도 쓰지 않는다.
 */
import { loadStyle } from '../../../lib/util/cdn'
import type { Theme } from '../../../shell/theme.svelte'

// ── Mermaid ──────────────────────────────────────────────────────────────────
interface MermaidApi {
  initialize(config: { startOnLoad: boolean; theme: string; securityLevel: string }): void
  run(opts: { nodes: Element[] }): Promise<void>
}
interface MermaidModule {
  default: MermaidApi
}

// URL을 별도 변수로 둔다 — import()에 문자열 리터럴을 바로 넘기면 TS가 정적 모듈 해석을
// 시도해 "Cannot find module" 오류를 낸다. `string`으로 넓혀 두면 런타임 전용 동적 경로로
// 취급되어 반환 타입이 `Promise<any>`가 되고, 그 값을 아래에서 명시적으로 캐스팅한다.
const MERMAID_CDN_URL: string = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'

let mermaidPromise: Promise<MermaidApi> | null = null

async function loadMermaid(theme: string): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = (import(/* @vite-ignore */ MERMAID_CDN_URL) as Promise<MermaidModule>).then((mod) => mod.default)
  }
  const m = await mermaidPromise
  m.initialize({ startOnLoad: false, theme, securityLevel: 'loose' })
  return m
}

// ── KaTeX ────────────────────────────────────────────────────────────────────
type RenderMathInElement = (
  el: HTMLElement,
  opts: { delimiters: { left: string; right: string; display: boolean }[]; throwOnError: boolean },
) => void
interface AutoRenderModule {
  default: RenderMathInElement
}

const KATEX_AUTORENDER_URL: string = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.mjs'

let katexPromise: Promise<RenderMathInElement> | null = null

async function loadKatex(): Promise<RenderMathInElement> {
  if (!katexPromise) {
    katexPromise = (async () => {
      await loadStyle('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css')
      const arMod = (await import(/* @vite-ignore */ KATEX_AUTORENDER_URL)) as AutoRenderModule
      return arMod.default
    })()
  }
  return katexPromise
}

// ── 도우미 ────────────────────────────────────────────────────────────────────
function getMermaidTheme(theme: Theme): string {
  return theme === 'dark' ? 'dark' : 'default'
}

function hasMath(container: HTMLElement): boolean {
  const text = container.textContent ?? ''
  return text.includes('$$') || /\$[^$\n]{1,200}\$/.test(text)
}

/**
 * `marked`가 `breaks:true`로 빈 줄 없는 블록 수식을 `<p>$$<br>…<br>$$</p>`로 바꿔 버리면
 * KaTeX auto-render는 `<br>`로 나뉜 `$$`를 하나로 못 묶는다. `$$`로 시작하는 문단의 `<br>`를
 * 개행으로 되돌려 KaTeX가 전체 블록을 매치할 수 있게 한다.
 */
function preprocessBlockMath(container: HTMLElement): void {
  container.querySelectorAll('p').forEach((p) => {
    const first = p.firstChild
    if (first?.nodeType === Node.TEXT_NODE && (first.textContent ?? '').trimStart().startsWith('$$')) {
      const text = p.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
      p.textContent = text
    }
  })
}

// ── 공개 API ───────────────────────────────────────────────────────────────────
/** Reader가 새 HTML을 넣은 뒤 호출한다. container 안의 Mermaid 다이어그램과 KaTeX 수식을 그린다. */
export async function renderExtras(container: HTMLElement | null, theme: Theme): Promise<void> {
  if (!container) return
  const mermaidNodes = [...container.querySelectorAll<HTMLElement>('pre.md-mermaid, .md-mermaid')]
  const needsMath = hasMath(container)

  const tasks: Promise<void>[] = []

  if (mermaidNodes.length > 0) {
    tasks.push(
      loadMermaid(getMermaidTheme(theme))
        .then((m) => {
          mermaidNodes.forEach((el) => {
            if (!el.dataset.src) el.dataset.src = el.textContent ?? ''
          })
          return m.run({ nodes: mermaidNodes })
        })
        .catch(() => undefined),
    )
  }

  if (needsMath) {
    tasks.push(
      loadKatex()
        .then((renderMathInElement) => {
          preprocessBlockMath(container)
          renderMathInElement(container, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false },
            ],
            throwOnError: false,
          })
        })
        .catch(() => undefined),
    )
  }

  await Promise.allSettled(tasks)
}

/** 테마가 바뀔 때 Mermaid 다이어그램을 다시 그린다. `data-src`에 저장해 둔 원문으로 되돌린 뒤 재실행한다. */
export async function rerenderMermaid(container: HTMLElement | null, theme: Theme): Promise<void> {
  if (!container) return
  const mermaidNodes = [...container.querySelectorAll<HTMLElement>('[data-src]')]
  if (!mermaidNodes.length) return

  mermaidNodes.forEach((el) => {
    el.removeAttribute('data-processed')
    el.innerHTML = ''
    el.textContent = el.dataset.src ?? ''
  })

  try {
    const m = await loadMermaid(getMermaidTheme(theme))
    await m.run({ nodes: mermaidNodes })
    mermaidNodes.forEach((el) => {
      if (!el.dataset.src) el.dataset.src = el.textContent ?? ''
    })
  } catch {
    // 재렌더 실패 — 이전 그림이 지워진 채로 남더라도 조용히 넘어간다(콘솔 출력 0 규약)
  }
}
