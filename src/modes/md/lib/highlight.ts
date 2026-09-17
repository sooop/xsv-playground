/**
 * 지연 구문 강조.
 *
 * highlight.js는 번들에 넣지 않고 처음 코드블록이 화면에 보일 때 CDN에서 받아온다(`lib/util/cdn.ts`
 * 공용 로더 사용). 실패해도(오프라인 등) escape된 plain 텍스트가 이미 렌더러가 낸 기본값이라
 * 조용히 그 상태로 남는다 — 콘솔에는 아무것도 쓰지 않는다.
 *
 * IntersectionObserver로 스크롤에 들어오는 코드블록부터 강조하고, idle 콜백으로 화면 밖
 * 블록도 뒤늦게 처리한다.
 */
import { loadScript } from '../../../lib/util/cdn'

const HLJS_VERSION = '11.11.1'
const HLJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${HLJS_VERSION}`

interface HljsApi {
  getLanguage(name: string): unknown
  highlight(code: string, opts: { language: string }): { value: string }
}

declare global {
  interface Window {
    hljs?: HljsApi
  }
}

let hljsPromise: Promise<HljsApi | null> | null = null
const loadedLangs = new Set<string>()
let observer: IntersectionObserver | null = null

function ensureHljs(): Promise<HljsApi | null> {
  if (!hljsPromise) {
    hljsPromise = loadScript(`${HLJS_BASE}/highlight.min.js`)
      .then(() => window.hljs ?? null)
      .catch(() => null)
  }
  return hljsPromise
}

async function ensureLanguage(hljs: HljsApi, lang: string): Promise<void> {
  if (!lang || hljs.getLanguage(lang) || loadedLangs.has(lang)) return
  loadedLangs.add(lang)
  try {
    await loadScript(`${HLJS_BASE}/languages/${lang}.min.js`)
  } catch {
    // 해당 언어 번들을 못 받아오면 plain 텍스트로 남는다 — 콘솔 출력 없이 조용히 저하
  }
}

async function highlightElement(el: HTMLElement): Promise<void> {
  if (el.dataset.highlighted) return
  el.dataset.highlighted = '1'
  const lang = el.dataset.lang ?? ''
  const hljs = await ensureHljs()
  if (!hljs) return
  if (lang) await ensureLanguage(hljs, lang)
  if (!lang || !hljs.getLanguage(lang)) return
  try {
    const result = hljs.highlight(el.textContent ?? '', { language: lang })
    el.innerHTML = result.value
  } catch {
    // 강조 실패 — escape된 plain 텍스트 그대로 둔다
  }
}

/** container 안의 강조되지 않은 코드블록 전부에 IntersectionObserver를 건다. */
export function attachHighlightObserver(container: HTMLElement): void {
  if (observer) {
    observer.disconnect()
    observer = null
  }

  const blocks = [...container.querySelectorAll<HTMLElement>('pre code.hljs:not([data-highlighted])')]
  if (!blocks.length) return

  const idle: (fn: () => void) => void =
    typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 50)

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          void highlightElement(entry.target as HTMLElement)
          observer?.unobserve(entry.target)
        }
      }
    },
    { rootMargin: '200px 0px' },
  )

  for (const el of blocks) observer.observe(el)

  idle(() => {
    for (const el of blocks) {
      if (!el.dataset.highlighted) void highlightElement(el)
    }
  })
}

export function disconnectHighlightObserver(): void {
  if (observer) {
    observer.disconnect()
    observer = null
  }
}
