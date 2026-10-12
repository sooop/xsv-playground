// TSV/CSV 붙여넣기 → 표 변환 ProseMirror 플러그인 (Milkdown `$prose` 로 등록).
//
// 흐름: paste 이벤트에서 동기로 조건을 판정 → 맞으면 preventDefault 후 비동기로 "첫 줄이 머리글인가" 확인 →
//  (1) 원문 텍스트를 선택 영역에 그대로 삽입 (2) closeHistory 로 undo 이벤트를 분리 (3) 삽입한 범위를 표로 교체.
// 그래서 변환 직후 Ctrl+Z 는 표 → 원문 텍스트로, 한 번 더 누르면 붙여넣기 전 상태로 돌아간다.
//
// handlePaste 대신 handleDOMEvents.paste 를 쓰는 이유: 플러그인 순서와 무관하게 Milkdown 의 clipboard
// 플러그인(text/plain 을 마크다운으로 파싱해 삽입)보다 먼저 실행되도록 하기 위해서다.
import { $prose } from '@milkdown/kit/utils';
import { closeHistory } from '@milkdown/kit/prose/history';
import { Fragment, type Node as PMNode, type Schema } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { dialogs } from '../../../lib/ui/dialog/dialog.svelte';
import { detectPasteTable, withHeaderRow, type PasteTable } from './pasteTable';

/** 첫 줄을 머리글로 쓸지 묻는다. true = 첫 줄을 머리글로, false = 머리글 없이(ESC·바깥 클릭 포함). */
export type AskHeader = (table: PasteTable) => Promise<boolean>;

export const askHeaderDialog: AskHeader = (t) =>
  dialogs.confirm({
    message: `붙여넣은 내용을 ${t.rows.length}행 × ${t.rows[0].length}열 표로 변환합니다. 첫 줄을 머리글로 사용할까요?`,
    detail: '변환 직후 Ctrl+Z 를 누르면 원문 텍스트로 되돌아갑니다.',
    okLabel: '첫 줄을 머리글로',
    cancelLabel: '머리글 없이(빈 머리글 행 추가)',
  });

/** Milkdown(gfm) 스키마의 표 노드 생성. 필요한 노드 타입이 없으면 null. */
export function buildTableNode(schema: Schema, rows: string[][], firstRowIsHeader: boolean): PMNode | null {
  const n = schema.nodes;
  if (!n.table || !n.table_header_row || !n.table_row || !n.table_header || !n.table_cell || !n.paragraph) return null;
  const cellParagraph = (text: string) => {
    const parts = text.split('\n');
    const inline: PMNode[] = [];
    parts.forEach((p, i) => {
      if (i > 0) inline.push(n.hardbreak ? n.hardbreak.create({ isInline: true }) : schema.text(' '));
      if (p) inline.push(schema.text(p));
    });
    return n.paragraph.create(null, inline);
  };
  const { header, body } = withHeaderRow(rows, firstRowIsHeader);
  const headRow = n.table_header_row.create(null, header.map((c) => n.table_header.create(null, cellParagraph(c))));
  const bodyRows = body.map((r) => n.table_row.create(null, r.map((c) => n.table_cell.create(null, cellParagraph(c)))));
  return n.table.create(null, Fragment.from([headRow, ...bodyRows]));
}

const inTableOrCode = (view: EditorView) => {
  const $from = view.state.selection.$from;
  for (let d = $from.depth; d >= 0; d--) {
    const t = $from.node(d).type;
    if (t.spec.code || t.spec.tableRole || t.name.startsWith('table')) return true;
  }
  return false;
};

async function convert(view: EditorView, table: PasteTable, ask: AskHeader) {
  const startDoc = view.state.doc;
  const { from, to } = view.state.selection;
  let firstRowIsHeader = false;
  try {
    firstRowIsHeader = await ask(table);
  } catch {
    /* 대화상자 실패 → 머리글 없이 */
  }
  if (view.isDestroyed || !view.editable) return;
  const st = view.state;

  // 대화상자를 기다리는 사이 문서·선택이 바뀌었으면 위치를 믿을 수 없다 → 원문만 현재 선택에 삽입
  const unchanged = st.doc === startDoc && st.selection.from === from && st.selection.to === to;
  if (!unchanged || !(st.selection instanceof TextSelection) || inTableOrCode(view)) {
    view.dispatch(st.tr.insertText(table.text).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
    view.focus();
    return;
  }

  // (1) 원문 텍스트 삽입
  view.dispatch(st.tr.insertText(table.text, from, to).setMeta('paste', true).setMeta('uiEvent', 'paste'));
  const end = from + table.text.length;

  // (2)(3) 이력 이벤트를 분리한 뒤 삽입한 범위를 표로 교체
  const node = buildTableNode(view.state.schema, table.rows, firstRowIsHeader);
  if (!node) return; // 스키마에 표가 없으면 원문만 남는다
  const tr = closeHistory(view.state.tr);
  tr.delete(from, end);
  tr.replaceRangeWith(from, from, node);
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

export function createPasteTablePlugin(ask: AskHeader): Plugin {
  return new Plugin({
    key: new PluginKey('WORKBENCH_PASTE_TABLE'),
    props: {
      handleDOMEvents: {
        paste(view, event) {
          const cd = (event as ClipboardEvent).clipboardData;
          if (!cd || !view.editable || view.props.editable?.(view.state) === false) return false;
          if (cd.files?.length || cd.getData('vscode-editor-data')) return false;
          if (!(view.state.selection instanceof TextSelection) || inTableOrCode(view)) return false;
          const table = detectPasteTable({ text: cd.getData('text/plain'), html: cd.getData('text/html') });
          if (!table || !buildTableNode(view.state.schema, table.rows, true)) return false;
          event.preventDefault();
          void convert(view, table, ask);
          return true;
        },
      },
    },
  });
}

export const pasteTable = $prose(() => createPasteTablePlugin(askHeaderDialog));
