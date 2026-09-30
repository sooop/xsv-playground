/**
 * docx ↔ 마크다운 변환, md → docx/rtf 내보내기.
 *
 * pandoc-wasm의 `input-files`는 필수다(실측: 생략하면 stdin을 읽으려다
 * "couldn't unpack docx container: not enough bytes"로 실패한다). `extract-media`를
 * 디렉터리 이름(zip 아님)으로 주면 pandoc이 내부적으로 `<이름>/media/<파일>` 경로에 이미지를
 * 두므로(실측: `media/media/rId18.png`), 정확한 중첩 규칙에 기대지 않고 `mediaFiles`의 키를
 * 그대로 본문에서 문자열 치환한다 — 마크다운 `![]()`든 raw `<img src="...">`든 가리지 않는다.
 */
import referenceUrl from './reference.docx?url'
import { runPandoc } from './client'
import { markdownToPlainHtml } from '../../modes/md/lib/markdown'

export type ExportFormat = 'docx' | 'rtf'

export interface DocxImportResult {
  markdown: string
  /** pandoc이 낸 경고 개수 (원격 리소스 실패 등) */
  warningCount: number
  /** 브라우저가 그리지 못해 인라인하지 못한 이미지 개수 (emf/wmf 등) */
  skippedImageCount: number
}

export interface ExportResult {
  blob: Blob
  warningCount: number
}

// ── 미디어 인라인 ────────────────────────────────────────────────────────────
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

function extOf(path: string): string {
  const i = path.lastIndexOf('.')
  return i < 0 ? '' : path.slice(i + 1).toLowerCase()
}

async function blobToDataUrl(blob: Blob, mime: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

/** `mediaFiles`의 각 경로를 찾아 본문에 나온 그대로(마크다운/raw HTML 무관) data URI로 치환한다. */
export async function inlineMedia(
  markdown: string,
  mediaFiles: Record<string, Blob>,
): Promise<{ markdown: string; skippedImageCount: number }> {
  let result = markdown
  let skippedImageCount = 0
  for (const [path, blob] of Object.entries(mediaFiles)) {
    const mime = IMAGE_MIME[extOf(path)]
    if (!mime) {
      skippedImageCount++
      continue
    }
    if (!result.includes(path)) continue
    const dataUrl = await blobToDataUrl(blob, mime)
    result = result.split(path).join(dataUrl)
  }
  return { markdown: result, skippedImageCount }
}

// ── 옵션 빌더 ─────────────────────────────────────────────────────────────────
// pandoc-wasm은 `input-files`가 없으면 stdin을 읽으려다 실패한다(실측:
// "couldn't unpack docx container: not enough bytes"). 앱과 `tests/pandoc.test.ts`가
// 같은 옵션을 쓰도록 빌더 함수로 분리해 둔다.
export function buildDocxImportOptions(): Record<string, unknown> {
  return { from: 'docx', to: 'gfm', wrap: 'none', 'input-files': ['in.docx'], 'extract-media': 'media' }
}

export function buildRtfExportOptions(): Record<string, unknown> {
  return { from: 'html', to: 'rtf', standalone: true, 'input-files': ['in.html'], 'output-file': 'out.rtf' }
}

export function buildDocxExportOptions(): Record<string, unknown> {
  return {
    from: 'html',
    to: 'docx',
    'input-files': ['in.html'],
    'reference-doc': 'reference.docx',
    'output-file': 'out.docx',
  }
}

// ── 가져오기: docx → markdown ────────────────────────────────────────────────
export async function docxToMarkdown(file: File): Promise<DocxImportResult> {
  const result = await runPandoc(buildDocxImportOptions(), { 'in.docx': file })
  const { markdown, skippedImageCount } = await inlineMedia(result.stdout, result.mediaFiles)
  return { markdown, warningCount: result.warnings.length, skippedImageCount }
}

// ── 내보내기: markdown → docx/rtf ────────────────────────────────────────────
let referenceDocxPromise: Promise<Blob> | null = null

/** 번들에 인라인된 사내 템플릿(reference.docx)을 Blob으로 가져온다. */
function getReferenceDocx(): Promise<Blob> {
  if (!referenceDocxPromise) {
    referenceDocxPromise = fetch(referenceUrl).then((r) => r.blob())
    referenceDocxPromise.catch(() => {
      referenceDocxPromise = null
    })
  }
  return referenceDocxPromise
}

export async function exportDocument(markdown: string, format: ExportFormat): Promise<ExportResult> {
  const html = markdownToPlainHtml(markdown)

  if (format === 'rtf') {
    // pandoc의 RTF writer는 reference-doc을 지원하지 않는다 — 템플릿은 docx에만 적용된다
    const result = await runPandoc(buildRtfExportOptions(), { 'in.html': html })
    const blob = result.files['out.rtf']
    if (!blob) throw new Error('RTF 변환 결과가 비어 있습니다')
    return { blob, warningCount: result.warnings.length }
  }

  const reference = await getReferenceDocx()
  const result = await runPandoc(buildDocxExportOptions(), { 'in.html': html, 'reference.docx': reference })
  const blob = result.files['out.docx']
  if (!blob) throw new Error('DOCX 변환 결과가 비어 있습니다')
  return { blob, warningCount: result.warnings.length }
}

// ── 파일명 ───────────────────────────────────────────────────────────────────
/** 확장자를 바꾼다. 확장자가 없어도(`보고서`) 그대로 붙인다. */
export function swapExt(name: string, ext: ExportFormat | 'md'): string {
  const i = name.lastIndexOf('.')
  const base = i < 0 ? name : name.slice(0, i)
  return `${base || name}.${ext}`
}
