# 49. 적재 파이프라인 v3 (paragraph) 통일 — 검색/적재 일관성 확보

- 일자: 2026-04-30
- 상태: 결정 완료 (적용)
- 영역: Phase 2.2 후속 — 운영 일관성
- 선행: dev-log 45 (v3 운영 전환), 48 (v4 PoC 보류)

---

## Context

dev-log 45에서 `'all'` 봇 `collection_main = malssum_poc_v3` (paragraph 청킹) 운영 전환을 결정했지만, 적재 파이프라인은 그대로 `settings.collection_name = "malssum_poc"` (구 sentence 컬렉션) + `chunk_text(max_chars=500)` (sentence 청킹)으로 동작 중이었다.

→ **검색은 paragraph(v3)에서 하지만 새 데이터 업로드는 sentence(v1)로 적재되는 불일치**.

사용자가 이번 phase 마무리하면서 추가 데이터 임베딩이 필요하다고 지적 → 적재 파이프라인을 v3 (paragraph)로 통일.

---

## 발견된 불일치

| 컴포넌트 | 변경 전 | 의도 |
|---|---|---|
| `'all'` 봇 검색 (`ChatbotConfig.collection_main`) | `malssum_poc_v3` | ✅ paragraph |
| Admin 데이터 업로드 (`data_router.py:272, 399`) | `chunk_text(max_chars=500)` (sentence) | ❌ |
| 적재 대상 컬렉션 (`settings.collection_name`) | `malssum_poc` | ❌ |
| Batch 임베딩 (`batch_service.py:140, 176, 181`) | `settings.collection_name` 사용 | ❌ (sentence 컬렉션에 적재) |
| Analytics 카운트 (`analytics_router.py:42`) | `settings.collection_name` | ❌ (구 컬렉션 카운트) |
| Search fallback (`hybrid.py:87`, `fallback.py:76`) | `settings.collection_name` | ❌ ChatbotConfig 미설정 시 잘못된 컬렉션 |

**결과**: 새 데이터 업로드 → sentence 청킹 → `malssum_poc`에 적재됨 → `'all'` 봇은 `malssum_poc_v3`만 검색 → **새 데이터가 검색 결과에 안 나타남**.

---

## 결정 — 환경변수 + chunker 둘 다 변경

사용자 의견: "환경변수 + chunker paragraph 전환" — 완전한 일관성 확보.

### 변경 사항

#### 1. `chunker.py`에 `chunk_paragraph` 함수 추가

`scripts/chunking_poc.py`의 `chunk_paragraph`를 `src/pipeline/chunker.py`로 이전 (admin 코드에서 import 가능하도록).

```python
def chunk_paragraph(text, volume, source="", title="", date="") -> list[Chunk]:
    """단락 단위 청킹 (운영 기본).
    - 빈 줄 기준 분할
    - PARAGRAPH_MIN_CHARS=200 미만은 다음 단락과 병합
    - PARAGRAPH_MAX_CHARS=3000 초과는 token-based fallback
    """
```

기존 `chunk_text(max_chars=500)`는 그대로 보존 (테스트 회귀 방지).

#### 2. `data_router.py` 두 곳에서 `chunk_text` → `chunk_paragraph`

```python
# 변경 전
chunks = chunk_text(text, volume=volume, max_chars=500, source=source,
                    title=meta["title"], date=meta["date"])

# 변경 후
chunks = chunk_paragraph(text, volume=volume, source=source,
                         title=meta["title"], date=meta["date"])
```

위치: `src/admin/data_router.py:272` (배치 제출), `:399` (직접 적재)

#### 3. 환경변수 `COLLECTION_NAME=malssum_poc_v3`

| 파일 | 변경 |
|---|---|
| `backend/.env` | `COLLECTION_NAME=malssum_poc_v3` |
| `backend/.env.example` | 동일 |
| `backend/.env.production.local` | 동일 |
| `.github/workflows/deploy.yml:76` | 동일 |
| `backend/src/config.py:15` | default `"malssum_poc_v3"` |
| `docs/05_env/environment-setup.md` | 표 업데이트 |
| `docs/06_devops/ci-cd-pipeline.md:51` | 동일 |

→ `settings.collection_name`을 참조하는 **모든 코드 경로**가 자동으로 `malssum_poc_v3`로 정합.

---

## 검증

### 단위 테스트

```bash
$ uv run pytest tests/ -x -q --ignore=tests/test_ragas_thresholds.py
558 passed, 1 xfailed, 256 warnings in 81.43s
```

기존 `chunk_text` 테스트(14개)는 함수 보존됐으므로 그대로 통과.

### Smoke 테스트

```bash
$ curl -sS http://localhost:8000/health
{"status":"ok"}

$ curl -sS -X POST http://localhost:8000/chat -H 'Content-Type: application/json' \
    -d '{"query":"여의도 세계본부 건물은 본래 몇 층으로 지을 계획이었습니까?","chatbot_id":"all"}' \
    -o /dev/null -w '%{http_code}'
200  # 두 번 모두
```

`'all'` 봇 chat 정상 동작 (chatbot_config.collection_main = malssum_poc_v3 명시적 사용 + cache 정상).

---

## 운영 영향

### 즉시 효과
- 새 데이터 업로드 시 paragraph 청킹으로 `malssum_poc_v3`에 적재 → 검색 결과 즉시 반영
- analytics 카운트가 운영 컬렉션과 일치
- search fallback이 ChatbotConfig 미설정 시에도 올바른 컬렉션 참조

### 잠재 영향
- **기존 `malssum_poc` 컬렉션은 보존됨** — A/B 측정 비교용으로 유지
- 기존 `malssum_poc` 컬렉션에 적재된 데이터는 `'all'` 봇 검색에 사용되지 않음 (이미 그렇게 운영 중이었음)
- staging 환경: `malssum_poc_v3_staging` 컬렉션 신규 생성 필요 (배포 시 자동 또는 수동)

### 비호환성
- 외부에서 `settings.collection_name` 값을 모니터링하던 도구가 있다면 영향. 본 프로젝트엔 없음.

---

## 후속 액션

1. **새 데이터 적재 시 v3 컬렉션에 paragraph 청킹으로 들어가는지 모니터링**
2. **데이터 50%/75%/100% 마일스톤별 v3 vs v4 재측정** (dev-log 47/48 연결)
3. **방안 E (메타데이터 필터/부스팅)** 후속 PR — 우선순위 최상 (Codex 권고)
4. **v5 PoC** — Hierarchical 또는 Structure-aware 청킹 (사용자 자료 ★★★★★)

---

## 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `backend/src/pipeline/chunker.py` | `chunk_paragraph` 함수 추가 (`+_chunk_token_fallback`) |
| `backend/src/admin/data_router.py` | `chunk_text` → `chunk_paragraph` (2곳) |
| `backend/src/config.py` | `collection_name` default → `malssum_poc_v3` |
| `backend/.env` | `COLLECTION_NAME=malssum_poc_v3` |
| `backend/.env.example` | 동일 |
| `backend/.env.production.local` | 동일 |
| `.github/workflows/deploy.yml` | 동일 |
| `docs/05_env/environment-setup.md` | 표 갱신 |
| `docs/06_devops/ci-cd-pipeline.md` | 환경변수 표기 갱신 |

---

## 핵심 학습

1. **검색/적재 분리는 위험하다** — Phase 2 청킹 PoC 동안 검색은 v3로 옮겼지만 적재는 v1에 남겨뒀다. 이런 임시 상태가 운영에 흘러가면 데이터 drift 발생.
2. **settings.collection_name은 single source of truth** — 코드에 직접 컬렉션명 박지 말고 settings 한 곳만 변경하면 모든 적재/검색/카운트가 따라옴 (검색은 ChatbotConfig 우선이지만 fallback이 settings).
3. **함수 deprecate보다 보존 + 추가가 안전** — `chunk_text`는 14개 테스트가 의존. 삭제하면 테스트 깨짐. paragraph는 신규 함수로 추가, 호출만 변경.
