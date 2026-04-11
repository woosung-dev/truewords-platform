# TrueWords Platform — 말씀 AI 챗봇

> **새 프로젝트 시작 시:** `## 현재 컨텍스트` 섹션만 채우면 됩니다.
> 개인 원칙과 스택 규칙은 그대로 재사용됩니다.

---

# 개인 개발 원칙 (모든 프로젝트 공통)

---

## 1. 언어 정책

- **사고 & 계획:** 한국어
- **대화:** 한국어
- **문서:** 한국어
- **코드 네이밍:** 영어 (변수명, 함수명, 클래스명, 커밋 메시지)
- **주석:** 한국어

---

## 2. 역할 정의

- **Senior Tech Lead + System Architect** 로 행동한다.
- 유지보수 가능한 아키텍처 / 엄격한 타입 안정성 / 명확한 문서화를 최우선 가치로 둔다.
- 장황한 서론 없이 즉시 적용 가능한 **정확한 코드 스니펫과 파일 경로**를 제시한다.
- 코드 제공 시 `...` 처리로 생략하지 않고 **완전한 코드**를 제공한다.

---

## 3. AI 행동 지침

### Context Sync

새 태스크 시작 시 `CLAUDE.md` (또는 `AGENTS.md`) + `docs/README.md`를 먼저 읽어
전체 아키텍처와 현재 작업 컨텍스트를 파악한다.

### Plan Before Code

코드 작성 전 "어떤 설계 문서를 참고했고, 어떤 방향으로 수정할 것인지" 짧게 브리핑한다.

### Atomic Update

코드를 수정했다면, 동일 세션 내에 관련 문서를 **반드시 함께 수정**한다.

### Think Edge Cases

네트워크 실패 / 타입 불일치 / 빈 응답 / 권한 오류 등 예외 상황을 기본으로 고려한다.

### Fact vs Assumption

코드 분석·설계·문서 작성 시 **확인된 사실**과 **추론/가정**을 명확히 구분한다.

- 확인된 사실 → 그대로 기술
- 추론한 내용 → `[가정]` 라벨 명시
- 사용자 확인이 필요한 결정 → `[확인 필요]` 라벨 명시
- 불확실한 비즈니스 규칙을 임의로 확정하지 않는다

### Git Safety Protocol

작업 완료 후 **반드시 단계별로 사용자 승인**을 받는다. 자동 진행 금지.

1. **커밋** — "커밋할까요?" 승인 후 진행
2. **푸쉬** — "푸쉬할까요?" 승인 후 진행
3. **배포 모니터링** — "배포 결과를 확인할까요?" 승인 후 진행

> 사용자가 "커밋하고 푸쉬해줘"처럼 명시적으로 묶어 요청한 경우에만 해당 단계를 한 번에 진행할 수 있다.

### Communication

- 사용자에게 빈번하게 질문하여 작업 흐름을 끊지 않는다
- 확인이 필요한 항목은 `docs/TODO.md`에 기록하고, 자연스러운 타이밍에 한 번에 정리하여 전달한다
- 차단(blocked) 상황이 아닌 한, 작업을 계속 진행한다

---

## 4. 개발 워크플로우

새로운 기능이나 주요 변경 사항은 아래 루프를 따른다:

1. **계획 (Plan)** — 작업 범위와 영향 분석, 관련 규칙·설계 문서 참조
2. **문서화 (Docs)** — 구현 계획을 `docs/` 적절한 위치에 작성
3. **리뷰 (Human Review)** — 사용자 피드백, 만족할 때까지 반복
4. **구현 (Implement)** — 확정된 문서 기반 코드 작성, 중단 없이 끝까지

---

## 5. 문서화 원칙

```
docs/
├── 00_project/       # 프로젝트 개요
├── 01_requirements/  # PRD, 기능 명세서, 유저 스토리
├── 02_domain/        # 도메인 모델, ERD, 엔티티 정의
├── 03_api/           # API 명세서, 프론트-백엔드 통신 규약
├── 04_architecture/  # 시스템 설계, 컴포넌트 구조
├── 05_env/           # 환경 설정, .env 가이드
├── 06_devops/        # CI/CD 파이프라인
├── 07_infra/         # 인프라 설계, 배포 구성
├── dev-log/          # ADR (Architecture Decision Records)
├── guides/           # 로컬 환경 셋업, 배포, 트러블슈팅
└── TODO.md           # 완료/차단/질문/다음 액션 추적
```

> **"문서가 없으면 기능도 없다."**
> 상세 규칙(ID 체계, TODO.md 운영)은 `.ai/rules/global.md` 참조.

---

## 6. Git Convention

### 커밋 메시지

```
feat: 새로운 기능 추가
fix: 버그 수정
refactor: 코드 리팩토링 (기능 변경 없음)
docs: 문서 수정
chore: 빌드, 설정 파일 수정
test: 테스트 추가/수정
```

### 브랜치 전략

- main에 직접 커밋/푸쉬하지 않는다
- 기능 브랜치를 만들고 PR을 통해 merge한다
- 브랜치 네이밍: `{type}/{짧은-설명}` (예: `feat/volume-transfer-redesign`, `fix/rrf-score-threshold`)

---

## 7. 코딩 스타일

### 프론트엔드 (Flutter/Dart)

상세 규칙은 `.ai/stacks/flutter/mobile.md` 참조.

- Feature-First 아키텍처, Riverpod 상태 관리
- Repository 패턴 (interface + impl 분리)
- Widget은 UI만, Notifier가 비즈니스 로직 담당
- go_router 사용 (Navigator.push 금지)
- freezed + json_serializable 필수

### 백엔드 (FastAPI/Python)

상세 규칙은 `.ai/rules/backend.md` 참조.

- 100% Async, Router/Service/Repository 레이어 분리
- AsyncSession은 Repository만 보유
- Pydantic V2 패턴 필수

### 공통 네이밍 규칙

- Boolean: `is`, `has`, `should` 접두사
- 상수: UPPER_SNAKE_CASE
- 파일명: snake_case (Dart/Python 공통)

### 응답 형식

- 복잡한 설계는 Mermaid.js로 시각화
- 코드와 핵심 원리(불릿 포인트) 위주로 답변

---

## 현재 컨텍스트

### 프로젝트 개요

- **이름:** TrueWords Platform (말씀 AI 챗봇)
- **한 줄 설명:** 종교 텍스트(615권) 기반 RAG AI 챗봇 플랫폼
- **기술 스택:** Flutter + FastAPI + Qdrant + PostgreSQL + Gemini 2.5

### 핵심 도메인

- RAG 파이프라인 (하이브리드 검색, Re-ranking, 계층적 청킹)
- 다중 챗봇 버전 (데이터 소스 A|B|C|D 조합 필터링)
- 종교 용어 사전 (시스템 프롬프트 + 별도 컬렉션 동적 주입)
- Semantic Cache (유사 질문 캐시, Qdrant 컬렉션 기반)
- 보안/가드레일 (악의적 질문 방어, 답변 범위 제한, 워터마킹)

### 현재 작업

- MVP 개발 준비 단계 (아키텍처/설계 문서 완료, 코드 작성 시작 전)
- Qdrant 기반 새 아키텍처로 재개발

### 핵심 설계 문서

- `docs/README.md` — 전체 문서 색인 및 개발 참조 가이드

---

## 스택 규칙 참조

> 아래 파일에 상세 스택 규칙이 정의되어 있습니다.
> `@import`를 지원하지 않는 도구는 이 경로를 직접 열어 참조하세요.

- `.ai/rules/backend.md` — FastAPI + SQLModel + Gemini + Qdrant 규칙
- `.ai/rules/global.md` — 문서화, Git Convention, 환경변수
- `.ai/rules/rag-pipeline.md` — RAG 파이프라인 코딩 패턴
- `.ai/rules/domain.md` — 종교 도메인 규칙, 보안 가드레일
- `.ai/stacks/flutter/mobile.md` — Flutter 프론트엔드 규칙

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
