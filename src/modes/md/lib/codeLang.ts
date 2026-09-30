/**
 * 코드블록 언어 지정 — 렌더된 N번째 코드블록에 대응하는 **소스의 펜스**를 찾아 여는 줄에 언어를 쓴다.
 *
 * 번호는 렌더러(`markdown.ts`)가 `marked`의 code 토큰을 문서 순서대로 센 것과 같다(mermaid 포함).
 * 토큰의 `raw`를 소스에서 순차 검색해 위치를 잡으므로, 인용문·목록 안처럼 raw에서 접두가 벗겨지는
 * 중첩 블록과 들여쓰기 코드블록은 찾지 못하고 null을 돌려준다(호출자가 안내한다).
 * marked가 줄바꿈을 LF로 정규화하므로 결과도 LF다.
 */
import { marked, type Token, type Tokens } from 'marked'

const OPEN_FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*\n/

export function setFenceLang(content: string, index: number, lang: string): string | null {
  if (!/^[a-zA-Z0-9_+-]+$/.test(lang)) return null
  const src = content.replace(/\r\n?/g, '\n')
  const codes: Tokens.Code[] = []
  marked.walkTokens(marked.lexer(src), (t: Token) => {
    if (t.type === 'code') codes.push(t as Tokens.Code)
  })
  const target = codes[index]
  if (!target || !OPEN_FENCE.test(target.raw)) return null

  // 앞선 코드블록들의 raw를 차례로 지나가며 커서를 옮겨, 중복 내용의 블록도 정확히 짚는다
  let cursor = 0
  for (let i = 0; i <= index; i++) {
    const at = src.indexOf(codes[i]!.raw, cursor)
    if (at < 0) return null
    if (i === index) {
      const raw = codes[i]!.raw.replace(OPEN_FENCE, (_m, sp: string, fence: string) => `${sp}${fence}${lang}\n`)
      return src.slice(0, at) + raw + src.slice(at + codes[i]!.raw.length)
    }
    cursor = at + codes[i]!.raw.length
  }
  return null
}
