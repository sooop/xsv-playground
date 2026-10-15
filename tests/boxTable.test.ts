import { describe, expect, it } from 'vitest'
import { parseBoxTable } from '../src/lib/parse/boxTable'

describe('parseBoxTable', () => {
  it('유니코드 테두리 표(행마다 구분선)', () => {
    const t = `  ┌──────┬──────┐
  │ 이름 │ 나이 │
  ├──────┼──────┤
  │ 철수 │ 30   │
  ├──────┼──────┤
  │ 영희 │ 25   │
  └──────┴──────┘`
    expect(parseBoxTable(t)).toEqual([['이름', '나이'], ['철수', '30'], ['영희', '25']])
  })

  it('긴 셀이 여러 줄로 감긴 행은 합친다', () => {
    const t = `┌────┬────────┐
│ id │ 설명   │
├────┼────────┤
│ 1  │ 첫 번째 │
│    │ 줄바꿈 │
├────┼────────┤
│ 2  │ 끝     │
└────┴────────┘`
    expect(parseBoxTable(t)).toEqual([['id', '설명'], ['1', '첫 번째 줄바꿈'], ['2', '끝']])
  })

  it('머리글 아래에만 구분선이 있으면 줄마다 한 행', () => {
    const t = `┌───┬───┐
│ a │ b │
├───┼───┤
│ 1 │ 2 │
│ 3 │ 4 │
└───┴───┘`
    expect(parseBoxTable(t)).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
  })

  it('ASCII +---+ 표와 앞뒤 문장 무시, "-" 셀 보존', () => {
    const t = `결과입니다
+---+---+
| a | b |
+---+---+
| - | 2 |
+---+---+
끝`
    expect(parseBoxTable(t)).toEqual([['a', 'b'], ['-', '2']])
  })

  it('마크다운 표·일반 텍스트는 null', () => {
    expect(parseBoxTable('| a | b |\n|---|---|\n| 1 | 2 |')).toBeNull()
    expect(parseBoxTable('hello\nworld')).toBeNull()
    expect(parseBoxTable('a,b\n1,2')).toBeNull()
  })
})
