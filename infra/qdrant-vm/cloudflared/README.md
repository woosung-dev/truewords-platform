# Cloudflare Tunnel 설정

본 프로젝트는 **토큰 방식**으로 cloudflared를 운영한다 (`docker-compose.yml`의
`cloudflared` 서비스 참고). 따라서 이 디렉토리에는 별도 `config.yml` /
credentials 파일을 두지 않는다.

## 라우트 관리 방법

라우팅은 Cloudflare 대시보드에서 관리한다.

1. Cloudflare → Zero Trust → Networks → Tunnels → `qdrant-truewords` 선택
2. **Public Hostname** 탭에서 라우트 추가
   - Hostname: `qdrant.<your-zone>` (Cloudflare 무료 도메인 또는 보유 zone)
   - Service: `http://qdrant:6333`
3. 두 번째 라우트(gRPC가 필요할 때만):
   - Hostname: `qdrant-grpc.<your-zone>`
   - Service: `http://qdrant:6334`

> `qdrant`는 docker-compose의 서비스명이며 같은 `qdrant_net` 브리지 내부
> 통신이라 컨테이너 이름으로 접근된다.

## 토큰 회전

토큰이 노출되면 즉시 회전한다.

1. Cloudflare 대시보드에서 새 토큰 발급
2. GitHub Secrets `CLOUDFLARE_TUNNEL_TOKEN` 갱신
3. VM `.env`의 `CLOUDFLARE_TUNNEL_TOKEN` 갱신
4. `docker compose up -d cloudflared`로 재시작
