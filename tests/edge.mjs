#!/usr/bin/env node
/**
 * 극단 입력 검증 — 실제 Chrome에서 `dist/index.html`을 열고 까다로운 파일을 먹여 본다.
 *
 *   npm run build && node tests/edge.mjs
 *
 * cp949 인코딩, 500칼럼, 매우 긴 셀, 전부 빈 칼럼, 헤더 없는 파일, 엑셀 통합 문서, 그리고
 * 내보낸 CSV를 다시 불러 원본과 같은지(라운드트립) 확인한다.
 *
 * 엑셀 구간만은 SheetJS를 CDN에서 받으므로 **인터넷 연결이 필요하다**(그 외 전부 오프라인).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import * as XLSX from 'xlsx'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DIST = resolve('dist/index.html')
const TMP = resolve('.edge-tmp')
if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + name + (detail ? '  - ' + detail : ''))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- 픽스처 만들기 ---

/** cp949(EUC-KR)로 인코딩된 CSV. Node에 euc-kr 인코더가 없으니 바이트를 직접 만든다. */
function cp949Fixture() {
  // '이름,값' / '한글,1' / '가나다,2' 를 cp949 바이트로
  const B = (...b) => Buffer.from(b)
  const 이름 = B(0xc0, 0xcc, 0xb8, 0xa7) // 이름
  const 값 = B(0xb0, 0xaa) // 값
  const 한글 = B(0xc7, 0xd1, 0xb1, 0xdb) // 한글
  const 가나다 = B(0xb0, 0xa1, 0xb3, 0xaa, 0xb4, 0xd9) // 가나다
  const C = B(0x2c) // ,
  const NL = B(0x0a)
  return Buffer.concat([
    이름, C, 값, NL,
    한글, C, B(0x31), NL,
    가나다, C, B(0x32), NL,
  ])
}

const files = {
  'cp949.csv': cp949Fixture(),
  'wide.csv': (() => {
    const N = 500
    const head = Array.from({ length: N }, (_, i) => 'col_' + i).join(',')
    const row = (r) => Array.from({ length: N }, (_, i) => r * N + i).join(',')
    return Buffer.from([head, row(0), row(1), row(2)].join('\n'), 'utf8')
  })(),
  'gnarly.csv': Buffer.from(
    [
      'id,long,empty,quoted,tabbed',
      '1,' + 'x'.repeat(4000) + ',,"has, comma and ""quotes""","tab\there"',
      '2,short,,"multi\nline value",plain',
      '3,,,"",',
    ].join('\r\n'),
    'utf8',
  ),
  'noheader.csv': Buffer.from('1,2,3\n4,5,6\n7,8,9\n', 'utf8'),
  'onecol.csv': Buffer.from('alpha\nbeta\ngamma\n', 'utf8'),
  'semicolon.csv': Buffer.from('a;b;c\n1;2;3\n4;5;6\n', 'utf8'),
  // 시트 3장: 서식 있는 데이터 / 앞자리 0·불리언 / 빈 시트
  'book.xlsx': (() => {
    const wb = XLSX.utils.book_new()
    const s1 = XLSX.utils.aoa_to_sheet([
      ['이름', '단가', '주문일'],
      ['김하늘', 89000, new Date(Date.UTC(2026, 0, 14))],
      ['이준호', 42500, new Date(Date.UTC(2026, 0, 15))],
    ])
    s1.B2.z = s1.B3.z = '#,##0'
    s1.C2.z = s1.C3.z = 'yyyy-mm-dd'
    XLSX.utils.book_append_sheet(wb, s1, '주문')
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['code', 'flag'],
        ['007', true],
      ]),
      '두번째',
    )
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), '빈시트')
    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer', cellDates: true })
  })(),
}
// 확장자가 .csv인 진짜 엑셀 파일 — 매직 바이트 판정이 이기는지 본다
files['mislabeled.csv'] = files['book.xlsx']
for (const [name, buf] of Object.entries(files)) writeFileSync(resolve(TMP, name), buf)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--allow-file-access-from-files'],
  defaultViewport: { width: 1400, height: 900 },
})
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

const status = () => page.$eval('.bar', (e) => e.innerText.replace(/\s+/g, ' '))
const headerNames = () => page.$$eval('.th-name', (e) => e.map((x) => x.textContent.trim()))
const cellText = (row, col) =>
  page.evaluate(
    (r, c) => {
      const tr = [...document.querySelectorAll('.canvas .tr')].find(
        (el) => Math.round(parseFloat(el.style.top) / 28) === r,
      )
      if (!tr) return null
      // 가로 가상화 때문에 첫 렌더 셀이 0열이 아닐 수 있다
      const tds = [...tr.querySelectorAll('.td')]
      const first = Math.round(parseFloat(tds[0].style.left))
      void first
      return tds[c]?.textContent ?? null
    },
    row,
    col,
  )

async function load(name) {
  await page.goto(pathToFileURL(DIST).href, { waitUntil: 'load' })
  await page.waitForSelector('#app *')
  const input = await page.$('input[type=file]')
  await input.uploadFile(resolve(TMP, name))
  await page.waitForSelector('[role=grid]', { timeout: 20000 })
  await sleep(500)
}

// ===================================================================
console.log('\n[cp949 인코딩 폴백]')
await load('cp949.csv')
check('cp949 자동 감지', (await status()).includes('cp949'), await status())
check('한글이 깨지지 않음', (await headerNames()).join(',') === '이름,값', (await headerNames()).join(','))
check('데이터 한글 정상', (await cellText(0, 0)) === '한글', String(await cellText(0, 0)))
check('두 번째 행도 정상', (await cellText(1, 0)) === '가나다', String(await cellText(1, 0)))

console.log('\n[500 칼럼]')
await load('wide.csv')
check('500열 인식', (await status()).includes('500'), (await status()).slice(0, 60))
const domCells500 = await page.$$eval('.canvas .td', (e) => e.length)
check('열 가상화로 DOM 셀 억제', domCells500 < 400, domCells500 + '셀 (전체 1,500)')
// 맨 오른쪽까지 스크롤해도 렌더되는지
await page.evaluate(() => {
  const b = document.querySelector('.body')
  b.scrollLeft = b.scrollWidth
  b.dispatchEvent(new Event('scroll'))
})
await sleep(300)
const lastHeaders = await headerNames()
check('마지막 칼럼까지 존재', lastHeaders[lastHeaders.length - 1] === 'col_499', lastHeaders[lastHeaders.length - 1])
check('가로 스크롤 후에도 셀 렌더', (await page.$$eval('.canvas .td', (e) => e.length)) > 0)

console.log('\n[까다로운 값]')
await load('gnarly.csv')
check('CRLF 처리 (3행)', (await status()).includes('3'), (await status()).slice(0, 40))
check('인용 안 콤마·따옴표', (await cellText(0, 3)) === 'has, comma and "quotes"', String(await cellText(0, 3)))
check('셀 안 탭 보존', (await cellText(0, 4)) === 'tab\there', JSON.stringify(await cellText(0, 4)))
check('인용 안 개행 보존', (await cellText(1, 3)) === 'multi\nline value', JSON.stringify(await cellText(1, 3)))
check('4000자 긴 셀도 렌더', ((await cellText(0, 1)) ?? '').length === 4000, String(((await cellText(0, 1)) ?? '').length) + '자')
check('전부 빈 칼럼은 string 타입', (await page.$$eval('.th-glyph', (e) => e.map((x) => x.textContent)))[2] === 'T')

console.log('\n[헤더 없는 파일]')
await load('noheader.csv')
check('헤더 없음으로 판단 → A,B,C', (await headerNames()).join(',') === 'A,B,C', (await headerNames()).join(','))
check('1행도 데이터로 (3행)', (await status()).includes('3'), (await status()).slice(0, 40))
check('첫 행 값 보존', (await cellText(0, 0)) === '1', String(await cellText(0, 0)))

console.log('\n[단일 칼럼 / 세미콜론]')
await load('onecol.csv')
check('1칼럼 파일 처리', (await status()).includes('1 열') || (await status()).includes('1열'), (await status()).slice(0, 40))
await load('semicolon.csv')
check('세미콜론 구분자 인식', (await status()).includes('세미콜론'), (await status()).slice(0, 50))
check('3열로 분리', (await headerNames()).join(',') === 'a,b,c', (await headerNames()).join(','))

console.log('\n[내보내기 라운드트립]')
await load('gnarly.csv')
// 내보낸 CSV 본문을 Blob에서 가로채 파일로 저장한 뒤 다시 불러온다
await page.evaluate(() => {
  window.__csv = null
  const orig = URL.createObjectURL
  URL.createObjectURL = (b) => {
    b.text().then((t) => (window.__csv = t))
    return orig.call(URL, b)
  }
  HTMLAnchorElement.prototype.click = function () {}
})
await page.keyboard.down('Control')
await page.keyboard.press('KeyE')
await page.keyboard.up('Control')
await page.waitForSelector('[aria-label=내보내기]')
await page.evaluate(() => {
  ;[...document.querySelectorAll('.dlg footer .btn')].find((b) => b.textContent.trim() === '저장').click()
})
await sleep(800)
const exported = await page.evaluate(() => window.__csv)
check('CSV 내보내기 성공', typeof exported === 'string' && exported.length > 100, (exported ?? '').length + '자')

if (typeof exported === 'string') {
  // BOM을 떼고 파일로 쓴 뒤 다시 로드
  const body = exported.charCodeAt(0) === 0xfeff ? exported.slice(1) : exported
  writeFileSync(resolve(TMP, 'roundtrip.csv'), Buffer.from(body, 'utf8'))
  const before = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.canvas .tr')].sort(
      (a, b) => parseFloat(a.style.top) - parseFloat(b.style.top),
    )
    return rows.map((r) => [...r.querySelectorAll('.td')].map((t) => t.textContent))
  })
  await load('roundtrip.csv')
  const after = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.canvas .tr')].sort(
      (a, b) => parseFloat(a.style.top) - parseFloat(b.style.top),
    )
    return rows.map((r) => [...r.querySelectorAll('.td')].map((t) => t.textContent))
  })
  check(
    '라운드트립: 내보낸 CSV를 다시 읽으면 동일',
    JSON.stringify(before) === JSON.stringify(after),
    before.length + '행 vs ' + after.length + '행',
  )
  check('라운드트립 후 헤더 동일', (await headerNames()).join(',') === 'id,long,empty,quoted,tabbed', (await headerNames()).join(','))
}

// ===================================================================
// 엑셀 통합 문서 — 이 구간만 SheetJS를 CDN에서 받는다
console.log('\n[엑셀 통합 문서]')
{
  /** load()는 그리드를 기다리지만 여러 시트짜리는 선택 창이 먼저 뜬다 */
  async function openFile(name) {
    await page.goto(pathToFileURL(DIST).href, { waitUntil: 'load' })
    await page.waitForSelector('#app *')
    const input = await page.$('input[type=file]')
    await input.uploadFile(resolve(TMP, name))
  }
  const pickSheet = async (i) => {
    await page.$$eval('[role=listbox] .item', (els, k) => els[k].click(), i)
    await page.waitForSelector('[role=grid]', { timeout: 20000 })
    await sleep(400)
  }

  await openFile('book.xlsx')
  // CDN 다운로드가 섞여 있어 넉넉히 기다린다
  await page.waitForSelector('[role=listbox]', { timeout: 30000 })
  const items = await page.$$eval('[role=listbox] .item', (e) =>
    e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
  )
  check('시트 3장을 목록으로 제시', items.length === 3, JSON.stringify(items))
  check('빈 시트는 고를 수 없음', await page.$$eval('[role=listbox] .item', (e) => e[2].disabled))

  await pickSheet(0)
  check('헤더 인식', (await headerNames()).join(',') === '이름,단가,주문일', (await headerNames()).join(','))
  check('숫자 서식 그대로', (await cellText(0, 1)) === '89,000', String(await cellText(0, 1)))
  check('날짜 서식 그대로', (await cellText(0, 2)) === '2026-01-14', String(await cellText(0, 2)))
  check('한글 셀 정상', (await cellText(1, 0)) === '이준호', String(await cellText(1, 0)))
  check('상태바에 시트명·형식', (await status()).includes('주문') && (await status()).includes('xlsx'), await status())

  // 툴바 시트 버튼으로 전환
  const btn = await page.$$eval('header button', (els) =>
    els.findIndex((e) => e.querySelector('.sheet-name')),
  )
  check('툴바에 시트 전환 버튼', btn >= 0, String(btn))
  await page.evaluate((i) => document.querySelectorAll('header button')[i].click(), btn)
  await page.waitForSelector('[role=listbox]', { timeout: 5000 })
  await pickSheet(1)
  check('시트 전환됨', (await headerNames()).join(',') === 'code,flag', (await headerNames()).join(','))
  check('앞자리 0 보존', (await cellText(0, 0)) === '007', String(await cellText(0, 0)))

  await openFile('mislabeled.csv')
  await page.waitForSelector('[role=listbox]', { timeout: 30000 })
  check('.csv 확장자여도 매직 바이트로 엑셀 인식', (await page.$$('[role=listbox] .item')).length === 3)
  await pickSheet(0)
  check('내용 정상', (await headerNames()).join(',') === '이름,단가,주문일', (await headerNames()).join(','))
}

console.log('\n[최종]')
check('전 과정 페이지 에러 없음', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log('\n' + '='.repeat(56))
console.log(results.length - failed.length + '/' + results.length + ' 통과')
if (failed.length) {
  console.log('\n실패:')
  for (const f of failed) console.log('  ' + f.name)
}
process.exit(failed.length === 0 ? 0 : 1)
