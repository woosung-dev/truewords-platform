# Postgres 를 Neon 에서 Oracle VM 으로 이전하고 일일 백업을 붙인 결정 ADR

- **작성일**: 2026-07-29
- **상태**: 적용 완료 (커밋 `c9f6de5`)
- **관련**: [GCP → Oracle 이전 ADR](2026-07-25-gcp-to-oracle-migration.md) · [이전 운영 가이드](../07_infra/oracle-vm-migration.md) · [운영 README](../../infra/oracle-vm/README.md)

## Context

GCP → Oracle 이전(2026-07-25 ADR)은 backend 와 Qdrant 만 옮기고 **PostgreSQL 은 Neon 유지**를 명시적 범위 제외로 뒀다. 이전 자체의 변수를 줄이려는 판단이었다.

이전 후 실측에서 그 결정이 병목으로 드러났다.

| 측정 | 값 |
|---|---|
| 도쿄 VM → Neon(us-east-1) 왕복 | 172ms |
| 채팅 1회당 DB 쿼리 | 5~10회 |
| 그중 순수 네트워크 대기 | 1~2초 |
| 채팅 응답 총 시간 | 34초 |

DB 크기는 47MB 다. 데이터가 작아서 얻는 것도 없이 대륙 간 왕복만 지불하고 있었다.

## 결정

**PostgreSQL 을 같은 VM 의 컨테이너로 옮긴다.**

```yaml
postgres:
  image: postgres:17-alpine
  ports: ["127.0.0.1:5432:5432"]     # 루프백 전용 — 덤프/복구·디버깅용
  volumes: [/opt/postgres/data:/var/lib/postgresql/data]
  mem_limit: 1g
```

`backend` 는 `depends_on: postgres(service_healthy)` 로 묶어 마이그레이션이 DB 기동보다 앞서 도는 것을 막는다.

**결과: 채팅 응답 34초 → 23.7초.**

### 왜 mem_limit 1g 인가

DB 47MB 에 인덱스·연결 버퍼를 더해도 1g 로 충분하다. 12GB 를 qdrant 6g + backend 3g + postgres 1g + cloudflared 0.5g 로 배분하면 host·docker 몫과 헤드룸이 남는다. 실사용은 전체 2.1GB 다.

### 왜 루프백에만 publish 하는가

컨테이너 간 통신은 `truewords_net` 의 서비스 DNS(`postgres:5432`)로 충분하다. 호스트 publish 는 `pg_dump`·`psql` 같은 VM 로컬 작업 편의용이며, `127.0.0.1` 바인딩이라 Security List(TCP 22만 허용)와 무관하게 외부에서 닿지 않는다.

## 백업 결정

Neon 을 떠나면서 **Neon 이 제공하던 자동 백업과 PITR 이 사라졌다.** 이걸 메우지 않으면 이전이 순수 다운그레이드가 된다.

### 전체 덤프 vs WAL 아카이빙

47MB DB 에 WAL 아카이빙(PITR)은 과하다. 아카이브 저장소·타임라인 관리·복구 절차 복잡도를 다 짊어지면서 얻는 건 "몇 시간 단위 → 몇 분 단위" RPO 개선인데, 이 서비스의 쓰기는 채팅 로그와 설정이라 하루치 유실이 치명적이지 않다. **매일 전체 덤프**를 택했다. 덤프가 11MB 라 시간도 1초 단위다.

`backup-db.sh` 가 cron 매일 03:00 KST(18:00 UTC)에 돈다.

1. `pg_dump -Fc` (커스텀 포맷, 자체 압축) → 약 11MB
2. **무결성 검증** — `pg_restore --list` 로 헤더를 읽어본다. 못 읽으면 손상이므로 즉시 실패시킨다. 검증 없는 백업 파이프라인은 실패를 성공으로 기록한다.
3. OCI Object Storage `truewords-backups` 업로드 — VM 로컬만으로는 인스턴스·디스크 유실을 못 막는다
4. `RETAIN_DAYS=14` 경과분 삭제. 원격은 버킷의 90일 lifecycle 규칙이 자동 정리한다

업로드가 실패해도 로컬 백업은 유지하고 경고만 남긴다. 원격 저장소 장애가 로컬 백업까지 실패시키면 안 된다.

### 인증은 Instance Principal

VM 에 OCI 개인키를 두지 않는다. dynamic group `truewords-vm-dg` 에 인스턴스를 넣고 버킷 쓰기 정책만 부여했다. 키 파일이 없으면 유출할 것도 없다.

## 복구 리허설 (2026-07-29)

**미검증 백업은 백업이 아니다.** `restore-drill.sh` 로 실제 복원을 검증했다.

첫 시도는 단순 행 수 비교였고 4개 테이블이 어긋났다. 원인은 백업 결함이 아니라 **덤프 시각(14:41) 이후 27분간 들어온 실사용 트래픽**이었다. 살아 있는 DB 를 상대로 행 수를 비교하는 검사는 애초에 성립하지 않는다.

검사를 백업이 실제로 보장해야 할 성질로 바꿨다 — *덤프에 담긴 모든 행이 원본과 동일하게 되살아난다*. `(id, 행 전체 JSON)` 집합의 차집합 `복원본 EXCEPT 운영본` 이 0 인지 본다. 덤프 이후 새로 생긴 행은 운영본에만 있으므로 이 방향에서는 잡히지 않는다. 두 DB 대조는 같은 클러스터라 `dblink` 로 잇는다.

| 항목 | 결과 |
|---|---|
| 대상 덤프 | `truewords-2026-07-29-1441.dump` (11MB) |
| 복원 | 1초, `pg_restore` rc=0 |
| 대조 | 11개 테이블 34,377행 전부 차집합 0 |
| alembic head | `a1c9e7d0b2f3` 양쪽 일치 |
| **판정** | **PASS** |

리허설 DB 는 검사 통과 후 자동으로 지운다. 실패하면 남겨서 수동 조사할 수 있게 한다.

## 남은 리스크

- **RPO 최대 24시간.** 03:00 직전 장애면 하루치 채팅 로그와 설정 변경이 사라진다. 쓰기 빈도가 올라가면 빈도를 높이거나 WAL 아카이빙을 재검토한다.
- **단일 VM.** DB·벡터DB·앱이 한 호스트라 인스턴스 유실이 전부 유실이다. Object Storage 사본이 마지막 방어선이며, 복구 절차는 `infra/oracle-vm/README.md` §복구에 있다.
- **Neon 계정 미정리.** 구 연결 문자열을 VM `.env` 의 `NEON_DATABASE_URL_BACKUP` 으로 보존 중이다. 정리는 별도 트리거.
