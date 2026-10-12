// 미니맵 좌표 계산(순수 함수). DOM 과 무관하게 테스트할 수 있다.

export type BlockKind = 'heading' | 'code' | 'image' | 'table' | 'quote' | 'text';

export interface BlockBox { top: number; height: number; kind: BlockKind }
export interface Bar { y: number; h: number; kind: BlockKind }

/** 문서 좌표의 블록들을 트랙 높이(px)에 맞춰 축소한다. 1px 미만 블록은 최소 높이로 올리고, 겹치거나 맞닿은 같은 종류 막대는 합친다. */
export function layoutBars(blocks: BlockBox[], total: number, trackH: number, minH = 1.5): Bar[] {
  if (total <= 0 || trackH <= 0) return [];
  const k = trackH / total;
  const out: Bar[] = [];
  for (const b of blocks) {
    const y = b.top * k;
    const h = Math.max(minH, b.height * k);
    const prev = out[out.length - 1];
    if (prev && prev.kind === b.kind && y <= prev.y + prev.h + 0.5) {
      prev.h = Math.max(prev.h, y + h - prev.y);
    } else {
      out.push({ y, h, kind: b.kind });
    }
  }
  return out;
}

/** 현재 보이는 영역을 나타내는 썸의 위치·높이(트랙 px). */
export function thumbBox(scrollTop: number, clientH: number, total: number, trackH: number): { y: number; h: number } {
  if (total <= 0) return { y: 0, h: trackH };
  const h = Math.min(trackH, Math.max(8, (clientH / total) * trackH));
  const y = Math.max(0, Math.min(trackH - h, (scrollTop / total) * trackH));
  return { y, h };
}

/** 트랙에서 누른 y(px)가 뷰포트 중앙이 되도록 하는 scrollTop. */
export function scrollTopForPointer(pointerY: number, trackH: number, clientH: number, total: number): number {
  if (trackH <= 0) return 0;
  const raw = (pointerY / trackH) * total - clientH / 2;
  return Math.max(0, Math.min(Math.max(0, total - clientH), raw));
}

export function kindOf(el: Element): BlockKind {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) return 'heading';
  if (el.classList.contains('milkdown-code-block')) return 'code';
  if (el.classList.contains('milkdown-image-block') || el.querySelector('img')) return 'image';
  if (el.classList.contains('milkdown-table-block') || tag === 'TABLE') return 'table';
  if (tag === 'BLOCKQUOTE') return 'quote';
  return 'text';
}
