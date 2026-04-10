# 25. 병렬 실행 패턴 심층 분석 및 적용 전략

> **작성일:** 2026-04-10
> **상태:** Accepted
> **결정자:** woosung
> **관련 도구:** Claude Code, gstack, superpowers, oh-my-claudecode, everything-claude-code
> **관련 문서:** `23-development-process-analysis.md`

---

## 배경 (Context)

`docs/dev-log/23-development-process-analysis.md`에서 최종 5가지 프로세스 추천을 도출했다.

- **추천 1위:** Phase-Adaptive (단계별 적응형, 일상 개발 중심)
- **추천 2위:** YC Partner Flow (`/autoplan` 포함 풀 파이프라인)

두 프로세스 모두 **순차 체인(sequential chain)** 구조이며, 생산성 관점에서 다음 질문이 제기됐다.

> "Phase-Adaptive와 YC Partner Flow를 병렬로 실행할 방법은 없는가? 어떤 단계에 어떤 병렬화 기법을 얹어야 하는가?"

사용자가 제시한 3가지 키워드를 출발점으로 조사를 수행했다.

1. `oh-my-claudecode`, `everything-claude-code` 에이전트 프레임워크
2. Sequential flow 대신 **operator 패턴**으로 terminal 3개 독립 실행
3. **Agent swarm** (다중 에이전트 오케스트레이션)

---

## 리서치 결과 (3가지 핵심 개념 검증)

### 1. oh-my-claudecode (OMC)

- **저장소:** `github.com/Yeachan-Heo/oh-my-claudecode`
- **성격:** Teams-first multi-agent orchestration 레이어
- **구성:** 32 specialized agents, 40+ skills, 자동 병렬화
- **5가지 실행 모드:** `autopilot`, `ultrapilot`, `swarm`, `pipeline`, `ecomode`
- **핵심 기능:** `ultrapilot` 모드는 최대 **5 concurrent workers + 공유 task list + 자동 git worktree 격리**로 3-5x 속도 향상. 20+ 파일 리팩터, 프레임워크 마이그레이션에 최적화.

### 2. everything-claude-code (ECC)

- **저장소:** `github.com/affaan-m/everything-claude-code`
- **성격:** Agent harness performance optimization system (100K+ stars)
- **구성:** 38 agents, 156 skills, 72 legacy command shims
- **아키텍처:** **Orchestrator Agents(Planner, Architect)** 가 **Specialized Agents**를 계층적으로 지휘 (hierarchical delegation)
- **프로덕션 사례:** Doctolib 엔지니어링 전체 팀 도입, 기능 개발 40% 가속

### 3. Claude Code 네이티브 병렬 메커니즘

- **Git Worktree (`claude -w feature-x`):** 격리된 worktree에서 독립 세션 실행, 실무 한계 3-5개
- **Task tool (Operator/Orchestrator 패턴):** 메인 세션이 `Task`로 subagent를 분기, 각자 fresh context window 할당 → attention dilution 해결
- **Agent Teams (Anthropic 2026 신규):** Leader-Worker 패턴 + `in_process_teammate` 간 직접 메시징, 20-30초 내 스폰, 3-4x 토큰 비용

**사용자 용어 해석 결과:**
- "operator 패턴으로 terminal 3개 독립 실행" = Claude Code의 **Orchestrator 패턴** + **git worktree 멀티 터미널**
- "agent 스윙" = **agent swarm** (다중 에이전트 협업 패턴)

---

## 10가지 병렬화 방안 브레인스토밍

| # | 방안 | 메커니즘 | 출처 |
|---|------|---------|------|
| B1 | Git Worktree + 멀티 터미널 | `claude -w feature-x`, 독립 세션 | Claude Code 네이티브 |
| B2 | oh-my-claudecode Ultrapilot | 5 concurrent workers + 공유 task list | OMC |
| B3 | Native Agent Teams | Leader-Worker, teammate 메시징 | Anthropic 2026 |
| B4 | Operator + Task tool | 메인이 subagent 분기, fresh context | Claude Code 네이티브 |
| B5 | ECC Orchestrator/Planner | 38 agents 계층적 지휘 | ECC |
| B6 | Review Fan-out | `/plan-{ceo,eng,design,devex}-review` 4 터미널 동시 | gstack + 수동 확장 |
| B7 | 2-Track Pipeline | Backend worktree ↔ Frontend worktree | `docs/dev-log/23` 방안 6 |
| B8 | Pipeline mode (OMC) | 순차 단계 스트리밍 오버랩 | OMC |
| B9 | Role-based Swarm | Research / Implement / Review 역할 분담 | wshobson/agents |
| B10 | Vertical Slice 병렬 | 독립 기능 풀스택 관통 동시 실행 | `docs/dev-log/23` 방안 7 × B1 |

---

## 소크라테스 논증으로 축소

**Q1. `/office-hours`를 병렬화할 수 있는가?**
→ 불가. 대화형 Q&A는 사용자 응답이 병목. **시작점은 직렬 유지.**

**Q2. `/autoplan`은 이미 내부적으로 병렬인가?**
→ 아니오. gstack autoplan 정의상 "sequentially with auto-decisions". 수동 fan-out으로 즉시 4x 이득 가능. → **B6 ROI 최고**.

**Q3. 1-2인 팀에서 worktree 5개를 의미 있게 관리할 수 있는가?**
→ 인간 동시 관리 한계 2개. 나머지는 **자율 실행**이어야 함. → B2, B3, B4 우선.

**Q4. TrueWords Phase 1(MVP 초기)에 대규모 병렬이 필요한가?**
→ 아니오. 코드베이스 작음, 리팩터 대상 없음. **B2 Ultrapilot은 Phase 3+ 재평가.**

**Q5. 네이티브 vs 서드파티 프레임워크?**
→ gstack + superpowers + ui-ux-pro-max 이미 64개 스킬 적재. 전면 도입 시 충돌 위험. **네이티브(B1, B3, B4) 우선, OMC/ECC는 선택적.**

**Q6. 병렬화는 시간만 압축하는가, 품질도 올리는가?**
→ 두 축 독립. **B6, B9 = 품질 축 / B1, B4 = 시간 축.** 둘 다 필요.

**Q7. Phase-Adaptive와 YC Partner Flow 중 어느 쪽이 병렬화와 궁합이 좋은가?**
→ YC Partner Flow. 이유: `/autoplan`이 multi-review 구조라 fan-out이 자연스러움. Phase-Adaptive는 Large 작업에서만 한정적 병렬화.

---

## 최종 6가지 병렬화 패턴 (전역 기준)

| 순위 | 패턴 | 추천도 | 적용 시점 |
|:---:|------|:---:|-----------|
| 1 | **Review Fan-out** (B6) | ★★★★★ 9.5 | `/autoplan` 단계 즉시 |
| 2 | **Git Worktree + Task tool Operator** (B1 + B4) | ★★★★★ 9.0 | Large 작업 TDD |
| 3 | **Role-based Swarm** (B9) | ★★★★ 8.0 | 불확실성 큰 설계 결정 |
| 4 | **2-Track Pipeline** (B7) | ★★★★ 7.5 | Phase 2 (Flutter MVP) |
| 5 | **oh-my-claudecode Ultrapilot** (B2) | ★★★ 6.5 | Phase 3+ 대규모 리팩터 |
| 6 | **Native Agent Teams** (B3) | ★★★ 6.0 | Opus 4.6 호환 확인 후 |

---

## 추천 1위 (Phase-Adaptive)에 얹을 병렬화 Top 3

**특성:** 일상 개발 / 크기 적응 / **시간 축 압축** 중심.
**병목:** 대부분의 시간이 Small/Medium/Large TDD 구현에 소비됨.

### 🥇 1위: Git Worktree + Task tool Operator 패턴 (B1 + B4) — ★★★★★ (9.5/10)

**왜 최고:** Phase-Adaptive의 Large 작업은 이미 `Task 1.1, 1.2, 1.3` 세분화 구조. 각 Task를 worktree에 배치하고 내부적으로 `Task` tool로 Repository/Service/Test를 분기하면 그대로 맞물림. 추가 도구 제로.

```
[Phase-Adaptive Large (3일+)]
brainstorming → writing-plans → checkpoint
  ↓
메인 세션이 Task tool로 subagent 분기:
  ├─ Task("Repository 레이어 TDD")
  ├─ Task("Service 레이어 TDD")
  └─ Task("통합 테스트 작성")
  ↓
verification → requesting-code-review
```

**압축률:** 독립 레이어 3개 기준 2-3x.

### 🥈 2위: Vertical Slice 병렬 (B10) — ★★★★ (8/10)

**왜 2위:** Phase-Adaptive는 "크기 적응"이라 **여러 Small/Medium Task가 동시에 쌓이는** 상황이 일상. 각 Task를 별도 worktree에 올리고 두 터미널을 번갈아 보면 됨.

```
Worktree A: Task 1.1 (Small) — brainstorming → TDD
Worktree B: Task 1.2 (Medium) — brainstorming → writing-plans → TDD
사용자는 한쪽 대기 시 다른 쪽 진행 확인
```

**주의:** 의존성 있는 Task끼리는 순차 유지. Small은 빨리 끝내는 게 오히려 이득인 경우 많음.

### 🥉 3위: Role-based Swarm (B9) — ★★★★ (7.5/10)

**왜 3위:** Phase-Adaptive는 Phase 시작 시 `/plan-eng-review` 1개만 돌리고 나머지는 생략 → **설계 단계의 관점 다양성 부족**. 불확실성 큰 결정(RAG 파라미터, 용어 사전 구조)에 Research/Plan/Critic 분기로 보완. 일상 적용은 과잉, **선택적 사용**.

---

## 추천 2위 (YC Partner Flow)에 얹을 병렬화 Top 3

**특성:** 신규·피벗 / 리뷰 파이프라인 풀세트 / **품질 축 극대화** 중심.
**병목:** `/autoplan`의 4개 리뷰 + `brainstorming`/`writing-plans` 설계 단계.

### 🥇 1위: Review Fan-out (B6) — ★★★★★ (10/10)

**왜 최고:** `/autoplan`이 현재 "sequentially"로 4개 리뷰 직렬 실행 중. 수동 fan-out 시 즉시 **4x 속도**. YC Partner Flow의 **존재 이유**와 정확히 일치하는 패턴.

```
/office-hours (직렬, 1회)
  ↓
[병렬 fan-out — 3~4 터미널]
  Terminal A: /plan-ceo-review
  Terminal B: /plan-eng-review
  Terminal C: /plan-design-review
  Terminal D: /plan-devex-review
  ↓
사용자가 4개 리포트 머지
  ↓
/brainstorming → /writing-plans → TDD → /review → /ship → /qa → /document-release → /retro
```

**압축률:** `autoplan` 단계 4x (20분 → 5-7분).

### 🥈 2위: Role-based Swarm (B9) — ★★★★★ (9/10)

**왜 2위:** YC Flow 사상은 "품질을 위해 overhead 감수". `brainstorming` → `writing-plans`에 Research/Plan/Critic 분기 추가 시 **품질 축의 병렬화** 극대화. 신규/피벗이라 **재작업 비용이 가장 큰 구간**이기도 함.

```
/brainstorming 진입 후 Task tool로 3 subagent 분기:
  ├─ Research (WebSearch + context7 + 유사 사례)
  ├─ Plan (아키텍처 초안)
  └─ Critic (codex review 관점 챌린지)
  ↓
메인이 종합 → /writing-plans 최종 확정
```

### 🥉 3위: Git Worktree + Task tool Operator (B1 + B4) — ★★★★ (8/10)

**왜 3위:** YC Flow도 결국 `TDD → verification → /review` 구현 단계가 있음. 다만 YC Flow의 최대 병목은 "리뷰·설계"라 구현 병렬은 상대 우선순위 낮음. 1·2위 적용 후 보완용.

---

## 핵심 통찰: 병렬화 기법은 파이프라인의 서로 다른 단계에 적용된다

> **병렬화 패턴은 배타적이지 않다. 파이프라인 단계별로 중첩 사용하는 것이 정답이다.**

Phase-Adaptive와 YC Partner Flow 모두 **시작 → 설계 → 구현 → 리뷰 → 배포**의 단계 구조를 갖는다. 각 단계의 병목이 다르기 때문에 **서로 다른 병렬화 패턴이 동시에 유효**하다. 즉 "1위 vs 2위"가 아니라 "1위 + 2위 + 3위 동시 적용"이다.

### 파이프라인 단계 × 병렬화 패턴 매핑

| 단계 | 병목 성격 | 적합한 병렬화 패턴 |
|------|----------|------------------|
| Phase 시작 (office-hours) | 대화 의존 | ❌ 병렬 불가 |
| 설계 검증 (plan-review) | 관점 독립성 | **Review Fan-out (B6)** |
| 아이디어 → 계획 (brainstorming/writing-plans) | 불확실성 | **Role-based Swarm (B9)** |
| 구현 (TDD) | 모듈 독립성 | **Worktree + Task tool (B1+B4)** |
| 다중 기능 진행 | 기능 독립성 | **Vertical Slice (B10)** |
| Backend ↔ Frontend 동시 | 레이어 독립성 | **2-Track Pipeline (B7)** |
| 대규모 리팩터 | 파일 다수 | **OMC Ultrapilot (B2)** |

**Phase-Adaptive / YC Partner Flow 순위의 진짜 의미:**

"1위가 가장 효과 크다"가 아니라 **"그 프로세스의 주 병목 단계에 가장 잘 맞는다"** 는 뜻이다. 전체 실행 시에는 다음과 같이 **파이프라인 전체에 걸쳐 여러 패턴을 동시에 얹는다**.

---

## 실전 예시: 전체 파이프라인 관통 적용

### 예시 1: Phase-Adaptive로 Large 백엔드 Task 실행 (TrueWords Phase 1 현재)

**시나리오:** "RAG 파이프라인의 하이브리드 검색 엔드포인트 구축" (3-5일 규모)

```
[Phase 1 진입 시점]
  /plan-eng-review (직렬 1회)                    — Phase-Adaptive 정석
    └─ 📌 3위 Swarm 적용: brainstorming 단계에서
        Task로 Research/Plan/Critic 분기
        → RAG 파라미터 결정 품질 향상

[Task 1.1: 하이브리드 검색 Repository 구축 (Medium)]
  brainstorming → writing-plans → TDD
    └─ 📌 1위 Worktree + Task tool 적용:
        메인이 Task로 분기
        ├─ Task("dense_retrieval Repository TDD")
        ├─ Task("sparse_retrieval Repository TDD")
        └─ Task("fusion_service 통합 테스트")
  → verification → requesting-code-review

[Task 1.1 진행 중, 독립 Task 1.2 병행 시작]
    └─ 📌 2위 Vertical Slice 적용:
        Worktree B에서 Task 1.2 ("Re-ranking 구현") 동시 진행
        사용자는 Task 1.1 대기 시 Task 1.2 진행 확인

[Phase 종료]
  /ship → /qa → /retro
```

**결과:** 3위(품질) + 1위(구현 시간) + 2위(작업 간 대기 시간)를 모두 얹어 **전 구간 병렬화**.

### 예시 2: YC Partner Flow로 새 방향 탐색 (Phase 2 Flutter MVP 진입 시)

**시나리오:** "Flutter 모바일 MVP를 완전히 새로운 UX 방향으로 기획"

```
[프로젝트 시작 / 피벗]
  /office-hours (직렬 1회)                       — YC Flow 정석
  ↓
  /autoplan 대신 수동 Review Fan-out
    └─ 📌 1위 Review Fan-out 적용 (즉시 4x):
        Terminal A: /plan-ceo-review
        Terminal B: /plan-eng-review
        Terminal C: /plan-design-review
        Terminal D: /plan-devex-review
        사용자가 4개 리포트 머지

  ↓
  /brainstorming → /writing-plans
    └─ 📌 2위 Role-based Swarm 적용:
        brainstorming 내부에서 Task로 3 subagent 분기
        ├─ Research (경쟁 Flutter 앱 UX 패턴 조사)
        ├─ Plan (화면 흐름 + 상태 모델 초안)
        └─ Critic (내비게이션 엣지케이스 챌린지)
        → writing-plans 최종 확정

  ↓
  TDD → verification → /review
    └─ 📌 3위 Worktree + Task tool 적용:
        Task 분기
        ├─ Task("Riverpod Notifier 레이어")
        ├─ Task("go_router 라우팅 + guard")
        └─ Task("Repository impl + Mock 데이터")

  ↓
  /ship → /qa → /document-release → /retro
```

**결과:** YC Flow의 풀 리뷰 철학을 유지하면서 1위(`autoplan`) + 2위(설계) + 3위(구현) 세 병목을 동시에 공격.

### 예시 3: 혼합 - Phase-Adaptive + YC Partner Flow 동시 운영

**시나리오:** TrueWords가 Phase 1 일상 개발 중 "검색 품질 개선" 이슈로 방향 재평가 필요

- **일상 Task** (Small/Medium): Phase-Adaptive 진행 + 1위 Worktree/Task tool
- **병렬로 방향 재검토 세션**: Phase-Adaptive 흐름을 중단하지 않고 **별도 worktree**에서 YC Partner Flow의 Review Fan-out만 독립 실행

```
Main worktree (Phase-Adaptive 일상 개발 지속)
  ├─ Task 1.1 TDD (Task tool 병렬)
  └─ Task 1.2 TDD

Detached worktree (YC Partner Flow 부분 적용)
  ├─ /office-hours (검색 품질 재평가)
  └─ Review Fan-out (4 터미널 동시)
      → 결과를 main worktree에 피드백
```

**핵심:** Phase-Adaptive 전체를 중단하지 않고 **방향 결정이 필요한 부분에만** YC Partner Flow를 얹는다.

---

## TrueWords 맞춤 적용 로드맵

| 시점 | 적용 패턴 | 목적 | 우선순위 |
|------|----------|------|:---:|
| **지금 (Phase 1 백엔드)** | Worktree + Task tool (Repository/Service/Test 동시 TDD) | 일상 구현 2-3x 가속 | 즉시 |
| **Phase 1 불확실성 큰 결정** | Role-based Swarm (RAG 파라미터, 용어 사전 구조) | 설계 품질 향상 | 필요 시 |
| **Phase 2 시작 시 (Flutter MVP)** | Review Fan-out (autoplan 4-terminal 수동 병렬화) | Phase 전환 리뷰 4x | Phase 2 시작일 |
| **Phase 2 본격 개발** | 2-Track Pipeline (Backend worktree + Frontend worktree) | 풀스택 동시 진행 | Phase 2 중반 |
| **Phase 3+ 대규모 작업** | OMC Ultrapilot 선택적 도입 | 615권 임베딩 재처리 등 | Phase 3 평가 |
| **보류** | Native Agent Teams | Opus 4.6 호환 미확인 | 재평가 |

### 즉시 실행 가능한 첫 스텝

1. **이번 주:** 다음 Large 작업에서 `Task` tool을 Repository/Service/Test 분기에 실험 적용 → 체감 2-3x 확인.
2. **다음 Phase 전환 시:** `/autoplan` 대신 4개 `/plan-*-review`를 4 터미널에서 수동 동시 실행 → 체감 4x 확인.
3. **RAG 파라미터 재조정 같은 불확실성 큰 결정:** Role-based Swarm 1회 실험 → `/plan-eng-review` 단독과 결정 품질 비교.

---

## 결과 (Consequences)

### 긍정적

- **파이프라인 단계별로 서로 다른 병렬화 패턴을 중첩** → 전 구간 병렬화 가능
- **추가 프레임워크 도입 없이 네이티브 기능(Worktree, Task tool)만으로 1·2·3위 모두 적용 가능**
- **Phase-Adaptive의 "시간 축"과 YC Partner Flow의 "품질 축"이 서로 다른 병목을 공격** → 같은 기법이 프로세스에 따라 다른 순위를 가짐
- **병렬화를 작업 크기와 Phase 단계에 따라 선택적 적용** → 오버엔지니어링 방지

### 부정적

- Task tool subagent의 결과 품질은 프롬프트 설계에 민감 (실패 시 디버깅 비용)
- Worktree 3개 이상은 1-2인 팀 인지 부하 한계 초과
- 토큰 비용 2-4x 증가 (Max 플랜 전제)
- OMC/ECC 전면 도입은 기존 gstack + superpowers 스킬과 충돌 위험 → 선택적 참고만

### 트리거 조건 (재평가 시점)

다음 중 하나라도 발생하면 이 결정 재평가:

- 팀 규모 3인 이상으로 확장 → 2-Track Pipeline + Vertical Slice 비중 상승
- Phase 3+ 대규모 리팩터/마이그레이션 작업 등장 → OMC Ultrapilot 도입 검토
- Anthropic Agent Teams의 Opus 4.6 호환성 확정 → Native Agent Teams 재평가
- Task tool subagent 품질이 프로젝트 요구에 못 미침 → 서드파티 프레임워크 도입 검토

---

## 관련 문서

- `docs/dev-log/23-development-process-analysis.md` — Phase-Adaptive / YC Partner Flow 결정 원본
- `docs/guides/development-workflow.md` — 실무 워크플로우 가이드
- [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) — OMC 저장소
- [everything-claude-code](https://github.com/affaan-m/everything-claude-code) — ECC 저장소
- [Claude Code Agent Teams 공식 문서](https://code.claude.com/docs/en/agent-teams) — Anthropic 2026
- [Claude Code Common Workflows](https://code.claude.com/docs/en/common-workflows) — 네이티브 Worktree/Task tool
