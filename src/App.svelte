<script lang="ts">
  import DialogHost from './lib/ui/dialog/DialogHost.svelte'
  import { dialogs } from './lib/ui/dialog/dialog.svelte'
  import { modals } from './lib/ui/modals.svelte'
  import Toast from './lib/ui/Toast.svelte'
  import { toasts } from './lib/ui/toasts.svelte'
  import CsvMode from './modes/csv/CsvMode.svelte'
  import JqMode from './modes/jq/JqMode.svelte'
  import MdMode from './modes/md/MdMode.svelte'
  import { OPEN_ACCEPT } from './shell/fileKind'
  import type { ModeId } from './shell/mode'
  import ModeTabs from './shell/ModeTabs.svelte'
  import { shell } from './shell/shell.svelte'
  import { themeCtl } from './shell/theme.svelte'

  // --- 테마 --- (상태는 shell/theme.svelte.ts, DOM 반영과 시스템 감지는 여기)
  $effect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    themeCtl.systemDark = mq.matches
    const onChange = (e: MediaQueryListEvent) => (themeCtl.systemDark = e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  })

  $effect(() => {
    document.documentElement.dataset.theme = themeCtl.theme
    themeCtl.persist()
  })

  // --- 모드 핸들 ---
  let csv = $state<CsvMode | null>(null)
  let jq = $state<JqMode | null>(null)
  let md = $state<MdMode | null>(null)
  $effect(() => {
    shell.handles.csv = csv ?? undefined
    shell.handles.jq = jq ?? undefined
    shell.handles.md = md ?? undefined
  })

  // --- 파일 열기 (셸이 소유) ---
  let fileInput = $state<HTMLInputElement | null>(null)
  $effect(() => {
    shell.fileInput = fileInput
  })

  /**
   * 창 전체에 파일을 떨어뜨려도 열리게 한다. 빈 화면(DropZone)이 자기 영역의 드롭을 먼저
   * 처리하고 `preventDefault`를 하므로, 여기서는 `defaultPrevented`인 이벤트를 건너뛴다 —
   * 그렇지 않으면 같은 파일이 두 번 열린다.
   */
  let dragDepth = $state(0)
  function onWindowDragOver(e: DragEvent): void {
    if (e.defaultPrevented) {
      dragDepth = 0
      return
    }
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault()
      dragDepth = 1
    }
  }
  function onWindowDrop(e: DragEvent): void {
    dragDepth = 0
    if (e.defaultPrevented) return
    const files = e.dataTransfer?.files
    if (files?.length) {
      e.preventDefault()
      void shell.openFiles(files)
    }
  }

  // --- 전역 단축키 ---
  //
  // **캡처 단계**에서 처리한다. 버블 단계로 두면 그리드의 keydown이 먼저 실행되어 `/`나 `?`를
  // "인쇄 가능한 문자"로 보고 셀 편집을 시작해 버린다. 셸은 모드 전환 키만 직접 처리하고,
  // 나머지는 **활성 모드에만, 다이얼로그가 떠 있지 않을 때만** 넘긴다 — 비활성 모드가 키를
  // 가로채거나, 확인 창 뒤에서 그리드가 반응하는 일이 없어야 한다.
  const MODE_KEYS: Record<string, ModeId> = { Digit1: 'csv', Digit2: 'jq', Digit3: 'md' }

  function onGlobalKeyDown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.shiftKey && !e.altKey && e.code in MODE_KEYS) {
      e.preventDefault()
      e.stopPropagation()
      shell.activate(MODE_KEYS[e.code])
      return
    }
    if (dialogs.pending > 0) return
    // 공용 모달이 떠 있으면 Escape는 맨 위 모달을 닫는 것으로 끝난다 — 모드에는 넘기지 않는다
    if (e.key === 'Escape' && modals.closeTop()) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (mod && !e.shiftKey && !e.altKey && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault()
      e.stopPropagation()
      shell.requestOpen()
      return
    }
    shell.handles[shell.active]?.handleKeydown(e)
  }

  $effect(() => {
    window.addEventListener('keydown', onGlobalKeyDown, true)
    return () => window.removeEventListener('keydown', onGlobalKeyDown, true)
  })
</script>

<!-- 탭 제목은 활성 모드와 그 문서를 따른다(조립은 shell.docTitle) -->
<svelte:head>
  <title>{shell.docTitle}</title>
</svelte:head>

<svelte:window
  ondragover={onWindowDragOver}
  ondragleave={() => (dragDepth = 0)}
  ondrop={onWindowDrop}
/>

<div class="app">
  <ModeTabs />

  <!-- 모드 페인은 겹쳐 쌓고 visibility로만 숨긴다. display:none은 overflow:auto 요소의
       scrollTop을 0으로 되돌리고 그리드 뷰포트를 한 프레임 0으로 만든다. inert는 숨은 페인으로
       포커스가 들어가는 것을 막는다. -->
  <div class="panes">
    <div class="mode-pane" class:inactive={shell.active !== 'csv'} inert={shell.active !== 'csv'}>
      <CsvMode bind:this={csv} isActive={shell.active === 'csv'} />
    </div>
    {#if shell.mounted.jq}
      <div class="mode-pane" class:inactive={shell.active !== 'jq'} inert={shell.active !== 'jq'}>
        <JqMode bind:this={jq} isActive={shell.active === 'jq'} />
      </div>
    {/if}
    {#if shell.mounted.md}
      <div class="mode-pane" class:inactive={shell.active !== 'md'} inert={shell.active !== 'md'}>
        <MdMode bind:this={md} isActive={shell.active === 'md'} />
      </div>
    {/if}
    {#if dragDepth > 0}
      <div class="drop-hint">놓으면 파일을 엽니다</div>
    {/if}
  </div>
</div>

<input
  bind:this={fileInput}
  id="shell-file-input"
  type="file"
  accept={OPEN_ACCEPT}
  hidden
  onchange={(e) => {
    const f = e.currentTarget.files
    if (f?.length) void shell.openFiles(f)
    e.currentTarget.value = ''
  }}
/>

<Toast items={toasts.items} onDismiss={(id) => toasts.dismiss(id)} />

<!-- 공통 다이얼로그 렌더러 — alert/confirm/prompt가 여기서 그려진다 -->
<DialogHost />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .panes {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .mode-pane {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .mode-pane.inactive {
    visibility: hidden;
    pointer-events: none;
  }
</style>
