# Cloud Run 리소스 권장 설정 (Backend)

## 배경

PR 5 (Reranker A/B) 에서 BGE Cross-encoder 모델 2종 (`BAAI/bge-reranker-v2-m3`, `dragonkue/bge-reranker-v2-m3-ko`) 을 Docker 이미지에 베이크인하면서 메모리/CPU/이미지 사이즈 요구가 변경됨.

## 변경 요약

| 항목 | PR 5 이전 | PR 5 이후 |
|------|----------|-----------|
| 이미지 사이즈 | ~600 MB | **~3 GB** (모델 ~1.1 GB × 2 추가) |
| Cold start (콜드 풀) | ~3-5 초 | **~5-10 초** (이미지 pull + 인스턴스 부팅) |
| 모델 로드 (첫 reranker 호출) | 네트워크 1.1GB 다운로드 (실패 시 graceful) | **즉시 (네트워크 X)** |
| 메모리 | 1-2 GB | **4 GB↑** (BGE 모델 + torch + uvicorn) |
| CPU | 1 vCPU | **2 vCPU↑** (cross-encoder predict 병렬) |

## 권장 Cloud Run 설정

```bash
gcloud run deploy <service-name> \
  --memory 4Gi \
  --cpu 2 \
  --min-instances 1 \
  --concurrency 10 \
  --timeout 60s \
  ...
```

### 각 옵션 근거

- **`--memory 4Gi`**: BGE 모델 2종 (~1.1GB×2) + torch runtime overhead (~500MB) + uvicorn 워커 + 응답 버퍼. 3Gi 는 OOM 위험.
- **`--cpu 2`**: BGE cross-encoder `predict()` 가 단일 호출에서 query-passage pair 50쌍을 forward — 1 vCPU 면 latency 가 늘어남 (관측치 1 vCPU = ~1.2s vs 2 vCPU = ~0.6s, 50 pairs).
- **`--min-instances 1`**: cold start 5-10초가 사용자 경험 깎음. 트래픽 적어도 1개 워밍.
- **`--concurrency 10`**: cross-encoder 가 GIL 영향 + CPU bound. 동시 요청 너무 많으면 latency 폭증.

## 배포 시 모니터링 metric

- `container/memory/utilizations` — 80% 초과하면 8Gi 로 증설 검토
- `request_latencies` — p95 가 5s 초과하면 vCPU 증설
- 첫 5분 cold start 빈도 — `min-instances` 추가 검토

## 롤백 시나리오

만약 메모리 비용 급증이 감당 안 되면:
1. **단기**: Cloud Run 인스턴스 사이즈 8Gi 로 임시 증설
2. **중기**: BGE 모델 1종만 register (PR 8 ADR 결과의 winner 한 종만)
3. **장기**: ONNX 양자화 또는 더 작은 모델 (e.g. `BAAI/bge-reranker-v2-base`) 평가

## 참고

- 모델 다운로드는 `backend/Dockerfile` 의 `model-cache` stage 에서 1회.
- `HF_HOME=/app/.cache/huggingface` 로 sentence-transformers 가 캐시 인식.
- 모델 변경 시 Dockerfile 의 `snapshot_download(...)` 인자만 수정 → 레이어 캐시 invalidate → 재빌드.
