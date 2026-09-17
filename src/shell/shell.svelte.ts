/**
 * 셸 상태 — 활성 모드, 모드별 요약 상태, 모드 간 전송.
 *
 * `handles`는 반응형이 아니다(컴포넌트 인스턴스를 proxy로 감싸면 안 된다). App이 `bind:this`
 * 결과를 채우고, `sendTo`가 읽는다.
 */
import { dialogs } from '../lib/ui/dialog/dialog.svelte'
import { sniffFile } from './fileKind'
import { MODE_LABEL, emptyStatus, type ModeHandle, type ModeId, type ModePayload, type ModeStatus } from './mode'

class ShellController {
  active = $state<ModeId>('csv')

  /**
   * 한 번이라도 활성화된 모드만 마운트한다(래치 — 다시 false가 되지 않는다). 상태 유지 요구는
   * 그대로 만족하면서, CSV만 쓰는 경로에서는 DOM이 단일 모드 시절과 동일하게 유지된다.
   */
  mounted = $state<Record<ModeId, boolean>>({ csv: true, jq: false, md: false })

  status = $state<Record<ModeId, ModeStatus>>({
    csv: emptyStatus(),
    jq: emptyStatus(),
    md: emptyStatus(),
  })

  handles: Partial<Record<ModeId, ModeHandle>> = {}

  /** 셸이 소유한 숨은 `<input type=file>`. App이 `bind:this`로 채운다. */
  fileInput: HTMLInputElement | null = null

  /** 파일 선택 대화상자를 연다(툴바 "열기", Ctrl+O). */
  requestOpen(): void {
    this.fileInput?.click()
  }

  /**
   * 파일을 종류에 맞는 모드로 연다 — 드롭·파일 선택·빈 화면의 모든 파일 진입점이 여기를 지난다.
   * 첫 파일만 연다(모드당 1문서).
   */
  async openFiles(files: FileList | File[] | null | undefined): Promise<void> {
    const file = files?.[0]
    if (!file) return
    const to = await sniffFile(file)
    this.mounted[to] = true
    const handle = await this.#waitHandle(to)
    if (!handle) return
    this.active = to
    await handle.openFile(file)
  }

  activate(m: ModeId): void {
    this.mounted[m] = true
    this.active = m
  }

  /**
   * 대상 모드에 데이터를 보낸다. 대상에 문서가 이미 있으면 덮어쓸지 확인한 뒤 전달하고,
   * 전달이 끝나면 그 모드로 전환한다. 취소하면 false.
   */
  async sendTo(to: ModeId, p: ModePayload): Promise<boolean> {
    if (this.status[to].hasDocument) {
      const ok = await dialogs.confirm({
        title: `${MODE_LABEL[to]} 모드로 보내기`,
        message: `${MODE_LABEL[to]} 모드에 열려 있는 문서를 닫고 이 데이터로 바꿀까요?`,
        detail: this.status[to].isDirty ? '저장되지 않은 변경이 있습니다.' : undefined,
        okLabel: '바꾸기',
        danger: this.status[to].isDirty,
      })
      if (!ok) return false
    }
    this.mounted[to] = true
    // 대상 모드가 아직 마운트되지 않았다면 핸들이 생길 때까지 한 틱 기다린다
    const handle = await this.#waitHandle(to)
    if (!handle) return false
    await handle.receive(p)
    this.active = to
    handle.focusMode()
    return true
  }

  async #waitHandle(m: ModeId): Promise<ModeHandle | null> {
    for (let i = 0; i < 50; i++) {
      const h = this.handles[m]
      if (h) return h
      await new Promise((r) => setTimeout(r, 10))
    }
    return null
  }
}

export const shell = new ShellController()
