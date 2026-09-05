# .ai/rules 및 AGENTS.md 프로젝트 맞춤 수정 계획 (v2)

## Context

`.ai/rules/`와 `AGENTS.md`는 **범용 템플릿**에서 복사한 상태로, 실제 프로젝트 결정 사항(docs/01-17)과 다수 불일치가 있다. 사용자 피드백을 반영하여 수정 계획을 재수립한다.

### 사용자 피드백 요약

1. **docs/ 구조**: `.ai/rules/global.md`의 디렉토리 템플릿(00_project/, 01_requirements/ 등)이 올바른 목표 구조. 실제 docs/를 이 구조에 맞게 재배치해야 함
2. **Flutter 확정**: FE는 Flutter. Next.js, TypeScript 관련 항목 모두 제거
3. **디자인 시스템**: doc 17은 AI가 임의 생성한 것. `.ai/rules/design-system.md`로 바로 만들지 말고 gstack(`/plan-design-review`)으로 고도화 후 결정
4. **중복 파일**: 심링크가 아닌 실제 복사본임 확인됨 → 심링크로 교체 또는 삭제 필요
5. **신규 규칙 파일**: `.ai/rules/` 하위에 생성하면 `.claude/rules/` 심링크 통해 Claude Code가 자동 인식

---

## 현재 심링크 구조 (확인 완료)

```
심링크:
  .claude/CLAUDE.md        → ../AGENTS.md              ✅
  .claude/rules/           → ../.ai/rules/             ✅
  .ai/rules/mobile.md      → ../stacks/flutter/mobile.md  ✅

심링크 아님 (실제 복사본):
  .ai/common/global.md          ← .ai/rules/global.md 복사본
  .ai/stacks/fastapi/backend.md ← .ai/rules/backend.md 복사본
```

---

## 수정 계획

### Step 1: 중복 파일을 심링크로 교체

`.ai/common/global.md`과 `.ai/stacks/fastapi/backend.md`는 심링크가 아닌 실제 복사본. 심링크로 교체하여 단일 소스 오브 트루스를 유지한다.

```bash
# .ai/common/global.md → .ai/rules/global.md 심링크로 교체
rm .ai/common/global.md
ln -s ../rules/global.md .ai/common/global.md

# .ai/stacks/fastapi/backend.md → .ai/rules/backend.md 심링크로 교체
rm .ai/stacks/fastapi/backend.md
ln -s ../../rules/backend.md .ai/stacks/fastapi/backend.md
```

→ 다른 도구(Cursor, Gemini 등)가 이 경로를 참조할 수 있으므로 삭제 대신 심링크 유지

---

### Step 2: AGENTS.md 수정

**파일:** `AGENTS.md`

**2-1. 헤더**
```
# {{PROJECT_NAME}} — {{PROJECT_DESCRIPTION}}
→
# TrueWords Platform — 말씀 AI 챗봇
```

**2-2. 현재 컨텍스트** — 템플릿 → 실제 정보

```markdown
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

### 팀
- 포너즈팀 2명 (김경서 대표, 장우성 개발자)
- 레드팀 (검증/테스트)

### 핵심 설계 문서
- `docs/README.md` — 전체 문서 색인 및 개발 참조 가이드
```

**2-3. 문서화 원칙 (section 5)** — 현재 `.ai/rules/global.md`의 디렉토리 구조 템플릿이 올바름. AGENTS.md의 이 섹션은 **그대로 유지** (00_project/, 01_requirements/ 등). 대신 실제 docs/를 이 구조에 맞게 재배치하는 작업을 별도 Step에서 수행.

**2-4. 스택 규칙 참조** — Flutter 중심으로 정리, 불필요 항목 제거

```markdown
## 스택 규칙 참조

- `.ai/rules/backend.md` — FastAPI + SQLModel + Gemini + Qdrant 규칙
- `.ai/rules/global.md` — 문서화, Git Convention, 환경변수
- `.ai/rules/rag-pipeline.md` — RAG 파이프라인 코딩 패턴
- `.ai/rules/domain.md` — 종교 도메인 규칙, 보안 가드레일
- `.ai/stacks/flutter/mobile.md` — Flutter 프론트엔드 규칙
```

제거 항목:
- ~~`.ai/rules/frontend.md`~~ (Next.js — 사용 안 함)
- ~~`.ai/rules/design-system.md`~~ (gstack으로 고도화 후 결정)
- ~~`.ai/common/typescript.md`~~ (TypeScript 사용 안 함)

**2-5. 코딩 스타일 (section 7)** — TypeScript/React 관련 내용을 Flutter/Dart로 교체

현재 section 7은 TypeScript Strict, Thin Component, React Query/Zustand 등 완전히 Next.js/React 기반. Flutter 프로젝트이므로:
- TypeScript → Dart strict 모드
- React Query → Riverpod
- Zustand → Riverpod
- Suspense/ErrorBoundary → AsyncValue 패턴
- 컴포넌트 네이밍 → Widget/Notifier/Repository 네이밍

→ `.ai/stacks/flutter/mobile.md`에 이미 잘 정의되어 있으므로, section 7을 간소화하고 "상세 규칙은 `.ai/stacks/flutter/mobile.md` 참조"로 위임

---

### Step 3: .ai/rules/backend.md 대폭 수정

**파일:** `.ai/rules/backend.md` — **가장 중요한 수정 대상**

**3-1. Tech Stack 테이블** — 전면 교체

| Before (잘못됨) | After (docs 반영) |
|---|---|
| Database: PostgreSQL on Neon + pgvector 확장 | Database: PostgreSQL (운영 전용: 사용자, 로그, FAQ, 설정) |
| AI: Anthropic Claude API (`anthropic` SDK) | AI: Google Gemini 2.5 Flash/Pro (`google-genai` SDK) |
| (벡터DB 없음) | Vector DB: Qdrant (`qdrant-client`) |
| (임베딩 없음) | Embedding: Gemini text-embedding [확인 필요: 차원] |

Storage(R2), Auth(Clerk), 배포(GCP Cloud Run) 유지.

**3-2. Section 4 "Claude API 패턴" → "Gemini API 패턴"** — 전면 교체

- `anthropic` SDK → `google-genai` SDK
- 스트리밍: `client.models.generate_content_stream()`
- JSON 모드: `response_mime_type="application/json"`
- Context Caching 패턴 (doc 04)
- Flash vs Pro 모델 선택 (doc 02)

**3-3. Section 7 "pgvector 임베딩" → "Qdrant 벡터 검색"** — 전면 교체

- Qdrant 클라이언트 설정 (async)
- 컬렉션 생성 (sparse+dense)
- payload 스키마 (doc 02)
- 하이브리드 검색 (sparse + dense + RRF)
- 메타데이터 필터링 (doc 07)

**3-4. Section 6 스트리밍 → Gemini SSE 패턴으로 구체화**

**3-5. 폴더 구조 (section 10) 업데이트** — 도메인 모듈 반영

```
backend/src/
├── chat/           # 채팅 도메인
├── chatbot/        # 챗봇 버전 관리
├── rag/            # RAG 파이프라인
├── embedding/      # 임베딩 + Qdrant 연동
├── cache/          # Semantic Cache
├── auth/           # Clerk JWT
├── common/
│   ├── database.py     # PostgreSQL
│   ├── qdrant.py       # Qdrant 클라이언트
│   ├── gemini.py       # Gemini 클라이언트
│   ├── prompts.py      # 시스템 프롬프트
│   └── ...
└── core/
    └── config.py
```

**유지 섹션:** 2(Pydantic V2), 3(Architecture 레이어), 5(R2), 8(BackgroundTasks), 9(Alembic)

---

### Step 4: .ai/rules/global.md 수정

**파일:** `.ai/rules/global.md`

**4-1. 환경변수** — 잘못된 키 교체

```bash
# Before
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# After
GEMINI_API_KEY=
QDRANT_URL=
QDRANT_API_KEY=
```

DATABASE_URL 주석: `# Neon PostgreSQL` → `# PostgreSQL`

**4-2. 문서 디렉토리 구조 (section 2)** — 현재 템플릿이 올바르므로 **변경 없음**. 실제 docs/ 재배치는 Step 8에서 처리.

---

### Step 5: 신규 — .ai/rules/rag-pipeline.md

`.ai/rules/` 하위에 생성하면 `.claude/rules/` 심링크를 통해 Claude Code가 자동 인식.

**출처:** docs 02, 05, 06, 07, 08, 11

```yaml
---
paths: ["backend/src/rag/**/*", "backend/src/embedding/**/*", "backend/src/cache/**/*"]
---
```

**포함 내용:**
1. 파이프라인 실행 순서 (Semantic Cache → Query Rewriting → 하이브리드 검색 → RRF → Re-ranking → 생성 → Safety → Cache)
2. 3컬렉션 검색 패턴 (malssum, dictionary, wonri)
3. Cascading Search 패턴 (doc 07)
4. Semantic Cache 패턴 (유사도 ≥ 0.93, doc 08)
5. Re-ranking 패턴 (Cross-encoder Top-50 → Top-10, doc 05)
6. Query Rewriting (LLM 기반, doc 05)
7. 금지 사항 (사전+말씀 혼합 금지, Safety 스킵 금지)

---

### Step 6: 신규 — .ai/rules/domain.md

**출처:** docs 01, 06, 09

```yaml
---
paths: ["backend/**/*", "frontend/**/*"]
---
```

**포함 내용:**
1. 종교 용어 처리 (시스템 프롬프트 100~200개 + dictionary_collection 동적 검색)
2. 보안 가드레일 (Prompt Injection 방어, 워터마킹, 민감 인명 필터, 답변 범위 제한)
3. 다중 챗봇 버전 (payload 필터, book_type enum)
4. 데이터 소스 분류 (malssum | mother | wonri | dict)
5. 답변 면책 고지 필수

---

### Step 7: .ai/stacks/flutter/mobile.md — TrueWords 패턴 추가

Flutter가 FE로 확정되었으므로, 기존 범용 Flutter 규칙에 프로젝트 특화 섹션 추가:

1. **Gemini SSE 스트리밍 수신** — dio + SSE로 AI 채팅 응답 실시간 렌더링
2. **성경 뷰어 패턴** — 대용량 텍스트 가상화 렌더링
3. **묵상 카드 공유** — 이미지 렌더링 → SNS 공유
4. **오디오 재생** — 백그라운드 재생 + 잠금화면 제어

"미확정" 주석 제거 — Flutter 확정.

---

### Step 8: docs/ 디렉토리 재배치

`.ai/rules/global.md` section 2의 디렉토리 구조가 올바른 목표 구조. 현재 플랫 파일(01~17)을 아래 구조로 재배치:

```
docs/
├── 00_project/
│   └── 01-project-overview.md
├── 01_requirements/
│   └── 16-app-feature-spec.md
├── 02_domain/
│   └── 06-terminology-dictionary-structure.md
├── 04_architecture/
│   ├── 02-architecture-design.md
│   ├── 03-vector-db-comparison.md
│   ├── 04-gemini-file-search-analysis.md
│   ├── 05-rag-pipeline.md
│   ├── 07-multi-chatbot-version.md
│   ├── 08-semantic-cache.md
│   ├── 10-vibe-coding-and-pinecone-vs-qdrant.md
│   └── 11-data-routing-strategies.md
├── research/   (또는 dev-log/)
│   ├── 12-market-analysis.md
│   ├── 13-competitor-deep-dive.md
│   ├── 14-success-factors-strategy.md
│   ├── 15-local-llm-benchmark.md
│   └── 17-design-strategy.md
├── 09-security-countermeasures.md → 적절한 위치 [확인 필요]
├── README.md
└── TODO.md
```

[확인 필요] 정확한 파일 매핑은 실행 시 사용자와 확인 후 결정. 위는 초안.

---

### Step 9: .ai/integrations/with-gstack.md 프로젝트 컨텍스트 추가

기존 내용 유지 + 하단에 추가:

```markdown
## TrueWords 프로젝트 컨텍스트

gstack 커맨드 실행 시 참조 문서:

| gstack 커맨드 | 참조 docs |
|---|---|
| /plan-eng-review | doc 02 (아키텍처), doc 05 (RAG) |
| /plan-design-review | doc 17 (디자인), doc 16 (기능 스펙) |
| /plan-ceo-review | doc 14 (전략), doc 12 (시장 조사) |
| /cso | doc 09 (보안 대응) |
| /review | .ai/rules/backend.md, .ai/rules/rag-pipeline.md |
| /qa | doc 16 (비기능 요구사항) |

### 프로젝트 핵심 스택
- AI: Gemini 2.5 Flash/Pro (NOT Claude/OpenAI)
- 벡터 DB: Qdrant (NOT pgvector/Pinecone)
- 운영 DB: PostgreSQL (사용자, 로그, 설정만)
- 프론트엔드: Flutter (Riverpod, go_router)
- 백엔드: FastAPI (100% async)
```

---

### ~~Step 7 (이전): design-system.md~~ → 보류

디자인 시스템(doc 17)은 AI가 임의 생성한 내용. `.ai/rules/design-system.md`로 바로 만들지 않고:
- gstack `/plan-design-review`로 고도화 후 결정
- 필요 시 추후 별도 Step으로 추가

---

### 불필요 항목 정리 (제거 또는 미사용 처리)

| 파일 | 조치 | 이유 |
|---|---|---|
| `.ai/stacks/nextjs/frontend.md` | 미사용 (삭제 또는 보관) | Flutter 확정, Next.js 사용 안 함 |
| `.ai/common/typescript.md` | 미사용 | Flutter/Dart 사용, TypeScript 안 함 |

→ 삭제할지 보관할지는 실행 시 확인. 다른 프로젝트에서 재사용 가능하므로 일단 보관 권장.

---

## 최종 파일 구조

```
.ai/
├── common/
│   ├── global.md              → ../rules/global.md (심링크로 교체)
│   └── typescript.md          # (보관, 이 프로젝트에서 미사용)
├── integrations/
│   ├── with-gstack.md         # (수정) 프로젝트 컨텍스트 추가
│   └── with-superpowers.md    # (유지)
├── rules/
│   ├── backend.md             # (대폭 수정) Gemini + Qdrant + PostgreSQL
│   ├── global.md              # (수정) 환경변수
│   ├── mobile.md              → ../stacks/flutter/mobile.md (기존 심링크)
│   ├── rag-pipeline.md        # (신규) RAG 파이프라인 패턴
│   └── domain.md              # (신규) 종교 도메인 + 보안
└── stacks/
    ├── fastapi/
    │   └── backend.md         → ../../rules/backend.md (심링크로 교체)
    ├── flutter/
    │   └── mobile.md          # (수정) TrueWords 패턴 추가, 미확정 제거
    └── nextjs/
        └── frontend.md        # (보관, 이 프로젝트에서 미사용)

AGENTS.md                      # (수정) 컨텍스트, Flutter 반영, 스택 참조
docs/                          # (재배치) global.md 템플릿 구조로 이동
```

---

## 실행 순서

1. **Step 1** — 중복 파일 심링크 교체
2. **Step 2** — AGENTS.md 수정 (컨텍스트, Flutter, 스택 참조)
3. **Step 3** — backend.md 대폭 수정 (Gemini + Qdrant) ← 가장 중요
4. **Step 4** — global.md 환경변수 수정
5. **Step 5** — rag-pipeline.md 신규 생성
6. **Step 6** — domain.md 신규 생성
7. **Step 7** — flutter/mobile.md 프로젝트 패턴 추가
8. **Step 8** — docs/ 디렉토리 재배치 [사용자 확인 후]
9. **Step 9** — with-gstack.md 프로젝트 컨텍스트

**보류:** design-system.md → gstack `/plan-design-review` 이후 결정

---

## 검증 방법

1. `.ai/rules/backend.md`에서 "anthropic", "pgvector", "1536", "claude" grep → 0건
2. `.ai/rules/global.md`에서 "ANTHROPIC_API_KEY", "OPENAI_API_KEY" grep → 0건
3. `AGENTS.md`에서 `{{` grep → 0건
4. `.ai/common/global.md`, `.ai/stacks/fastapi/backend.md` → 심링크 확인 (`file` 명령)
5. `.ai/rules/rag-pipeline.md`, `.ai/rules/domain.md` 존재 확인
6. AGENTS.md에 "Next.js", "TypeScript" 언급 없음 확인
7. docs/ 디렉토리가 global.md 템플릿 구조와 일치 확인
