<script lang="ts">
  import './notes/notes.css';
  import { onMount } from 'svelte';
  import type { ModePayload } from '../../shell/mode';
  import { shell } from '../../shell/shell.svelte';
  import StatusLine from './notes/components/StatusLine.svelte';
  import Editor from './notes/components/Editor.svelte';
  import Settings from './notes/components/Settings.svelte';
  import PasteModal from './notes/components/PasteModal.svelte';
  import MoreMenu from './notes/components/MoreMenu.svelte';
  import HistoryPanel from './notes/components/HistoryPanel.svelte';
  import ModeToggle from './notes/components/ModeToggle.svelte';
  import CommentsPanel from './notes/components/CommentsPanel.svelte';
  import CommentLayer from './notes/components/CommentLayer.svelte';
  import { openCount } from './notes/comments/store.svelte';
  import FindBar from './notes/components/FindBar.svelte';
  import Minimap from './notes/components/Minimap.svelte';
  import Lightbox from './notes/components/Lightbox.svelte';
  import SearchPanel from './notes/components/SearchPanel.svelte';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Archive from '@lucide/svelte/icons/archive';
  import FileText from '@lucide/svelte/icons/file-text';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
  import { doc } from './notes/store.svelte';
  import {
    lib, init, save, flush, exportMd, exportAll, openPicker, openDoc, createDoc, renameDoc, removeDoc, onEditorChange,
    upload, resolveUrl, importFiles, createFromText, exportDocxCurrent, exportRtfCurrent, tpl, pickTemplate, clearTemplate, restoreVersion, searchLibrary,
  } from './notes/standalone-mode.svelte';
  import { stripExt } from './notes/utils';
  import { ui, searchShortcut } from './notes/search/state.svelte';
  import { matchName } from './notes/search/nameMatch';

  interface Props {
    /** 셸이 이 모드를 보여주고 있는지. false면 단축키를 받지 않는다. */
    isActive: boolean;
  }
  let { isActive }: Props = $props();
  let commentLayer = $state<CommentLayer | null>(null);
  let wrapEl = $state<HTMLElement | null>(null);

  let pasteOpen = $state(false);
  let sidebarOpen = $state(true);
  let historyOpen = $state(false);

  const templateOptions = $derived([
    { id: '', label: '기본 템플릿' },
    ...(tpl.name ? [{ id: 'custom', label: tpl.name }] : []),
  ]);

  const visibleDocs = $derived(lib.filter.trim() ? lib.docs.filter((d) => matchName(stripExt(d.name), lib.filter)) : lib.docs);

  onMount(() => { void init(); });

  // ── 셸 계약(ModeHandle) ──
  export async function openFile(file: File): Promise<void> { await importFiles([file]); }

  /** 여러 파일(.md/.txt/.docx/.zip)을 한꺼번에 가져온다. 셸이 md 모드가 활성일 때 쓴다. */
  export async function openFiles(files: File[]): Promise<void> { await importFiles(files); }

  export async function openText(text: string, name: string): Promise<void> { await createFromText(name, text); }

  const escapeCell = (v: string) => v.replace(/\|/g, '\|').replace(/\r?\n/g, '<br>');
  function tableToMarkdown(header: string[], rows: string[][]): string {
    const line = (r: string[]) => `| ${r.map(escapeCell).join(' | ')} |`;
    return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
  }

  export async function receive(p: ModePayload): Promise<void> {
    const stem = p.name.replace(/\.[^./\\]+$/, '') || '새 문서';
    if (p.kind === 'table') { await createFromText(stem, tableToMarkdown(p.header, p.rows)); return; }
    const ext = /\.([^./\\]+)$/.exec(p.name)?.[1]?.toLowerCase() ?? '';
    const plain = !ext || ['md', 'markdown', 'txt'].includes(ext);
    const fence = '`'.repeat(3);
    await createFromText(stem, plain ? p.text : `${fence}${ext}\n${p.text.replace(/\n$/, '')}\n${fence}\n`);
  }

  export function focusMode(): void { /* 문서 목록·에디터가 자체 포커스를 관리한다 */ }

  // 탭바가 읽는 요약 상태. 문서는 자동 저장되므로 dirty 는 항상 false 다.
  $effect(() => {
    shell.status.md = { hasDocument: false, isDirty: false, label: doc.path ? stripExt(doc.name) : '' };
  });

  // 셸이 활성 모드에만 넘겨주는 단축키 진입점(ModeHandle). 처리했으면 true.
  export function handleKeydown(e: KeyboardEvent): boolean {
    if (!isActive) return false;
    if (commentLayer?.handleKeydown(e)) return true;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return false;
    const k = e.key.toLowerCase();
    if (k === 'f') {
      const r = searchShortcut(e, !!doc.path);
      if (r === 'global') sidebarOpen = true;
      if (r) e.stopPropagation();
      return r !== null;
    }
    if (e.altKey || e.shiftKey) return false;
    if (k === 's') { e.preventDefault(); e.stopPropagation(); void save(); return true; }
    if (k === 'e' && doc.path) { e.preventDefault(); e.stopPropagation(); doc.edit = !doc.edit; return true; }
    return false;
  }

  // 입력 후 디바운스 대기 중인 내용을 탭을 숨기거나 닫을 때 바로 기록한다
  function onHide() { void flush(); }
</script>

<svelte:window onpagehide={onHide} />
<svelte:document onvisibilitychange={() => { if (document.visibilityState === 'hidden') onHide(); }} />
<div class="md-notes shell">
  {#if sidebarOpen}
    <aside class="sidebar">
      <header>
        <span class="root-btn" title="이 브라우저에 보관된 문서">Notes</span>
        <span class="ops-head">
          <button class="icon-btn" title="새 문서" aria-label="새 문서" onclick={createDoc}><FilePlus size={17} /></button>
          <button class="icon-btn" title="붙여넣어 새 문서 만들기" aria-label="붙여넣어 새 문서 만들기" onclick={() => (pasteOpen = true)}><ClipboardPaste size={17} /></button>
          <button class="icon-btn" title="파일 가져오기 (Ctrl+O)" aria-label="파일 가져오기" onclick={openPicker}><FolderOpen size={17} /></button>
          <button class="icon-btn" title="모든 문서를 zip 으로 내보내기 (백업)" aria-label="모든 문서 내보내기" onclick={exportAll}><Archive size={17} /></button>
        </span>
      </header>
      <div class="sidetabs" role="tablist">
        <button role="tab" class:on={ui.tab === 'files'} aria-selected={ui.tab === 'files'} onclick={() => (ui.tab = 'files')}>파일</button>
        <button role="tab" class:on={ui.tab === 'search'} aria-selected={ui.tab === 'search'} onclick={() => { ui.tab = 'search'; ui.globalFocus++; }} title="모든 문서에서 검색 (Ctrl+Shift+F)">검색</button>
        <button role="tab" class:on={ui.tab === 'comments'} aria-selected={ui.tab === 'comments'} onclick={() => (ui.tab = 'comments')} title="이 문서의 코멘트">코멘트{#if openCount()} <span class="cm-badge">{openCount()}</span>{/if}</button>
      </div>
      <div class="tabpane" hidden={ui.tab !== 'files'}>
        <div class="filterbox">
          <Search size={14} />
          <input bind:value={lib.filter} placeholder="파일 이름 검색 (초성 가능)" aria-label="파일 이름 검색" spellcheck="false" />
          {#if lib.filter}<button class="icon-btn" title="지우기" aria-label="검색어 지우기" onclick={() => (lib.filter = '')}><X size={14} /></button>{/if}
        </div>
        <nav class="tree">
          {#if visibleDocs.length}
            <ul>
              {#each visibleDocs as d (d.id)}
                <li>
                  <div class="row" class:active={doc.path === d.id} style:padding-left="8px">
                    <button class="name" onclick={() => openDoc(d.id)}>
                      <span class="twisty"></span>
                      <FileText size={15} class="ico" />
                      <span class="label">{stripExt(d.name)}</span>
                    </button>
                    <span class="ops">
                      <button title="이름 변경" aria-label="이름 변경" onclick={() => renameDoc(d)}><Pencil size={14} /></button>
                      <button title="삭제" aria-label="삭제" onclick={() => removeDoc(d)}><Trash2 size={14} /></button>
                    </span>
                  </div>
                </li>
              {/each}
            </ul>
          {:else if lib.filter.trim()}
            <p class="empty">'{lib.filter}' 와 일치하는 문서가 없습니다.</p>
          {:else}
            <p class="empty">문서가 없습니다. 위의 새 문서 버튼으로 만들거나 .md · .txt · .docx · 백업 .zip 파일을 끌어다 놓으세요. 문서는 이 브라우저에 보관됩니다.</p>
          {/if}
        </nav>
      </div>
      <div class="tabpane" hidden={ui.tab !== 'search'}>
        <SearchPanel run={searchLibrary} onOpen={openDoc} activeId={doc.path} />
      </div>
      <div class="tabpane" hidden={ui.tab !== 'comments'}>
        <CommentsPanel />
      </div>
    </aside>
  {/if}

  <main class="main">
    <header class="topbar">
      <button class="icon-btn" aria-label="사이드바 토글" onclick={() => (sidebarOpen = !sidebarOpen)}><PanelLeft size={18} /></button>
      <h1 class="doc-title">{doc.path ? stripExt(doc.name) : '문서를 선택하세요'}</h1>
      <span class="spacer"></span>
      {#if doc.path}
        <ModeToggle />
        <HistoryPanel docKey={doc.path} {resolveUrl} onRestore={restoreVersion} bind:open={historyOpen} />
        <MoreMenu
          onHistory={() => (historyOpen = true)}
          onMd={exportMd}
          onDocx={exportDocxCurrent}
          onRtf={exportRtfCurrent}
          options={templateOptions}
          selected={tpl.name ? 'custom' : ''}
          onSelect={(id) => { if (id === '') void clearTemplate(); }}
          actions={[{ label: '템플릿 .docx 파일 선택…', run: pickTemplate }]}
          hint="템플릿은 이 브라우저에 보관됩니다. 첫 docx 사용 때 pandoc 엔진(약 16MB)을 내려받습니다."
        />
      {/if}
      <Settings />
    </header>

    <section class="editor-wrap" bind:this={wrapEl}>
      <FindBar />
      {#if doc.path}
        {#key doc.key}
          <Editor initial={doc.content} onChange={onEditorChange} {upload} {resolveUrl} readonly={!doc.edit} />
        {/key}
        <CommentLayer bind:this={commentLayer} />
      {:else}
        <div class="placeholder">왼쪽 목록에서 문서를 열거나 새로 만드세요.</div>
      {/if}
    </section>
    <Minimap wrap={wrapEl} editing={doc.edit} />
    <Lightbox root={wrapEl} enabled={!doc.edit} />
  </main>
</div>

<StatusLine />
<PasteModal open={pasteOpen} onClose={() => (pasteOpen = false)} onCreate={createFromText} />
