# .ai/rules 및 AGENTS.md 프로젝트 맞춤 수정 계획

## Context

`.ai/rules/`와 `AGENTS.md`는 **범용 템플릿**에서 복사한 상태로, 실제 프로젝트 결정 사항(docs/01-17)과 다수 불일치가 있다. 특히 AI 모델(Claude→Gemini), 벡터DB(pgvector→Qdrant), 환경변수 등이 잘못되어 있어 개발 지시 시 혼란을 유발한다. gstack 스킬을 활용한 개발에 앞서 이를 바로잡는다.

---

## 핵심 불일치 요약

| 영역            | 현재 (.ai/rules)                           | 실제 (docs/)                       | 심각도    |
| --------------- | ------------------------------------------ | ---------------------------------- | --------- |
| AI 모델         | Anthropic Claude API                       | **Gemini 2.5 Flash/Pro**           | 치명적    |
| 벡터DB          | pgvector (1536dim)                         | **Qdrant** (하이브리드 검색)       | 치명적    |
| 환경변수        | ANTHROPIC_API_KEY, OPENAI_API_KEY          | **GEMINI_API_KEY, QDRANT_URL**     | 치명적    |
| DB 역할         | Neon PostgreSQL + pgvector                 | PostgreSQL(운영만) + Qdrant(검색)  | 높음      |
| 문서 구조       | `docs/00_project/`, `01_requirements/` ... | `docs/01-*.md ~ 17-*.md` (플랫)    | 중간      |
| 프로젝트 정보   | `{{PROJECT_NAME}}` 템플릿                  | TrueWords Platform 정보 미기입     | 중간      |
| RAG/도메인 규칙 | 없음                                       | docs 05,06,07,08,09,11에 상세 정의 | 높음      |
| 디자인 시스템   | 없음                                       | doc 17에 컬러/타이포/컴포넌트 정의 | 중간      |
| 파일 중복       | global.md 3벌, backend.md 2벌              | —                                  | 정리 필요 |

> "나의 답변 피드백" 문서구조는 .ai/rules가 맞는것 같아. 해당 부분에 맞도록 기존 실제 docs의 내용을 다시 바꿔줘야할것 같아.
> "나의 답변 피드백" 디자인 시스템은 임의로 만든건데.. 해당 부분은 gstack을 통해서 고도화 하는게 좋을지 가져가는게 좋을지 고민이야..
> "나의 답변 피드백" 파일 중복의 경우 심리크로 연결되어있는것으로 알고 있는데,, 확인하고 지워야할것 같아

---

## 수정 계획

### Step 1: 중복 파일 삭제

| 삭제 대상                       | 이유                               |
| ------------------------------- | ---------------------------------- |
| `.ai/common/global.md`          | `.ai/rules/global.md`과 완전 동일  |
| `.ai/stacks/fastapi/backend.md` | `.ai/rules/backend.md`과 완전 동일 |

→ 단일 소스 오브 트루스: `.ai/rules/`가 규칙의 원본

> "나의 답변 피드백" 파일 중복의 경우 심리크로 연결되어있는것으로 알고 있는데,, 확인하고 지워야할것 같아

---

### Step 2: AGENTS.md 수정

**파일:** `/Users/woosung/project/agy-project/truewords-platform/AGENTS.md`

**2-1. 헤더 (line 1)**

```
# {{PROJECT_NAME}} — {{PROJECT_DESCRIPTION}}
→
# TrueWords Platform — 말씀 AI 챗봇
```

**2-2. 현재 컨텍스트 (lines 152-168)** — 템플릿 → 실제 정보

```markdown
## 현재 컨텍스트

### 프로젝트 개요

- **이름:** TrueWords Platform (말씀 AI 챗봇)
- **한 줄 설명:** 종교 텍스트(615권) 기반 RAG AI 챗봇 플랫폼
- **기술 스택:** Next.js 16 + FastAPI + Qdrant + PostgreSQL + Gemini 2.5

### 핵심 도메인

- RAG 파이프라인 (하이브리드 검색, Re-ranking, 계층적 청킹)
- 다중 챗봇 버전 (데이터 소스 A|B|C|D 조합 필터링)
- 종교 용어 사전 (시스템 프롬프트 + 별도 컬렉션 동적 주입)
- Semantic Cache (유사 질문 캐시, Qdrant 컬렉션 기반)
- 보안/가드레일 (악의적 질문 방어, 답변 범위 제한, 워터마킹)

### 현재 작업

- MVP 개발 준비 단계 (아키텍처/설계 문서 완료, 코드 작성 시작 전)
- 베타 버전(Gemini File Search + pgvector FAQ) 존재하나 이어서 개발하지 않음
- Qdrant 기반 새 아키텍처로 재개발

### 팀

- 포너즈팀 2명 (김경서 대표, 장우성 개발자)
- 레드팀 (검증/테스트)

### 핵심 설계 문서

- `docs/README.md` — 전체 문서 색인 및 개발 참조 가이드
```

**2-3. 문서화 원칙 (lines 83-96)** — 디렉토리 구조를 실제에 맞게 수정

현재 `docs/00_project/`, `01_requirements/` 등 카테고리 디렉토리 구조인데, 실제는 `docs/01-*.md ~ 17-*.md` 플랫 구조. 실제 구조 반영:

```markdown
docs/
├── 01~11 백엔드/인프라 기술 결정 (아키텍처, DB, RAG, 보안 등)
├── 12~17 시장 조사/프로덕트 설계 (시장분석, 기능 스펙, 디자인)
├── README.md 전체 색인 + 개발 참조 가이드
└── TODO.md 완료/차단/질문/다음 액션 추적
```

> "나의 답변 피드백" 문서구조는 .ai/rules가 맞는것 같아. 해당 부분에 맞도록 기존 실제 docs의 내용을 다시 바꿔줘야할것 같아.

**2-4. 스택 규칙 참조 (lines 170-178)** — 실제 파일 경로 반영

```markdown
## 스택 규칙 참조

- `.ai/rules/backend.md` — FastAPI + SQLModel + Gemini + Qdrant 규칙
- `.ai/rules/global.md` — 문서화, Git Convention, 환경변수
- `.ai/rules/rag-pipeline.md` — RAG 파이프라인 코딩 패턴
- `.ai/rules/domain.md` — 종교 도메인 규칙, 보안 가드레일
- `.ai/rules/design-system.md` — 디자인 시스템 (컬러, 타이포, 컴포넌트)
- `.ai/stacks/nextjs/frontend.md` — Next.js 16 + shadcn v4 + FSD 규칙
- `.ai/stacks/flutter/mobile.md` — Flutter 규칙 [모바일 프레임워크 미확정]
- `.ai/common/typescript.md` — TypeScript 공통 규칙
```

> "나의 답변 피드백" 해당 부분 다 일부는 필요없는 것들도 좀 보이는데? typescript를 하지 않으르게 FE대신 Flutter를 사용할거야.

---

### Step 3: .ai/rules/backend.md 대폭 수정

**파일:** `/Users/woosung/project/agy-project/truewords-platform/.ai/rules/backend.md`

이 파일이 **가장 중요한 수정 대상**. AI 모델과 DB가 모두 잘못되어 있음.

**3-1. Tech Stack 테이블 (section 1)** — 전면 교체

| Before (잘못됨)                              | After (docs 반영)                                                |
| -------------------------------------------- | ---------------------------------------------------------------- |
| Database: PostgreSQL on Neon + pgvector 확장 | Database: PostgreSQL (운영 데이터 전용: 사용자, 로그, FAQ, 설정) |
| AI: Anthropic Claude API (`anthropic` SDK)   | AI: Google Gemini 2.5 Flash/Pro (`google-genai` SDK)             |
| (벡터DB 없음)                                | Vector DB: Qdrant (하이브리드 검색 엔진, `qdrant-client`)        |
| (임베딩 없음)                                | Embedding: Gemini text-embedding (768/1024dim) [확인 필요]       |

Storage(R2), Auth(Clerk), 배포(GCP Cloud Run) 등은 유지.

**3-2. Section 4 "Claude API 패턴" → "Gemini API 패턴"으로 전면 교체**

- `anthropic` SDK → `google-genai` SDK
- 스트리밍 패턴: `client.models.generate_content_stream()`
- JSON 모드: `response_mime_type="application/json"`
- Context Caching 패턴 (doc 04: 원리강론/대사전 정적 캐싱)
- Flash vs Pro 모델 선택 로직 (doc 02: Flash=일반, Pro=심층)
- Safety settings 설정

**3-3. Section 7 "pgvector 임베딩" → "Qdrant 벡터 검색"으로 전면 교체**

- Qdrant 클라이언트 설정 (async)
- 컬렉션 생성 (sparse+dense vectors)
- payload 스키마 (doc 02: source, book_type, volume, year, chapter)
- 하이브리드 검색 패턴 (sparse + dense + RRF)
- 메타데이터 필터링 패턴 (doc 07: chatbot_filters)
- score_threshold 패턴

**3-4. Section 6 스트리밍 → SSE 패턴 강화**

기존 기본 스트리밍 코드는 유지하되, Gemini 스트리밍 + SSE 형식으로 구체화.

**3-5. 폴더 구조 (section 10) 업데이트**

```
backend/src/
├── chat/           # 채팅 도메인 (대화 관리)
├── chatbot/        # 챗봇 버전 관리 (A|B 조합)
├── rag/            # RAG 파이프라인 (검색, 리랭킹, 생성)
├── embedding/      # 임베딩 생성 + Qdrant 연동
├── cache/          # Semantic Cache
├── auth/           # Clerk JWT 검증
├── common/
│   ├── database.py     # PostgreSQL AsyncSession
│   ├── qdrant.py       # Qdrant 클라이언트
│   ├── gemini.py       # Gemini 클라이언트
│   ├── prompts.py      # 시스템 프롬프트 (핵심 용어 포함)
│   └── ...
└── core/
    └── config.py
```

**유지하는 섹션:** 2(Pydantic V2), 3(Architecture 레이어), 5(R2), 8(BackgroundTasks), 9(Alembic) — 범용 FastAPI 패턴으로 정확함

---

### Step 4: .ai/rules/global.md 수정

**파일:** `/Users/woosung/project/agy-project/truewords-platform/.ai/rules/global.md`

**4-1. 환경변수 섹션 (lines 83-113)** — 잘못된 키 교체

```bash
# Before (잘못됨)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# After
GEMINI_API_KEY=
QDRANT_URL=
QDRANT_API_KEY=
```

DATABASE_URL 주석도 `# Neon PostgreSQL` → `# PostgreSQL` 수정

**4-2. 문서 디렉토리 구조 (section 2)** — AGENTS.md와 동일하게 실제 구조 반영

---

### Step 5: 신규 파일 생성 — .ai/rules/rag-pipeline.md

**파일:** `.ai/rules/rag-pipeline.md` (신규)

> "나의 답변 피드백" 셍상힌디먄.. 심리크로 연결 필요할것 같아. (.ai/rules)하위 모두다.

**출처:** docs 02, 05, 06, 07, 08, 11

```yaml
---
paths:
  [
    "backend/src/rag/**/*",
    "backend/src/embedding/**/*",
    "backend/src/cache/**/*",
  ]
---
```

**포함 내용:**

1. **파이프라인 실행 순서** — Semantic Cache → Query Rewriting → 용어 감지 → 하이브리드 검색(3컬렉션) → RRF 병합 → Re-ranking → 생성 → Safety → Cache 저장 (doc 02 파이프라인 그대로)
2. **3컬렉션 검색 패턴** — malssum_collection, dictionary_collection, wonri_collection 각각의 검색 방식 (doc 06)
3. **Cascading Search 코드 패턴** — 우선순위 기반 폴백 검색 (doc 07)
4. **Semantic Cache 패턴** — 유사도 ≥ 0.93 체크 → 히트 시 즉시 반환, 미스 시 파이프라인 실행 후 저장 (doc 08)
5. **Re-ranking 패턴** — Cross-encoder로 Top-50 → Top-10 (doc 05)
6. **Query Rewriting** — LLM 기반 질문 확장/재작성 (doc 05)
7. **금지 사항** — 사전과 말씀을 같은 컬렉션에 혼합 금지, Safety Layer 스킵 금지

---

### Step 6: 신규 파일 생성 — .ai/rules/domain.md

**파일:** `.ai/rules/domain.md` (신규)

**출처:** docs 01, 06, 09

```yaml
---
paths: ["backend/**/*", "frontend/**/*"]
---
```

**포함 내용:**

1. **종교 용어 처리** — 핵심 100~200개 용어 시스템 프롬프트 주입 + 나머지는 dictionary_collection 동적 검색 (doc 06)
2. **보안 가드레일** — 입력 검증(Prompt Injection 방어), 출력 안전(워터마킹, 민감 인명 필터), 답변 범위 제한(인용 중심, 해석 금지) (doc 09)
3. **다중 챗봇 버전** — payload 필터 패턴, chatbot_id별 데이터 접근 범위, book_type enum (doc 07)
4. **데이터 소스 분류** — book_type: malssum | mother | wonri | dict, 메타데이터 스키마 (doc 02)
5. **답변 면책 고지** — 모든 AI 답변에 "AI 답변은 참고용이며 목회 대체 불가" 고지 필수 (doc 17)

---

### Step 7: 신규 파일 생성 — .ai/rules/design-system.md

**파일:** `.ai/rules/design-system.md` (신규)

**출처:** doc 17

```yaml
---
paths: ["frontend/**/*"]
---
```

**포함 내용:**

1. **컬러 시스템** — Primary(#2C3E6B), Secondary(#C9A96E), Background(#F8F5F0) 등 + 다크/수면 모드
2. **타이포그래피** — Noto Serif KR(성경), Pretendard(UI), 3단계 접근성 폰트 사이즈
3. **핵심 컴포넌트 목록** — ChatBubble, StreamingText, SourceBadge, VerseCard, StreakCounter, GrowthTree 등
4. **애니메이션 규칙** — Lottie(축하), SSE 타이핑 효과, 200-350ms 트랜지션, 60fps
5. **에러 UX 패턴** — AI 지연/타임아웃/부적절 질문/위기 감지 각각의 UI 대응

---

### Step 8: .ai/stacks/nextjs/frontend.md 추가 섹션

**파일:** `.ai/stacks/nextjs/frontend.md` — 기존 내용 유지 + 아래 섹션 추가

1. **SSE 스트리밍 클라이언트** — EventSource/fetch 기반 AI 채팅 응답 수신 + 타이핑 효과
2. **성경 뷰어** — Virtualized List 대용량 텍스트 렌더링 (doc 16 M-05)
3. **묵상 카드 공유** — html2canvas 이미지 렌더링 → SNS 공유 (doc 16 M-02)
4. **디자인 시스템 참조** — `.ai/rules/design-system.md` 연결

---

### Step 9: .ai/stacks/flutter/mobile.md 상단 주석 추가

```markdown
> **[확인 필요]** 모바일 프레임워크 최종 선택 미확정 (React Native 또는 Flutter).
> doc 16, 17 참조. 이 파일은 Flutter 선택 시 적용.
```

기존 Flutter 규칙 내용은 유지 (잘 작성된 범용 패턴).

> "나의 답변 피드백" 해당 부분 확정 맞아.. 그래서 frontend.md를 쓰면 안되.. 해당 포함되는 계획들 제거 해줘야해

---

### Step 10: .ai/integrations/with-gstack.md 프로젝트 컨텍스트 추가

기존 내용 유지 + 하단에 추가:

```markdown
## TrueWords 프로젝트 컨텍스트

gstack 커맨드 실행 시 참조 문서:

| gstack 커맨드       | 참조 docs                                       |
| ------------------- | ----------------------------------------------- |
| /plan-eng-review    | doc 02 (아키텍처), doc 05 (RAG)                 |
| /plan-design-review | doc 17 (디자인), doc 16 (기능 스펙)             |
| /plan-ceo-review    | doc 14 (전략), doc 12 (시장 조사)               |
| /cso                | doc 09 (보안 대응)                              |
| /review             | .ai/rules/backend.md, .ai/rules/rag-pipeline.md |
| /qa                 | doc 16 (비기능 요구사항)                        |

### 프로젝트 핵심 스택

- AI: Gemini 2.5 Flash/Pro (NOT Claude/OpenAI)
- 벡터 DB: Qdrant (NOT pgvector/Pinecone)
- 운영 DB: PostgreSQL (사용자, 로그, 설정만)
- 프론트엔드: Next.js 16 + shadcn v4
```

---

## 최종 파일 구조

```
.ai/
├── common/
│   └── typescript.md              # (유지) TS 공통 규칙
├── integrations/
│   ├── with-gstack.md             # (수정) 프로젝트 컨텍스트 추가
│   └── with-superpowers.md        # (유지)
├── rules/
│   ├── backend.md                 # (대폭 수정) Gemini + Qdrant + PostgreSQL
│   ├── global.md                  # (수정) 환경변수, 문서 구조
│   ├── rag-pipeline.md            # (신규) RAG 파이프라인 코딩 패턴
│   ├── domain.md                  # (신규) 종교 도메인 + 보안 가드레일
│   └── design-system.md           # (신규) 컬러/타이포/컴포넌트/애니메이션
└── stacks/
    ├── nextjs/
    │   └── frontend.md            # (수정) SSE/뷰어/공유 패턴 추가
    └── flutter/
        └── mobile.md             # (수정) 미확정 주석 추가

AGENTS.md                          # (수정) 컨텍스트 채움, 참조 경로 업데이트

삭제:
- .ai/common/global.md             # (삭제) rules/global.md과 중복
- .ai/stacks/fastapi/backend.md    # (삭제) rules/backend.md과 중복
```

---

## 실행 순서

1. 중복 삭제 (Step 1)
2. AGENTS.md 수정 (Step 2)
3. backend.md 대폭 수정 (Step 3) — 가장 중요
4. global.md 수정 (Step 4)
5. rag-pipeline.md 신규 생성 (Step 5)
6. domain.md 신규 생성 (Step 6)
7. design-system.md 신규 생성 (Step 7)
8. frontend.md 추가 (Step 8)
9. flutter/mobile.md 주석 (Step 9)
10. with-gstack.md 추가 (Step 10)

---

## 검증 방법

1. 모든 파일 수정/생성 후 `docs/README.md`의 "문서 간 참조 관계"와 `.ai/rules/` 내용이 일치하는지 크로스체크
2. `.ai/rules/backend.md`에서 "anthropic", "pgvector", "1536", "claude" 키워드가 제거되었는지 grep 확인
3. `.ai/rules/global.md`에서 "ANTHROPIC_API_KEY", "OPENAI_API_KEY" 키워드가 제거되었는지 확인
4. AGENTS.md에서 `{{` 템플릿 변수가 남아있지 않은지 확인
5. 중복 파일(.ai/common/global.md, .ai/stacks/fastapi/backend.md)이 삭제되었는지 확인
