/**
 * 셸 ↔ 모드 계약.
 *
 * 세 모드(CSV / jq / Markdown)는 모두 이 인터페이스를 구현한다. 셸은 `bind:this`로 얻은
 * 인스턴스를 `ModeHandle`로 다루고, 모드는 `shell.status[모드]`에 자기 상태를 써서 탭바가
 * 읽게 한다.
 */

export type ModeId = 'csv' | 'jq' | 'md'

export const MODE_IDS: readonly ModeId[] = ['csv', 'jq', 'md']

export const MODE_LABEL: Record<ModeId, string> = {
  csv: 'CSV',
  jq: 'jq',
  md: 'Markdown',
}

/** 다른 모드로 보내는 데이터. 표는 텍스트로 직렬화하지 않고 2차원 배열 그대로 넘긴다. */
export type ModePayload =
  | { kind: 'table'; header: string[]; rows: string[][]; name: string; from: ModeId }
  | { kind: 'text'; text: string; name: string; from: ModeId }

/** `bind:this`로 얻는 모드 인스턴스의 표면. 모드 컴포넌트가 `export function`으로 구현한다. */
export interface ModeHandle {
  openFile(file: File): Promise<void>
  openText(text: string, name: string): Promise<void>
  /** 다른 모드에서 보낸 데이터 수신. 셸이 덮어쓰기 확인을 마친 뒤 호출한다. */
  receive(p: ModePayload): Promise<void>
  focusMode(): void
  /**
   * 모드 단축키. 셸이 캡처 단계에서 잡아 **활성 모드에만, 다이얼로그가 없을 때만** 넘긴다.
   * 처리했으면 true(이미 preventDefault/stopPropagation을 했어야 한다).
   */
  handleKeydown(e: KeyboardEvent): boolean
}

/** 탭바가 읽는 모드 요약 상태. 모드가 `$effect`로 자기 슬롯만 갱신한다. */
export interface ModeStatus {
  hasDocument: boolean
  isDirty: boolean
  /** 탭에 덧붙일 문서 이름 힌트(없으면 빈 문자열) */
  label: string
}

export function emptyStatus(): ModeStatus {
  return { hasDocument: false, isDirty: false, label: '' }
}
