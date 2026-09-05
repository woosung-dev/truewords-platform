# 21. Recovery-Doctor 코드베이스 분석 및 적용 검토

> **작성일:** 2026-04-09
> **목적:** 기존 팀원의 개발 결과물(뇌졸중 퇴원환자 AI 챗봇)에서 TrueWords에 적용할 수 있는 RAG 패턴, 인프라 구성 참고
> **소스 위치:** `/Users/woosung/project/agy-project/check-repo/recovery-doctor/`

---

## 프로젝트 개요

- **서비스:** 뇌졸중 퇴원환자 자립생활 지원 AI 챗봇 (ELIS)
- **스택:** FastAPI + PostgreSQL + Qdrant + OpenAI (gpt-4o-mini / text-embedding-3-small)
- **규모:** Q&A ~860건, 복지자원 ~4,200건 (총 ~5,000건)
- **구조:** `backend.py` 단일 파일 7,269줄 (모듈 분리 없음)

---

## RAG 파이프라인 상세

### 임베딩

| 항목 | Recovery-Doctor | TrueWords |
|------|----------------|-----------|
| 모델 | OpenAI `text-embedding-3-small` | Gemini embedding |
| 차원 | 1536 | 1536 |
| 임베딩 대상 | 질문 텍스트만 | 청크 전체 텍스트 |

### 청킹

- **청킹 없음** — Q&A 쌍을 통째로 저장 (질문만 임베딩, 답변은 payload)
- TrueWords는 615권 본문이라 청킹 필수 (현재 max_chars=500)
- [참고] "질문만 임베딩" 접근은 우리의 FAQ/용어사전 컬렉션에 활용 가능

### 하이브리드 검색 (핵심 참고 대상)

```
hybrid_score = vector_score × 0.7 + keyword_score × 0.3
```

| 구성 | 상세 |
|------|------|
| 벡터 검색 | cosine similarity, top-5 |
| 키워드 검색 | **Kiwi 형태소 분석기** (한국어 NLP) |
| 가중치 | 벡터 70%, 키워드 30% |
| 키워드 매칭 | 완전 일치 1.0점, 부분 일치(3자+) 0.5점 |
| 최종 top-k | 3건 |

### 적응형 임계값 (Adaptive Threshold)

키워드 매칭 유무에 따라 동적으로 임계값 조정:

```python
if keyword_score > 0:      # 키워드 매치 있으면 → 낮은 임계값
    threshold = 0.1
elif vector_score > 0.4:    # 벡터 점수 높으면 → 중간 임계값
    threshold = 0.25
else:                        # 둘 다 낮으면 → 높은 임계값
    threshold = 0.4
```

→ 키워드가 매칭되면 벡터 점수가 낮아도 신뢰하는 전략. 종교 용어처럼 특정 키워드가 핵심인 도메인에서 효과적.

### 질문 분류 파이프라인

```
사용자 질문
  → [1] 정확히 일치하는 Q&A? (Jaccard similarity > 0.9)
       ├─ YES → 캐시된 답변 반환
       └─ NO → [2] 웹 검색 키워드 포함? (병원주소, 전화번호 등)
                 ├─ YES → Perplexity API (웹 검색)
                 └─ NO → RAG 하이브리드 검색
```

### LLM 설정

| 항목 | 값 |
|------|-----|
| 모델 | gpt-4o-mini |
| Temperature (RAG) | **0.3** (사실 기반) |
| Temperature (일반대화) | **0.7** (자연스러움) |
| Max Tokens | 300 (짧음) / 700 (보통) / 1200 (길게) — 3단계 |

### 프롬프트 엔지니어링 패턴

참고할 만한 기법들:

1. **출처 언급 금지** — "참고 정보에 따르면", "자료에서" 등 표현 차단
2. **용어 표기 강제** — 특정 단어를 정해진 표현으로 교정 (예: 의료기관 → "뇌졸중 전문 의료기관 혹은 상급병원")
3. **마크다운 금지** — 모바일 챗봇 특성상 순수 텍스트 + 줄바꿈만 허용
4. **사용자 프로필 주입** — 이름, 나이, 거주지, 질환 등을 시스템 프롬프트에 동적 삽입

---

## 인프라/배포 구성

### Docker Compose (4개 서비스)

```yaml
services:
  postgres:    # PostgreSQL 15 Alpine, port 5432
  qdrant:      # Qdrant latest, port 6333/6334
  backend:     # Python 3.11 slim + FastAPI, port 8000
  frontend:    # nginx alpine (리버스 프록시), port 3000/80
```

- 프로덕션/개발 docker-compose 분리 (`docker-compose.yml` / `docker-compose.dev.yml`)
- Health check 설정: `curl -f http://localhost:8000/health` (30s 간격)
- 리소스 제한 설정 있음 (memory, CPU)

### Nginx 리버스 프록시

```
/admin/*  → backend:8000 (관리자)
/api/*    → backend:8000 (API, prefix strip)
/         → React dist/ (정적 파일)
Gzip 압축, 정적 파일 1년 캐시
```

### DB 초기화

```sql
CREATE EXTENSION pg_stat_statements;  -- 쿼리 성능 모니터링
```

### 주요 의존성

```
FastAPI >=0.104.0, uvicorn, openai >=1.3.7
qdrant-client >=1.7.0, psycopg2-binary, sqlalchemy >=2.0.0
kiwipiepy >=0.15.0 (한국어 형태소 분석)
python-docx (DOCX 파싱), pandas (데이터 처리)
httpx (비동기 HTTP), pydantic >=2.0.0
```

---

## TrueWords 적용 추천

### 즉시 적용 가능 (높은 가치)

| 항목 | 내용 | 적용 위치 |
|------|------|----------|
| **Kiwi 형태소 분석기** | 한국어 키워드 추출 강화. BM25 sparse vector보다 한국어 특화 형태소 분석이 더 정확할 가능성 | RAG 파이프라인 키워드 검색 |
| **적응형 임계값** | 키워드 매칭 유무에 따른 동적 threshold | search_tiers 검색 로직 |
| **Temperature 분리** | RAG=0.3 (사실 기반), 일반대화=0.7 | 챗봇 LLM 설정 |
| **응답 길이 3단계** | short(300)/medium(700)/long(1200) 토큰 제한 | 챗봇 설정 옵션 |
| **Health check 엔드포인트** | `/health` API — Cloud Run/Docker 모두 필요 | 배포 설정 |

### 설계 참고 (중기)

| 항목 | 내용 |
|------|------|
| **질문 분류 파이프라인** | 정확매칭(Semantic Cache) → 웹검색 → RAG 순서 분기 |
| **프롬프트 용어 강제 규칙** | 종교 용어 표기 통일에 활용 (예: 특정 표현 → 정해진 형태로 교정) |
| **사용자 프로필 컨텍스트 주입** | 종교적 배경/관심사 기반 개인화 답변 |
| **Docker Compose 구조** | 로컬 개발환경 구성 시 참고 (postgres + qdrant + backend) |
| **pg_stat_statements** | PostgreSQL 쿼리 성능 모니터링 확장 |

### 반면교사 (이렇게 하지 말 것)

| 항목 | Recovery-Doctor의 문제 | TrueWords 현재 상태 |
|------|----------------------|-------------------|
| 7,269줄 단일 파일 | 유지보수 불가능 | Router/Service/Repository 분리 완료 |
| CORS allow_origins=["*"] | 보안 취약 | 특정 도메인만 허용 |
| docker-compose에 DB 비밀번호 하드코딩 | 시크릿 노출 | .env.local + SecretStr 사용 |
| 테스트/CI/CD 없음 | 품질 보장 불가 | 향후 구축 예정 |
| 인증 부재 | 엔드포인트 무방비 | JWT HttpOnly 쿠키 + CSRF 보호 구현 완료 |

---

## 핵심 파일 참조

| 파일 | 내용 | 주요 라인 |
|------|------|----------|
| `recovery-doctor/backend/backend.py` | 전체 로직 (7,269줄) | — |
| ↳ 임베딩 생성 | `_generate_embedding()` | 509-519 |
| ↳ 벡터 DB 초기화 | Qdrant collection 설정 | 418-490 |
| ↳ 하이브리드 검색 | `hybrid_search()` | 858-912 |
| ↳ 키워드 검색 (Kiwi) | `keyword_search()` | 611-773 |
| ↳ 시스템 프롬프트 | RAG/웹검색/Perplexity | 1617-1748, 2111-2147 |
| ↳ 응답 길이 설정 | short/medium/long | 1840-1859 |
| ↳ 적응형 임계값 | 동적 threshold | 2310-2326, 3168-3172 |
| ↳ 질문 분류 | 타입 판별 로직 | 1863-1913 |
| `recovery-doctor/backend/database.py` | SQLAlchemy 모델 | 1-95 |
| `recovery-doctor/docker-compose.yml` | 프로덕션 배포 구성 | — |
| `recovery-doctor/docker-compose.dev.yml` | 개발환경 구성 | — |
| `recovery-doctor/frontend/nginx.conf` | 리버스 프록시 설정 | — |
