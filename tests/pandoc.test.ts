/**
 * pandoc-wasm을 실제로 돌려보는 통합 테스트.
 *
 * 앱은 브라우저 워커(`lib/pandoc/client.ts`)를 통해서만 pandoc을 부르지만, vitest는 워커를 돌릴
 * 환경이 아니다. 대신 pandoc-wasm의 Node 진입점(`index.node.js` — 로컬 `pandoc.wasm`을 파일로
 * 읽는다, npm install 때 이미 받아져 있다)을 직접 쓰고, 앱과 **같은 옵션 빌더**(`docx.ts`가
 * export하는 `buildDocxImportOptions`/`buildDocxExportOptions`/`buildRtfExportOptions`)를
 * 재사용해서 실제 옵션이 어긋나지 않게 한다.
 *
 * docx는 ZIP이므로, 생성된 파일을 검산하려면 최소한의 zip 리더가 필요하다. 외부 라이브러리 없이
 * central directory를 훑어 항목 하나를 꺼내는 함수 하나만 둔다(`inflateRawSync`로 충분 — docx
 * 항목은 deflate 아니면 무압축이다).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { convert } from 'pandoc-wasm'
import { describe, expect, it } from 'vitest'
import {
  buildDocxExportOptions,
  buildDocxImportOptions,
  buildRtfExportOptions,
  inlineMedia,
  swapExt,
} from '../src/lib/pandoc/docx'
import { PANDOC_VERSION } from '../src/lib/pandoc/wasmStore'
import { markdownToPlainHtml } from '../src/modes/md/lib/markdown'

function readZipEntry(buf: Buffer, name: string): Buffer | null {
  const centralSig = Buffer.from([0x50, 0x4b, 0x01, 0x02])
  let i = 0
  while ((i = buf.indexOf(centralSig, i)) !== -1) {
    const method = buf.readUInt16LE(i + 10)
    const compSize = buf.readUInt32LE(i + 20)
    const nameLen = buf.readUInt16LE(i + 28)
    const extraLen = buf.readUInt16LE(i + 30)
    const commentLen = buf.readUInt16LE(i + 32)
    const localOffset = buf.readUInt32LE(i + 42)
    const entryName = buf.toString('utf8', i + 46, i + 46 + nameLen)
    if (entryName === name) {
      const lNameLen = buf.readUInt16LE(localOffset + 26)
      const lExtraLen = buf.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + lNameLen + lExtraLen
      const compData = buf.subarray(dataStart, dataStart + compSize)
      return method === 0 ? Buffer.from(compData) : inflateRawSync(compData)
    }
    i += 46 + nameLen + extraLen + commentLen
  }
  return null
}

const referenceDocxPath = fileURLToPath(new URL('../src/lib/pandoc/reference.docx', import.meta.url))
const referenceDocx = new Blob([readFileSync(referenceDocxPath)])

// 1x1 투명 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('pandoc-wasm 옵션 빌더', () => {
  it('설치된 pandoc-wasm 버전이 CDN URL 상수와 일치한다', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../node_modules/pandoc-wasm/package.json', import.meta.url)), 'utf8'),
    ) as { version: string }
    expect(pkg.version).toBe(PANDOC_VERSION)
  })

  it('docx → gfm: input-files 없이는 stdin을 읽으려다 실패한다(실측 회귀 방지)', async () => {
    const result = await convert({ from: 'docx', to: 'gfm' }, null, { 'in.docx': referenceDocx })
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/couldn't unpack docx container/)
  })

  it('docx → md: input-files를 주면 본문을 읽어온다', async () => {
    const result = await convert(buildDocxImportOptions(), null, { 'in.docx': referenceDocx })
    expect(result.stdout).toContain('제목')
  })

  it('rtf 내보내기: standalone 헤더로 시작한다', async () => {
    const html = markdownToPlainHtml('# 제목\n\n본문입니다.')
    const result = await convert(buildRtfExportOptions(), null, { 'in.html': html })
    const blob = result.files['out.rtf']
    expect(blob).toBeDefined()
    const text = Buffer.from(await blob!.arrayBuffer()).toString('latin1')
    expect(text.startsWith('{\\rtf1')).toBe(true)
  })

  it('docx 내보내기: reference-doc 스타일이 적용되고, 병합 셀과 이미지가 살아남는다', async () => {
    const html = markdownToPlainHtml('# 제목') + `
      <img src="data:image/png;base64,${PNG_B64}" alt="테스트">
      <table>
        <tr><td colspan="2">병합된 헤더</td></tr>
        <tr><td rowspan="2">세로 병합</td><td>B1</td></tr>
        <tr><td>B2</td></tr>
      </table>
    `

    const toDocx = await convert(buildDocxExportOptions(), null, {
      'in.html': html,
      'reference.docx': referenceDocx,
    })
    const outDocxBlob = toDocx.files['out.docx']
    expect(outDocxBlob).toBeDefined()
    const outDocxBuf = Buffer.from(await outDocxBlob!.arrayBuffer())

    // reference-doc 스타일 적용 확인 — 템플릿 고유 폰트가 styles.xml에 들어 있어야 한다
    const styles = readZipEntry(outDocxBuf, 'word/styles.xml')?.toString('utf8') ?? ''
    expect(styles).toContain('Pretendard')

    // 병합 셀(colspan → gridSpan, rowspan → vMerge)이 살아남는지 확인
    const document = readZipEntry(outDocxBuf, 'word/document.xml')?.toString('utf8') ?? ''
    expect(document).toContain('gridSpan')
    expect(document).toContain('vMerge')

    // docx → md 왕복: extract-media로 뽑은 이미지가 다시 data URI로 인라인되는지 확인
    const back = await convert(buildDocxImportOptions(), null, { 'in.docx': new Blob([outDocxBuf]) })
    expect(Object.keys(back.mediaFiles).length).toBeGreaterThan(0)
    const { markdown, skippedImageCount } = await inlineMedia(back.stdout, back.mediaFiles)
    expect(skippedImageCount).toBe(0)
    expect(markdown).toContain('data:image/png;base64')
  })
})

describe('inlineMedia', () => {
  it('지원하는 이미지 확장자는 data URI로 치환한다', async () => {
    const png = new Blob([new Uint8Array([1, 2, 3, 4])])
    const { markdown, skippedImageCount } = await inlineMedia('![](media/media/img1.png)', {
      'media/media/img1.png': png,
    })
    expect(markdown).toMatch(/^!\[\]\(data:image\/png;base64,/)
    expect(skippedImageCount).toBe(0)
  })

  it('브라우저가 그리지 못하는 확장자(emf 등)는 건너뛰고 개수만 센다', async () => {
    const emf = new Blob([new Uint8Array([1, 2, 3, 4])])
    const { markdown, skippedImageCount } = await inlineMedia('본문 그대로', {
      'media/media/img1.emf': emf,
    })
    expect(markdown).toBe('본문 그대로')
    expect(skippedImageCount).toBe(1)
  })

  it('본문에 나오지 않는 경로는 건드리지 않는다', async () => {
    const png = new Blob([new Uint8Array([1])])
    const { markdown } = await inlineMedia('본문', { 'media/media/unused.png': png })
    expect(markdown).toBe('본문')
  })

  it('raw HTML <img> 안의 경로도 치환한다', async () => {
    const png = new Blob([new Uint8Array([1, 2, 3])])
    const { markdown } = await inlineMedia('<img src="media/media/rId1.png" alt="x" />', {
      'media/media/rId1.png': png,
    })
    expect(markdown).toContain('src="data:image/png;base64,')
  })
})

describe('swapExt', () => {
  it('확장자를 바꾼다', () => {
    expect(swapExt('보고서.docx', 'md')).toBe('보고서.md')
    expect(swapExt('보고서.md', 'docx')).toBe('보고서.docx')
    expect(swapExt('보고서', 'rtf')).toBe('보고서.rtf')
  })
})
