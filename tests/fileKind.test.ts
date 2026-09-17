import { describe, expect, it } from 'vitest'
import { detectFileKind, sniffText } from '../src/shell/fileKind'

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
const TEXT = new Uint8Array([0x61, 0x2c, 0x62, 0x0a, 0x31, 0x2c, 0x32, 0x0a])

describe('detectFileKind — 매직 바이트 → 확장자 → 내용', () => {
  it('ZIP 시그니처면 확장자가 .csv여도 스프레드시트(csv 모드)', () => {
    expect(detectFileKind('wrong.csv', ZIP, '')).toBe('csv')
    expect(detectFileKind('book.xlsx', ZIP, '')).toBe('csv')
  })
  it('확장자 매핑', () => {
    expect(detectFileKind('README.md', TEXT, '# hi')).toBe('md')
    expect(detectFileKind('notes.markdown', TEXT, '')).toBe('md')
    expect(detectFileKind('data.json', TEXT, '')).toBe('jq')
    expect(detectFileKind('log.jsonl', TEXT, '')).toBe('jq')
    expect(detectFileKind('a.csv', TEXT, '')).toBe('csv')
    expect(detectFileKind('a.tsv', TEXT, '')).toBe('csv')
  })
  it('.txt는 내용으로 판정한다', () => {
    expect(detectFileKind('x.txt', TEXT, '{"a":1}')).toBe('jq')
    expect(detectFileKind('x.txt', TEXT, 'a\tb\n1\t2\n3\t4\n')).toBe('csv')
    expect(detectFileKind('x.txt', TEXT, '# 제목\n\n본문 문단입니다.\n')).toBe('md')
  })
})

describe('sniffText', () => {
  it('JSON 객체·배열', () => {
    expect(sniffText('  {"a": 1}')).toBe('jq')
    expect(sniffText('﻿[1,2,3]')).toBe('jq')
  })
  it('JSONL — 앞 두 줄이 각각 JSON', () => {
    expect(sniffText('{"a":1}\n{"a":2}\n{"a":3}\n')).toBe('jq')
  })
  it('마크다운 — 첫 줄 헤딩이면 충분', () => {
    expect(sniffText('# Title\nplain text here\n')).toBe('md')
  })
  it('마크다운 — 신호 둘 이상', () => {
    expect(sniffText('Intro paragraph\n\n- item one\n- item two\n\n```js\ncode\n```\n')).toBe('md')
  })
  it('구분자 표 — 필드 수 2 이상이고 행마다 일정', () => {
    expect(sniffText('id,name,qty\n1,사과,3\n2,배,5\n3,감,1\n')).toBe('csv')
    expect(sniffText('id;name\n1;a\n2;b\n')).toBe('csv')
    expect(sniffText('a|b|c\n1|2|3\n4|5|6\n')).toBe('csv')
  })
  it('마지막 줄은 잘렸을 수 있으니 판정에서 뺀다', () => {
    expect(sniffText('a,b\n1,2\n3,4\n5,')).toBe('csv')
  })
  it('불릿 하나만 있는 산문은 csv도 md 신호 부족 — 폴백 md', () => {
    expect(sniffText('그냥 글입니다.\n둘째 줄.\n- 하나\n')).toBe('md')
  })
  it('빈 내용은 md', () => {
    expect(sniffText('')).toBe('md')
    expect(sniffText('   \n')).toBe('md')
  })
  it('열이 1개뿐인 줄글은 표가 아니다', () => {
    expect(sniffText('first line\nsecond line\nthird line\n')).toBe('md')
  })
})
