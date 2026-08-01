<script lang="ts">
  interface Props {
    onClose: () => void
  }
  let { onClose }: Props = $props()

  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: '스마트 필터 (행 걸러내기)',
      rows: [
        ['/', '스마트 필터로 이동'],
        ['Alt R', '정규식 토글 (기억됨)'],
        ['Enter', '디바운스 무시하고 즉시 적용'],
        ['Esc', '필터 지우기 / 포커스 해제'],
      ],
    },
    {
      title: '찾기 · 바꾸기 (셀 단위)',
      rows: [
        ['Ctrl F', '찾기 패널 열기'],
        ['Enter  F3', '다음 매치로 이동'],
        ['Shift Enter', '이전 매치로 이동'],
        ['↑ ↓', '목록에서 이동'],
        ['Alt R', '정규식 토글'],
        ['Alt C', '대소문자 구분 토글'],
        ['Alt W', '셀 전체 일치 토글'],
        ['Ctrl H', '바꾸기 열기'],
      ],
    },
    {
      title: '변형',
      rows: [
        ['도구 메뉴', '찾기 · 바꾸기 · 나누기 · 결합'],
        ['열 나누기', '구분자로 열 또는 행으로 분리'],
        ['열 결합', '선택한 2개 이상 열을 합쳐 새 열'],
      ],
    },
    {
      title: '이동 · 선택',
      rows: [
        ['↑ ↓ ← →', '셀 이동'],
        ['Shift ↑↓←→', '선택 확장'],
        ['Ctrl ↑↓←→', '끝으로 이동'],
        ['PgUp PgDn', '한 화면씩'],
        ['Ctrl A', '전체 선택'],
        ['드래그', '사각 범위 선택'],
        ['Shift 클릭', '범위 확장'],
        ['Ctrl 클릭', '범위 추가 (멀티 선택)'],
        ['헤더 클릭', '열 전체 선택'],
        ['Shift 헤더 클릭', '열 구간 선택'],
        ['Ctrl 헤더 클릭', '열 추가 선택'],
        ['행 번호 클릭', '행 전체 선택'],
      ],
    },
    {
      title: '편집',
      rows: [
        ['Enter  F2', '셀 편집'],
        ['문자 입력', '내용을 지우고 바로 편집'],
        ['Enter', '확정 후 아래로'],
        ['Tab', '확정 후 오른쪽으로'],
        ['Esc', '편집 취소'],
        ['Delete', '선택 영역 비우기'],
        ['Ctrl Z', '실행 취소'],
        ['Ctrl Shift Z', '다시 실행'],
        ['헤더 더블클릭', '칼럼명 변경'],
      ],
    },
    {
      title: '정렬 · 필터 · 숨기기',
      rows: [
        ['정렬 버튼', 'asc → desc → 해제'],
        ['Shift 정렬 버튼', '다중 정렬에 추가'],
        ['필터 버튼', '칼럼 필터 열기'],
        ['우클릭', '행·열 숨기기 / 빈 열 일괄 처리'],
        ['열 관리', '열 목록에서 on/off로 일괄 정리'],
        ['숨김 배지', '상태바에서 클릭하면 전체 해제'],
      ],
    },
    {
      title: '우클릭 메뉴 — 이동',
      rows: [
        ['↑ ↓', '항목 이동 (구분선·비활성 건너뜀)'],
        ['Home End', '처음 / 마지막 항목'],
        ['Enter  Space', '짚은 항목 실행'],
        ['Esc', '메뉴 닫기'],
      ],
    },
    {
      // 메뉴가 열려 있는 동안에만 먹는 키다. 항목 오른쪽 배지에 같은 글자가 표시된다.
      title: '우클릭 메뉴 — 한 글자 실행',
      rows: [
        ['C  E', '복사 / 내용 지우기'],
        ['A  B', '위에 / 아래에 행 삽입'],
        ['W  H  D', '행 복제 / 숨기기 / 삭제'],
        ['L  R', '왼쪽에 / 오른쪽에 열 삽입'],
        ['P  I  X', '열 복제 / 숨기기 / 삭제'],
        ['N  M', '빈 열 모두 숨기기 / 삭제'],
        ['S  J', '열 나누기 / 열 결합'],
        ['U', '숨김 모두 해제'],
      ],
    },
    {
      title: '순서 · 크기',
      rows: [
        ['헤더 드래그', '열 순서 변경'],
        ['행 번호 드래그', '행 순서 변경 (정렬 해제 시)'],
        ['헤더 경계 드래그', '칼럼 폭 조절'],
        ['헤더 경계 더블클릭', '내용에 맞춤'],
      ],
    },
    {
      title: '복사 · 내보내기',
      rows: [
        ['Ctrl C', '선택 영역 복사 (TSV + 표)'],
        ['Ctrl V', '선택 위치에 붙여넣기'],
        ['Ctrl E', '내보내기 열기'],
        ['Ctrl O', '파일 열기'],
      ],
    },
  ]
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onClose}></div>

<div class="dlg pop" role="dialog" aria-modal="true" aria-label="단축키">
  <header>
    <h2>단축키</h2>
    <button class="btn icon" onclick={onClose} aria-label="닫기">✕</button>
  </header>

  <div class="cols">
    {#each groups as g (g.title)}
      <section>
        <h3 class="label">{g.title}</h3>
        {#each g.rows as [keys, desc] (keys + desc)}
          <div class="row">
            <!--
              토큰 텍스트를 키로 쓰면 안 된다 — `'W  H  D'`처럼 공백이 겹치면 빈 토큰이 둘
              생겨 `each_key_duplicate`로 다이얼로그 전체가 렌더에 실패한다. 빈 토큰을
              걸러내고 위치로 키잉한다.
            -->
            <span class="keys">
              {#each keys.split(/\s+/).filter(Boolean) as k, i (i)}<span class="kbd">{k}</span>{/each}
            </span>
            <span class="desc">{desc}</span>
          </div>
        {/each}
      </section>
    {/each}
  </div>

  <footer>
    <span class="label">모든 데이터는 브라우저 안에서만 처리됩니다</span>
    <span class="grow"></span>
    <span class="label"><span class="kbd">?</span> 로 다시 열기</span>
  </footer>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--bg-overlay);
    z-index: 70;
    animation: fade 140ms var(--ease);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  .dlg {
    position: fixed;
    z-index: 71;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(720px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    animation: rise 180ms var(--ease);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-50% + 8px));
    }
  }

  header {
    display: flex;
    align-items: center;
    padding: 11px 8px 11px 14px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
  }

  .cols {
    columns: 2;
    column-gap: 26px;
    padding: 14px 16px;
    overflow-y: auto;
  }
  section {
    break-inside: avoid;
    margin-bottom: 16px;
  }
  h3 {
    margin: 0 0 5px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border-soft);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2.5px 0;
  }
  .keys {
    flex: none;
    display: flex;
    gap: 2px;
    width: 132px;
  }
  .desc {
    flex: 1;
    color: var(--text-dim);
    font-size: 11.5px;
  }

  footer {
    display: flex;
    align-items: center;
    padding: 9px 14px;
    border-top: 1px solid var(--border);
    background: var(--bg-header);
    border-radius: 0 0 8px 8px;
  }
  .grow {
    flex: 1;
  }

  @media (max-width: 620px) {
    .cols {
      columns: 1;
    }
  }
</style>
