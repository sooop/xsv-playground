/**
 * textarea 캐럿의 화면 좌표.
 *
 * 브라우저가 textarea 내부 좌표를 알려 주지 않으므로, 같은 글꼴·패딩·너비를 가진 거울 div 를
 * 같은 자리에 겹쳐 두고 커서까지의 텍스트를 넣은 뒤 끝에 붙인 span 의 위치를 잰다.
 * (원본 `QueryPanel.ts:getCaretCoordinates` 와 같은 방법 — 다른 방법이 없다.)
 */

const COPY_PROPS = [
  'font',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'boxSizing',
] as const

export interface CaretPos {
  x: number
  y: number
  lineHeight: number
}

export function getCaretCoordinates(textarea: HTMLTextAreaElement, pos: number): CaretPos {
  const computed = window.getComputedStyle(textarea)
  const rect = textarea.getBoundingClientRect()

  const div = document.createElement('div')
  div.style.cssText =
    'position:fixed;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;'
  div.style.top = rect.top + 'px'
  div.style.left = rect.left + 'px'
  div.style.width = rect.width + 'px'
  div.style.height = rect.height + 'px'

  for (const prop of COPY_PROPS) {
    div.style.setProperty(
      prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()),
      computed.getPropertyValue(prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())),
    )
  }

  div.scrollTop = textarea.scrollTop
  div.scrollLeft = textarea.scrollLeft
  div.textContent = textarea.value.substring(0, pos)

  const span = document.createElement('span')
  span.textContent = '​'
  div.appendChild(span)

  document.body.appendChild(div)
  const spanRect = span.getBoundingClientRect()
  const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.2
  document.body.removeChild(div)

  return { x: spanRect.left, y: spanRect.top, lineHeight }
}
