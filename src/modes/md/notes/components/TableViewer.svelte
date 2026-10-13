<script lang="ts">
  // 문서 안 표를 큰 팝오버의 읽기 전용 그리드(CSV 모드와 같은 GridWorkbench)로 보여 준다.
  // 열 너비 드래그·정렬·필터·찾기·범위 복사·내보내기를 그대로 쓸 수 있다. 셀 안 서식(굵게·링크)은 일반 텍스트로 보인다.
  import { untrack } from 'svelte';
  import { Dataset } from '../../../../lib/data/dataset.svelte';
  import { FindStore } from '../../../../lib/data/findState.svelte';
  import { SelectionStore } from '../../../../lib/data/selection.svelte';
  import { View } from '../../../../lib/data/view.svelte';
  import { finalize } from '../../../../lib/parse/detect';
  import GridWorkbench from '../../../../lib/ui/GridWorkbench.svelte';
  import Modal from '../../../../lib/ui/Modal.svelte';
  import type { TableData } from '../tableTools';

  interface Props {
    table: TableData;
    /** 팝오버 제목에 쓰는 문서 이름 */
    docName: string;
    onClose: () => void;
    onSendToCsv: (t: TableData) => void;
  }
  let { table, docName, onClose, onSendToCsv }: Props = $props();

  // 이 팝오버 전용 인스턴스 — CSV·jq 모드와 공유하지 않는다
  const ds = new Dataset();
  const view = new View(ds);
  const sel = new SelectionStore();
  const find = new FindStore(ds, view, sel, 'mdtable.');

  // loadParsed 는 쓰면서 ds.rows 를 다시 읽으므로 추적되면 effect 가 자기 쓰기에 반응해 무한 루프가 된다
  $effect(() => {
    const t = table;
    untrack(() => {
      const pr = finalize([t.header, ...t.rows], ',', true, false);
      ds.loadParsed(pr, `${docName}-표${t.index}`);
      view.clearAll();
      sel.clear();
    });
  });
</script>

<Modal
  label="표 확대 보기"
  title="표 {table.index} 확대 보기"
  subtitle="{table.rows.length}행 × {table.header.length}열"
  width="min(1400px, 96vw)"
  maxHeight="92vh"
  plainBody
  {onClose}
>
  <div class="tv-body">
    <GridWorkbench {ds} {view} {sel} {find} readonly filterStorageKey="md.table.regexMode" />
  </div>
  {#snippet footer()}
    <span class="tv-hint">헤더 경계를 끌어 열 너비를 조절합니다. 이 조절은 문서에 저장되지 않습니다.</span>
    <button type="button" onclick={() => onSendToCsv(table)}>CSV 모드로 보내기</button>
    <button type="button" class="primary" onclick={onClose}>닫기</button>
  {/snippet}
</Modal>

<style>
  .tv-body {
    display: flex;
    flex-direction: column;
    height: min(78vh, 900px);
    min-height: 240px;
  }
  .tv-hint { margin-right: auto; align-self: center; font-size: 12px; color: var(--muted); }
</style>
