# Cloud Scheduler — 정기 cron 작업

매일 자동 실행되는 백엔드 작업 목록과 등록 방법.

## 등록된 작업

| 시각 (KST) | 작업 | 스크립트 | 비고 |
|------------|------|----------|------|
| 03:00 | semantic_cache TTL 정리 | `backend/scripts/cleanup_semantic_cache.py --execute` | ADR-55 |
| 03:30 | 봇별 추천 질문 갱신 | `backend/scripts/refresh_suggested_questions.py --execute` | ADR-56 |

> 작업 사이는 30 분 이상 간격 — Qdrant / Gemini 동시 호출 부담 회피.

## GCP Cloud Scheduler 등록 (운영 환경)

운영은 Cloud Run job 으로 스크립트를 패키징한 뒤, Cloud Scheduler 가 HTTP trigger 로
실행한다.

### 1. Cloud Run job 생성 (backend 이미지 재사용)

```bash
gcloud run jobs create refresh-suggested-questions \
  --image gcr.io/$PROJECT/truewords-backend:latest \
  --region asia-northeast3 \
  --service-account truewords-backend-sa@$PROJECT.iam.gserviceaccount.com \
  --command uv \
  --args run,python,scripts/refresh_suggested_questions.py,--execute \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest \
  --set-env-vars QDRANT_URL=$QDRANT_URL,DATABASE_URL_FROM_SECRET=true \
  --max-retries 1
```

### 2. Cloud Scheduler 트리거 등록

```bash
gcloud scheduler jobs create http refresh-suggested-questions \
  --location asia-northeast3 \
  --schedule "30 3 * * *" \
  --time-zone "Asia/Seoul" \
  --uri "https://asia-northeast3-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT/jobs/refresh-suggested-questions:run" \
  --http-method POST \
  --oauth-service-account-email truewords-backend-sa@$PROJECT.iam.gserviceaccount.com
```

## 로컬에서 수동 실행 (개발 / 디버깅)

```bash
cd backend
uv run python scripts/refresh_suggested_questions.py --dry-run    # 활성 봇 목록만
uv run python scripts/refresh_suggested_questions.py --execute    # 모든 활성 봇
uv run python scripts/refresh_suggested_questions.py --bot-id main_bot --execute  # 단일 봇
```

## 모니터링

- Cloud Run job 실행 로그: GCP Console → Cloud Run → Jobs → `refresh-suggested-questions`
- 실패 봇 별도 격리: 한 봇 실패해도 나머지 진행. summary JSON 이 stdout 에 출력 →
  Cloud Logging 으로 자동 수집.
- 알람: failed 봇이 절반 초과 시 Slack notification (TODO: GCP Alert policy 등록).
