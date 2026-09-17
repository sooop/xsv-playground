/**
 * 파일 종류 판정 — 어느 모드로 열어야 하는가.
 *
 * `parse/detect.ts`의 원칙을 그대로 따른다: **매직 바이트 → 확장자 → 내용** 순서. 확장자가
 * `.csv`로 잘못 붙은 엑셀도, 확장자 없는 JSON도 제대로 간다. 셸은 파일 앞 64KB만 읽어 판정하고
 * 본문은 모드가 읽는다(28MB CSV를 두 번 읽지 않기 위해).
 */
import { CsvParser } from '../lib/parse/csv'
import { FILE_ACCEPT, decodeBytes, looksSpreadsheet } from '../lib/parse/detect'
import type { Delimiter } from '../lib/data/types'
import type { ModeId } from './mode'

const MD_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx'])
const JSON_EXTS = new Set(['.json', '.jsonl', '.ndjson', '.geojson'])
const CSV_EXTS = new Set(['.csv', '.tsv', '.tab', '.psv'])

/** 셸의 파일 선택 대화상자 `accept` — CSV 계열 + 마크다운 + JSON + 일반 텍스트 */
export const OPEN_ACCEPT = [
  FILE_ACCEPT,
  ...MD_EXTS,
  ...JSON_EXTS,
  '.log',
  'text/markdown',
  'application/json',
].join(',')

/** 앞부분만 읽어 판정할 때의 크기 */
export const SNIFF_BYTES = 64 << 10

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

export function detectFileKind(name: string, head: Uint8Array, sample: string): ModeId {
  if (looksSpreadsheet(name, head)) return 'csv'
  const ext = extOf(name)
  if (MD_EXTS.has(ext)) return 'md'
  if (JSON_EXTS.has(ext)) return 'jq'
  if (CSV_EXTS.has(ext)) return 'csv'
  return sniffText(sample)
}

/** 확장자로 알 수 없을 때(`.txt`, `.log`, 무확장자) 내용으로 판정한다. */
export function sniffText(sample: string): ModeId {
  const t = sample.replace(/^﻿/, '').trimStart()
  if (t === '') return 'md'
  if (t[0] === '{' || t[0] === '[') return 'jq'
  const lines = t.split(/\r?\n/)
  // 샘플이 줄 중간에서 잘렸을 수 있으니 마지막 줄은 판정에서 뺀다
  const whole = lines.length > 1 ? lines.slice(0, -1) : lines
  const nonEmpty = whole.filter((l) => l.trim() !== '')
  if (nonEmpty.length > 0 && nonEmpty.slice(0, 2).every(isJsonLine)) return 'jq'
  if (looksMarkdown(whole)) return 'md'
  if (looksDelimited(whole.join('\n'))) return 'csv'
  return 'md'
}

function isJsonLine(line: string): boolean {
  const s = line.trim()
  if (!(s.startsWith('{') || s.startsWith('['))) return false
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

const MD_SIGNALS: RegExp[] = [
  /^#{1,6}\s+\S/, // 헤딩
  /^```/, // 코드 펜스
  /^\|.*\|\s*$/, // 파이프 표
  /^\s{0,3}[-*+]\s+\S/, // 불릿
  /^\s{0,3}\d+\.\s+\S/, // 번호 목록
  /^>\s?\S/, // 인용
  /\[[^\]]+\]\([^)]+\)/, // 링크
]

function looksMarkdown(lines: string[]): boolean {
  const head = lines.slice(0, 40)
  let hits = 0
  for (const l of head) if (MD_SIGNALS.some((re) => re.test(l))) hits++
  // 첫 줄이 헤딩이면 그것만으로 충분하고, 아니면 신호가 둘 이상 필요하다(불릿 하나는 CSV 주석일 수 있다)
  const first = head.find((l) => l.trim() !== '') ?? ''
  return /^#{1,6}\s+\S/.test(first) || hits >= 2
}

const DELIMS: Delimiter[] = [',', '\t', ';', '|']

/**
 * 구분자 후보 중 하나로 파싱했을 때 **필드 수가 2 이상이고 행마다 일정**하면 표로 본다.
 * `detectDelimiter`는 아무것도 쪼개지지 않아도 `,`를 폴백으로 돌려주므로 여기서 직접 확인한다.
 */
function looksDelimited(text: string): boolean {
  for (const d of DELIMS) {
    const p = new CsvParser(d)
    p.push(text)
    const rows = p.finish().slice(0, 20)
    if (rows.length < 2) continue
    const widths = rows.map((r) => r.length)
    if (widths[0] < 2) continue
    if (widths.every((w) => w === widths[0])) return true
  }
  return false
}

/** 파일 앞부분만 읽어 종류를 판정한다. 본문은 읽지 않는다. */
export async function sniffFile(file: File): Promise<ModeId> {
  try {
    const buf = await file.slice(0, SNIFF_BYTES).arrayBuffer()
    const head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength))
    if (looksSpreadsheet(file.name, head)) return 'csv'
    const ext = extOf(file.name)
    if (MD_EXTS.has(ext)) return 'md'
    if (JSON_EXTS.has(ext)) return 'jq'
    if (CSV_EXTS.has(ext)) return 'csv'
    return sniffText(decodeBytes(buf).text)
  } catch {
    return 'csv'
  }
}
