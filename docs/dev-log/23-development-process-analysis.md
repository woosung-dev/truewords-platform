# 23. 개발 프로세스 심층 분석 및 결정

> **작성일:** 2026-04-10
> **상태:** Accepted
> **결정자:** woosung
> **관련 도구:** gstack, superpowers, ui-ux-pro-max

---

## 배경 (Context)

`/office-hours`로 Nexus Core 패턴 적용을 브레인스토밍한 후, 다음 스텝 추천 시 superpowers 프로세스(`brainstorming → writing-plans → TDD`)만 언급하고 gstack의 리뷰 파이프라인(`/autoplan`, `/plan-eng-review` 등)을 건너뛴 것이 문제 제기됨.

핵심 질문: **프로젝트 시작부터 배포까지 전체 라이프사이클에서 gstack, superpowers, ui-ux-pro-max를 어떻게 조합해야 하는가?**

---

## 결정 (Decision)

**1위: Phase-Adaptive (단계별 적응형) 프로세스 채택.**

`/office-hours`는 Phase 시작 시에만 사용하고, 일상 개발은 작업 크기에 따라 superpowers 프로세스를 축약/확장한다. 디자인 도구는 프론트엔드 Phase 시작 시 1회만 사용한다.

---

## 분석 과정 (Analysis)

### 사고 축 4가지

모든 프로세스는 이 4가지 축의 조합:

```
축 1: 프로젝트 단계    아이디어 ◄────────► 운영 중
축 2: 팀 규모          1인 ◄──────────────► 10인+
축 3: 리스크 수준      실험적 ◄────────────► 프로덕션 크리티컬
축 4: AI 활용 수준     보조 ◄──────────────► AI가 주 실행자
```

### 10가지 프로세스 방안 비교

| # | 방안 | 스킬 수 | 기능당 소요 | 적합 조건 |
|---|------|:------:|:-----------:|-----------|
| 1 | Full Ceremony (모든 도구 순차) | 15+ | 1-2주 | 의료/금융 크리티컬 |
| 2 | Lean Startup Loop | 6-7 | 3-5일 | MVP 이전, PMF 탐색 |
| 3 | YC Partner Flow (gstack 정석) | 12 | 1주 | 새 Phase, 피벗 |
| 4 | Design-Led Development | 9 | 1주 | B2C 앱, 디자인 차별화 |
| 5 | Size-Adaptive (크기 적응형) | 2-12 | 작업에 비례 | 일상 개발 |
| 6 | 2-Track Pipeline | 8-10 | 병렬 | 2인+ 팀 |
| 7 | Vertical Slice | 7 | 2-3일 | 기능별 관통 |
| 8 | Review-Heavy | 11 | 1주 | 프로덕션 크리티컬 |
| 9 | AI-First Parallel | 6 | 병렬 압축 | 독립 모듈 다수 |
| 10 | Sprint 기반 (2주) | 전체 | 2주 사이클 | 3인+ 팀 |

### 소크라테스 논증으로 축소

**질문 1: "프로세스의 시작점은 항상 같은가?"**
→ 새 방향은 `/office-hours`에서 시작, 기존 방향 개선은 그렇지 않음.
→ **방안 1, 8 제외** (모든 작업에 과도)

**질문 2: "디자인은 언제 선행해야 하는가?"**
→ 매 기능마다는 과도. Phase 시작 시 1회 DESIGN.md 생성 후 참고.
→ **방안 4는 독립 프로세스가 아니라 Phase 내 요소**

**질문 3: "병렬 실행이 현실적인가?"**
→ 독립 모듈이 명확할 때만. 1-2인 팀에서는 제한적.
→ **방안 9는 독립 프로세스가 아니라 실행 전략**

**질문 4: "스프린트가 1-2인 팀에 적합한가?"**
→ 스프린트 플래닝/리뷰 의식은 1인에게 과도. `retro + health`만 추출.
→ **방안 10은 독립 프로세스 아님**

**질문 5: "gstack 설계 의도를 따르되, 모든 작업에 적용 안 하려면?"**
→ 방안 3(YC Partner Flow)이 **Phase 시작**에, 방안 5(Size-Adaptive)가 **일상 개발**에 적합.
→ **둘을 결합 + 방안 4(디자인) + 방안 10(회고) = 최종 1위**

---

## 최종 5가지 추천

### 1위: Phase-Adaptive (9/10) ← 채택

```
[Phase 시작 = 새로운 방향/큰 결정]
  /office-hours → /plan-eng-review (→ /plan-design-review, 프론트엔드 시)
  → design-consultation + ui-ux-pro-max (프론트엔드 Phase만, 1회)
  → /brainstorming → /writing-plans

[Large 작업 (3일+)]
  brainstorming → writing-plans → checkpoint
  → TDD → verification → requesting-code-review

[Medium (반나절~2일)]
  brainstorming → writing-plans → TDD → verification

[Small (< 2시간)]
  brainstorming → TDD

[Bug Fix]
  systematic-debugging → TDD → verification

[배포]
  /ship → /qa

[주기적 (매 2주)]
  /retro → /health
```

**핵심 원리:** office-hours는 Phase 시작에만. 일상 개발은 superpowers. 디자인 도구는 프론트엔드 Phase 1회.

**1위 조건:** 1-2인 팀, 일상 개발 흐름, 다양한 크기 작업 혼재.
**1위 아닌 경우:** 팀 5인+ → 2-Track(방안 6) 전환 필요.

### 2위: YC Partner Flow (8/10)

```
/office-hours → /autoplan (CEO→Eng→Design→DX)
→ /brainstorming → /writing-plans → TDD → verification → /review
→ /ship → /qa → /document-release → /retro
```

**1위 조건:** 새 프로젝트 처음 시작, 피벗, 투자자용 계획 필요.
**현재 부적합:** TrueWords 백엔드가 이미 구축되어 있고 Design Doc도 승인됨.

### 3위: Vertical Slice (7/10)

```
[기능별 수직 관통]
/office-hours (해당 기능) → ui-ux-pro-max (해당 화면)
→ /brainstorming → /writing-plans
→ TDD (백엔드+프론트엔드 동시) → verification → /ship → /qa
```

**1위 조건:** Flutter + 백엔드 동시 개발 Phase, 기능별 배포 가능성.

### 4위: Feedback Loop (7/10)

```
[첫 배포]
/office-hours → /brainstorming → /writing-plans → TDD → /ship

[피드백 후]
/investigate /qa → /office-hours (재평가) → /brainstorming → TDD → /ship

[매 2주]
/retro → /health
```

**1위 조건:** 앱이 실제 사용자에게 배포된 후, 데이터 기반 결정.

### 5위: Design-First Mobile (6/10)

```
[프론트엔드 Phase 시작 1회]
/design-consultation → DESIGN.md
→ ui-ux-pro-max (스타일 시스템)
→ /design-shotgun (화면 변형 탐색)
→ /plan-design-review

[이후 각 화면]
/brainstorming (ui-ux-pro-max 참고) → /writing-plans → TDD
→ /design-review → /ship
```

**1위 조건:** 디자인 시스템 첫 구축, 신뢰감이 핵심인 도메인 (종교/의료/금융).

---

## 도구별 사용 빈도

| 도구 | 사용 시점 | 빈도 |
|------|----------|------|
| `/office-hours` | Phase 시작, 방향 전환, 피드백 후 재평가 | Phase당 1회 |
| `/plan-eng-review` | Phase 시작 직후, 아키텍처 결정 | Phase당 1회 |
| `/design-consultation` + ui-ux-pro-max | 프론트엔드 Phase 시작 | 1회 |
| `/autoplan` | 새 프로젝트 또는 큰 피벗 | 프로젝트당 1-2회 |
| `/brainstorming` | 모든 작업 시작 | 매번 |
| `/writing-plans` | Medium 이상 작업 | 자주 |
| TDD | 모든 구현 | 매번 |
| `verification-before-completion` | 완료 주장 전 | 매번 |
| `/review` 또는 `requesting-code-review` | Large 작업, PR | Large마다 |
| `/ship` | 배포 시 | 배포마다 |
| `/retro` + `/health` | 주기적 | 매 2주 |
| `systematic-debugging` | 버그 발생 시 | 필요 시 |
| `/checkpoint` | 세션 간 컨텍스트 보존 | Large 작업 |

---

## TrueWords 현재 위치와 다음 스텝

### 현재 위치

- **Phase 1 (백엔드 기반 작업):** office-hours 완료 → Design Doc APPROVED
- **다음 스텝:** `/plan-eng-review`로 아키텍처 검증 → `/writing-plans` → TDD

### Phase별 적용

```
Phase 1 (백엔드 기반 작업 반나절):
  ✅ /office-hours (완료)
  ▶ /plan-eng-review ← 지금
  → Task 1.1 (Small): brainstorming → TDD → verification
  → Task 1.2 (Small): brainstorming → TDD → verification
  → Task 1.3 (Medium): brainstorming → writing-plans → TDD → verification
  → /review → /ship

Phase 2 (Flutter 모바일 MVP 2-3일):
  → /office-hours (UI 방향)
  → /design-consultation (DESIGN.md 생성)
  → ui-ux-pro-max (스타일 시스템)
  → /plan-design-review
  → (Large): brainstorming → writing-plans → checkpoint → TDD → verification
  → /design-review → /ship

배포 후:
  → /qa (실사용자 테스트)
  → /office-hours (피드백 기반 재평가)
  → Feedback Loop 진입
```

---

## 결과 (Consequences)

### 긍정적

- **오버헤드가 작업 크기에 비례** — 30분짜리에 1시간 프로세스를 돌리지 않음
- **gstack과 superpowers의 역할 분리 명확** — gstack은 "무엇을", superpowers는 "어떻게"
- **ui-ux-pro-max 활용 위치 명확** — 프론트엔드 Phase 시작 시 1회
- **매 2주 retro/health로 프로세스 자체를 개선 가능**

### 부정적

- "이게 Small인지 Medium인지" 판단이 주관적 (경험 축적으로 해소)
- 팀이 커지면 2-Track(방안 6)으로 재전환 필요

### 트리거 조건 (재평가 시점)

다음 중 하나라도 발생하면 이 결정 재평가:
- 팀 규모가 3인 이상으로 확장
- 프로덕션 크리티컬 상황 (결제, 인증 등 실수 비용 높은 기능)
- 사용자가 10+ 이상이 되어 피드백 기반 사이클이 주류가 됨

---

## 관련 문서

- `docs/guides/development-workflow.md` — 실무 워크플로우 가이드 (이 결정 반영)
- `docs/insights/02-nexus-core-analysis.md` — 이 결정을 촉발한 Nexus Core 패턴 분석
- `~/.gstack/projects/woosung-dev-truewords-platform/woosung-main-design-20260410-100111.md` — 현재 진행 중 Design Doc
