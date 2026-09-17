/**
 * 마크다운 파싱 파이프라인: `marked.parse(raw)` → `DOMPurify.sanitize()` → 안전한 HTML.
 *
 * 커스텀 렌더러:
 *  - code:    복사/열기 버튼 + 언어 라벨 마크업만 출력한다(실제 hljs 채색은 `lib/highlight.ts`가
 *             화면에 보일 때 지연 적용). `csv/tsv/json` 언어는 "CSV로 열기"/"jq로 열기" 버튼도 낸다.
 *  - heading: 안정적인 텍스트 기반 슬러그 id + hover 앵커 링크
 *  - image:   클릭 확대(라이트박스)용 data-lightbox 속성
 */
import DOMPurify from 'dompurify'
import { marked, type RendererObject, type Tokens } from 'marked'

// ── 슬러그 ────────────────────────────────────────────────────────────────
const slugCounters = new Map<string, number>()

export function resetSlugs(): void {
  slugCounters.clear()
}

export function makeSlug(text: string): string {
  const base =
    text
      .toLowerCase()
      .trim()
      .replace(/[\s]+/g, '-')
      .replace(/[^\p{L}\p{N}\-]/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'heading'

  const count = slugCounters.get(base) ?? 0
  slugCounters.set(base, count + 1)
  return count === 0 ? base : `${base}-${count}`
}

// ── 코드블록 payload 인코딩 ─────────────────────────────────────────────────
// 텍스트를 속성값(base64)으로 담아 두었다가, 복사·"CSV/jq로 열기" 클릭 시 디코드한다.
function encodeCodeText(text: string): string {
  return btoa(encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_, p: string) => String.fromCharCode(parseInt(p, 16))))
}

export function decodeCodeText(encoded: string): string {
  try {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    try {
      return decodeURIComponent(escape(atob(encoded)))
    } catch {
      return encoded
    }
  }
}

/** "CSV/jq로 열기" 버튼을 낼 언어 → 라벨 */
const OPENABLE_LANGS: Record<string, string> = { csv: 'CSV로 열기', tsv: 'CSV로 열기', json: 'jq로 열기' }

// ── DOMPurify 설정 ──────────────────────────────────────────────────────────
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // 외부로 열리는 링크에 rel=noopener 추가
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  // 헤딩 id(TOC 앵커)와 렌더러가 심어 둔 data-* 속성을 허용한다
  ADD_ATTR: ['id', 'data-lightbox', 'data-lang', 'data-code', 'data-src', 'data-open-lang'],
  ADD_TAGS: ['svg', 'path', 'polyline', 'rect'],
}

// ── 커스텀 렌더러 ────────────────────────────────────────────────────────────
function buildRenderer(): RendererObject {
  return {
    code({ text, lang }: Tokens.Code): string {
      const safeLang = (lang ?? '').replace(/[^a-zA-Z0-9_-]/g, '')

      // Mermaid는 render-extras.ts가 처리하도록 평범한 <pre class="md-mermaid">로 낸다
      if (safeLang === 'mermaid') {
        return `<pre class="md-mermaid" data-src="${escapeAttr(text)}">${escapeHtml(text)}</pre>\n`
      }

      const encoded = encodeCodeText(text)
      const langLabel = safeLang
        ? `<span class="md-code-lang">${safeLang}</span>`
        : '<span class="md-code-lang"></span>'
      const openLabel = OPENABLE_LANGS[safeLang]
      const openBtn = openLabel
        ? `<button class="md-code-open-btn" data-open-lang="${safeLang}" data-code="${encoded}">${openLabel}</button>`
        : ''

      return `<div class="md-code-block">
  <div class="md-code-header">
    ${langLabel}
    <div class="md-code-actions">
      ${openBtn}
      <button class="md-code-copy-btn" data-code="${encoded}" aria-label="코드 복사" title="복사"></button>
    </div>
  </div>
  <pre><code class="hljs${safeLang ? ` language-${safeLang}` : ''}" data-lang="${safeLang}">${escapeHtml(text)}</code></pre>
</div>`
    },

    heading({ tokens, depth }: Tokens.Heading): string {
      const text = tokens.map((t) => t.raw).join('')
      const textContent = text.replace(/<[^>]+>/g, '') // 슬러그용으로 인라인 HTML 제거
      const id = makeSlug(textContent)
      return `<h${depth} id="${id}">
  <a class="md-heading-anchor" href="#${id}" aria-label="${textContent} 앵커 링크">#</a>${text}
</h${depth}>\n`
    },

    image({ href, title, text }: Tokens.Image): string {
      const safeHref = /^(https?:\/\/|\/|\.\/|\.\.\/)/.test(href ?? '') ? href : ''
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
      const altAttr = text ? escapeAttr(text) : ''
      return `<img src="${escapeAttr(safeHref)}" alt="${altAttr}"${titleAttr} data-lightbox="1" loading="lazy">`
    },
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeAttr(s: string | null | undefined): string {
  return (s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )
}

// ── marked 설정 ──────────────────────────────────────────────────────────────
marked.setOptions({ breaks: true, gfm: true })
marked.use({ renderer: buildRenderer() })

// ── 기능 감지 ─────────────────────────────────────────────────────────────────
export const supportsCustomHighlight = typeof CSS !== 'undefined' && typeof CSS.highlights !== 'undefined'

// ── 공개 API ───────────────────────────────────────────────────────────────────
/** 마크다운을 안전한 HTML로 변환한다. 문서마다 슬러그 카운터를 리셋해 헤딩 id를 결정적으로 만든다. */
export function parseMarkdown(content: string): string {
  resetSlugs()
  const raw = marked.parse(content, { async: false })
  return DOMPurify.sanitize(raw, PURIFY_CONFIG)
}

export { escapeHtml }
