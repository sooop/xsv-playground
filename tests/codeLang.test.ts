import { describe, expect, it } from 'vitest'
import { setFenceLang } from '../src/modes/md/lib/codeLang'
import { inferLanguage, type AutoResult } from '../src/modes/md/lib/inferLang'

describe('setFenceLang', () => {
  const doc = '# t\n\n```\na\n```\n\ntext\n\n```js\nb\n```\n\n```\na\n```\n'

  it('N번째 코드블록의 여는 펜스에 언어를 쓴다', () => {
    expect(setFenceLang(doc, 0, 'json')).toBe(doc.replace('```\na', '```json\na'))
  })

  it('내용이 같은 블록도 번호로 정확히 짚는다(mermaid·언어 있는 블록 포함해 센다)', () => {
    const out = setFenceLang(doc, 2, 'sql')!
    expect(out.endsWith('```sql\na\n```\n')).toBe(true)
    expect(out.startsWith('# t\n\n```\na\n```')).toBe(true)
  })

  it('물결 펜스와 들여쓴 펜스도 처리한다', () => {
    expect(setFenceLang('~~~\nx\n~~~\n', 0, 'bash')).toBe('~~~bash\nx\n~~~\n')
    expect(setFenceLang('  ```\nx\n  ```\n', 0, 'bash')).toBe('  ```bash\nx\n  ```\n')
  })

  it('CRLF 문서는 LF로 정규화해 처리한다', () => {
    expect(setFenceLang('```\r\nx\r\n```\r\n', 0, 'yaml')).toBe('```yaml\nx\n```\n')
  })

  it('들여쓰기 코드블록·없는 번호·잘못된 언어는 null', () => {
    expect(setFenceLang('    indented\n', 0, 'json')).toBeNull()
    expect(setFenceLang(doc, 9, 'json')).toBeNull()
    expect(setFenceLang(doc, 0, 'a b')).toBeNull()
  })

  it('인용문 안 블록은 raw가 소스와 달라 null', () => {
    expect(setFenceLang('> ```\n> x\n> ```\n', 0, 'json')).toBeNull()
  })
})

describe('inferLanguage', () => {
  const auto =
    (r: AutoResult) =>
    (): AutoResult =>
      r

  it('JSON은 파싱으로 확정한다', () => {
    expect(inferLanguage('{"a": [1, 2, 3]}', auto({ relevance: 0 }))).toBe('json')
  })

  it('깨진 JSON은 일반 추정으로 넘어간다', () => {
    expect(inferLanguage('{"a": [1, 2,,,}', auto({ language: 'javascript', relevance: 6, secondBest: { relevance: 2 } }))).toBe(
      'javascript',
    )
  })

  it('관련도가 낮거나 2위와 격차가 없으면 추정하지 않는다', () => {
    const text = 'some output line one\nsome output line two'
    expect(inferLanguage(text, auto({ language: 'css', relevance: 3 }))).toBeNull()
    expect(inferLanguage(text, auto({ language: 'yaml', relevance: 5, secondBest: { relevance: 5 } }))).toBeNull()
    expect(inferLanguage(text, auto({ language: 'sql', relevance: 4, secondBest: { relevance: 1 } }))).toBe('sql')
  })

  it('짧은 텍스트는 추정하지 않는다', () => {
    expect(inferLanguage('npm run x', auto({ language: 'bash', relevance: 9 }))).toBeNull()
  })
})
