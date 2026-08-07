---
description: QA 이슈를 우선순위대로 1건 가져와 수정하고 PR 직전까지 진행
---

private QA 리포의 이슈를 한 건 가져와 public 코드 리포에서 수정한다.

## 설정

- **QA 리포** (이슈): `Sunmi-Park-private/debut-loop-qa` (private)
- **코드 리포** (작업): `Sunmi-Park-private/debut-loop` (public) — 현재 디렉터리
- 설계 근거: `docs/superpowers/specs/2026-08-06-qa-issue-pipeline-design.md`

인자로 이슈 번호가 주어지면 그 이슈를 처리한다. 없으면 우선순위대로 고른다.

## 🚨 공개 범위 규칙 — 반드시 지킬 것

코드 리포는 **public이고 사전과제 심사 대상**이다. QA 과정이 심사위원에게 드러나면 안 된다.

- 브랜치명·PR 제목·커밋 메시지에 **QA 이슈 번호를 쓰지 않는다**
- ❌ `qa/issue-12`, `fix: QA #12 대응`
- ✅ `fix/title-hero-crop`, `fix: 타이틀 화면 상단 이미지 잘림 수정`
- 증상 기반으로 짓는다. 평범한 개발 커밋처럼 보여야 한다

## 절차

### 1. 이슈 선택

```bash
gh issue list --repo Sunmi-Park-private/debut-loop-qa \
  --state open --label qa --json number,title,labels,body
```

우선순위 (Projects Todo 컬럼 순서가 있으면 그것이 우선):

1. `대분류 ∈ {프롤로그, 로딩, 타이틀, 로비, 스토리}` 이고 `bug` — **플레이 영상에 잡히는 화면**
2. 나머지 `bug`
3. `enhancement`
4. `qa:question`

고른 이슈를 사용자에게 보여주고 진행할지 확인한다.

### 2. 라벨별 분기

**`qa:question`** — 코드를 건드리지 않는다. 관련 소스를 조사해 "의도된 동작인지" 판단하고, 근거(파일:줄)와 함께 이슈에 답변 코멘트를 단다. 여기서 종료.

**`qa:asset`** — 에디터 설정값(JSON)만 수정한다. 소스 로직은 건드리지 않는다.

**`qa:code`** — 아래 3번부터 진행한다.

### 3. 브랜치 생성

```bash
git switch -c fix/<증상-영문-요약>
```

### 4. 수정

관련 파일을 찾아 고친다. 이슈의 `슬롯 ID`가 검색 키가 된다.

주요 위치:
- UI 슬롯 렌더링 — `src/ui/uiSkin.ts`
- 배경 슬롯 — `src/data/backgrounds.json`
- 슬롯 정의 — `src/data/assets.json`
- 화면별 로직 — `src/ui/`

### 5. 검증 게이트 ← 건너뛰지 말 것

```bash
npm run typecheck
npm test          # 110개 통과 유지
```

실패하면 고칠 때까지 다음 단계로 넘어가지 않는다.

### 6. 화면 확인

430×800 (모바일 세로) 기준으로 해당 화면을 실제로 띄워 확인한다.

```bash
npx vite --port 5174 --strictPort
```

`?goto=` 파라미터나 치트 메뉴(우하단 ⚙️)로 해당 화면에 진입한다.

수정 후 화면을 캡처한다. Google Drive `debut-loop QA/shots/` 폴더에 `issue-<번호>-after.png`로 업로드하고 공유 링크를 받는다. (Drive MCP `create_file`, `base64Content` + `contentMimeType: image/png`)

### 7. 사용자 승인 ← 정지 지점

**여기서 멈춘다.** 아래를 보고하고 승인을 기다린다:

- 변경 파일과 diff 요약
- typecheck·test 결과
- 캡처 이미지

승인 없이 **커밋·푸시·PR 생성을 하지 않는다.**

### 8. 커밋 (승인 후)

커밋 메시지 초안을 먼저 보여주고 승인받는다. QA 이슈 번호를 넣지 않는다.

### 9. PR 생성 (승인 후)

```bash
gh pr create --title "fix: <증상 한국어 요약>" --body "<변경 내용>"
```

PR 본문에도 QA 이슈 번호를 쓰지 않는다.

### 10. QA 이슈에 결과 코멘트

```bash
gh issue comment <번호> --repo Sunmi-Park-private/debut-loop-qa --body "..."
```

내용: 변경 요약 + PR 링크 + 스크린샷 Drive 링크 + 디자이너 확인 요청.
Projects 보드가 있으면 Review로 이동.

### 11. 머지는 사용자가 한다

`gh pr merge`를 실행하지 않는다.

## 완료된 이슈 정리

`/qa-work` 실행 시작 시, 이전에 만든 PR 중 머지된 것이 있는지 확인한다. 있으면 대응하는 QA 이슈를 닫고(리포가 달라 자동 close가 안 됨) Projects를 Done으로 옮긴다.

```bash
gh issue close <번호> --repo Sunmi-Park-private/debut-loop-qa \
  --comment "PR <링크> 머지 완료"
```
