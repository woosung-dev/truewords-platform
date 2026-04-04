# REQ-017: 챗봇 시스템 프롬프트 & 데이터 소스 확장

> **상태:** 설계 완료 — 리뷰 대기  
> **우선순위:** ★★★★★ (MVP 필수)  
> **관련 문서:** `04_architecture/05-rag-pipeline.md`, `04_architecture/09-security-countermeasures.md`, `02_domain/06-terminology-dictionary-structure.md`

---

## 1. 배경 및 목적

현재 Admin UI에서 챗봇을 생성/편집할 때 **시스템 프롬프트**를 설정할 수 없고, 데이터 소스도 A/B/C만 지원한다. 설계 문서에는 봇별 페르소나, 응답 규칙, 가드레일, 데이터 소스 D(종교 용어 사전)가 정의되어 있으나 구현되지 않았다.

### 현재 상태 (AS-IS)

```
ChatbotConfig 모델
├── chatbot_id          ✅
├── display_name        ✅
├── description         ✅
├── system_prompt_version  ⚠️ 버전 문자열만 (내용 없음)
├── search_tiers        ✅ (A/B/C만)
├── is_active           ✅
└── organization_id     ✅
```

### 목표 상태 (TO-BE)

```
ChatbotConfig 모델
├── chatbot_id          ✅ 유지
├── display_name        ✅ 유지
├── description         ✅ 유지
├── system_prompt       🆕 시스템 프롬프트 전문 (TEXT)
├── persona_name        🆕 페르소나 이름 (예: "30년 경력 목회공직자")
├── search_tiers        ✅ 데이터 소스 D 추가
├── is_active           ✅ 유지
└── organization_id     ✅ 유지
```

---

## 2. 기능 명세

### 2.1 시스템 프롬프트 관리

#### 2.1.1 시스템 프롬프트 필드

| 필드명 | 타입 | 설명 | 필수 |
|--------|------|------|------|
| `system_prompt` | TEXT | 시스템 프롬프트 전문. LLM에 그대로 전달됨 | N (기본 프롬프트 사용) |
| `persona_name` | VARCHAR(100) | 페르소나 표시 이름 (Admin UI용) | N |

- `system_prompt`가 비어있으면 **기본 시스템 프롬프트**를 사용한다
- `system_prompt_version` 필드는 제거한다 (프롬프트 내용을 직접 저장하므로 불필요)

#### 2.1.2 기본 시스템 프롬프트 구조

```
[페르소나 정의]
- 역할, 톤앤매너, 호칭 규칙

[핵심 신학 지침]
- 참부모님 중심성
- 참부모 일체성
- 독자적 해석 금지

[응답 규칙]
- 구조화 (불릿포인트, 표)
- 출처 명시 필수
- 회피 전략 (정치, 루머, 미합의 논쟁)

[가드레일]
- "인용" 중심, "해석" 지양
- 민감 인물/사건 필터링
- AI 생성 워터마킹
```

#### 2.1.3 시스템 프롬프트 예시 (봇 타입별)

**A. 신학/원리 전문 봇**
```
당신은 30년 경력의 지혜롭고 따뜻한 가정연합 목회공직자입니다.
식구님들의 신학적 궁금증에 대해 원리강론과 3대 경전을 근거로 답변합니다.

[응답 원칙]
• 사용자를 "식구님"으로 호칭합니다
• 답변은 반드시 경전 원문을 인용하며, 출처(경전명, 페이지)를 명시합니다
• 자의적 해석은 배제하고, 근거가 없을 경우 "정확한 지침을 위해 목회자 상담이 필요합니다"로 안내합니다
• 정치적 이슈, 인신공격성 루머에 대해서는 "공식 규정집에 근거가 없습니다"로 응답합니다

[가드레일]
• 참부모님의 말씀이 모든 답변의 최종 기준입니다
• 하늘부모님과 참부모님은 일체이심을 강조합니다
• 이 답변은 AI가 말씀을 기반으로 생성한 것임을 명시합니다
```

**B. 섭리/생애 노정 봇**
```
당신은 참부모님의 생애와 섭리 노정에 대해 깊이 있는 지식을 가진 안내자입니다.
식구님들에게 참부모님의 자서전과 말씀선집을 통해 따뜻한 위로와 신앙적 유대감을 전합니다.

[응답 원칙]
• 참부모님의 생애 사건을 시간순으로 정리하여 맥락을 제공합니다
• 감성적 공감을 먼저 표현한 후, 말씀 근거를 제시합니다
• 출처를 반드시 명시합니다 (자서전 페이지, 말씀선집 권/페이지)

[가드레일]
• 참부모님의 말씀이 모든 답변의 최종 기준입니다
• 이 답변은 AI가 말씀을 기반으로 생성한 것임을 명시합니다
```

**C. 통합 말씀 네비게이션**
```
당신은 가정연합의 모든 말씀 자료를 종합적으로 안내하는 말씀 네비게이터입니다.
식구님들의 일상적인 신앙 질문에 대해 전체 데이터셋에서 가장 적합한 답변을 찾아드립니다.

[응답 원칙]
• 질문의 성격에 따라 적합한 경전/자료를 우선 검색합니다
• 여러 자료에 관련 내용이 있을 경우, 종합하여 정리합니다
• 출처를 반드시 명시합니다

[가드레일]
• 참부모님의 말씀이 모든 답변의 최종 기준입니다
• 최근 말씀과 과거 말씀이 충돌할 경우, 양쪽 모두 제시하되 최근 맥락을 우선 설명합니다
• 이 답변은 AI가 말씀을 기반으로 생성한 것임을 명시합니다
```

---

### 2.2 데이터 소스 확장

#### 2.2.1 데이터 소스 정의

| 코드 | 이름 | Qdrant 컬렉션 | 설명 | 상태 |
|------|------|---------------|------|------|
| **A** | 말씀선집 | `malssum_poc` (source="A") | 615권 말씀선집 | 데이터 적재 진행중 |
| **B** | 어머니말씀 | `malssum_poc` (source="B") | 어머니 말씀 모음 | 데이터 적재 진행중 |
| **C** | 원리강론 | `malssum_poc` (source="C") | 원리강론 텍스트 | 데이터 적재 진행중 |
| **D** | 종교 용어 사전 | `dictionary_collection` | 종교 핵심 용어 정의 | [확인 필요] 데이터 미확보 |

#### 2.2.2 데이터 소스 D 동작 방식

데이터 소스 D는 다른 소스(A/B/C)와 **다른 방식으로 동작**한다:

- A/B/C: `malssum_poc` 컬렉션에서 `source` 필드로 필터링 → 검색 결과를 컨텍스트로 전달
- **D**: `dictionary_collection`에서 질문 관련 용어 3~5개를 검색 → **시스템 프롬프트에 동적 주입**

```
[검색 흐름]
사용자 질문 → 용어 감지 → dictionary_collection 검색 (Top 3~5)
                                    ↓
                        시스템 프롬프트 + 용어 정의 주입
                                    ↓
                        A/B/C 검색 결과와 합쳐서 LLM에 전달
```

> **[확인 필요]** dictionary_collection 데이터가 아직 미확보 상태. D 소스는 UI에 표시하되, 데이터 준비 전까지는 "준비중" 상태로 비활성화.

#### 2.2.3 Cascading Search 설정 예시

```json
{
  "tiers": [
    {
      "sources": ["A", "B"],
      "min_results": 3,
      "score_threshold": 0.75
    },
    {
      "sources": ["C"],
      "min_results": 2,
      "score_threshold": 0.65
    }
  ],
  "rerank_enabled": true,
  "dictionary_enabled": true
}
```

- `dictionary_enabled`: D 소스(용어 사전 동적 주입) 활성화 여부
- D는 tiers에 넣지 않고 **별도 플래그**로 관리 (동작 방식이 다르므로)

---

## 3. 변경 범위

### 3.1 백엔드

| 파일 | 변경 내용 |
|------|----------|
| `src/chatbot/models.py` | `system_prompt: str` 추가, `persona_name: str` 추가, `system_prompt_version` 제거 |
| `src/chatbot/schemas.py` | Create/Update/Response 스키마에 새 필드 반영, `SearchTiersConfig`에 `dictionary_enabled` 추가 |
| `src/chatbot/service.py` | 시스템 프롬프트 조회 메서드 추가 |
| `alembic/versions/` | 새 마이그레이션: `system_prompt` 컬럼 추가, `system_prompt_version` 컬럼 제거 |
| `.env.example` | 변경 없음 |

### 3.2 프론트엔드

| 파일 | 변경 내용 |
|------|----------|
| `src/lib/api.ts` | `ChatbotConfig` 타입에 `system_prompt`, `persona_name` 추가 |
| `src/app/chatbots/[id]/edit/page.tsx` | 시스템 프롬프트 textarea, 페르소나 이름 input 추가 |
| `src/app/chatbots/new/page.tsx` | 동일하게 시스템 프롬프트 입력 필드 추가 |
| 검색 티어 컴포넌트 | 데이터 소스 D 체크박스 추가 (또는 `dictionary_enabled` 토글) |

### 3.3 Admin UI 와이어프레임

```
┌─────────────────────────────────────────────────┐
│ 챗봇 편집                                        │
├─────────────────────────────────────────────────┤
│                                                  │
│ 표시 이름:  [신학/원리 전문 봇              ]     │
│ 설명:      [공직자 및 식구들의 신학적 궁금증]     │
│ [✓] 활성화                                       │
│                                                  │
│ ── 페르소나 설정 ──────────────────────────────── │
│                                                  │
│ 페르소나 이름: [30년 경력 목회공직자         ]     │
│                                                  │
│ 시스템 프롬프트:                                  │
│ ┌───────────────────────────────────────────┐     │
│ │ 당신은 30년 경력의 지혜롭고 따뜻한        │     │
│ │ 가정연합 목회공직자입니다.                 │     │
│ │ 식구님들의 신학적 궁금증에 대해            │     │
│ │ 원리강론과 3대 경전을 근거로 답변합니다.   │     │
│ │ ...                                       │     │
│ │                                           │     │
│ │                                           │     │
│ └───────────────────────────────────────────┘     │
│ * 비워두면 기본 시스템 프롬프트가 적용됩니다       │
│                                                  │
│ ── 검색 티어 설정 ─────────────────────────────── │
│                                                  │
│ [✓] 용어 사전 자동 주입 (D)  ⓘ 준비중            │
│                                                  │
│ Tier 1 (최우선)                                   │
│ 데이터 소스: [✓]A: 말씀선집  [ ]B: 어머니말씀     │
│             [✓]C: 원리강론                        │
│ 최소 결과 수: [3]                                 │
│ 점수 임계값: 0.75 ──●──────                       │
│                                                  │
│ [+ 티어 추가]                                     │
│                                                  │
│ [저장]  [목록으로]                                 │
└─────────────────────────────────────────────────┘
```

---

## 4. DB 마이그레이션 계획

```sql
-- 새 컬럼 추가
ALTER TABLE chatbot_configs ADD COLUMN system_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE chatbot_configs ADD COLUMN persona_name VARCHAR(100) NOT NULL DEFAULT '';

-- 기존 컬럼 제거
ALTER TABLE chatbot_configs DROP COLUMN system_prompt_version;
```

---

## 5. API 변경

### ChatbotConfigCreate (POST /admin/chatbot-configs)

```json
{
  "chatbot_id": "won_bot01",
  "display_name": "신학/원리 전문 봇",
  "description": "공직자 및 식구들의 신학적 궁금증 해결",
  "persona_name": "30년 경력 목회공직자",
  "system_prompt": "당신은 30년 경력의 지혜롭고 따뜻한...",
  "search_tiers": {
    "tiers": [
      {"sources": ["A", "C"], "min_results": 5, "score_threshold": 0.80}
    ],
    "rerank_enabled": true,
    "dictionary_enabled": false
  },
  "is_active": true
}
```

### ChatbotConfigResponse (GET /admin/chatbot-configs/:id)

```json
{
  "id": "uuid",
  "chatbot_id": "won_bot01",
  "display_name": "신학/원리 전문 봇",
  "description": "공직자 및 식구들의 신학적 궁금증 해결",
  "persona_name": "30년 경력 목회공직자",
  "system_prompt": "당신은 30년 경력의 지혜롭고 따뜻한...",
  "search_tiers": {
    "tiers": [...],
    "rerank_enabled": true,
    "dictionary_enabled": false
  },
  "is_active": true,
  "created_at": "2026-04-05T00:00:00",
  "updated_at": "2026-04-05T00:00:00"
}
```

---

## 6. 구현 순서

| 순서 | 작업 | 예상 |
|------|------|------|
| 1 | 백엔드 모델 + 스키마 + 마이그레이션 | 모델 변경 + Alembic |
| 2 | 백엔드 API 업데이트 (service, router) | CRUD 반영 |
| 3 | 프론트엔드 API 타입 업데이트 | `api.ts` |
| 4 | 프론트엔드 UI 구현 (편집/생성 페이지) | textarea + 토글 |
| 5 | 빌드 + 배포 + 테스트 | Docker + Cloud Run |

---

## 7. 미결 사항

| # | 항목 | 상태 |
|---|------|------|
| 1 | dictionary_collection 데이터 확보 시점 | [확인 필요] |
| 2 | 기본 시스템 프롬프트 문구 최종 확정 | [확인 필요] — 위 예시를 기반으로 목회진과 협의 필요 |
| 3 | 데이터 소스 D의 용어 목록 (100~200개) | [확인 필요] — 핵심 신학 용어 리스트 필요 |
| 4 | 시스템 프롬프트 최대 길이 제한 | [가정] 10,000자 — Gemini 컨텍스트 윈도우 고려 |
