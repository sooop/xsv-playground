/**
 * 원시 HTML 컨텍스트(Reader의 코드블록 복사 버튼)용 SVG 문자열.
 *
 * 컴포넌트 마크업 안의 아이콘은 xsv 관례대로 각 자리에 인라인 `<svg>`로 쓴다 — 이 파일은
 * `{@html}`로 이미 삽입된(DOMPurify가 svg 자식을 지워버리는) 코드블록 바깥에서, 클릭 델리게이션이
 * `innerHTML`을 직접 갈아끼우는 두 아이콘(복사/완료)만 담는다.
 */

export const COPY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>' +
  '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'

export const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="20 6 9 17 4 12"/></svg>'
