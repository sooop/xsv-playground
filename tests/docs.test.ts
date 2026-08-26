import { describe, expect, it } from 'vitest'
import { Dataset } from '../src/lib/data/dataset.svelte'
import {
  defaultDocName,
  migrateBody,
  packDoc,
  unpackDoc,
  type DocBody,
} from '../src/lib/data/docSnapshot'
import { finalize } from '../src/lib/parse/detect'

function makeDataset(raw: string[][], hasHeader: boolean | null = true): Dataset {
  const ds = new Dataset()
  ds.loadParsed(finalize(raw, ',', hasHeader, false), 'orders.csv')
  return ds
}

/** pack → unpack 왕복. 재사용 편의를 위해 pack의 id/name/시각은 고정값을 쓴다. */
async function roundtrip(ds: Dataset) {
  const { meta, body } = packDoc(ds, { id: 'doc-1', name: '테스트', createdAt: 1000, now: 2000 })
  const { snapshot, lostRows } = await unpackDoc(migrateBody(body))
  return { meta, body, snapshot, lostRows }
}

describe('packDoc / unpackDoc 왕복', () => {
  it('인용이 필요한 값(콤마·따옴표·개행·CRLF·공백)이 손실 없이 돌아온다', async () => {
    const raw = [
      ['id', 'name', 'note'],
      ['1', '김,철수', '괜찮음'],
      ['2', '박"영희"', '  앞뒤공백  '],
      ['3', '최민준', '줄바꿈\n두번째줄'],
      ['4', '이서연', 'CRLF\r\n포함'],
    ]
    const ds = makeDataset(raw)
    const { snapshot, lostRows } = await roundtrip(ds)
    expect(lostRows).toBe(0)
    expect(snapshot.rows).toEqual(ds.rows)
    expect(snapshot.header).toEqual(ds.header)
  })

  it('셀 안에 탭 문자(페이로드 구분자)가 있어도 손실 없다', async () => {
    const raw = [
      ['id', 'note'],
      ['1', '탭\t포함된\t값'],
    ]
    const ds = makeDataset(raw)
    const { snapshot, lostRows } = await roundtrip(ds)
    expect(lostRows).toBe(0)
    expect(snapshot.rows).toEqual(ds.rows)
  })

  it('큰 셀(4000자)과 많은 열(500열)도 손실 없다', async () => {
    const bigCell = 'x'.repeat(4000)
    const header = Array.from({ length: 500 }, (_, i) => `col${i}`)
    const row = Array.from({ length: 500 }, (_, i) => (i === 250 ? bigCell : String(i)))
    const ds = makeDataset([header, row])
    const { snapshot, lostRows } = await roundtrip(ds)
    expect(lostRows).toBe(0)
    expect(snapshot.rows).toEqual(ds.rows)
    expect(snapshot.header).toEqual(ds.header)
  })

  it('1열 표에서 완전히 빈 행이 보존된다 (빈 줄 유실 가드)', async () => {
    const ds = makeDataset([['only'], ['a'], [''], ['b'], ['']])
    expect(ds.rowCount).toBe(4) // 헤더 제외 4행
    const { snapshot, lostRows } = await roundtrip(ds)
    expect(lostRows).toBe(0)
    expect(snapshot.rows).toEqual(ds.rows)
    expect(snapshot.rows).toEqual([['a'], [''], ['b'], ['']])
  })

  it('hasHeader: false 문서(생성 헤더 A,B,C…)가 그대로 왕복한다', async () => {
    const ds = makeDataset(
      [
        ['1', '2', '3'],
        ['4', '5', '6'],
      ],
      false,
    )
    expect(ds.hasHeader).toBe(false)
    expect(ds.header).toEqual(['A', 'B', 'C'])
    const { snapshot, lostRows } = await roundtrip(ds)
    expect(lostRows).toBe(0)
    expect(snapshot.hasHeader).toBe(false)
    expect(snapshot.header).toEqual(['A', 'B', 'C'])
    expect(snapshot.rows).toEqual(ds.rows)
  })

  it('데이터 행이 없는 문서(rows: [])도 열이 사라지지 않는다', async () => {
    const ds = makeDataset([['a', 'b', 'c']]) // 헤더 한 줄뿐
    expect(ds.rowCount).toBe(0)
    expect(ds.colCount).toBe(3)
    const { snapshot, lostRows } = await roundtrip(ds)
    expect(lostRows).toBe(0)
    expect(snapshot.rows).toEqual([])
    expect(snapshot.header).toEqual(['a', 'b', 'c'])
  })

  it('중복/빈 이름으로 바꾼 헤더가 글자 그대로 복원된다 (재정규화되지 않는다)', async () => {
    const ds = makeDataset([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
    // 사용자가 renameCol로 중복 이름을 만든 상황을 흉내낸다 — 앱은 이때 재정규화하지 않는다
    ds.header = ['same', 'same', '']
    const { snapshot, lostRows } = await roundtrip(ds)
    expect(lostRows).toBe(0)
    expect(snapshot.header).toEqual(['same', 'same', ''])
  })

  it('colOrder/colWidths/colTypes가 보존된다', async () => {
    const ds = makeDataset([
      ['a', 'b', 'c'],
      ['1', '2026-01-01', 'x'],
      ['2', '2026-01-02', 'y'],
    ])
    ds.colOrder = [2, 0, 1]
    ds.setColWidth(0, 123)
    const { snapshot } = await roundtrip(ds)
    expect(snapshot.colOrder).toEqual([2, 0, 1])
    expect(snapshot.colWidths[0]).toBe(123)
    expect(snapshot.colTypes).toEqual(ds.colTypes)
  })

  it('meta.rowCount/colCount/bytes가 정확하다', async () => {
    const ds = makeDataset([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
    const { meta, body } = packDoc(ds, { id: 'x', name: 'n', createdAt: 0, now: 0 })
    expect(meta.rowCount).toBe(2)
    expect(meta.colCount).toBe(2)
    expect(meta.bytes).toBe(body.payload.byteLength)
    expect(meta.bytes).toBeGreaterThan(0)
  })
})

describe('Dataset.loadSnapshot', () => {
  it('저장된 열 상태를 복원한다', async () => {
    const ds = makeDataset([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
    ds.colOrder = [2, 0, 1]
    ds.setColWidth(1, 200)

    const { snapshot } = await roundtrip(ds)
    const ds2 = new Dataset()
    ds2.loadSnapshot(snapshot)

    expect(ds2.rows).toEqual(ds.rows)
    expect(ds2.header).toEqual(ds.header)
    expect(ds2.colOrder).toEqual([2, 0, 1])
    expect(ds2.colWidths[1]).toBe(200)
  })

  it('깨진 colOrder는 항등 순열로 폴백한다', () => {
    const ds2 = new Dataset()
    ds2.loadSnapshot({
      rows: [['1', '2', '3']],
      header: ['a', 'b', 'c'],
      firstRow: null,
      colOrder: [0, 0, 2], // 중복 — 순열이 아니다
      colWidths: [80, 80, 80],
      colTypes: ['string', 'string', 'string'],
      delimiter: ',',
      hasHeader: true,
      fileName: '',
    })
    expect(ds2.colOrder).toEqual([0, 1, 2])
  })

  it('길이가 안 맞는 colWidths/colTypes는 재계산으로 폴백한다', () => {
    const ds2 = new Dataset()
    ds2.loadSnapshot({
      rows: [['1', '2', '3']],
      header: ['a', 'b', 'c'],
      firstRow: null,
      colOrder: [0, 1, 2],
      colWidths: [80], // 길이 불일치
      colTypes: ['string'], // 길이 불일치
      delimiter: ',',
      hasHeader: true,
      fileName: '',
    })
    expect(ds2.colWidths.length).toBe(3)
    expect(ds2.colTypes.length).toBe(3)
  })

  it('firstRow가 보존되어 열기 후 toggleHeader가 원본 1행을 되돌린다', async () => {
    const ds = makeDataset([
      ['a', 'a', 'b'], // 중복 이름 — normalizeHeader가 'a (2)'로 바꾼다
      ['1', '2', '3'],
    ])
    expect(ds.header).toEqual(['a', 'a (2)', 'b'])
    expect(ds.firstRow).toEqual(['a', 'a', 'b'])

    const { snapshot } = await roundtrip(ds)
    const ds2 = new Dataset()
    ds2.loadSnapshot(snapshot)
    expect(ds2.header).toEqual(['a', 'a (2)', 'b'])

    ds2.toggleHeader() // 헤더 -> 데이터 첫 행으로
    expect(ds2.rows[0]).toEqual(['a', 'a', 'b']) // 정규화 전 원본이 되돌아온다
  })
})

describe('defaultDocName', () => {
  it('파일명이 있으면 확장자를 뗀 이름을 쓴다', () => {
    expect(defaultDocName('2026-01 주문내역.csv', 0)).toBe('2026-01 주문내역')
  })

  it('파일명이 없으면(붙여넣기) 날짜·시각이 들어간 이름을 만든다', () => {
    const now = new Date(2026, 0, 5, 9, 3, 0).getTime()
    expect(defaultDocName('', now)).toBe('무제 2026-01-05 09:03')
  })
})

describe('migrateBody', () => {
  it('현재 스키마 버전은 그대로 통과시킨다', () => {
    const body = { v: 1 } as DocBody
    expect(migrateBody(body)).toBe(body)
  })
})
