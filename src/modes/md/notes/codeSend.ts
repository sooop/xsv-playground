// 코드 블록 → 다른 모드로 보내기. 구 Markdown 뷰어와 같은 규칙: json → jq, csv/tsv → CSV.
import type { EditorView } from '@milkdown/kit/prose/view';
import type { ModeId } from '../../../shell/mode';
import { shell } from '../../../shell/shell.svelte';

/** 언어 → 보낼 모드. 보낼 수 없는 언어면 null. */
export function sendTarget(lang: string): { to: ModeId; label: string } | null {
  switch (lang.trim().toLowerCase()) {
    case 'json': return { to: 'jq', label: 'jq로 열기' };
    case 'csv':
    case 'tsv': return { to: 'csv', label: 'CSV로 열기' };
    default: return null;
  }
}

const SEND_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>';

const BTN_CLASS = 'md-send-btn';

interface CodeInfo { lang: string; text: string }

/** 문서의 code_block 들을 순서대로 수집한다(DOM 의 .milkdown-code-block 순서와 같다). */
function collectBlocks(view: EditorView): CodeInfo[] {
  const out: CodeInfo[] = [];
  view.state.doc.descendants((node) => {
    if (node.type.name === 'code_block') {
      out.push({ lang: String(node.attrs.language ?? ''), text: node.textContent });
      return false;
    }
    return true;
  });
  return out;
}

/**
 * 코드 블록 헤더(.tools-button-group)에 보내기 버튼을 넣는다.
 * Milkdown 은 화면 밖 블록의 CodeMirror 를 해체·재생성하며 자식 DOM 을 비우므로,
 * ProseMirror DOM 의 변경을 관찰해(rAF 로 합침) 없는 곳에만 다시 주입하고 언어에 따라 표시를 갱신한다.
 * 반환값은 해제 함수.
 */
export function attachCodeSend(root: HTMLElement, view: EditorView): () => void {
  const pm = root.querySelector<HTMLElement>('.ProseMirror') ?? root;
  let raf = 0;

  const scan = () => {
    raf = 0;
    const blocks = pm.querySelectorAll<HTMLElement>('.milkdown-code-block');
    if (!blocks.length) return;
    const infos = collectBlocks(view);
    blocks.forEach((block, i) => {
      const group = block.querySelector<HTMLElement>('.tools-button-group');
      if (!group) return; // 아직 placeholder 상태
      const target = sendTarget(infos[i]?.lang ?? '');
      let btn = group.querySelector<HTMLButtonElement>(`:scope > .${BTN_CLASS}`);
      if (!target) { btn?.remove(); return; }
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = BTN_CLASS;
        btn.innerHTML = SEND_ICON;
        group.insertBefore(btn, group.firstChild);
      }
      btn.title = target.label;
      btn.setAttribute('aria-label', `코드 블록을 ${target.label.replace('로 열기', '')} 모드로 보내기`);
    });
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(scan); };

  const mo = new MutationObserver(schedule);
  mo.observe(pm, { childList: true, subtree: true });

  const onClick = (e: MouseEvent) => {
    const btn = (e.target as Element | null)?.closest?.(`.${BTN_CLASS}`);
    if (!btn || !pm.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    const block = btn.closest('.milkdown-code-block');
    const idx = block ? Array.from(pm.querySelectorAll('.milkdown-code-block')).indexOf(block) : -1;
    const info = idx >= 0 ? collectBlocks(view)[idx] : undefined;
    const target = info && sendTarget(info.lang);
    if (!info || !target) return;
    const lang = info.lang.trim().toLowerCase();
    void shell.sendTo(target.to, { kind: 'text', text: info.text, name: `코드블록.${lang}`, from: 'md' });
  };
  // PM 이 mousedown 을 가로채기 전에 처리하도록 캡처 단계에서 듣는다
  pm.addEventListener('click', onClick, true);
  schedule();

  return () => {
    mo.disconnect();
    if (raf) cancelAnimationFrame(raf);
    pm.removeEventListener('click', onClick, true);
  };
}
