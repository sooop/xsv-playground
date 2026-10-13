// 표 도구(호버 툴바·우클릭 메뉴·⋯ 메뉴)가 공유하는 상태와 동작: 확대 보기 팝오버, CSV 모드로 보내기.
import { buildXlsxSheets } from '../../../lib/parse/xlsx';
import { shell } from '../../../shell/shell.svelte';
import { doc, errMsg, toast, withStatus } from './store.svelte';
import type { TableData, TableToolsEnv } from './tableTools';
import { downloadBlob, stripExt } from './utils';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 확대 보기 팝오버가 보여 줄 표(null 이면 닫힘) */
export const tableViewer = $state<{ table: TableData | null }>({ table: null });

/** 표 이름 바탕 — 문서 이름에서 확장자를 뗀 것 */
export const docBaseName = (): string => stripExt(doc.name) || '표';

/** 시트·파일 이름: `{문서명}-표N` */
export const tableName = (index: number): string => `${docBaseName()}-표${index}`;

/** 표 하나를 CSV 모드로 보낸다(CSV 모드에 문서가 있으면 셸이 바꿀지 묻는다). */
export async function sendTableToCsv(t: TableData): Promise<void> {
  const ok = await shell.sendTo('csv', { kind: 'table', header: t.header, rows: t.rows, name: tableName(t.index), from: 'md' });
  if (ok) tableViewer.table = null;
}

/**
 * 시트 이름 `{문서명}-표N`. 엑셀 시트 이름은 31자 이하·`: \ / ? * [ ]` 불가라서
 * 문서명 쪽만 잘라 `-표N`은 항상 남긴다(표마다 번호가 달라 이름이 겹치지 않는다).
 */
export function sheetName(index: number): string {
  const suffix = `-표${index}`;
  const base = docBaseName().replace(/[:\\/?*[\]]/g, '_');
  return base.slice(0, 31 - suffix.length) + suffix;
}

async function buildSheets(tables: TableData[]): Promise<Uint8Array> {
  return withStatus('xlsx 만드는 중…', () =>
    buildXlsxSheets(tables.map((t) => ({ name: sheetName(t.index), matrix: [t.header, ...t.rows] }))),
  );
}

/** 문서의 모든 표를 시트로 나눠 하나의 xlsx 로 내려받는다(SheetJS 를 CDN 에서 받는다). */
export async function exportTablesXlsx(tables: TableData[]): Promise<void> {
  if (!tables.length) { toast('문서에 표가 없습니다', 'error'); return; }
  try {
    const bytes = await buildSheets(tables);
    downloadBlob(`${docBaseName()}-표.xlsx`, new Blob([bytes as BlobPart], { type: XLSX_MIME }));
    toast(`표 ${tables.length}개를 시트로 나눠 내려받았습니다`);
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

/** 문서의 모든 표를 시트로 나눠 CSV 모드에서 연다(표가 하나면 그냥 그 표를 보낸다). */
export async function openTablesInCsv(tables: TableData[]): Promise<void> {
  if (!tables.length) { toast('문서에 표가 없습니다', 'error'); return; }
  if (tables.length === 1) { await sendTableToCsv(tables[0]); return; }
  try {
    const bytes = await buildSheets(tables);
    const name = `${docBaseName()}-표.xlsx`;
    const file = new File([bytes as BlobPart], name, { type: XLSX_MIME });
    await shell.sendTo('csv', { kind: 'file', file, name, from: 'md' });
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

export const tableEnv: TableToolsEnv = {
  toast,
  docName: docBaseName,
  openViewer: (t) => { tableViewer.table = t; },
  sendToCsv: (t) => { void sendTableToCsv(t); },
};
