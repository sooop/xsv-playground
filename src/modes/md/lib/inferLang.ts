/**
 * 언어 표기 없는 코드블록의 언어 추정.
 *
 * highlight.js `highlightAuto`는 실제 코드는 대부분 맞히지만 점수가 낮고 노이즈가 크다(실측: 산문·CSV는
 * css, 로그는 yaml로 오인, 관련도 2~3). 그래서 (1) JSON은 파싱으로 먼저 확정하고, (2) 후보를 흔한
 * 언어로 좁히고, (3) 관련도 4 이상 + 2위와 격차 1 이상일 때만 채택한다. 못 미치면 null(plain).
 */
export interface AutoResult {
  language?: string
  relevance: number
  secondBest?: { relevance: number }
}

export const AUTO_SUBSET = [
  'json', 'yaml', 'bash', 'sql', 'javascript', 'typescript', 'python', 'xml', 'css',
  'java', 'csharp', 'diff', 'ini', 'powershell', 'go', 'rust', 'cpp', 'php',
]

const MIN_RELEVANCE = 4
const MIN_MARGIN = 1
const MIN_LENGTH = 12

export function inferLanguage(
  text: string,
  auto: (code: string, subset: string[]) => AutoResult,
): string | null {
  const t = text.trim()
  if (t.length < MIN_LENGTH) return null
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(t)
      return 'json'
    } catch {
      /* JSON이 아니면 아래 일반 추정으로 */
    }
  }
  const r = auto(t, AUTO_SUBSET)
  if (!r.language || r.relevance < MIN_RELEVANCE) return null
  if (r.relevance - (r.secondBest?.relevance ?? 0) < MIN_MARGIN) return null
  return r.language
}
