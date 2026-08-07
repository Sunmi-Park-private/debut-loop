# 에셋 출처 및 제작 도구

> 사전과제 제출물 4번 「AI 활용 기술 문서」의 근거 자료.
> 주최 측 유의사항: *외부 에셋(이미지·사운드 등) 사용 시 출처와 라이선스를 AI 활용 기술 문서에 반드시 명시*,
> *AI 도구 사용은 허용·권장하나 사용 도구와 활용 내역을 반드시 기재*.
> 작성일 2026-08-07

---

## 요약

**이 프로젝트의 모든 에셋은 생성 AI 산출물이며, 외부에서 가져온 제3자 저작물은 없습니다.**

| 구분 | 생성 도구 | 후처리 | 수량 |
|---|---|---|---|
| UI 스킨 | GPT | After Effects | 141 슬롯 |
| 배경 | GPT | After Effects | 17 슬롯 |
| 캐릭터 | GPT | After Effects | 121 슬롯 |
| 영상 (타이틀·프롤로그·로딩·idle 루프) | GPT | After Effects | UI·배경 슬롯에 포함 |
| 배경음악 · 효과음 | **Suno (유료 플랜)** | — | 11 트랙 |

## 상세

### 이미지 · 영상

- **생성**: GPT로 원본 이미지 생성
- **편집**: After Effects로 합성·모션·루프 처리
  - 타이틀 `title-hero.mp4`, 프롤로그 `prologue-01.mp4`, 로딩 `loading.mp4`
  - 캐릭터 알파 영상(idle 루프) — Chrome용 webm, WebKit용 HEVC mov 두 벌
- **라이선스**: 자체 제작물. 제3자 소재 미사용

### 음악 · 효과음

- **생성**: Suno **유료 플랜**으로 생성
- **라이선스**: 유료 구독 플랜의 상업적 이용 조건을 따름
- **범위**: 로비·연습·리듬·회귀·엔딩 트랙 등 11개

### 코드

- Claude Code (Anthropic) 를 사용한 AI 페어 프로그래밍
- 설계·지시 내역은 `docs/QA_HARNESS_PLAN.md`, `docs/ASSET_EDITOR_PIPELINE.md`, `docs/superpowers/specs/`, `.claude/commands/` 에 남아 있음

### 오픈소스 의존성

`package.json` 참조. 주요 항목:

| 패키지 | 용도 | 라이선스 |
|---|---|---|
| pixi.js | 렌더링 엔진 | MIT |
| vite | 빌드 도구 | MIT |
| @capacitor/* | 모바일 패키징 | MIT |
| vitest | 테스트 | MIT |

---

## 제출 문서 작성 시 체크

- [ ] 위 표를 AI 활용 기술 문서(PDF)에 그대로 반영
- [ ] Suno 플랜 종류·구독 시점 명시 (상업적 이용권 근거)
- [ ] GPT 모델명 확인 후 기재
- [ ] After Effects 버전 기재
- [ ] 오픈소스 라이선스 전문 링크 첨부
