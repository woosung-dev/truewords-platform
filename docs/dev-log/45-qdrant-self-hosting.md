# 45. Qdrant 셀프 호스팅 (GCP VM + Cloudflare Tunnel)

> 결정일: 2026-04-29
> 상태: 결정 완료, 구현 진행 중 (`feat/qdrant-self-hosting`)
> 관련 플랜: `~/.claude/plans/tingly-watching-noodle.md`

## 컨텍스트

현재 백엔드(Cloud Run)는 **Qdrant Cloud**를 원격 벡터 DB로 사용한다. 1GB 규모의
종교 텍스트(말씀선집 1~30권 + 외 자료)를 적재하면 Qdrant Cloud Free tier가
빠듯해지고, 유료 플랜은 단일 클러스터당 $25/월부터 시작한다. 또한 향후 AWS로
플랫폼 이관 가능성도 검토 중인데, 매니지드 Qdrant Cloud는 클라우드 종속도가 다소
높다.

## 결정

**GCP VM(e2-medium)에 Docker로 Qdrant를 셀프 호스팅하고, Cloud Run ↔ VM 연결은
Cloudflare Tunnel로 처리한다.**

| 항목 | 선택 | 대안 |
|---|---|---|
| 호스팅 | GCP Compute Engine `e2-medium` (asia-northeast3-a) | Qdrant Cloud 유료, AWS EC2 |
| 인증 | Qdrant API Key (32바이트 랜덤) + Cloudflare Tunnel | API Key only, mTLS |
| 외부 접근 | **Cloudflare Tunnel** (도메인·HTTPS·인바운드 포트 0) | VPC 내부 IP, sslip.io+LE, 도메인+Nginx |
| 데이터 전송 | Cloud → VM 풀 마이그레이션 (체크포인트 기반) | 재인덱싱 |
| 배포 범위 | 프로덕션 완전 대체 (1주일 fallback 유지) | Staging 우선 도입 |

## 의사결정 근거

### 왜 Cloud → VM 셀프 호스팅인가
- **비용**: 1GB 데이터 기준 Cloud 유료 $25/월 vs VM e2-medium $25/월(+ 디스크 $5)이 비슷하지만, **데이터 증가 시 디스크 GB당 $0.17/월** 만 누적 → 장기적으로 셀프 호스팅이 유리
- **데이터 주권**: 스냅샷·백업 자동화 자유도, 인덱스 정책(HNSW 파라미터, on_disk_payload) 직접 통제
- **Free tier 한계**: 0.5GB RAM 제약으로 1GB 데이터 적재 시 OOM 위험 — 운영 안정성 부족

### 왜 Cloudflare Tunnel인가
GCP 외부 접근을 위한 4가지 옵션 비교:

| 옵션 | 도메인 | HTTPS | 포트개방 | AWS 이식성 | 비용 |
|---|---|---|---|---|---|
| **Cloudflare Tunnel** | 불필요 | 자동 | 불필요 | **★★★★★** | 무료 |
| VPC 내부 IP + Serverless VPC Access | - | 불필요 | - | ★☆☆☆☆ (재설계) | +$12/월 |
| sslip.io + Let's Encrypt | 불필요 | 수동 | 6333 개방 | ★★★★☆ (IP 변경 시 재설정) | 무료 |
| 도메인 신규 구매 + Nginx + LE | 필요 | 수동 | 443 개방 | ★★★★☆ | $12/년 |

**Cloudflare Tunnel 채택 핵심 이유**:
1. **AWS 이관 친화** — `cloudflared` 데몬을 EC2로 그대로 옮기면 동일하게 동작 (인프라 코드 변경 0)
2. **인바운드 포트 노출 0** — VM 보안 그룹은 SSH(22)만 열고 Qdrant 포트는 닫힌 채 운영. 단일 EC2 패턴의 가장 큰 약점인 공격면을 제거
3. **도메인·Certbot 운영 부담 0** — Cloudflare가 발급/갱신 자동
4. **DDoS·CDN 무료 포함**

거절된 대안: **VPC 내부 IP**는 GCP 종속도가 높아 AWS 이관 시 PrivateLink/Peering 재설계가 필요하다. 본 결정은 "이관 시점이 정해지진 않았지만 가능성 있음"이라는 시나리오에서 클라우드 무관 설계를 우선시했다.

### 왜 풀 마이그레이션인가 (재인덱싱이 아닌)
- 임베딩 정책(Gemini text-embedding-004 / 1536-d / source-array payload)이
  현재 안정 상태 — 재계산할 이유가 없다
- 1GB 재인덱싱은 토큰 비용 + 시간 부담. 풀 마이그레이션은 1회 ~1시간으로 끝남
- 체크포인트(`backend/scripts/.migration_state.json`) 기반 재개로 중단에 강건

## 영향

### 변경되는 것
- `QDRANT_URL` Secret 값 (Cloud → `https://qdrant.<cf-zone>`)
- `QDRANT_API_KEY` Secret 값 (Cloud key → VM 발급 신규 32바이트)
- `infra/qdrant-vm/` 신규 (docker-compose, provision/setup 스크립트)
- `backend/scripts/migrate_cloud_to_vm.py` + `verify_migration.py` 신규

### 변경되지 않는 것
- `backend/src/qdrant_client.py` — 환경변수 주입 방식 그대로
- `backend/src/config.py` — 이미 환경변수 기반
- `.github/workflows/deploy.yml` — Secret 값만 교체, 워크플로우 수정 0

## 리스크와 대응

| 리스크 | 대응 |
|---|---|
| Cloudflare Tunnel 일시 장애 | Cloud Run 재시도, 1시간+ 장애 시 GitHub Secrets로 즉시 Cloud 롤백 (1주일 fallback 유지) |
| 마이그레이션 중단 | 체크포인트로 재개, Cloud 보존하며 멱등 재실행 |
| API Key 유출 | GitHub Secrets 보관, VM `.env` 권한 600. **GCP Secret Manager 도입은 별도 ADR로 분리** |
| 디스크 풀 (1GB → 증가) | 30GB SSD 모니터링, > 70% 알람. 향후 PD 확장 또는 Snapshot Cold Storage |

## 후속 작업

- GCP Secret Manager 도입 (별도 ADR)
- VM Snapshot → Cloud Storage 자동 백업 (cron + gcloud snapshot)
- Qdrant 클러스터링 (3노드, 데이터 ≥ 10GB 시점)
- AWS 이관 IaC 작성 (Terraform/CDK)

## 참고

- 운영 가이드: [docs/07_infra/qdrant-self-hosting.md](../07_infra/qdrant-self-hosting.md)
- 환경 설정: [docs/05_env/environment-setup.md](../05_env/environment-setup.md)
- 마이그레이션 스크립트: `backend/scripts/migrate_cloud_to_vm.py`, `verify_migration.py`
