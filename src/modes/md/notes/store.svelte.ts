// Markdown 모드 상태: 설정, 현재 문서, 진행 표시. 테마는 셸(themeCtl)이 맡는다.
import { dialogs } from '../../../lib/ui/dialog/dialog.svelte';
import { toasts } from '../../../lib/ui/toasts.svelte';

const SETTINGS_KEY = 'notes.settings';
const SETTINGS_VERSION = 2;

function loadSettings() {
  const base = {
    fontSize: 16, // 에디터 기본 글자 크기(px)
    contentWidth: 860, // 본문 최대 폭(px), 0 이면 전체 폭
    version: SETTINGS_VERSION,
  };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    const merged = { ...base, ...stored };
    if (stored.version !== SETTINGS_VERSION) localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return base;
  }
}

export const settings = $state(loadSettings());

export function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* 저장소를 못 쓰는 환경 */ }
}

export const FONT_RANGE = { min: 12, max: 24 };
export const WIDTH_RANGE = { min: 480, max: 1600 };

// 글자 크기와 본문 폭을 CSS 변수로 반영한다
export function applyLayout() {
  const f = Math.min(FONT_RANGE.max, Math.max(FONT_RANGE.min, Number(settings.fontSize) || 16));
  const w = Number(settings.contentWidth) || 0;
  const root = document.documentElement.style;
  root.setProperty('--editor-font-size', `${f}px`);
  root.setProperty('--editor-width', w > 0 ? `${Math.min(WIDTH_RANGE.max, Math.max(WIDTH_RANGE.min, w))}px` : 'none');
}

export const doc = $state({
  key: 0, // 바뀌면 에디터를 새로 만든다
  path: '', // 서버 모드: 루트 기준 경로, 스탠드얼론: 빈 문자열
  name: '제목 없음',
  content: '',
  dirty: false,
  saving: false,
  edit: false, // 편집 모드 여부. 기존 문서는 읽기 모드로 열고, 새로 만든 문서만 편집 모드로 시작한다
});

// 마지막 에디터 내용을 외부에서 읽기 위한 훅 (Editor 가 등록)
export const editorBridge: { getMarkdown: () => string } = { getMarkdown: () => doc.content };

// ---- 진행 상태 (pandoc 엔진 준비/변환 등 시간이 걸리는 작업) ----
export const status = $state({ text: '' });
export async function withStatus<T>(text: string, fn: (set: (t: string) => void) => Promise<T>): Promise<T> {
  status.text = text;
  try {
    return await fn((t) => { status.text = t; });
  } finally {
    status.text = '';
  }
}

// ---- 토스트·대화상자: 셸 공용 컨트롤러를 쓴다 ----
export function toast(text: string, kind: 'info' | 'error' = 'info') {
  toasts.push(text, kind === 'error' ? 'warn' : 'info');
}

export async function askPrompt(title: string, value = ''): Promise<string | null> {
  const r = await dialogs.prompt({ message: title, value, okLabel: '확인' });
  return r === null ? null : r.trim();
}

export function askConfirm(message: string, okLabel = '확인'): Promise<boolean> {
  return dialogs.confirm({ message, okLabel });
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
