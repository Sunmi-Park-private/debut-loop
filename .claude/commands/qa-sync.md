---
description: QA 구글시트를 읽어 신규 피드백만 GitHub 이슈로 등록 (중복 skip)
---

QA 체크리스트 시트를 읽어, 아직 이슈로 등록되지 않은 피드백만 골라 private QA 리포에 이슈로 만든다.

## 설정

- **시트**: `https://docs.google.com/spreadsheets/d/1MLN_JtoLJQ-QhGz1avhDDBOP0aSU240D_Z-4qXA9gI8/edit`
  - fileId: `1MLN_JtoLJQ-QhGz1avhDDBOP0aSU240D_Z-4qXA9gI8`
- **QA 리포**: `Sunmi-Park-private/debut-loop-qa` (private)
- 설계 근거: `docs/superpowers/specs/2026-08-06-qa-issue-pipeline-design.md`

## 절차

### 1. 시트 읽기

Google Drive MCP `read_file_content`로 위 fileId를 읽는다. 첫 번째 탭이 체크리스트다.

열 구성: `# / 대분류 / 화면 / 진입경로 / 확인항목 / 슬롯ID / 기대결과 / 업로드 / 판정 / 비고` + 그 오른쪽에 디자이너 자유 코멘트 열(헤더 없음).

`#` 열이 숫자인 행만 데이터 행으로 취급한다. 상단 안내 블록·부록 표·하단의 행에 붙지 않은 떠다니는 메모는 **무시**한다.

### 2. 이슈 대상 선별

| 조건 | 이슈화 | 라벨 |
|---|---|---|
| `판정 = Fail` | O | `bug` |
| `판정 = ?` | O | `question` |
| `판정 ∈ {N-A, Pass}` 이고 코멘트 열에 내용 있음 | O | `enhancement` |
| `판정 = Pass` 이고 코멘트 없음 | X | — |
| `판정` 빈칸 | X | — |

작업 유형 라벨을 함께 판단해 붙인다:

- `qa:code` — 소스 수정이 필요한 것 (잘림·정렬·전환·레이아웃)
- `qa:asset` — 에디터 설정값(배율·좌표) 조정으로 끝나는 것 (아이콘 크기 등)
- `qa:question` — 판단·답변만 필요한 것 (`판정 = ?` 는 대체로 여기)

모든 이슈에 `qa` 라벨을 공통으로 붙인다.

### 3. 중복 판별

각 대상 행의 키를 만든다:

```
qa-row: <행번호> | <판정정규화> | <코멘트해시>
```

- 판정 정규화: 소문자, `N-A` → `na`, `?` → `question`
- 코멘트 해시: 코멘트 열 텍스트를 트림·공백 축약한 뒤 SHA-1 앞 6자. 코멘트 없으면 `none`

기존 이슈의 마커를 수집한다:

```bash
gh issue list --repo Sunmi-Park-private/debut-loop-qa --state all --limit 500 \
  --json number,title,body
```

본문에서 `<!-- qa-row: ... -->` 를 파싱해 비교한다.

| 상황 | 동작 |
|---|---|
| 동일 키 존재 | **skip** |
| 같은 행번호가 있으나 판정/코멘트가 다름 | **새 이슈 생성** + 이전 이슈에 `행 재검수됨 → #<새번호>` 코멘트 |
| 행번호 없음 | 신규 생성 |

### 4. 승인 받기 ← 반드시

생성 전에 **표로 목록을 보여주고 사용자 승인을 받는다.** 승인 없이 이슈를 만들지 않는다.

```
생성 예정 N건 / skip M건 / 재검수 K건

| 행 | 화면 | 슬롯 | 판정 | 라벨 | 제목 |
```

### 5. 이슈 생성

```bash
gh issue create --repo Sunmi-Park-private/debut-loop-qa \
  --title "[QA #10] 타이틀 — title-hero 상단 잘림" \
  --label "qa,qa:code,bug" \
  --body "$(cat <<'EOF'
<!-- qa-row: 10 | fail | a3f9c2 -->
**화면**: 타이틀 › 타이틀
**슬롯**: `title-hero`
**진입 경로**: 로딩 종료
**기대 결과**: ①②③⑤ — 화면 전체 cover, 상하 잘림 없음
**판정**: Fail
**디자이너 의견**: 상단 이미지 잘림 현상
**비고**: 권장 1080×2400

_QA 시트 행 #10 · <오늘날짜> 동기화_
EOF
)"
```

제목 형식: `[QA #<행>] <화면> — <증상 요약>`

Projects 보드가 설정돼 있으면 생성된 이슈를 Triage 컬럼에 추가한다. 보드가 없으면 건너뛴다(에러 아님).

### 6. 결과 보고

생성 N건 / skip M건 / 재검수 K건 + 생성된 이슈 번호와 링크.

## 주의

- **이슈 생성 외의 git 작업(커밋·푸시·PR)은 하지 않는다.**
- 시트는 읽기 전용이다. 되쓰기를 시도하지 않는다.
- 오늘 날짜는 실제 현재 날짜를 쓴다.
