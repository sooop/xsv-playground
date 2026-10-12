import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/shell/shell.svelte', () => ({ shell: { sendTo: vi.fn() } }));
import { sendTarget } from '../src/modes/md/notes/codeSend';
import { layoutBars, thumbBox, scrollTopForPointer } from '../src/modes/md/notes/minimap';

describe('sendTarget', () => {
  it('json → jq, csv/tsv → csv, 그 외 null', () => {
    expect(sendTarget('json')?.to).toBe('jq');
    expect(sendTarget(' JSON ')?.to).toBe('jq');
    expect(sendTarget('csv')?.to).toBe('csv');
    expect(sendTarget('tsv')?.to).toBe('csv');
    expect(sendTarget('ts')).toBeNull();
    expect(sendTarget('')).toBeNull();
  });
});

describe('minimap', () => {
  it('블록을 트랙 높이에 비례 축소하고 맞닿은 같은 종류는 합친다', () => {
    const bars = layoutBars([
      { top: 0, height: 100, kind: 'text' },
      { top: 100, height: 100, kind: 'text' },
      { top: 200, height: 100, kind: 'heading' },
    ], 1000, 100);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ y: 0, h: 20, kind: 'text' });
    expect(bars[1]).toMatchObject({ y: 20, h: 10, kind: 'heading' });
  });
  it('썸과 포인터 변환', () => {
    expect(thumbBox(500, 200, 1000, 100)).toEqual({ y: 50, h: 20 });
    expect(thumbBox(900, 200, 1000, 100).y).toBe(80);
    expect(scrollTopForPointer(50, 100, 200, 1000)).toBe(400);
    expect(scrollTopForPointer(0, 100, 200, 1000)).toBe(0);
    expect(scrollTopForPointer(100, 100, 200, 1000)).toBe(800);
  });
});
