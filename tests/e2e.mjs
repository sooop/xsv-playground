#!/usr/bin/env node
/**
 * 빌드 산출물(dist/index.html)을 실제 Chrome에서 `file://`로 열어 검증한다.
 *
 *   npm run build && node tests/e2e.mjs [--headful] [--shots]
 *
 * 소스가 아니라 배포되는 단일 HTML 그 자체를, 사용자가 더블클릭했을 때와 같은 조건으로 띄운다.
 * 외부 요청이 하나라도 발생하면 잡아내고, 가상 스크롤·필터·정렬·편집·되돌리기를 실제 DOM에서 확인한다.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DIST = resolve('dist/index.html')
const FIXTURE = resolve('fixtures/big.csv')
const SHOTS = resolve('.e2e-shots')
const headful = process.argv.includes('--headful')
const wantShots = process.argv.includes('--shots')

if (!existsSync(DIST)) {
  console.error('dist/index.html이 없습니다. npm run build 를 먼저 실행하세요.')
  process.exit(1)
}
if (wantShots && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true })

const results = []
let currentGroup = ''
const group = (name) => {
  currentGroup = name
  console.log('\n[' + name + ']')
}
const check = (name, ok, detail = '') => {
  results.push({ group: currentGroup, name, ok })
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + name + (detail ? '  - ' + detail : ''))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: !headful,
  args: ['--allow-file-access-from-files', '--window-size=1500,950'],
  defaultViewport: { width: 1500, height: 950 },
})
const page = await browser.newPage()

// --- 외부 요청 및 에러 감시 ---
// SheetJS는 XLSX 내보내기를 실제로 쓸 때만 CDN에서 받아온다 — "예상된 유일한 예외"라
// 그 외 모든 외부 요청과 분리해서 센다. 전자가 1건도 아니거나(0건, 또는 xlsx 없이 발생),
// 후자가 1건이라도 있으면 "완전히 오프라인" 약속이 깨진 것이다.
const SHEETJS_CDN = 'https://cdn.sheetjs.com/'
const external = []
const sheetjsRequests = []
const consoleErrors = []
const pageErrors = []
page.on('request', (r) => {
  const u = r.url()
  if (u.startsWith('file://') || u.startsWith('data:') || u.startsWith('blob:')) return
  if (u.startsWith(SHEETJS_CDN)) sheetjsRequests.push(u)
  else external.push(u)
})
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => pageErrors.push(e.message))

const shot = async (name) => {
  if (wantShots) await page.screenshot({ path: SHOTS + '/' + name + '.png' })
}
const status = () => page.$eval('.bar', (e) => e.innerText.replace(/\s+/g, ' '))
const visRows = () => page.$$eval('.canvas .tr', (e) => e.length)
const headerNames = () => page.$$eval('.th-name', (e) => e.map((x) => x.textContent.trim()))

/** 뷰 행/열 좌표의 셀 텍스트. 가상화로 DOM 순서 != 논리 순서라 style.top으로 찾는다. */
const cellText = (row, col) =>
  page.evaluate(
    (r, c) => {
      const tr = [...document.querySelectorAll('.canvas .tr')].find(
        (el) => Math.round(parseFloat(el.style.top) / 28) === r,
      )
      if (!tr) return null
      const td = [...tr.querySelectorAll('.td')][c]
      return td ? td.textContent : null
    },
    row,
    col,
  )

const cellBox = (row, col) =>
  page.evaluate(
    (r, c) => {
      const tr = [...document.querySelectorAll('.canvas .tr')].find(
        (el) => Math.round(parseFloat(el.style.top) / 28) === r,
      )
      const td = [...tr.querySelectorAll('.td')][c]
      const b = td.getBoundingClientRect()
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    },
    row,
    col,
  )

/**
 * 헤더 셀 본문의 클릭 지점 — 우측의 정렬·필터 버튼과 리사이즈 핸들을 피해 이름 쪽을 겨냥한다.
 * 헤더 본문 클릭은 이제 **열 선택**이다.
 */
const headerBox = (i) =>
  page.evaluate((idx) => {
    const th = [...document.querySelectorAll('[role=columnheader]')][idx]
    const r = th.getBoundingClientRect()
    const name = th.querySelector('.th-name')
    const nr = name ? name.getBoundingClientRect() : r
    return { x: nr.x + Math.min(nr.width / 2, 24), y: r.y + r.height / 2 }
  }, i)

/** 헤더의 정렬 버튼을 누른다. `shift`면 다중 정렬에 추가. */
const clickSort = async (idx, shift = false) => {
  await page.evaluate(
    (i, withShift) => {
      const th = [...document.querySelectorAll('[role=columnheader]')][i]
      const b = th.querySelector('.th-sort')
      const r = b.getBoundingClientRect()
      b.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: r.x + r.width / 2,
          clientY: r.y + r.height / 2,
          shiftKey: withShift,
        }),
      )
    },
    idx,
    shift,
  )
  await sleep(280)
}

const press = async (combo) => {
  const parts = combo.split('+')
  const key = parts.pop()
  for (const m of parts) await page.keyboard.down(m)
  await page.keyboard.press(key)
  for (const m of parts.reverse()) await page.keyboard.up(m)
}

const setFilter = async (text) => {
  await page.evaluate(() => {
    const i = document.querySelector('input[aria-label="스마트 필터"]')
    i.focus()
    i.value = ''
    i.dispatchEvent(new Event('input', { bubbles: true }))
  })
  if (text) await page.keyboard.type(text)
  await sleep(450)
}

const readCol = (c) =>
  page.$$eval(
    '.canvas .tr',
    (rows, ci) =>
      rows
        .sort((a, z) => parseFloat(a.style.top) - parseFloat(z.style.top))
        .map((r) => r.querySelectorAll('.td')[ci].textContent),
    c,
  )

const clickText = async (label) => {
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
    if (el) el.click()
  }, label)
}

const selectRowHeader = async (label) => {
  await page.evaluate((t) => {
    const gt = [...document.querySelectorAll('[role=rowheader]')].find(
      (e) => e.textContent.trim() === t,
    )
    const r = gt.getBoundingClientRect()
    const o = { bubbles: true, clientX: r.x + 10, clientY: r.y + 10, button: 0, pointerId: 1 }
    gt.dispatchEvent(new PointerEvent('pointerdown', o))
    gt.dispatchEvent(new PointerEvent('pointerup', o))
  }, label)
  await sleep(200)
}

const clickMenu = async (label) => {
  await page.evaluate((t) => {
    ;[...document.querySelectorAll('[role=menuitem]')].find((b) => b.textContent.includes(t)).click()
  }, label)
  await sleep(380)
}

/** 공통 confirm 다이얼로그가 떠 있으면 확인/취소를 누른다. 없으면 아무 것도 하지 않는다. */
const settleConfirm = async (accept = true) => {
  const has = (await page.$('[role=alertdialog]')) !== null
  if (!has) return false
  await page.evaluate((ok) => {
    const btns = [...document.querySelectorAll('[role=alertdialog] .dlg-btn')]
    const target = ok ? btns.find((b) => b.classList.contains('primary')) : btns[0]
    target.click()
  }, accept)
  await sleep(400)
  return true
}

const toasts = () =>
  page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | '))

await page.goto(pathToFileURL(DIST).href, { waitUntil: 'load' })
await page.waitForSelector('#app *', { timeout: 10000 })

// ===================================================================
group('부팅 (file://)')
check('앱 마운트', (await page.$$('#app *')).length > 0)
check('외부 네트워크 요청 0건', external.length === 0, external.slice(0, 3).join(', '))
check('부팅만으로는 SheetJS도 받지 않는다', sheetjsRequests.length === 0, sheetjsRequests.join(', '))
check('페이지 에러 없음', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
check('콘솔 에러 없음', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))
const bootText = await page.evaluate(() => document.body.innerText)
check('드롭존 표시', bootText.includes('xsv') && bootText.includes('샘플 데이터'))
await shot('01-empty')

// ===================================================================
group('샘플 데이터 로드')
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((e) => e.textContent.includes('샘플 데이터')).click()
})
await page.waitForSelector('[role=grid]', { timeout: 5000 })
await sleep(400)

const cols = await headerNames()
check('헤더 7개 인식', cols.length === 7, cols.join(','))
check('헤더 내용', cols[0] === '주문번호' && cols[6] === '상태')
check('상태바 10행', (await status()).includes('10'), await status())
check('셀 렌더링 (0,1)', (await cellText(0, 1)) === '김하늘', String(await cellText(0, 1)))
check('인용 안 따옴표 보존', (await cellText(2, 2)) === '모니터 27" QHD', String(await cellText(2, 2)))
check('인용 안 콤마 보존', (await cellText(5, 2)) === '케이블, 1.5m', String(await cellText(5, 2)))

const glyphs = await page.$$eval('.th-glyph', (e) => e.map((x) => x.textContent))
check('숫자 칼럼 타입 추론', glyphs[3] === '#' && glyphs[4] === '#', glyphs.join(''))
check('날짜 칼럼 타입 추론', glyphs[5] === '◷', glyphs.join(''))
check('숫자 칼럼 우측 정렬', (await page.$$('.td[data-type=number]')).length > 0)
// 타입별 색상 — 숫자/날짜 글리프가 서로, 그리고 문자열과 다른 색이어야 한다
const glyphColors = await page.$$eval('.th-glyph', (els) =>
  els.map((e) => ({ t: e.dataset.type, c: getComputedStyle(e).color })),
)
const colorOf = (t) => glyphColors.find((g) => g.t === t)?.c
check(
  '타입별 글리프 색상이 구분됨',
  colorOf('number') !== colorOf('string') &&
    colorOf('date') !== colorOf('string') &&
    colorOf('number') !== colorOf('date'),
  ['number=' + colorOf('number'), 'date=' + colorOf('date'), 'string=' + colorOf('string')].join(' '),
)
check(
  '숫자 셀에 색조 적용',
  (await page.$$eval('.td[data-type=number]', (e) => getComputedStyle(e[0]).color)) !==
    (await page.$$eval('.td[data-type=string]', (e) => getComputedStyle(e[0]).color)),
)
await shot('02-sample')

// ===================================================================
group('스마트 필터')
await page.keyboard.press('Slash')
check(
  '/ 로 필터 포커스',
  await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === '스마트 필터'),
)
await page.keyboard.type('김하늘')
await sleep(450)
check('부분 매치 (김하늘 → 2행)', (await visRows()) === 2, (await visRows()) + '행')
check('건수 배지 표시', (await page.$('.pill')) !== null)
const marks = (await page.$$('.td mark')).length
check('매치 하이라이트', marks > 0, marks + '개')
await shot('03-filter')

await setFilter('김하늘 이준호')
check('OR (공백) → 4행', (await visRows()) === 4, (await visRows()) + '행')
await setFilter('김하늘,취소')
check('AND (콤마) → 1행', (await visRows()) === 1, (await visRows()) + '행')
await setFilter('김하늘&취소')
check('AND (&) → 1행', (await visRows()) === 1, (await visRows()) + '행')

await page.keyboard.down('Alt')
await page.keyboard.press('KeyR')
await page.keyboard.up('Alt')
check('Alt+R 정규식 켜짐', await page.$eval('.re', (e) => e.classList.contains('on')))
await setFilter('^ORD-100[13]$')
check('정규식 필터 → 2행', (await visRows()) === 2, (await visRows()) + '행')
await setFilter('([')
check('잘못된 정규식 → 에러 표시', (await page.$('.err')) !== null)
check('잘못된 정규식은 필터 미적용', (await visRows()) === 10, (await visRows()) + '행')
await page.keyboard.down('Alt')
await page.keyboard.press('KeyR')
await page.keyboard.up('Alt')
check('Alt+R 다시 누르면 꺼짐', await page.$eval('.re', (e) => !e.classList.contains('on')))

await setFilter('김하늘')
await page.click('.pill')
await sleep(250)
check('배지 클릭 → 초기화 (10행)', (await visRows()) === 10, (await visRows()) + '행')

// ===================================================================
group('헤더 클릭 = 열 선택')
let hb = await headerBox(2)
await page.mouse.click(hb.x, hb.y)
await sleep(250)
check('헤더 본문 클릭 → 열 전체 선택', (await page.$$('[role=columnheader].sel')).length === 1)
check('헤더 클릭이 정렬을 걸지 않는다', (await page.$('.th-sort.on')) === null)
check('열 전체 셀이 선택됨 (10행)', (await page.$$('.td.on')).length === 10, (await page.$$('.td.on')).length + '셀')

hb = await headerBox(4)
await page.keyboard.down('Shift')
await page.mouse.click(hb.x, hb.y)
await page.keyboard.up('Shift')
await sleep(250)
check('Shift+헤더 클릭 → 열 구간 선택 (3열)', (await page.$$('[role=columnheader].sel')).length === 3, (await page.$$('[role=columnheader].sel')).length + '열')

hb = await headerBox(0)
await page.keyboard.down('Control')
await page.mouse.click(hb.x, hb.y)
await page.keyboard.up('Control')
await sleep(250)
check('Ctrl+헤더 클릭 → 열 추가 선택 (4열)', (await page.$$('[role=columnheader].sel')).length === 4, (await page.$$('[role=columnheader].sel')).length + '열')

// ===================================================================
group('정렬 (우측 버튼)')
await clickSort(3)
let qty = (await readCol(3)).map(Number)
check(
  '오름차순 정렬',
  qty.every((v, i) => i === 0 || qty[i - 1] <= v),
  qty.join(','),
)
check('정렬 활성 표식', (await page.$('.th-sort.on')) !== null)
check('상태바에 정렬 표시', (await status()).includes('정렬'), await status())

await clickSort(3)
qty = (await readCol(3)).map(Number)
check(
  '내림차순 정렬',
  qty.every((v, i) => i === 0 || qty[i - 1] >= v),
  qty.join(','),
)

await clickSort(3)
check('세 번째 클릭에 해제', (await page.$('.th-sort.on')) === null)

await clickSort(6)
await clickSort(3, true)
check('Shift+정렬 버튼 다중 정렬', (await page.$$('.th-sort.on')).length === 2, (await page.$$('.th-sort.on')).length + '개')
check('우선순위 배지 표시', (await page.$$('.th-sort i')).length === 2)
await shot('04-sort')

await clickText('초기화')
await sleep(250)
check('초기화로 정렬 해제', (await page.$('.th-sort.on')) === null)

// ===================================================================
group('선택')
let p1 = await cellBox(1, 1)
await page.mouse.click(p1.x, p1.y)
check('셀 클릭 선택', (await page.$$('.td.on')).length === 1)
check('활성 셀 표시', (await page.$$('.td.active')).length === 1)

let p2 = await cellBox(3, 3)
await page.mouse.move(p1.x, p1.y)
await page.mouse.down()
await page.mouse.move(p2.x, p2.y, { steps: 8 })
await page.mouse.up()
await sleep(200)
check('드래그 사각 선택 3×3', (await page.$$('.td.on')).length === 9, (await page.$$('.td.on')).length + '셀')
check('상태바에 합계 표시', (await status()).includes('합'), await status())

let p3 = await cellBox(6, 5)
await page.keyboard.down('Control')
await page.mouse.click(p3.x, p3.y)
await page.keyboard.up('Control')
check('Ctrl 클릭 멀티 선택', (await page.$$('.td.on')).length === 10, (await page.$$('.td.on')).length + '셀')

await page.mouse.click(p1.x, p1.y)
await page.keyboard.down('Shift')
await page.mouse.click(p2.x, p2.y)
await page.keyboard.up('Shift')
check('Shift 클릭 확장', (await page.$$('.td.on')).length === 9, (await page.$$('.td.on')).length + '셀')

await selectRowHeader('3')
check('행 번호 클릭 → 행 전체 선택', (await page.$$('[role=rowheader].sel')).length === 1)
await shot('05-select')

await page.click('[role=grid]')
await press('Control+KeyA')
await sleep(200)
check('Ctrl+A 전체 선택 (70셀)', (await status()).includes('70'), await status())

p1 = await cellBox(0, 0)
await page.mouse.click(p1.x, p1.y)
await page.keyboard.press('ArrowDown')
await page.keyboard.press('ArrowRight')
await sleep(150)
check(
  '방향키 이동',
  await page.evaluate(() => {
    const a = document.querySelector('.td.active')
    return a && Math.round(parseFloat(a.parentElement.style.top) / 28) === 1
  }),
)
await page.keyboard.down('Shift')
await page.keyboard.press('ArrowDown')
await page.keyboard.press('ArrowRight')
await page.keyboard.up('Shift')
await sleep(150)
check('Shift+방향키 확장 (4셀)', (await page.$$('.td.on')).length === 4, (await page.$$('.td.on')).length + '셀')

// ===================================================================
group('편집 · Undo/Redo')
p1 = await cellBox(0, 1)
await page.mouse.click(p1.x, p1.y)
await page.keyboard.press('Enter')
check('Enter로 편집 시작', (await page.$('.editor')) !== null)
await press('Control+KeyA')
await page.keyboard.type('편집됨')
await page.keyboard.press('Enter')
await sleep(250)
check('편집 확정', (await cellText(0, 1)) === '편집됨', String(await cellText(0, 1)))
check(
  'Enter 후 아래 셀로 이동',
  await page.evaluate(() => {
    const a = document.querySelector('.td.active')
    return a && Math.round(parseFloat(a.parentElement.style.top) / 28) === 1
  }),
)

await press('Control+KeyZ')
await sleep(250)
check('Ctrl+Z 되돌리기', (await cellText(0, 1)) === '김하늘', String(await cellText(0, 1)))
await press('Control+Shift+KeyZ')
await sleep(250)
check('Ctrl+Shift+Z 다시하기', (await cellText(0, 1)) === '편집됨', String(await cellText(0, 1)))
await press('Control+KeyZ')
await sleep(250)

p1 = await cellBox(0, 1)
await page.mouse.click(p1.x, p1.y)
await page.keyboard.type('X')
check('문자 입력으로 즉시 편집', (await page.$('.editor')) !== null)
await page.keyboard.press('Escape')
await sleep(200)
check('Escape로 편집 취소', (await cellText(0, 1)) === '김하늘', String(await cellText(0, 1)))

p1 = await cellBox(0, 6)
await page.mouse.click(p1.x, p1.y)
await page.keyboard.press('Delete')
await sleep(250)
check('Delete로 내용 비우기', (await cellText(0, 6)) === '', JSON.stringify(await cellText(0, 6)))
await press('Control+KeyZ')
await sleep(250)
check('되돌리기로 복구', (await cellText(0, 6)) === '배송완료', String(await cellText(0, 6)))

p1 = await cellBox(0, 5)
p2 = await cellBox(2, 6)
await page.mouse.move(p1.x, p1.y)
await page.mouse.down()
await page.mouse.move(p2.x, p2.y, { steps: 6 })
await page.mouse.up()
await page.keyboard.press('Delete')
await sleep(250)
check(
  '범위 Delete (6셀 비움)',
  (await cellText(0, 5)) === '' && (await cellText(2, 6)) === '',
  JSON.stringify([await cellText(0, 5), await cellText(2, 6)]),
)
await press('Control+KeyZ')
await sleep(250)
check(
  '범위 Delete가 단일 Undo로 전부 복구',
  (await cellText(0, 5)) !== '' && (await cellText(2, 6)) !== '',
  JSON.stringify([await cellText(0, 5), await cellText(2, 6)]),
)

hb = await headerBox(0)
await page.mouse.click(hb.x, hb.y, { count: 2 })
await sleep(200)
check('헤더 더블클릭 → 이름 편집', (await page.$('.rename')) !== null)
await press('Control+KeyA')
await page.keyboard.type('ORDER_ID')
await page.keyboard.press('Enter')
await sleep(250)
check('헤더명 변경', (await headerNames())[0] === 'ORDER_ID', (await headerNames())[0])
await press('Control+KeyZ')
await sleep(250)
check('헤더명 되돌리기', (await headerNames())[0] === '주문번호', (await headerNames())[0])

// ===================================================================
group('칼럼 필터 드롭다운')
await page.evaluate(() => {
  ;[...document.querySelectorAll('[role=columnheader]')][6].querySelector('.th-filter').click()
})
await page.waitForSelector('[role=dialog]', { timeout: 3000 })
const uniqVals = await page.$$eval('.list .row .val', (e) => e.map((x) => x.textContent.trim()))
check('고유값 목록 표시', uniqVals.length >= 4, uniqVals.join(','))
check('건수 표시', (await page.$$('.list .row .cnt')).length > 0)
check('고유값/조건 두 탭', (await page.$$eval('.tabs button', (e) => e.length)) === 2)
await shot('06-colfilter')

await page.evaluate(() => document.querySelectorAll('.list .row')[0].click())
await page.evaluate(() => {
  ;[...document.querySelectorAll('footer .btn')].find((b) => b.textContent.trim() === '적용').click()
})
await sleep(350)
check('칼럼 필터 적용 → 행 감소', (await visRows()) < 10, (await visRows()) + '행')
check('헤더에 필터 표식', (await page.$$('.th-filter.on')).length === 1)
check('상태바에 칼럼 필터 표시', (await status()).includes('칼럼 필터'), await status())

await clickText('초기화')
await sleep(350)
check('초기화로 해제', (await visRows()) === 10, (await visRows()) + '행')

await page.evaluate(() => {
  ;[...document.querySelectorAll('[role=columnheader]')][4].querySelector('.th-filter').click()
})
await page.waitForSelector('[role=dialog]')
await page.evaluate(() => {
  ;[...document.querySelectorAll('.tabs button')].find((b) => b.textContent.includes('조건')).click()
})
await sleep(150)
await page.type('.text-tab .field', '>100000')
await page.evaluate(() => {
  ;[...document.querySelectorAll('footer .btn')].find((b) => b.textContent.trim() === '적용').click()
})
await sleep(350)
const prices = (await readCol(4)).map(Number)
check(
  '숫자 조건 필터 (>100000)',
  prices.length > 0 && prices.every((v) => v > 100000),
  prices.join(','),
)
await clickText('초기화')
await sleep(300)

// ===================================================================
group('컨텍스트 메뉴 · 행/열 조작')
p1 = await cellBox(1, 1)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]', { timeout: 3000 })
const menuItems = await page.$$eval('[role=menuitem] span:first-child', (e) => e.map((x) => x.textContent))
check('컨텍스트 메뉴 열림', menuItems.length >= 8, menuItems.length + '항목')
check('행 삽입 항목', menuItems.some((m) => m.includes('행 삽입')))
check('열 삽입 항목', menuItems.some((m) => m.includes('열 삽입')))
await shot('07-context')

await clickMenu('위에 행 삽입')
check('행 삽입 → 11행', (await status()).includes('11'), await status())
await press('Control+KeyZ')
await sleep(300)
check('행 삽입 되돌리기 → 10행', (await status()).includes('10'), await status())

p1 = await cellBox(1, 1)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
await clickMenu('오른쪽에 열 삽입')
let names = await headerNames()
check('열 삽입 → 8열, 위치 정확', names.length === 8 && names[2] === '새 칼럼', names.join(','))
await press('Control+KeyZ')
await sleep(350)
names = await headerNames()
check('열 삽입 되돌리기 → 7열', names.length === 7, names.join(','))

await selectRowHeader('2')
const rowBefore = await cellText(1, 0)
p1 = await cellBox(1, 1)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
await clickMenu('행 삭제')
check('행 삭제 → 9행', (await status()).includes('9'), await status())
check('삭제된 행이 사라짐', (await cellText(1, 0)) !== rowBefore, String(await cellText(1, 0)))
await press('Control+KeyZ')
await sleep(350)
check('행 삭제 되돌리기', (await cellText(1, 0)) === rowBefore, String(await cellText(1, 0)))

// ===================================================================
group('빈 열 처리 · 숨기기')
// 빈 열이 포함된 데이터를 붙여넣어 로드한다 (원래 신고된 시나리오)
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('#app *')
await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.setData('text/plain', 'id,비어있음,name,메모\n1,,kim,\n2,,lee,\n3,,park,')
  window.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }))
})
await page.waitForSelector('[role=grid]', { timeout: 5000 })
await sleep(450)
check('빈 열 포함 데이터 로드 (4열)', (await headerNames()).length === 4, (await headerNames()).join(','))

// 빈 열 헤더를 클릭해 선택 → 삭제 (원래는 정렬만 되어 선택이 불가능했다)
hb = await headerBox(1)
await page.mouse.click(hb.x, hb.y)
await sleep(250)
check('빈 열 헤더 클릭으로 선택됨', (await page.$$('[role=columnheader].sel')).length === 1)
p1 = await cellBox(0, 1)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
await clickMenu('열 삭제')
check('빈 열 삭제 성공 (3열)', (await headerNames()).length === 3, (await headerNames()).join(','))
check('삭제된 열이 빈 열이었다', !(await headerNames()).includes('비어있음'), (await headerNames()).join(','))
await press('Control+KeyZ')
await sleep(350)
check('빈 열 삭제 되돌리기 (4열)', (await headerNames()).length === 4, (await headerNames()).join(','))

// 빈 열 모두 숨기기
p1 = await cellBox(0, 0)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
const emptyMenuLabel = await page.$$eval('[role=menuitem] span:first-child', (e) =>
  e.map((x) => x.textContent).find((t) => t.includes('빈 열 모두 숨기기')),
)
check('빈 열 개수를 메뉴에 표시', /\(2\)/.test(emptyMenuLabel ?? ''), String(emptyMenuLabel))
await clickMenu('빈 열 모두 숨기기')
check('빈 열 2개 숨김 → 2열만 보임', (await headerNames()).length === 2, (await headerNames()).join(','))
check('상태바에 열 2/4 표시', (await status()).includes('2') && (await status()).includes('4'), (await status()).slice(0, 50))
check('숨김 배지 표시', (await page.$('.hidden-pill')) !== null)
await shot('13-hidden')

await page.click('.hidden-pill')
await sleep(300)
check('숨김 배지 클릭 → 전체 해제 (4열)', (await headerNames()).length === 4, (await headerNames()).join(','))
check('숨김 배지 사라짐', (await page.$('.hidden-pill')) === null)

// 빈 열 모두 삭제 — 파괴적이라 확인 다이얼로그를 거친다
p1 = await cellBox(0, 0)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
await clickMenu('빈 열 모두 삭제')
check('빈 열 모두 삭제에 확인 다이얼로그', await settleConfirm(true))
check('빈 열 모두 삭제 → 2열', (await headerNames()).length === 2, (await headerNames()).join(','))
await press('Control+KeyZ')
await sleep(350)
check('빈 열 모두 삭제 되돌리기 → 4열', (await headerNames()).length === 4, (await headerNames()).join(','))

// 열 숨기기 (선택한 열)
hb = await headerBox(3)
await page.mouse.click(hb.x, hb.y)
await sleep(200)
p1 = await cellBox(0, 3)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
await clickMenu('열 숨기기')
check('선택한 열 숨기기 → 3열', (await headerNames()).length === 3, (await headerNames()).join(','))
check('숨긴 열이 목록에서 빠짐', !(await headerNames()).includes('메모'), (await headerNames()).join(','))

// 행 숨기기
await selectRowHeader('2')
p1 = await cellBox(1, 0)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
await clickMenu('행 숨기기')
check('선택한 행 숨기기 → 2행', (await visRows()) === 2, (await visRows()) + '행')
check('상태바에 행 2/3 표시', (await status()).includes('3'), (await status()).slice(0, 40))
check('숨김 배지에 열·행 모두 표기', (await page.$eval('.hidden-pill', (e) => e.innerText)).includes('열'), await page.$eval('.hidden-pill', (e) => e.innerText.replace(/\s+/g, ' ')))

await page.click('.hidden-pill')
await sleep(300)
check('숨김 전체 해제 (3행 4열)', (await visRows()) === 3 && (await headerNames()).length === 4, (await visRows()) + '행 ' + (await headerNames()).length + '열')

// 원래 샘플 데이터로 복귀 — 이후 테스트가 이어서 쓴다
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('#app *')
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((e) => e.textContent.includes('샘플 데이터')).click()
})
await page.waitForSelector('[role=grid]')
await sleep(400)

// ===================================================================
group('열 순서 변경 · 폭 조절')
const h0 = await headerBox(0)
const h2 = await headerBox(2)
await page.mouse.move(h0.x, h0.y)
await page.mouse.down()
await page.mouse.move(h2.x, h2.y, { steps: 12 })
await page.mouse.up()
await sleep(350)
names = await headerNames()
check('헤더 드래그로 열 이동', names[0] !== '주문번호' && names.includes('주문번호'), names.join(','))
await press('Control+KeyZ')
await sleep(300)
names = await headerNames()
check('열 이동 되돌리기', names[0] === '주문번호', names.join(','))

const wBefore = await page.$$eval('[role=columnheader]', (e) => e[0].getBoundingClientRect().width)
const edge = await page.evaluate(() => {
  const r = [...document.querySelectorAll('[role=columnheader]')][0].getBoundingClientRect()
  return { x: r.right - 2, y: r.y + r.height / 2 }
})
await page.mouse.move(edge.x, edge.y)
await page.mouse.down()
await page.mouse.move(edge.x + 70, edge.y, { steps: 8 })
await page.mouse.up()
await sleep(300)
const wAfter = await page.$$eval('[role=columnheader]', (e) => e[0].getBoundingClientRect().width)
check('헤더 경계 드래그로 폭 조절', wAfter > wBefore + 50, Math.round(wBefore) + ' -> ' + Math.round(wAfter))

// ===================================================================
group('행 순서 변경')
const dragRow = async (fromLabel, toLabel) => {
  await page.evaluate(
    (f, t) => {
      const all = [...document.querySelectorAll('[role=rowheader]')]
      const a = all.find((e) => e.textContent.trim() === f)
      const b = all.find((e) => e.textContent.trim() === t)
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      const mk = (type, y) =>
        new PointerEvent(type, { bubbles: true, clientX: ra.x + 10, clientY: y, button: 0, pointerId: 7 })
      a.dispatchEvent(mk('pointerdown', ra.y + 10))
      a.dispatchEvent(mk('pointermove', ra.y + 10))
      a.dispatchEvent(mk('pointermove', rb.y + 20))
      a.dispatchEvent(mk('pointerup', rb.y + 20))
    },
    fromLabel,
    toLabel,
  )
  await sleep(380)
}

await clickSort(3)
await dragRow('1', '4')
check('정렬 중 행 이동 차단 + 안내', (await toasts()).includes('정렬'), await toasts())

await clickText('초기화')
await sleep(300)
const firstBefore = await cellText(0, 0)
await dragRow('1', '4')
check('정렬 해제 후 행 이동 동작', (await cellText(0, 0)) !== firstBefore, String(await cellText(0, 0)))
await press('Control+KeyZ')
await sleep(350)
check('행 이동 되돌리기', (await cellText(0, 0)) === firstBefore, String(await cellText(0, 0)))

// ===================================================================
group('복사 · 붙여넣기')
await page.evaluate(() => {
  // 클립보드 권한 없이 검증하기 위해 write/writeText를 가로챈다
  window.__clip = null
  window.__clipHtml = null
  navigator.clipboard.write = async (items) => {
    const it = items[0]
    window.__clip = await (await it.getType('text/plain')).text()
    window.__clipHtml = await (await it.getType('text/html')).text()
  }
  navigator.clipboard.writeText = async (t) => {
    window.__clip = t
  }
})
p1 = await cellBox(0, 1)
p2 = await cellBox(2, 2)
await page.mouse.move(p1.x, p1.y)
await page.mouse.down()
await page.mouse.move(p2.x, p2.y, { steps: 6 })
await page.mouse.up()
await press('Control+KeyC')
await sleep(350)
const clip = await page.evaluate(() => window.__clip)
const clipHtml = await page.evaluate(() => window.__clipHtml)
check('Ctrl+C가 TSV 기록', typeof clip === 'string' && clip.includes('\t'), JSON.stringify(clip?.slice(0, 50)))
check('3행 복사', clip?.split('\n').length === 3, clip?.split('\n').length + '행')
check('text/html 표도 함께 기록', typeof clipHtml === 'string' && clipHtml.startsWith('<table>'), String(clipHtml).slice(0, 36))

p1 = await cellBox(5, 1)
await page.mouse.click(p1.x, p1.y)
// 하드코딩하지 않고 붙여넣기 전 값을 기록해 두고 비교한다
const pasteUndoTargets = [await cellText(5, 1), await cellText(6, 2)]
await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.setData('text/plain', 'AAA\tBBB\nCCC\tDDD')
  document
    .querySelector('[role=grid]')
    .dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
})
await sleep(380)
check(
  '붙여넣기가 블록을 덮어쓴다',
  (await cellText(5, 1)) === 'AAA' && (await cellText(6, 2)) === 'DDD',
  JSON.stringify([await cellText(5, 1), await cellText(6, 2)]),
)
await press('Control+KeyZ')
await sleep(300)
check(
  '붙여넣기 4셀이 단일 Undo로 복구',
  (await cellText(5, 1)) === pasteUndoTargets[0] && (await cellText(6, 2)) === pasteUndoTargets[1],
  JSON.stringify([await cellText(5, 1), await cellText(6, 2)]) + ' 기대 ' + JSON.stringify(pasteUndoTargets),
)

p1 = await cellBox(9, 6)
await page.mouse.click(p1.x, p1.y)
await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.setData('text/plain', 'P\tQ\tR\nS\tT\tU\nV\tW\tX')
  document
    .querySelector('[role=grid]')
    .dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
})
await sleep(420)
check('격자 밖은 잘리고 안내', (await toasts()).includes('잘렸'), await toasts())
check('행 수는 늘지 않음', (await status()).includes('10'), await status())
await press('Control+KeyZ')
await sleep(300)

// ===================================================================
group('내보내기')
await press('Control+KeyE')
await page.waitForSelector('[aria-label=내보내기]', { timeout: 3000 })
const scopeOpts = await page.$$eval('.opt .opt-main', (e) => e.map((x) => x.textContent))
check('범위 3종', scopeOpts.join(',') === '전체,보이는 부분,선택 영역', scopeOpts.join(','))
const fmts = await page.$$eval('.seg button', (e) => e.map((x) => x.textContent.trim()))
check('형식 CSV/TSV/XLSX', fmts.slice(0, 3).join(',') === 'CSV,TSV,XLSX', fmts.join(','))
check('행×열 요약', (await page.$eval('.sum', (e) => e.textContent)).includes('10'), await page.$eval('.sum', (e) => e.textContent))
await shot('08-export')

// Blob을 가로채 실제 생성물을 확인 (다운로드는 막는다)
await page.evaluate(() => {
  window.__blobs = []
  const orig = URL.createObjectURL
  URL.createObjectURL = (b) => {
    window.__blobs.push({ size: b.size, type: b.type })
    b.arrayBuffer().then((ab) => {
      window.__lastMagic = [...new Uint8Array(ab.slice(0, 4))]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('')
      // ignoreBOM: true 가 없으면 TextDecoder가 선두 BOM을 지워버려 BOM 검증이 불가능하다
      window.__lastText = new TextDecoder('utf-8', { ignoreBOM: true }).decode(ab.slice(0, 300))
    })
    return orig.call(URL, b)
  }
  HTMLAnchorElement.prototype.click = function () {}
})
const clickSave = async (label) => {
  await page.evaluate((t) => {
    ;[...document.querySelectorAll('.dlg footer .btn')].find((b) => b.textContent.trim() === t).click()
  }, label)
}
await clickSave('저장')
await sleep(700)
let blobs = await page.evaluate(() => window.__blobs)
const csvHead = await page.evaluate(() => window.__lastText)
check('CSV 파일 생성', blobs.length === 1 && blobs[0].size > 200, JSON.stringify(blobs[0]))
check('CSV에 BOM 포함', csvHead?.charCodeAt(0) === 0xfeff, 'U+' + csvHead?.charCodeAt(0).toString(16))
check('CSV 헤더 행 포함', !!csvHead?.includes('주문번호'), String(csvHead).slice(1, 36))
check('CSV 인용 규칙 적용', !!csvHead?.includes('"모니터 27') || !!csvHead?.includes('"케이블, 1.5m"'), 'ok')

check(
  'XLSX 선택 전에는 SheetJS를 받지 않는다',
  sheetjsRequests.length === 0,
  sheetjsRequests.join(', '),
)
await press('Control+KeyE')
await page.waitForSelector('[aria-label=내보내기]')
await page.evaluate(() => {
  window.__blobs = []
  ;[...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'XLSX').click()
})
await sleep(250)
await clickSave('저장')
// SheetJS를 CDN에서 처음 받아오는 실제 네트워크 왕복이 걸리므로 고정 sleep 대신 완료를 기다린다
await page.waitForFunction(() => window.__blobs && window.__blobs.length > 0, { timeout: 15000 })
await sleep(300) // arrayBuffer() 콜백이 매직바이트를 채울 시간
blobs = await page.evaluate(() => window.__blobs)
const magic = await page.evaluate(() => window.__lastMagic)
check('XLSX 파일 생성', blobs.length === 1 && blobs[0].size > 1000, JSON.stringify(blobs[0]))
check('XLSX ZIP 매직바이트', magic === '504b0304', String(magic))
check(
  'XLSX 내보내기가 SheetJS를 CDN에서 정확히 1건 가져온다',
  sheetjsRequests.length === 1,
  sheetjsRequests.join(', '),
)
check(
  '가져온 주소가 공식 SheetJS CDN',
  sheetjsRequests[0]?.startsWith(SHEETJS_CDN) ?? false,
  sheetjsRequests[0],
)
check(
  'SheetJS 외에 다른 외부 요청은 없다',
  external.length === 0,
  external.slice(0, 3).join(', '),
)

await press('Control+KeyE')
await page.waitForSelector('[aria-label=내보내기]')
await page.evaluate(() => {
  window.__clip = null
  ;[...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'TSV').click()
})
await sleep(200)
await page.evaluate(() => {
  ;[...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === '클립보드').click()
})
await sleep(200)
await clickSave('복사')
await sleep(700)
const expClip = await page.evaluate(() => window.__clip)
check('클립보드로 TSV 내보내기', typeof expClip === 'string' && expClip.includes('주문번호\t'), JSON.stringify(String(expClip).slice(0, 36)))

// ===================================================================
group('찾기 (Ctrl+F)')
await press('Control+KeyF')
await page.waitForSelector('[aria-label=찾기]', { timeout: 3000 })
check('Ctrl+F로 찾기 패널 열림', true)
check(
  '입력에 포커스',
  await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === '찾을 내용'),
)
check('스마트 필터와 별개 레이어', (await page.$('[aria-label=찾기]')) !== null)

await page.keyboard.type('배송중')
await sleep(400)
const findCount = () => page.$eval('[aria-label=찾기] .count', (e) => e.innerText.replace(/\s+/g, ''))
check('매치 수 표시', /\d+\/\d+/.test(await findCount()), await findCount())
check('매치 목록 표시', (await page.$$('[aria-label=찾기] .hit')).length === 3, (await page.$$('[aria-label=찾기] .hit')).length + '건')
check('그리드에 매치 셀 강조', (await page.$$('.td.find-hit')).length > 0, (await page.$$('.td.find-hit')).length + '셀')
check('현재 매치가 구별되어 표시', (await page.$$('.td.find-cur')).length === 1)
await shot('14-find')

// Enter로 다음 매치 순회
const curIdx = () => page.$eval('[aria-label=찾기] .count', (e) => parseInt(e.innerText, 10))
const first = await curIdx()
await page.keyboard.press('Enter')
await sleep(250)
check('Enter로 다음 매치', (await curIdx()) !== first, first + ' → ' + (await curIdx()))
await page.keyboard.down('Shift')
await page.keyboard.press('Enter')
await page.keyboard.up('Shift')
await sleep(250)
check('Shift+Enter로 이전 매치', (await curIdx()) === first, String(await curIdx()))

// 현재 매치가 활성 셀로 이동했는지
check('매치가 활성 셀로 이동', (await page.$$('.td.active')).length === 1)

// 목록에서 선택해 이동
await page.evaluate(() => document.querySelectorAll('[aria-label=찾기] .hit')[2].click())
await sleep(300)
check('목록 클릭으로 이동', (await curIdx()) === 3, String(await curIdx()))

// 정규식 토글
await page.evaluate(() => {
  const t = [...document.querySelectorAll('[aria-label=찾기] .tog')].find((b) => b.textContent.trim() === '.*')
  t.click()
})
await sleep(300)
check('정규식 토글 켜짐', await page.$eval('[aria-label=찾기] .tog', (e) => e.classList.contains('on')))
await page.evaluate(() => {
  const i = document.querySelector('[aria-label="찾을 내용"]')
  i.focus()
  i.value = ''
  i.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.keyboard.type('^ORD-100[12]$')
await sleep(400)
check('정규식 찾기 → 2건', (await page.$$('[aria-label=찾기] .hit')).length === 2, (await page.$$('[aria-label=찾기] .hit')).length + '건')

// 셀 전체 일치
await page.evaluate(() => {
  const i = document.querySelector('[aria-label="찾을 내용"]')
  i.value = ''
  i.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.evaluate(() => {
  const t = [...document.querySelectorAll('[aria-label=찾기] .tog')].find((b) => b.textContent.trim() === '.*')
  t.click()
})
await page.keyboard.type('김하늘')
await sleep(400)
check('부분 일치 → 2건', (await page.$$('[aria-label=찾기] .hit')).length === 2)
await page.evaluate(() => {
  const t = [...document.querySelectorAll('[aria-label=찾기] .tog')].find((b) => b.textContent.trim() === '[·]')
  t.click()
})
await sleep(350)
check('셀 전체 일치도 2건 (정확히 일치)', (await page.$$('[aria-label=찾기] .hit')).length === 2)
await page.evaluate(() => {
  const t = [...document.querySelectorAll('[aria-label=찾기] .tog')].find((b) => b.textContent.trim() === '[·]')
  t.click()
})
await sleep(300)

// 잘못된 정규식
await page.evaluate(() => {
  const i = document.querySelector('[aria-label="찾을 내용"]')
  i.value = ''
  i.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.evaluate(() => {
  const t = [...document.querySelectorAll('[aria-label=찾기] .tog')].find((b) => b.textContent.trim() === '.*')
  t.click()
})
await page.keyboard.type('([')
await sleep(400)
check('잘못된 정규식 → 오류 표시', (await page.$('[aria-label=찾기] .err')) !== null)
await page.evaluate(() => {
  const t = [...document.querySelectorAll('[aria-label=찾기] .tog')].find((b) => b.textContent.trim() === '.*')
  t.click()
})

await page.keyboard.press('Escape')
await sleep(300)
check('Esc로 찾기 닫힘', (await page.$('[aria-label=찾기]')) === null)
check('닫으면 매치 강조도 사라짐', (await page.$$('.td.find-hit')).length === 0)

// ===================================================================
group('바꾸기 (Ctrl+H)')
await press('Control+KeyH')
await page.waitForSelector('[aria-label=바꾸기]', { timeout: 3000 })
check('Ctrl+H로 바꾸기 열림', true)
const rScopes = await page.$$eval('[aria-label=바꾸기] .opt .opt-main', (e) => e.map((x) => x.textContent))
check('적용 범위 3종', rScopes.join(',') === '전체,보이는 부분,선택 영역', rScopes.join(','))

await page.evaluate(() => {
  const inputs = document.querySelectorAll('[aria-label=바꾸기] input.field')
  inputs[0].focus()
})
await page.keyboard.type('배송중')
await sleep(250)
await page.evaluate(() => {
  const inputs = document.querySelectorAll('[aria-label=바꾸기] input.field')
  inputs[1].focus()
})
await page.keyboard.type('발송')
await sleep(300)
const rSum = await page.$eval('[aria-label=바꾸기] .sum', (e) => e.innerText.replace(/\s+/g, ' '))
check('변경 건수 미리보기', rSum.includes('3'), rSum)
check('전/후 예시 표시', (await page.$$('[aria-label=바꾸기] .sample')).length > 0)
await shot('15-replace')

await page.evaluate(() => {
  ;[...document.querySelectorAll('[aria-label=바꾸기] footer .btn')]
    .find((b) => b.textContent.trim() === '모두 바꾸기')
    .click()
})
await sleep(400)
check('바꾸기 적용', (await cellText(1, 6)) === '발송', String(await cellText(1, 6)))
check('바꾸기 다이얼로그 닫힘', (await page.$('[aria-label=바꾸기]')) === null)
await press('Control+KeyZ')
await sleep(350)
check('바꾸기 전체가 단일 Undo로 복구', (await cellText(1, 6)) === '배송중', String(await cellText(1, 6)))

// 정규식 역참조
await press('Control+KeyH')
await page.waitForSelector('[aria-label=바꾸기]')
await page.evaluate(() => {
  ;[...document.querySelectorAll('[aria-label=바꾸기] .tog')]
    .find((b) => b.textContent.includes('정규식'))
    .click()
})
await page.evaluate(() => {
  document.querySelectorAll('[aria-label=바꾸기] input.field')[0].focus()
})
await page.keyboard.type('(\\d{4})-(\\d{2})-(\\d{2})')
await page.evaluate(() => {
  document.querySelectorAll('[aria-label=바꾸기] input.field')[1].focus()
})
await page.keyboard.type('$3.$2.$1')
await sleep(350)
await page.evaluate(() => {
  ;[...document.querySelectorAll('[aria-label=바꾸기] footer .btn')]
    .find((b) => b.textContent.trim() === '모두 바꾸기')
    .click()
})
await sleep(400)
check('정규식 역참조 치환', (await cellText(0, 5)) === '14.01.2026', String(await cellText(0, 5)))
await press('Control+KeyZ')
await sleep(350)
check('역참조 치환 되돌리기', (await cellText(0, 5)) === '2026-01-14', String(await cellText(0, 5)))

// ===================================================================
group('열 나누기 · 결합')
// 나누기: 상품 열을 공백으로 열 방향 분리
hb = await headerBox(2)
await page.mouse.click(hb.x, hb.y)
await sleep(200)
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('도구')).click()
})
await page.waitForSelector('[role=menu]')
await clickMenu('열 나누기')
await page.waitForSelector('[aria-label="열 나누기"]', { timeout: 3000 })
check('열 나누기 다이얼로그 열림', true)
check('대상 열 표시', (await page.$eval('[aria-label="열 나누기"] .target', (e) => e.textContent)) === '상품')

await page.evaluate(() => {
  ;[...document.querySelectorAll('[aria-label="열 나누기"] .chip')]
    .find((b) => b.textContent.trim() === '공백')
    .click()
})
await sleep(350)
check('미리보기 표시', (await page.$$('[aria-label="열 나누기"] .pv-row')).length > 0)
await shot('16-split')
await page.evaluate(() => {
  ;[...document.querySelectorAll('[aria-label="열 나누기"] footer .btn')]
    .find((b) => b.textContent.trim() === '나누기')
    .click()
})
await sleep(500)
names = await headerNames()
check('열로 나누기 적용', names.length > 7 && names.some((n) => n.startsWith('상품 1')), names.join(','))
check('원본 열 유지 (기본)', names.includes('상품'), names.join(','))
await press('Control+KeyZ')
await sleep(400)
check('나누기 되돌리기 → 7열', (await headerNames()).length === 7, (await headerNames()).length + '열')

// 결합: 고객명 + 상태를 결합
hb = await headerBox(1)
await page.mouse.click(hb.x, hb.y)
await sleep(150)
hb = await headerBox(6)
await page.keyboard.down('Control')
await page.mouse.click(hb.x, hb.y)
await page.keyboard.up('Control')
await sleep(200)
check('열 2개 선택', (await page.$$('[role=columnheader].sel')).length === 2)

await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('도구')).click()
})
await page.waitForSelector('[role=menu]')
await clickMenu('열 결합')
await page.waitForSelector('[aria-label="열 결합"]', { timeout: 3000 })
const srcChips = await page.$$eval('[aria-label="열 결합"] .src', (e) => e.map((x) => x.textContent.trim()))
check('결합 대상 표시', srcChips.join('+') === '고객명+상태', srcChips.join('+'))
const joinName = await page.$$eval('[aria-label="열 결합"] input.field', (e) => e[1].value)
check('새 열 이름 자동 제안', joinName === '고객명_상태', joinName)
check('미리보기 표시', (await page.$$('[aria-label="열 결합"] .pv')).length > 0)
const jpv = await page.$eval('[aria-label="열 결합"] .pv', (e) => e.textContent.trim())
check('공백으로 결합', jpv === '김하늘 배송완료', jpv)
await shot('17-join')

await page.evaluate(() => {
  ;[...document.querySelectorAll('[aria-label="열 결합"] footer .btn')]
    .find((b) => b.textContent.trim() === '결합')
    .click()
})
await sleep(500)
names = await headerNames()
check('결합 열 추가 (8열)', names.length === 8 && names.includes('고객명_상태'), names.join(','))
const joinedIdx = names.indexOf('고객명_상태')
check('결합 열 값', (await cellText(0, joinedIdx)) === '김하늘 배송완료', String(await cellText(0, joinedIdx)))
await press('Control+KeyZ')
await sleep(400)
check('결합 되돌리기 → 7열', (await headerNames()).length === 7, (await headerNames()).length + '열')

// ===================================================================
group('공통 다이얼로그 (confirm/alert)')
// 빈 열이 없는 샘플에서 '빈 열 모두 삭제'를 누르면 alert가 떠야 한다
p1 = await cellBox(0, 0)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
const emptyItem = await page.$$eval('[role=menuitem]', (els) =>
  els.map((e) => ({ t: e.textContent, d: e.disabled })).find((x) => x.t.includes('빈 열 모두 삭제')),
)
check('빈 열이 없으면 메뉴 항목 비활성', emptyItem?.d === true, JSON.stringify(emptyItem))
await page.keyboard.press('Escape')
await sleep(200)

// 여러 열 삭제는 confirm을 거친다
hb = await headerBox(0)
await page.mouse.click(hb.x, hb.y)
await sleep(120)
hb = await headerBox(1)
await page.keyboard.down('Control')
await page.mouse.click(hb.x, hb.y)
await page.keyboard.up('Control')
await sleep(200)
p1 = await cellBox(0, 0)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
await clickMenu('열 삭제')
await page.waitForSelector('[role=alertdialog]', { timeout: 3000 })
check('네이티브 아닌 전용 confirm 다이얼로그', true)
check('삭제 대상 개수 표시', (await page.$eval('[role=alertdialog] .dlg-msg', (e) => e.textContent)).includes('2'), await page.$eval('[role=alertdialog] .dlg-msg', (e) => e.textContent))
check('열 이름을 상세로 표시', (await page.$eval('[role=alertdialog] .dlg-detail', (e) => e.textContent)).includes('주문번호'))
check('위험 톤 적용', await page.$eval('[role=alertdialog]', (e) => e.classList.contains('tone-danger')))
await shot('18-confirm')

// 취소하면 아무 일도 없어야 한다
await page.evaluate(() => {
  ;[...document.querySelectorAll('[role=alertdialog] .dlg-btn')]
    .find((b) => b.textContent.trim() === '취소')
    .click()
})
await sleep(300)
check('취소 시 삭제되지 않음', (await headerNames()).length === 7, (await headerNames()).length + '열')
check('다이얼로그 닫힘', (await page.$('[role=alertdialog]')) === null)

// 확인하면 삭제된다
p1 = await cellBox(0, 0)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
await clickMenu('열 삭제')
await page.waitForSelector('[role=alertdialog]')
await page.evaluate(() => {
  ;[...document.querySelectorAll('[role=alertdialog] .dlg-btn.primary')][0].click()
})
await sleep(400)
check('확인 시 2열 삭제 → 5열', (await headerNames()).length === 5, (await headerNames()).length + '열')
await press('Control+KeyZ')
await sleep(400)
check('삭제 되돌리기 → 7열', (await headerNames()).length === 7, (await headerNames()).length + '열')

// Escape로 confirm 취소
hb = await headerBox(0)
await page.mouse.click(hb.x, hb.y)
await sleep(120)
hb = await headerBox(1)
await page.keyboard.down('Control')
await page.mouse.click(hb.x, hb.y)
await page.keyboard.up('Control')
p1 = await cellBox(0, 0)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
await clickMenu('열 삭제')
await page.waitForSelector('[role=alertdialog]')
await page.keyboard.press('Escape')
await sleep(300)
check('Escape로 confirm 취소', (await page.$('[role=alertdialog]')) === null)
check('Escape 취소 후 데이터 유지', (await headerNames()).length === 7)

// ===================================================================
group('열 관리 패널')
await page.keyboard.press('Escape')
await sleep(150)
await clickText('열 관리')
await page.waitForSelector('[aria-label="열 관리"]', { timeout: 3000 })
const cmNames = () => page.$$eval('[aria-label="열 관리"] .item .name', (e) => e.map((x) => x.textContent))
check('전체 열이 목록에 나온다', (await cmNames()).length === 7, (await cmNames()).join(','))
check(
  '처음에는 모두 켜짐',
  (await page.$$('[aria-label="열 관리"] [role=switch][aria-checked=true]')).length === 7,
)
await shot('19-colmanager')

// 스위치를 끄면 그리드에서 즉시 사라진다
await page.evaluate(() => document.querySelectorAll('[aria-label="열 관리"] .item')[1].click())
await sleep(280)
check('토글 off → 6열', (await headerNames()).length === 6, (await headerNames()).join(','))
check('숨긴 열은 그리드에서 빠짐', !(await headerNames()).includes('고객명'), (await headerNames()).join(','))
check(
  '목록에서는 자리를 지킨다',
  (await cmNames()).length === 7 && (await cmNames())[1] === '고객명',
  (await cmNames()).join(','),
)
check(
  '스위치 상태가 aria에 반영',
  await page.evaluate(
    () => document.querySelectorAll('[aria-label="열 관리"] .item')[1].getAttribute('aria-checked') === 'false',
  ),
)
check('푸터에 숨김 개수', (await page.$eval('[aria-label="열 관리"] .hid', (e) => e.textContent)).includes('1'))

// 다시 켜면 원래 자리로 돌아온다
await page.evaluate(() => document.querySelectorAll('[aria-label="열 관리"] .item')[1].click())
await sleep(280)
check(
  '토글 on → 원래 자리 복귀',
  (await headerNames()).length === 7 && (await headerNames())[1] === '고객명',
  (await headerNames()).join(','),
)

// 검색은 목록만 좁히고, 일괄 버튼은 좁혀진 항목에만 작용한다
await page.type('[aria-label="열 관리"] input', '주문')
await sleep(250)
const cmFiltered = await cmNames()
check(
  '검색으로 목록 좁힘',
  cmFiltered.length === 2 && cmFiltered.every((n) => n.includes('주문')),
  cmFiltered.join(','),
)
check(
  '일괄 버튼 라벨이 검색 상태를 반영',
  (await page.$$eval('[aria-label="열 관리"] .bulk button', (e) => e.map((x) => x.textContent.trim()))).some((t) =>
    t.startsWith('표시된 항목'),
  ),
)
await page.evaluate(() => {
  ;[...document.querySelectorAll('[aria-label="열 관리"] .bulk button')]
    .find((b) => b.textContent.includes('숨기기') && !b.textContent.includes('빈 열'))
    .click()
})
await sleep(300)
check(
  '검색된 2열만 숨김 → 5열',
  (await headerNames()).length === 5 && !(await headerNames()).includes('주문일'),
  (await headerNames()).join(','),
)
check('툴바 버튼에 숨김 개수 표시', (await page.$$eval('button', (e) => e.map((x) => x.textContent.trim()))).includes('열 관리 2'))

// 푸터의 '모두 보이기'로 원복
await page.evaluate(() => {
  ;[...document.querySelectorAll('[aria-label="열 관리"] footer button')][0].click()
})
await sleep(300)
check('모두 보이기 → 7열', (await headerNames()).length === 7, (await headerNames()).join(','))
check('푸터가 사라짐', (await page.$('[aria-label="열 관리"] footer')) === null)

// 마지막 남은 열은 숨길 수 없다 (그리드가 빈 화면이 되는 것을 막는다)
await page.evaluate(() => {
  const el = document.querySelector('[aria-label="열 관리"] input')
  el.value = ''
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(200)
await page.evaluate(() => {
  ;[...document.querySelectorAll('[aria-label="열 관리"] .bulk button')]
    .find((b) => b.textContent.includes('모두 숨기기'))
    .click()
})
await sleep(300)
check('모든 열 숨기기는 거부된다', (await headerNames()).length === 7, (await headerNames()).join(','))
check('거부 안내 토스트', (await toasts()).includes('모든 열'), await toasts())

await page.keyboard.press('Escape')
await sleep(250)
check('Escape로 패널 닫힘', (await page.$('[aria-label="열 관리"]')) === null)

// ===================================================================
group('컨텍스트 메뉴 키보드 조작')
p1 = await cellBox(2, 2)
await page.mouse.click(p1.x, p1.y)
await sleep(150)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]', { timeout: 3000 })

/** aria-activedescendant가 짚고 있는 항목의 라벨 */
const menuCursor = () =>
  page.evaluate(() => {
    const id = document.querySelector('[role=menu]')?.getAttribute('aria-activedescendant')
    return id ? (document.getElementById(id)?.querySelector('.lbl')?.textContent ?? '').trim() : null
  })

const accBadges = await page.$$eval('[role=menu] .acc', (e) => e.map((x) => x.textContent))
check('모든 항목에 단축 문자 배지', accBadges.length >= 17, accBadges.length + '개: ' + accBadges.join(''))
check('배지 글자가 중복되지 않는다', new Set(accBadges).size === accBadges.length, accBadges.join(''))
check(
  '배지 없는 실행 항목이 없다',
  (await page.$$('[role=menu] [role=menuitem]')).length === accBadges.length,
  (await page.$$('[role=menu] [role=menuitem]')).length + '항목 / ' + accBadges.length + '배지',
)
check('열자마자 메뉴가 포커스를 가진다', await page.evaluate(() => document.activeElement?.getAttribute('role') === 'menu'))
check('처음에는 짚은 항목 없음', (await menuCursor()) === null, String(await menuCursor()))

await page.keyboard.press('ArrowDown')
await sleep(120)
check('ArrowDown → 첫 항목', (await menuCursor()) === '복사', String(await menuCursor()))

await page.keyboard.press('ArrowDown')
await page.keyboard.press('ArrowDown')
await sleep(150)
check('구분선을 건너뛴다', (await menuCursor())?.startsWith('위에 행 삽입'), String(await menuCursor()))

await page.keyboard.press('End')
await sleep(120)
check('End → 마지막 선택 가능 항목', (await menuCursor())?.startsWith('열 나누기'), String(await menuCursor()))
await page.keyboard.press('ArrowDown')
await sleep(120)
check('마지막에서 ArrowDown → 처음으로 순환', (await menuCursor()) === '복사', String(await menuCursor()))
await page.keyboard.press('ArrowUp')
await sleep(120)
check('처음에서 ArrowUp → 마지막으로 순환', (await menuCursor())?.startsWith('열 나누기'), String(await menuCursor()))

// 비활성 항목은 건너뛴다 — 셀 선택 상태에서는 '열 결합'·'숨김 모두 해제'가 비활성이다
check(
  '비활성 항목은 짚지 않는다',
  !(await menuCursor())?.includes('열 결합') && !(await menuCursor())?.includes('숨김 모두 해제'),
  String(await menuCursor()),
)

// Enter로 실행
await page.keyboard.press('Home')
await page.keyboard.press('ArrowDown')
await page.keyboard.press('ArrowDown')
await sleep(150)
check('Home 후 이동 위치 확인', (await menuCursor())?.startsWith('위에 행 삽입'), String(await menuCursor()))
await page.keyboard.press('Enter')
await sleep(350)
check('Enter로 실행 → 11행', (await status()).includes('11'), await status())
check('실행 후 메뉴 닫힘', (await page.$('[role=menu]')) === null)
await press('Control+KeyZ')
await sleep(350)

// 단축 문자로 바로 실행
p1 = await cellBox(2, 2)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
await page.keyboard.press('KeyB')
await sleep(350)
check('단축 문자 b → 아래에 행 삽입', (await status()).includes('11'), await status())
check('단축 문자 실행 후 메뉴 닫힘', (await page.$('[role=menu]')) === null)
await press('Control+KeyZ')
await sleep(350)
check('되돌리기 → 10행', (await status()).includes('10'), await status())

// 행 번호를 우클릭하면 그 행이 먼저 선택되고, D 한 번으로 삭제까지 간다
await page.evaluate(() => {
  const gt = [...document.querySelectorAll('[role=rowheader]')].find((e) => e.textContent.trim() === '3')
  const r = gt.getBoundingClientRect()
  gt.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: r.x + 10, clientY: r.y + 10 }),
  )
})
await page.waitForSelector('[role=menu]')
check(
  '행 번호 우클릭만으로 그 행이 선택된다',
  (await page.$$('[role=rowheader].sel')).length === 1 && (await status()).includes('선택 7 셀'),
  (await status()).slice(0, 60),
)
check(
  '행 삭제 항목이 활성 상태',
  await page.evaluate(
    () => ![...document.querySelectorAll('[role=menuitem]')].find((b) => b.textContent.includes('행 삭제')).disabled,
  ),
)
const row3Before = await cellText(2, 0)
await page.keyboard.press('KeyD')
await sleep(400)
check('행 번호 우클릭 → D 로 행 삭제', (await status()).includes('9'), await status())
check('삭제된 행이 사라짐', (await cellText(2, 0)) !== row3Before, `${row3Before} → ${await cellText(2, 0)}`)
await press('Control+KeyZ')
await sleep(400)
check('행 삭제 되돌리기 → 10행', (await status()).includes('10'), await status())

// 헤더 우클릭도 같은 방식으로 열을 먼저 선택한다
await page.evaluate(() => {
  const th = [...document.querySelectorAll('[role=columnheader]')][3]
  const r = th.getBoundingClientRect()
  th.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: r.x + 10, clientY: r.y + 10 }),
  )
})
await page.waitForSelector('[role=menu]')
check('헤더 우클릭만으로 그 열이 선택된다', (await page.$$('[role=columnheader].sel')).length === 1)
await page.keyboard.press('KeyI') // 열 숨기기
await sleep(400)
check('헤더 우클릭 → I 로 열 숨기기', (await headerNames()).length === 6, (await headerNames()).join(','))
await page.click('.hidden-pill')
await sleep(300)
check('숨김 해제 → 7열', (await headerNames()).length === 7, (await headerNames()).join(','))

// 비활성 항목의 단축 문자는 무시된다
p1 = await cellBox(2, 2)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
await page.keyboard.press('KeyU') // 숨김 모두 해제 — 숨긴 것이 없어 비활성
await sleep(250)
check('비활성 항목 단축 문자는 무시', (await page.$('[role=menu]')) !== null)
await page.keyboard.press('Escape')
await sleep(200)
check('Escape로 메뉴 닫힘', (await page.$('[role=menu]')) === null)

// 메뉴가 열려 있는 동안 키가 그리드로 새지 않는다
const cellBefore = await cellText(2, 2)
p1 = await cellBox(2, 2)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
await page.keyboard.press('KeyZ') // 어떤 항목에도 없는 문자
await sleep(200)
await page.keyboard.press('Escape')
await sleep(200)
check('메뉴 중 키 입력이 셀 편집을 시작하지 않는다', (await cellText(2, 2)) === cellBefore, String(await cellText(2, 2)))

// ===================================================================
group('도움말 · 테마 · 헤더행')
await page.click('[role=grid]')
await page.keyboard.press('?')
await page.waitForSelector('[aria-label=단축키]', { timeout: 3000 })
const helpRows = await page.$$eval('[aria-label=단축키] .row', (e) => e.length)
check('? 로 도움말 열림', helpRows > 25, helpRows + '개 항목')
const helpText = await page.$eval('[aria-label=단축키]', (e) => e.innerText)
check('우클릭 메뉴 단축 문자 표가 있다', helpText.includes('한 글자 실행'), '')
check(
  '키 칩이 빈 것 없이 렌더된다',
  (await page.$$eval('[aria-label=단축키] .kbd', (e) => e.filter((x) => x.textContent.trim() === '').length)) === 0,
)
await shot('09-help')
await page.keyboard.press('Escape')
await sleep(250)
check('Escape로 닫힘', (await page.$('[aria-label=단축키]')) === null)

const toggleTheme = () =>
  page.evaluate(() => {
    // aria-label에 현재 상태가 들어가므로 접두사로 찾는다
    ;[...document.querySelectorAll('button')]
      .find((b) => (b.getAttribute('aria-label') ?? '').startsWith('테마'))
      .click()
  })
// 기본값은 시스템 설정을 따른다. Chrome은 기본이 라이트 선호이므로 라이트로 해석되어야 한다.
const savedPref = await page.evaluate(() => localStorage.getItem('xsv.themePref'))
check('테마 기본 선호 = system', savedPref === null || savedPref === '"system"', String(savedPref))
const sysResolved = await page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
}))
check(
  '시스템 선호와 해석된 테마가 일치',
  sysResolved.theme === (sysResolved.prefersDark ? 'dark' : 'light'),
  JSON.stringify(sysResolved),
)

// system → light → dark → system 순환
const cycle = []
for (let i = 0; i < 4; i++) {
  cycle.push(await page.evaluate(() => document.documentElement.dataset.theme))
  await toggleTheme()
  await sleep(220)
}
check('테마 3상태 순환이 원위치로 돌아온다', cycle[0] === cycle[3], cycle.join(' -> '))
const themes = new Set(cycle.slice(0, 3))
check('라이트·다크 모두 거친다', themes.has('light') && themes.has('dark'), [...themes].join(','))

// 라이트 상태로 맞춘 뒤 스크린샷
while ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'light') {
  await toggleTheme()
  await sleep(220)
}
const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
check('라이트 테마 색 적용', lightBg !== 'rgb(13, 15, 18)', lightBg)
await shot('10-light')
while ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'dark') {
  await toggleTheme()
  await sleep(220)
}

const hdrBefore = (await headerNames())[0]
await clickText('헤더행')
await sleep(420)
check('헤더행 토글 → A,B,C', (await headerNames())[0] === 'A', (await headerNames()).slice(0, 3).join(','))
check('헤더가 데이터 행이 됨 (11행)', (await status()).includes('11'), await status())
await clickText('헤더행')
await sleep(420)
check('헤더행 토글 복귀', (await headerNames())[0] === hdrBefore, (await headerNames())[0])

// ===================================================================
group('문서 저장 · 열기 (IndexedDB)')
// puppeteer는 실행마다 새 프로필을 쓰므로 여기서부터 IndexedDB는 항상 빈 상태다.

/** 툴바의 "문서" 드롭다운을 연다. 체브런 SVG가 딸려 있어 textContent가 정확히 일치하지 않는다. */
const openDocDropdown = async () => {
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.toolbar button')]
      .find((b) => b.textContent.trim().startsWith('문서'))
      .click()
  })
  await sleep(200)
}

/** 공통 prompt 다이얼로그 입력을 전체 선택 후 덮어쓰고 확인을 누른다. */
const fillPrompt = async (text) => {
  await page.waitForSelector('[role=alertdialog] input', { timeout: 3000 })
  await sleep(150) // DialogHost의 focus+select가 requestAnimationFrame 뒤에 일어난다
  await page.click('[role=alertdialog] input')
  await press('Control+KeyA') // 기본값(제안된 이름)을 전부 선택 — 타이핑이 덮어쓰게 한다
  if (text) await page.keyboard.type(text)
  else await page.keyboard.press('Backspace')
  await page.evaluate(() => document.querySelector('[role=alertdialog] .dlg-btn.primary')?.click())
  await sleep(350)
}

// 첫 저장 — 알려진 문서가 없으므로 이름 프롬프트가 뜬다
await openDocDropdown()
await clickMenu('저장')
await page.waitForSelector('[role=alertdialog]', { timeout: 3000 })
check('첫 저장은 이름 프롬프트를 띄운다', true)
await fillPrompt('테스트문서')
await sleep(200)
check('저장 성공 토스트', (await toasts()).includes('테스트문서'), await toasts())
check('상태바에 문서 이름 표시', (await status()).includes('테스트문서'), await status())

// 편집 → dirty 표시
p1 = await cellBox(0, 1)
await page.mouse.click(p1.x, p1.y)
await page.keyboard.press('Enter')
await press('Control+KeyA')
await page.keyboard.type('dirty체크')
await page.keyboard.press('Enter')
await sleep(250)
check('편집 후 dirty 표시(●)', (await status()).includes('●'), await status())

// Ctrl+S — 이미 알려진 문서라 프롬프트 없이 조용히 덮어쓴다
await press('Control+KeyS')
await sleep(400)
check('Ctrl+S는 프롬프트를 띄우지 않는다', (await page.$('[role=alertdialog]')) === null)
check('덮어쓴 후 dirty 해제', !(await status()).includes('●'), await status())

// 열 순서 변경 + 열 숨김 + 스마트 필터 적용 — 이 중 열 순서만 "열 상태"로 저장되고,
// 숨김·필터는 "뷰 상태"라 저장되지 않아야 한다
const h0b = await headerBox(0)
const h2b = await headerBox(2)
await page.mouse.move(h0b.x, h0b.y)
await page.mouse.down()
await page.mouse.move(h2b.x, h2b.y, { steps: 12 })
await page.mouse.up()
await sleep(350)
const orderAfterDrag = await headerNames()
check('열 순서 변경됨', orderAfterDrag[0] !== '주문번호', orderAfterDrag.join(','))

hb = await headerBox(1)
await page.mouse.click(hb.x, hb.y)
await sleep(150)
p1 = await cellBox(0, 1)
await page.mouse.click(p1.x, p1.y, { button: 'right' })
await page.waitForSelector('[role=menu]')
await clickMenu('열 숨기기')
await sleep(200)
check('열 숨기기 적용', (await headerNames()).length === orderAfterDrag.length - 1, (await headerNames()).join(','))

await setFilter('김하늘')
await sleep(300)

await press('Control+KeyS')
await sleep(400)
check('열 순서 변경 후에도 Ctrl+S는 덮어쓴다', (await page.$('[role=alertdialog]')) === null)

// 새로고침 — 지금까지의 인메모리 상태를 모두 버리고 IndexedDB에서만 복원한다
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('#app *')
await page.waitForFunction(() => [...document.querySelectorAll('.doc-item')].some((b) => b.textContent.includes('테스트문서')), { timeout: 5000, polling: 100 })
check('새로고침 후 DropZone에 저장된 문서 표시', true)
await page.evaluate(() => {
  ;[...document.querySelectorAll('.doc-item')].find((b) => b.textContent.includes('테스트문서')).click()
})
await page.waitForSelector('[role=grid]', { timeout: 5000 })
await sleep(300)

check('복원: 7열', (await headerNames()).length === 7, (await headerNames()).join(','))
check('복원: 10행', (await status()).includes('10'), await status())
check('복원: 열 순서 유지 (colOrder는 저장된다)', JSON.stringify(await headerNames()) === JSON.stringify(orderAfterDrag), (await headerNames()).join(','))
check('복원: 숨김은 저장되지 않는다', !(await status()).includes('/'), await status())
const filterVal = await page.$eval('input[aria-label="스마트 필터"]', (e) => e.value)
check('복원: 스마트 필터는 저장되지 않는다', filterVal === '', JSON.stringify(filterVal))
const custIdx = (await headerNames()).indexOf('고객명')
check('복원: 편집한 값 유지', (await cellText(0, custIdx)) === 'dirty체크', String(await cellText(0, custIdx)))

// 다른 이름으로 저장 — 같은 이름을 다시 입력하면 덮어쓰기 확인을 거친다
await press('Control+Shift+KeyS')
await page.waitForSelector('[role=alertdialog] input', { timeout: 3000 })
await fillPrompt('테스트문서') // 지금 열려 있는 문서와 같은 이름
await page.waitForSelector('[role=alertdialog]', { timeout: 3000 })
check('중복 이름 확인 대화상자 등장', (await page.$eval('[role=alertdialog] .dlg-msg', (e) => e.textContent)).includes('테스트문서'))
await settleConfirm(false) // 취소 — 이름 프롬프트가 다시 뜬다
await fillPrompt('테스트문서2')
await sleep(300)
check('다른 이름으로 저장 성공', (await toasts()).includes('테스트문서2'), await toasts())

await openDocDropdown()
const openItemLabel = await page.$$eval('[role=menuitem]', (els) =>
  els.map((e) => e.textContent).find((t) => t.includes('문서 열기')),
)
check('문서 메뉴에 저장된 문서 수 표시', openItemLabel?.includes('(2)'), openItemLabel)
await clickMenu('문서 열기')
await page.waitForSelector('[aria-label="저장된 문서"]', { timeout: 3000 })

const pickerRows = await page.$$eval('[aria-label="저장된 문서"] .name', (els) => els.map((e) => e.textContent.trim()))
check('피커에 문서 2개 표시', pickerRows.length === 2, pickerRows.join(','))
const currentBadges = await page.$$eval('[aria-label="저장된 문서"] .tag', (els) =>
  els.filter((e) => e.textContent.trim() === '현재').length,
)
check('현재 배지 1개', currentBadges === 1, String(currentBadges))

await page.evaluate(() => {
  const row = [...document.querySelectorAll('[aria-label="저장된 문서"] .row')].find((r) =>
    r.querySelector('.name').textContent.trim() === '테스트문서',
  )
  row.querySelector('.del').click()
})
await page.waitForSelector('[role=alertdialog]', { timeout: 3000 })
check('삭제 확인 대화상자 등장', true)
await settleConfirm(true)
await sleep(300)
const pickerRowsAfter = await page.$$eval('[aria-label="저장된 문서"] .name', (els) => els.map((e) => e.textContent.trim()))
check('삭제 후 1개로 감소', pickerRowsAfter.length === 1 && pickerRowsAfter[0] === '테스트문서2', pickerRowsAfter.join(','))

await page.keyboard.press('Escape')
await sleep(250)
check('Escape로 피커 닫힘', (await page.$('[aria-label="저장된 문서"]')) === null)

// ===================================================================
group('대용량 (10만 행 × 25열, 28MB)')
if (!existsSync(FIXTURE)) {
  check('fixture 존재', false, 'node fixtures/gen.mjs 100000 25 > fixtures/big.csv 실행 필요')
} else {
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('#app *')
  const input = await page.$('input[type=file]')
  const t0 = Date.now()
  await input.uploadFile(FIXTURE)
  await page.waitForFunction(() => document.querySelector('.bar')?.innerText.includes('100,000'), {
    timeout: 60000,
    polling: 100,
  })
  const loadMs = Date.now() - t0
  check('10만 행 로드 완료', true, loadMs + 'ms')
  check('로드 5초 이내', loadMs < 5000, loadMs + 'ms')

  const st = await status()
  check('상태바 100,000행 · 25열', st.includes('100,000') && st.includes('25'), st.slice(0, 76))

  // 문서 저장을 텍스트 직렬화로 하기로 한 결정의 실측 증거: 대용량에서도 저장/복원이
  // 되고, 그 소요 시간이 감내할 만한지를 여기서 잰다.
  const docSaveT0 = Date.now()
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.toolbar button')]
      .find((b) => b.textContent.trim().startsWith('문서'))
      .click()
  })
  await sleep(150)
  await page.evaluate(() => {
    ;[...document.querySelectorAll('[role=menuitem]')].find((b) => b.textContent.includes('저장')).click()
  })
  await page.waitForSelector('[role=alertdialog] input', { timeout: 5000 })
  await sleep(150)
  await page.click('[role=alertdialog] input')
  await press('Control+KeyA')
  await page.keyboard.type('대용량문서')
  await page.evaluate(() => document.querySelector('[role=alertdialog] .dlg-btn.primary').click())
  await page.waitForFunction(
    () => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('대용량문서')),
    { timeout: 20000, polling: 100 },
  )
  const docSaveMs = Date.now() - docSaveT0
  check('10만 행 문서 저장 완료', true, docSaveMs + 'ms')
  check('10만 행 문서 저장 15초 이내', docSaveMs < 15000, docSaveMs + 'ms')

  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('#app *')
  await page.waitForFunction(
    () => [...document.querySelectorAll('.doc-item')].some((b) => b.textContent.includes('대용량문서')),
    { timeout: 8000, polling: 100 },
  )
  const docOpenT0 = Date.now()
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.doc-item')].find((b) => b.textContent.includes('대용량문서')).click()
  })
  await page.waitForFunction(() => document.querySelector('.bar')?.innerText.includes('100,000'), {
    timeout: 60000,
    polling: 100,
  })
  const docOpenMs = Date.now() - docOpenT0
  check('10만 행 문서 열기 완료', true, docOpenMs + 'ms')
  const stReopened = await status()
  check(
    '재오픈 후 상태바 100,000행 · 25열',
    stReopened.includes('100,000') && stReopened.includes('25'),
    stReopened.slice(0, 76),
  )

  const domRows = await page.$$eval('.canvas .tr', (e) => e.length)
  const domCells = await page.$$eval('.canvas .td', (e) => e.length)
  check('행 가상화 (DOM 행 < 60)', domRows < 60, domRows + '행')
  check('열 가상화 (DOM 셀 < 1500)', domCells < 1500, domCells + '셀 / 250만 논리셀')

  /**
   * 프레임당 `px`만큼 스크롤하며 프레임 간격을 측정한다.
   * 60fps의 프레임 예산은 16.7ms이므로, 중앙값이 그 근처면 렌더가 병목이 아니라는 뜻이다.
   */
  const scrollBench = (px) =>
    page.evaluate(async (step) => {
      const body = document.querySelector('.body')
      body.scrollTop = 0
      await new Promise((r) => requestAnimationFrame(r))
      const frames = []
      let last = performance.now()
      let raf = requestAnimationFrame(function tick() {
        const now = performance.now()
        frames.push(now - last)
        last = now
        raf = requestAnimationFrame(tick)
      })
      for (let i = 0; i < 70; i++) {
        body.scrollTop += step
        await new Promise((r) => requestAnimationFrame(r))
      }
      cancelAnimationFrame(raf)
      frames.shift()
      frames.sort((a, b) => a - b)
      return {
        median: frames[Math.floor(frames.length / 2)],
        p95: frames[Math.floor(frames.length * 0.95)],
      }
    }, px)

  // 일반적인 휠 스크롤 (프레임당 3행)
  const slow = await scrollBench(84)
  check('일반 스크롤 중앙값 ~60fps (< 20ms)', slow.median < 20, slow.median.toFixed(1) + 'ms')
  check('일반 스크롤 p95 < 25ms', slow.p95 < 25, slow.p95.toFixed(1) + 'ms')

  // 빠른 휠 스크롤 (프레임당 10행)
  const fast = await scrollBench(280)
  check('빠른 스크롤 중앙값 < 22ms', fast.median < 22, fast.median.toFixed(1) + 'ms')

  // 극단적 플링 — 매 프레임 화면 전체(32행)가 교체되는 최악의 경우.
  // 이때는 재사용할 행이 없어 30fps 수준이 되는 것이 구조적으로 정상이다.
  const fling = await scrollBench(900)
  check('극단 플링(화면 전체 교체) < 40ms', fling.median < 40, fling.median.toFixed(1) + 'ms')
  check('깊은 스크롤 후에도 렌더 유지', (await page.$$eval('.canvas .tr', (e) => e.length)) > 5)
  await shot('11-big-scrolled')

  const aligned = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('.canvas .tr')]
      .map((e) => parseFloat(e.style.top))
      .sort((a, b) => a - b)[0]
    const gt = [...document.querySelectorAll('[role=rowheader]')]
      .map((e) => parseFloat(e.style.top))
      .sort((a, b) => a - b)[0]
    return Math.abs(tr - gt)
  })
  check('거터와 본문 행 정렬 일치', aligned < 28, '차이 ' + aligned + 'px')

  await page.keyboard.press('Slash')
  await page.keyboard.type('노이즈캔슬링')
  const tf = Date.now()
  await page.waitForFunction(
    () => {
      const t = document.querySelector('.bar')?.innerText ?? ''
      return t.includes('/') && !t.trim().startsWith('100,000')
    },
    { timeout: 15000, polling: 50 },
  )
  const filterMs = Date.now() - tf
  check('10만 행 필터 응답 1.5초 내 (디바운스 250ms 포함)', filterMs < 1500, filterMs + 'ms')
  const perfText = await page.$eval('.bar', (e) => e.innerText)
  check('상태바에 필터 소요시간 노출', perfText.includes('필터'), (perfText.match(/필터[^\n·]*/) ?? [''])[0])
  check('대용량에서도 하이라이트 동작', (await page.$$('.td mark')).length > 0)
  await shot('12-big-filter')

  await page.click('[role=grid]')
  const ts = Date.now()
  await clickSort(1)
  await page.waitForFunction(() => document.querySelector('.th-sort.on') !== null, { timeout: 15000 })
  check('10만 행 정렬 2초 이내', Date.now() - ts < 2000, Date.now() - ts + 'ms')

  await press('Control+KeyA')
  await sleep(900)
  check('대용량 Ctrl+A 후에도 응답', (await status()).includes('선택'), (await status()).slice(0, 70))
}

// ===================================================================
group('거터 · 헤더 휠 스크롤')
// 스크롤이 생길 만큼의 데이터를 붙여넣는다
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('#app *')
await page.evaluate(() => {
  const cols = 12
  const head = Array.from({ length: cols }, (_, c) => `아주긴칼럼이름${c}`).join(',')
  const body = Array.from({ length: 400 }, (_, r) =>
    Array.from({ length: cols }, (_, c) => `값-${r}-${c}`).join(','),
  ).join('\n')
  const dt = new DataTransfer()
  dt.setData('text/plain', head + '\n' + body)
  window.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }))
})
await page.waitForSelector('[role=grid]', { timeout: 5000 })
await sleep(450)

const scrollState = () =>
  page.evaluate(() => {
    const b = document.querySelector('.body')
    const gt = document.querySelector('.gut-track')
    const ht = document.querySelector('.head-track')
    return {
      top: b.scrollTop,
      left: b.scrollLeft,
      gut: gt.style.transform,
      head: ht.style.transform,
      scrollableY: b.scrollHeight > b.clientHeight + 10,
      scrollableX: b.scrollWidth > b.clientWidth + 10,
    }
  })

let ss = await scrollState()
check('세로·가로 모두 스크롤 가능한 상태', ss.scrollableY && ss.scrollableX, JSON.stringify(ss))

/** 지정한 요소 위로 커서를 옮겨 실제 휠을 굴린다 */
const wheelOver = async (sel, delta) => {
  const at = await page.$eval(sel, (e) => {
    const r = e.getBoundingClientRect()
    return { x: r.x + Math.min(14, r.width / 2), y: r.y + Math.min(70, r.height / 2) }
  })
  await page.mouse.move(at.x, at.y)
  await page.mouse.wheel(delta)
  await sleep(250)
}

// 행 번호 거터 위에서 세로 휠 — 원래 보고된 버그
await wheelOver('.gut-clip', { deltaY: 420 })
ss = await scrollState()
check('행 번호 거터에서 세로 휠 → 본문 스크롤', ss.top > 100, 'scrollTop=' + ss.top)
check('거터도 함께 따라온다', ss.gut.includes('-' + Math.round(ss.top)) || ss.gut !== 'none', ss.gut)

const topAfterGutter = ss.top
await wheelOver('.gut-clip', { deltaY: -420 })
ss = await scrollState()
check('거터에서 역방향 휠도 동작', ss.top < topAfterGutter, `${topAfterGutter} → ${ss.top}`)

// 헤더 위에서 가로 휠
await wheelOver('.head-clip', { deltaX: 300 })
ss = await scrollState()
check('헤더에서 가로 휠 → 본문 가로 스크롤', ss.left > 50, 'scrollLeft=' + ss.left)
check('헤더 트랙도 함께 따라온다', ss.head.includes('-' + Math.round(ss.left)) || ss.head !== 'none', ss.head)

// 거터/헤더 자체는 스크롤 컨테이너가 아니어야 한다 (전용 스크롤바가 생기면 어긋난다)
const noOwnScroll = await page.evaluate(() => {
  const g = document.querySelector('.gut-clip')
  const h = document.querySelector('.head-clip')
  return g.scrollTop === 0 && h.scrollLeft === 0
})
check('거터·헤더는 자체 스크롤을 갖지 않는다', noOwnScroll)

// 본문 위 휠은 당연히 동작해야 한다 (전달 로직이 본문을 망가뜨리지 않았는지)
const beforeBody = (await scrollState()).top
await wheelOver('.body', { deltaY: 300 })
check('본문 휠은 그대로 동작', (await scrollState()).top > beforeBody, `${beforeBody} → ${(await scrollState()).top}`)

// ===================================================================
group('최종')
check('전 과정 예상 밖 외부 요청 0건', external.length === 0, external.slice(0, 3).join(', '))
check(
  '전 과정 통틀어 SheetJS는 XLSX 내보내기 그 한 번만 받아온다',
  sheetjsRequests.length === 1,
  sheetjsRequests.length + '건: ' + sheetjsRequests.join(', '),
)
check('전 과정 페이지 에러 없음', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
check('전 과정 콘솔 에러 없음', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log('\n' + '='.repeat(60))
console.log(results.length - failed.length + '/' + results.length + ' 통과')
if (failed.length > 0) {
  console.log('\n실패:')
  for (const f of failed) console.log('  [' + f.group + '] ' + f.name)
}
if (wantShots) console.log('\n스크린샷: ' + SHOTS)
process.exit(failed.length === 0 ? 0 : 1)
