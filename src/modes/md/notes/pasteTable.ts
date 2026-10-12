// TSV/CSV 붙여넣기 → 표 변환의 순수 로직 (감지·파싱·마크다운 표 문자열). ProseMirror 에 의존하지 않는다.
import { CsvParser } from '../../../lib/parse/csv';

export interface PasteTableInput {
  text: string;
  /** 클립보드의 text/html. `<table` 이 있으면 엑셀·시트 복사이므로 개입하지 않는다 */
  html?: string;
}

export interface PasteTable {
  kind: 'tsv' | 'csv';
  /** 정규화한 원문(줄바꿈 \n, 끝 개행 제거) — 변환 전에 먼저 삽입하는 텍스트 */
  text: string;
  /** 모든 행의 길이가 같은 2차원 배열 (셀은 앞뒤 공백 제거) */
  rows: string[][];
}

// CSV 오탐 방지 한도: 첫 줄이 문장처럼 길면 변환하지 않는다
const CSV_MAX_FIRST_LINE = 120;
const CSV_MAX_CELL = 200;

export const normalizePasted = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');

function parse(text: string, delimiter: '\t' | ','): string[][] | null {
  const p = new CsvParser(delimiter);
  p.push(text);
  const rows = p.finish().map((r) => r.map((c) => c.trim()));
  if (rows.length === 0) return null;
  const cols = rows[0].length;
  if (cols < 2 || rows.some((r) => r.length !== cols)) return null;
  return rows;
}

/** 이미 마크다운 표인 텍스트(`|` 로 시작하는 줄들) */
export function looksLikeMarkdownTable(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  return lines.length >= 2 && lines.every((l) => l.trimStart().startsWith('|'));
}

/**
 * 붙여넣은 내용이 표로 바꿀 대상인지 판정한다. 대상이 아니면 null (에디터 기본 붙여넣기에 맡긴다).
 * - HTML 에 `<table` 이 있으면 null (엑셀·구글 시트: 기본 붙여넣기가 표로 처리)
 * - TSV: 2줄 이상 + 탭 + 모든 행 열 수 동일 + 2열 이상. 단 모든 행이 탭으로 시작하면(들여쓴 코드) 제외
 * - CSV: 3줄 이상 + 열 수 동일 + 2열 이상 + (따옴표가 없으면) 빈 줄 없음 + 첫 줄 120자 이하 + 셀 200자 이하
 */
export function detectPasteTable({ text: raw, html }: PasteTableInput): PasteTable | null {
  if (html && /<table[\s>]/i.test(html)) return null;
  const text = normalizePasted(raw);
  if (!text.trim() || looksLikeMarkdownTable(text)) return null;

  if (text.includes('\t')) {
    const rows = parse(text, '\t');
    // 모든 행이 탭으로 시작 = 들여쓰기된 코드/목록일 가능성이 높다
    if (rows && rows.length >= 2 && !rows.every((r) => r[0] === '')) return { kind: 'tsv', text, rows };
    return null;
  }

  if (text.includes(',')) {
    const hasQuote = text.includes('"');
    if (!hasQuote && /\n[ \t]*\n/.test(text)) return null;
    if (!hasQuote && text.split('\n').length < 3) return null;
    const rows = parse(text, ',');
    if (!rows || rows.length < 3) return null;
    if (text.split('\n')[0].length > CSV_MAX_FIRST_LINE) return null;
    if (rows.some((r) => r.some((c) => c.length > CSV_MAX_CELL))) return null;
    return { kind: 'csv', text, rows };
  }
  return null;
}

/** 첫 행이 머리글이 아니면 빈 머리글 행을 앞에 붙인다 (마크다운 표는 머리글 행이 필수). */
export function withHeaderRow(rows: string[][], firstRowIsHeader: boolean): { header: string[]; body: string[][] } {
  if (firstRowIsHeader) return { header: rows[0], body: rows.slice(1) };
  return { header: rows[0].map(() => ''), body: rows };
}

const escapeCell = (c: string) => c.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '<br>');

/** GFM 표 마크다운 문자열. 파이프는 `\|`, 셀 안 줄바꿈은 `<br>` 로 쓴다. */
export function toMarkdownTable(rows: string[][], firstRowIsHeader: boolean): string {
  const { header, body } = withHeaderRow(rows, firstRowIsHeader);
  const line = (r: string[]) => `| ${r.map(escapeCell).join(' | ')} |`;
  return [line(header), `| ${header.map(() => '---').join(' | ')} |`, ...body.map(line)].join('\n');
}
