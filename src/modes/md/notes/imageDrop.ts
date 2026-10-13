// 이미지 파일 드롭을 에디터 영역 전체(미니맵 위 포함)에서 받는다.
// ProseMirror 는 본문(.ProseMirror) 안에 놓인 드롭만 받는다. 본문은 최대 폭이 있고 높이도 내용만큼이라, 양옆 여백이나
// 본문 아래 빈 공간에 놓으면 이벤트가 셸(window)로 올라가 "파일만 열 수 있습니다"로 끝난다. 그래서 에디터 영역(wrap)에서
// 이미지 드롭을 가로채 본문 안쪽 가장 가까운 좌표로 다시 던진다 — 이후는 본문 안에 놓은 것과 같은 경로(앱의 이미지 저장)를 탄다.
import type { EditorView } from '@milkdown/kit/prose/view';
import { isImageDrag } from '../../../shell/dragKind';
import { toast } from './store.svelte';

/**
 * `area`(Markdown 모드 화면 전체) 안에서 놓인 이미지 드롭을 `view` 본문으로 넘긴다 — 사이드바·툴바·여백·미니맵 어디든.
 * 파일은 창 가장자리와 툴바를 지나 들어오므로 에디터 위에서만 받으면, 지나가는 동안 셸의 "파일을 엽니다" 오버레이가 깔린다.
 * 편집 모드에서는 본문 밖에 놓인 것만 다루고(본문 안은 ProseMirror 가 처리), 읽기 모드에서는 본문 안도 막는다.
 * 대화상자 위의 드롭은 건드리지 않는다. 반환값은 해제 함수.
 */
export function attachImageDrop(area: HTMLElement, view: EditorView): () => void {
  const mine = (e: DragEvent) => {
    if (!isImageDrag(e.dataTransfer)) return false;
    if ((e.target as Element | null)?.closest?.('[role="dialog"]')) return false;
    return !view.editable || !view.dom.contains(e.target as Node);
  };

  const onOver = (e: DragEvent) => {
    if (!mine(e)) return;
    e.preventDefault(); // 이게 있어야 drop 이 발생한다. defaultPrevented 라서 셸의 "파일 열기" 오버레이도 꺼진다
    if (e.dataTransfer) e.dataTransfer.dropEffect = view.editable ? 'copy' : 'none';
  };

  const onDrop = (e: DragEvent) => {
    if (!mine(e)) return;
    e.preventDefault();
    e.stopPropagation(); // 셸이 이미지를 "열 파일"로 처리하지 않게 한다
    if (!view.editable) {
      toast('이미지는 편집 모드에서 놓을 수 있습니다', 'error');
      return;
    }
    // 본문 안쪽으로 좌표를 끌어온다. 아래 빈 공간은 본문 맨 아래, 옆 여백은 같은 높이의 본문 가장자리가 된다.
    const r = view.dom.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX, r.left + 60), r.right - 60);
    const y = Math.min(Math.max(e.clientY, r.top + 1), r.bottom - 1);
    // bubbles:false — ProseMirror 는 view.dom 에 직접 붙어 있어 충분하고, window 의 파일 열기 핸들러로 올라가면 안 된다
    view.dom.dispatchEvent(new DragEvent('drop', { dataTransfer: e.dataTransfer, clientX: x, clientY: y, bubbles: false, cancelable: true }));
  };

  // 캡처 단계: mine() 이 편집 모드 본문 안의 이벤트를 걸러내므로 ProseMirror 의 기존 처리에는 끼어들지 않는다
  area.addEventListener('dragover', onOver, true);
  area.addEventListener('drop', onDrop, true);
  return () => {
    area.removeEventListener('dragover', onOver, true);
    area.removeEventListener('drop', onDrop, true);
  };
}
