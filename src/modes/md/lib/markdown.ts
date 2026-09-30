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
import { Marked, marked, type RendererObject, type Tokens } from 'marked'

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
// DOM이 없는 환경(vitest의 기본 node 환경)에서는 DOMPurify가 addHook 없는 축소 객체를 낸다.
// 이 파일의 `markdownToPlainHtml`은 DOM 없이도 동작해야 하므로(`tests/pandoc.test.ts`), 여기서
// 막히지 않게 방어한다 — 브라우저에서는 항상 존재해 실제 동작은 그대로다.
if (typeof DOMPurify.addHook === 'function') {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // 외부로 열리는 링크에 rel=noopener 추가
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  // 헤딩 id(TOC 앵커)와 렌더러가 심어 둔 data-* 속성을 허용한다
  ADD_ATTR: ['id', 'data-lightbox', 'data-lang', 'data-code', 'data-src', 'data-open-lang', 'data-code-index'],
  ADD_TAGS: ['svg', 'path', 'polyline', 'rect'],
}

// ── 커스텀 렌더러 ────────────────────────────────────────────────────────────
let codeCounter = 0

function buildRenderer(): RendererObject {
  return {
    code({ text, lang, codeBlockStyle }: Tokens.Code): string {
      const safeLang = (lang ?? '').replace(/[^a-zA-Z0-9_-]/g, '')

      // Mermaid는 render-extras.ts가 처리하도록 평범한 <pre class="md-mermaid">로 낸다
      if (safeLang === 'mermaid') {
        codeCounter++
        return `<pre class="md-mermaid" data-src="${escapeAttr(text)}">${escapeHtml(text)}</pre>\n`
      }

      const encoded = encodeCodeText(text)
      // 문서 순서대로 매긴 코드블록 번호 — 언어 지정 시 소스의 N번째 펜스를 찾는 데 쓴다(`codeLang.ts`)
      const codeIndex = codeCounter++
      const fenced = codeBlockStyle !== 'indented'
      // 언어 표기가 없는 펜스 블록에는 지정 버튼을 낸다(하이라이터가 자동 추정하면 그 결과로 라벨을 바꾼다)
      const langLabel = safeLang
        ? `<span class="md-code-lang">${safeLang}</span>`
        : fenced
          ? `<button class="md-code-lang-btn" data-code-index="${codeIndex}" title="언어 지정" aria-label="코드블록 언어 지정">언어 선택</button>`
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
      // docx에서 변환된 이미지는 본문에 data:image/... URI로 인라인되므로 함께 허용한다
      const safeHref = /^(https?:\/\/|\/|\.\/|\.\.\/|data:image\/)/.test(href ?? '') ? href : ''
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
  codeCounter = 0
  const raw = marked.parse(content, { async: false })
  return DOMPurify.sanitize(raw, PURIFY_CONFIG)
}

// 리더용 전역 `marked`와 분리된 인스턴스 — 복사 버튼·라이트박스·헤딩 앵커 같은 리더 전용 마크업이
// 섞이지 않은 순수 HTML을 낸다. pandoc(html → docx/rtf)에 그대로 넘기기 위한 용도라 DOMPurify도
// 거치지 않는다(DOM에 삽입되지 않고 워커로만 전달된다).
const plainMarked = new Marked({ breaks: true, gfm: true })

/**
 * 마크다운을 꾸밈 없는 HTML로 변환한다(내보내기 전용).
 *
 * pandoc의 markdown reader는 병합 셀 표를 raw HTML `<table>`로 남기는데, 그 md를 pandoc에
 * 그대로 넣으면 docx/rtf writer가 raw HTML을 버려 표가 사라진다. 이 함수로 HTML을 먼저
 * 만들어 `from: html`로 넘기면 그 표도 살아남는다.
 */
export function markdownToPlainHtml(content: string): string {
  return plainMarked.parse(content, { async: false })
}

export { escapeHtml }
