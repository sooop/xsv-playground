/**
 * 드래그 중인 데이터의 종류 판정. 드래그 중에는 파일 내용을 읽을 수 없고 종류(`items`)만 보인다.
 */

/** 파일이 있고 전부 이미지이면 true — 에디터에 끼워 넣을 대상이지 "열 파일"이 아니다. */
export function isImageDrag(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false
  const files = Array.from(dt.items).filter((i) => i.kind === 'file')
  return files.length > 0 && files.every((i) => i.type.startsWith('image/'))
}
