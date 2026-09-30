# docx 읽기 + md 모드 다중 포맷 내보내기 (pandoc-wasm)

**Date**: 2026-09-30  
**Target Route**: src/modes/md  
**Status**: Draft  

## Overview

xlsx는 SheetJS로 이미 읽을 수 있다. Word가 없는 기기에서도 docx를 읽을 수 있게 하려는 작업이다. docx 파일을 떨구거나 열면 브라우저 안의 pandoc-wasm이 마크다운으로 바꿔 **md 모드**에서 보여준다. md 모드의 내보내기에는 `.md` 외에 `.docx`와 `.rtf`를 추가한다. `.docx`로 내보낼 때는 사내 템플릿(`C:/apps/lib/pandoc-docx-template.docx`)의 스타일을 적용한다.

앱은 Svelte 5 + Vite로 만든 단일 HTML(`dist/index.html`, `file://`로 실행)이고, 무거운 라이브러리는 CDN에서 지연 로드한다(`src/lib/util/cdn.ts`).

## 확정된 결정 (사용자 답변)

| 항목 | 결정 |
|---|---|
| wasm 로딩 | unpkg에서 지연 로드하고 IndexedDB에 캐시한다. 처음 한 번만 16MB(gzip)를 받고, 이후에는 오프라인에서도 동작한다. |
| docx 안의 이미지 | md 본문에 data URI로 인라인한다. |
| 내보내기 포맷 | `.md`(기존), `.docx`(템플릿 적용), `.rtf` |
| 템플릿 | 저장소에 복사해 두고 빌드 때 HTML에 인라인한다(15KB → base64 약 20KB). |
| 내보내기 경로 | md → marked로 순수 HTML → pandoc(`from: html`). 병합 셀 표도 살아남는다. |

## 조사로 확인한 사실

- `pandoc-wasm@1.1.0`(pandoc 3.9, GPL-2.0+)의 wasm은 원본 58.6MB, gzip 전송 16MB다.
- 인라인하면 base64로 약 78MB가 되어 쓸 수 없다. jsDelivr는 크기 제한 때문에 403을 돌려준다. unpkg는 200을 돌려주고 `ACAO: *`를 준다.
- `convert(options, stdin, files)`는 호출할 때마다 `fileSystem.clear()`를 하므로 인스턴스 하나를 재사용해도 된다. `output-file`은 Blob으로 돌아오고, 추출된 미디어는 `mediaFiles`에 `<extract-media>/media/imageN.ext` 경로로 담긴다.
- 패키지의 브라우저 진입점(`index.browser.js`)은 `import("./pandoc.wasm")`을 한다. 이것을 그대로 import하면 Vite가 58MB를 HTML에 인라인한다. 그래서 **`src/core.js`만** 가져다 써야 한다. `exports` 필드가 하위 경로 import를 막고 있으므로 Vite alias로 우회한다.
- **함정:** docx도 ZIP이다. 지금은 `looksSpreadsheet()`가 ZIP을 모두 스프레드시트로 판정해서 docx가 CSV 모드로 간다.

## 구현

### 1. 의존성과 빌드 설정

- `package.json`: `dependencies`에 `"pandoc-wasm": "1.1.0"`을 추가한다. 버전을 정확히 고정해서 CDN URL 상수와 맞춘다.
- `vite.config.ts`: `resolve.alias`로 `pandoc-wasm-core`를 `node_modules/pandoc-wasm/src/core.js`에 연결한다. 번들에 들어가는 것은 core.js와 `@bjorn3/browser_wasi_shim`(수십 KB)뿐이다.
- `src/lib/pandoc/core.d.ts`: `createPandocInstance`의 최소 타입 선언.
- 템플릿 복사는 CLAUDE.md 규칙대로 `cp`로 하고, 끝나면 `fd`로 존재를 확인한다.
  ```
  cp "C:/apps/lib/pandoc-docx-template.docx" src/lib/pandoc/reference.docx
  ```
  코드에서는 `import referenceUrl from './reference.docx?url'`로 가져온다. `assetsInlineLimit`이 크게 잡혀 있어서 data URL로 인라인되고, 실행할 때 `fetch(dataUrl).then(r => r.blob())`로 Blob을 얻는다.

### 2. `src/lib/pandoc/` (신규, 모드와 독립)

- **`wasmStore.ts`**: wasm 바이트를 확보한다.
  - 캐시 저장소는 **별도 DB `xsv-playground-pandoc`**의 스토어 `wasm`(keyPath `version`)이다. 앱 DB(`src/lib/data/idb.ts`, `DB_VERSION=1`)를 올리지 않기 때문에, 열려 있는 다른 탭 때문에 업그레이드가 막히는 문제가 생기지 않는다. 앱 DB 헬퍼 `req`/`normalizeError`는 재사용한다.
  - `getPandocWasm(onProgress)`: 캐시에 있으면 바로 돌려준다. 없으면 `https://unpkg.com/pandoc-wasm@1.1.0/src/pandoc.wasm`를 스트림으로 읽는다. gzip 전송이라 Content-Length를 믿을 수 없으므로 진행률은 알려진 원본 크기 상수를 분모로 계산한다. 다 받으면 `put`하고, 이전 버전 키는 지운다.
  - 캐시 저장이 quota로 실패해도 변환은 계속 진행하고, 경고 토스트만 띄운다. 네트워크 실패는 reject하고 promise 캐시를 비운다(`cdn.ts`의 실패 규약과 같다).

- **`pandoc.worker.ts`**: `?worker&inline` 방식이다(`src/modes/jq/utils/json-preprocess-client.ts` 선례). `init` 메시지로 wasm ArrayBuffer를 transfer로 받아 `createPandocInstance`를 만든다. 그 뒤 `convert` 요청을 `{id}`별로 처리한다. 58MB wasm을 컴파일하고 변환하는 동안 UI가 멈추지 않게 워커에서 돌린다.

- **`client.ts`**: 워커 싱글턴을 관리한다. `ensurePandoc(onProgress)`와 `runPandoc(options, files)`를 제공한다. init이 실패하면 워커를 폐기해서 다음 호출이 재시도하게 한다.

- **`docx.ts`**: 순수 함수와 변환 진입점.
  - `docxToMarkdown(file)`: 옵션은 `{from:'docx', to:'gfm', wrap:'none', 'input-files':['in.docx'], 'extract-media':'m'}`이다. 그 뒤 `inlineMedia(md, mediaFiles)`가 본문의 `m/media/…` 경로(마크다운 `![](…)`와 raw `<img src="…">` 둘 다)를 확장자별 MIME의 data URI로 바꾼다. 브라우저가 그리지 못하는 EMF/WMF 이미지는 개수를 세어 경고로 돌려준다.
  - `exportDocument(md, 'docx'|'rtf')`: `markdownToPlainHtml(md)` 결과를 `in.html`로 넘긴다.
    - docx: `{from:'html', to:'docx', 'reference-doc':'reference.docx', 'output-file':'out.docx'}`
    - rtf: `{from:'html', to:'rtf', standalone:true, 'output-file':'out.rtf'}`. **standalone을 빼면 RTF 조각만 나와 파일로 열리지 않는다.** RTF에는 템플릿이 적용되지 않는다.
    - pandoc 경고(원격 이미지는 네트워크가 없어 가져오지 못함 등)는 개수만 토스트로 알린다.
  - `swapExt(name, ext)`: `보고서.docx`, `보고서.md`, `보고서` 모두 → `보고서.<ext>`.

### 3. 파일 판정: `src/shell/fileKind.ts`

- `DOCX_EXTS = ['.docx']`를 추가한다. `detectFileKind`과 `sniffFile` 모두에서 **`looksSpreadsheet()`보다 먼저** 확장자가 `.docx`이면 `'md'`를 돌려준다.
- `OPEN_ACCEPT`에 `.docx`와 `application/vnd.openxmlformats-officedocument.wordprocessingml.document`를 추가한다.
- 구형 `.doc`(OLE2)은 pandoc이 읽지 못하므로 범위 밖이다. 지금처럼 동작한다.

### 4. md 모드

- `src/modes/md/lib/db.ts`: `MdFileSource`에 `'docx'`를 추가한다. 이름은 원본 파일명(`보고서.docx`)을 그대로 쓴다. source가 달라서 같은 이름의 `.md` 기록과 섞이지 않는다.
  - 알아둘 점: 같은 docx를 다시 열면 기존 md 파일과 똑같이 그 기록을 덮어쓴다. 변환한 뒤 고친 내용도 이때 사라진다.

- `src/modes/md/lib/markdown.ts`: `markdownToPlainHtml(content)`를 추가한다.
  - 전역 `marked`와 따로 **`new Marked()` 인스턴스**를 쓴다. 리더 전용 렌더러(복사 버튼, SVG, `data-*`, lightbox)가 섞이지 않게 하기 위해서다.
  - code 렌더러만 `<pre><code class="js">`처럼 `language-` 접두를 떼서 pandoc이 언어를 인식하게 한다.

- `src/modes/md/MdMode.svelte`
  - `openFile`: `.docx`이면 `ensurePandoc`을 거쳐 `docxToMarkdown`을 부르고, 결과를 `loadRaw(file.name, md, 'docx')`에 넘긴다.
  - `busy` 상태(`{label, loaded?, total?}`)를 두고 content-area 위에 진행 배너를 띄운다. 최초 다운로드일 때는 "pandoc 엔진 내려받는 중 (최초 1회) 12.3 / 58.6MB"를, 그 뒤에는 "변환 중…"을 보여준다. 토스트는 진행률을 갱신할 수 없어서 쓰지 않는다.
  - `exportMarkdown()`을 `exportAs(format)`로 바꾼다. `md`는 기존 Blob 다운로드를 그대로 쓰고, `docx`/`rtf`는 `exportDocument`를 부른다. 다운로드 코드(`<a download>`)는 한 헬퍼로 합친다.
  - 드롭존 문구를 "마크다운·Word(.docx) 파일 열기"로 바꾼다.

- `src/modes/md/components/Toolbar.svelte`
  - `onExport: (f: 'md'|'docx'|'rtf') => void`로 바꾼다.
  - 내보내기 버튼을 누르면 기존 `src/lib/ui/ContextMenu.svelte`를 버튼 아래 좌표에 띄운다. 항목은 "Markdown (.md)" accel `m`, "Word (.docx)" accel `w`, "RTF (.rtf)" accel `r`이다.
  - title/aria-label은 "내보내기"로 바꾼다.

## 검증

1. `npm run check`, `npm run test`
   - `tests/fileKind.test.ts`: ZIP 매직을 가진 `x.docx`는 `'md'`, `x.xlsx`는 여전히 `'csv'`인지 확인한다.
   - 신규 `tests/pandoc.test.ts`: Node 진입점 `import { convert } from 'pandoc-wasm'`을 쓴다. 앱과 **같은 옵션 빌더**를 쓰도록 `docx.ts`에서 옵션 생성 함수를 export해 재사용한다. 확인할 것은 네 가지다.
     - 이미지가 든 md를 docx로 만든 뒤 `docxToMarkdown` 경로로 되돌렸을 때 `data:image/png;base64`가 들어 있는가
     - 병합 셀 HTML 표가 docx 출력의 `word/document.xml`에서 `gridSpan`/`vMerge`로 남는가
     - reference-doc를 적용한 docx의 `word/styles.xml`에 템플릿 고유 스타일이나 글꼴이 들어 있는가(구현할 때 템플릿 styles.xml에서 식별자를 골라 넣는다)
     - rtf 출력이 `{\rtf1`로 시작하는가
   - `inlineMedia`와 `swapExt`는 단위 테스트한다.
   - 버전 정합: `node_modules/pandoc-wasm/package.json`의 version과 CDN URL 상수가 같은지 확인한다.

2. 번들 크기: `dist/index.html`이 기존(약 600KB)보다 100KB 넘게 커지지 않아야 한다. 58MB wasm이 섞여 들어가지 않았다는 확인이다. 빌드는 `.next`와 무관한 Vite 프로젝트라 dev 서버 충돌 규칙에 해당하지 않는다. 그래도 `npm run dev`가 떠 있는지는 확인만 한다.

3. `npm run e2e`, `npm run edge`: 기존 회귀가 없는지 본다. 콘솔 에러 0건 규칙도 포함된다. e2e에는 16MB 네트워크 다운로드를 넣지 않는다.

4. 수동 확인(`dist/index.html`을 `file://`로 연다)
   - docx(이미지, 표, 병합 셀, 한글 포함)를 드롭하면 진행 배너가 뜨고 md 모드에서 렌더링되는가
   - 새로고침한 뒤 네트워크를 끈 상태에서 다시 docx를 열어도 캐시로 변환되는가
   - 내보내기 메뉴의 .md, .docx, .rtf가 모두 동작하고, .docx에 템플릿 스타일이 적용되며, Word/워드패드에서 열리는가
   - xlsx 드롭은 여전히 CSV 모드로 가는가

## 참고

- pandoc과 core.js는 GPL-2.0+다. core.js 래퍼는 번들에 포함되고 wasm은 실행할 때 받는다. `private` 사내 도구라 외부에 배포하지 않으면 문제가 없다. 외부에 배포할 계획이 생기면 다시 검토한다.
- docx를 docx로 되돌리면 원본 서식이 아니라 **md 내용 + 템플릿 스타일**로 새로 만들어진다. 원본 레이아웃(머리글, 바닥글, 페이지 설정, 글자 색)은 보존되지 않는다.
