/** 천 단위 구분자를 넣은 정수 표기. */
export function num(n: number): string {
  return n.toLocaleString('ko-KR')
}

/** 통계 표시용 — 정수는 그대로, 소수는 유효자리를 적당히 자른다. */
export function stat(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Number.isInteger(n)) return n.toLocaleString('ko-KR')
  const abs = Math.abs(n)
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6
  return Number(n.toFixed(digits)).toLocaleString('ko-KR')
}

/** 바이트를 사람이 읽는 크기로. */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 밀리초 표기 — 1ms 미만은 소수점, 1초 이상은 초 단위. */
export function ms(v: number): string {
  if (v < 1) return `${v.toFixed(2)}ms`
  if (v < 1000) return `${Math.round(v)}ms`
  return `${(v / 1000).toFixed(1)}s`
}

/** 구분자를 사람이 읽는 이름으로. */
export function delimiterName(d: string): string {
  switch (d) {
    case ',':
      return '콤마'
    case '\t':
      return '탭'
    case ';':
      return '세미콜론'
    case '|':
      return '파이프'
    default:
      return d
  }
}

/** 파일명에서 확장자를 떼고, 비어 있으면 기본값을 준다. */
export function baseName(fileName: string, fallback = 'export'): string {
  if (!fileName) return fallback
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  return base || fallback
}
