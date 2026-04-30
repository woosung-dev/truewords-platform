#!/usr/bin/env bash
# GCP VM(qdrant-server) 프로비저닝 스크립트
#
# 전제:
#   - gcloud CLI 인증 완료 (gcloud auth login)
#   - 활성 프로젝트 설정 (gcloud config set project <PROJECT_ID>)
#
# 사용:
#   ./infra/qdrant-vm/provision.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
ZONE="${ZONE:-asia-northeast3-a}"
INSTANCE_NAME="${INSTANCE_NAME:-qdrant-server}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-medium}"
DISK_SIZE="${DISK_SIZE:-30GB}"
DISK_TYPE="${DISK_TYPE:-pd-ssd}"
NETWORK_TAG="${NETWORK_TAG:-qdrant-server}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "ERROR: PROJECT_ID 가 설정되지 않았습니다. 'gcloud config set project ...' 또는 PROJECT_ID 환경변수를 지정하세요." >&2
  exit 1
fi

echo "==> Project: ${PROJECT_ID}"
echo "==> Zone:    ${ZONE}"
echo "==> Instance: ${INSTANCE_NAME} (${MACHINE_TYPE}, ${DISK_SIZE} ${DISK_TYPE})"

# 1) VM 생성 (이미 존재하면 스킵)
if gcloud compute instances describe "${INSTANCE_NAME}" \
    --project="${PROJECT_ID}" --zone="${ZONE}" >/dev/null 2>&1; then
  echo "==> Instance ${INSTANCE_NAME} already exists, skipping create."
else
  gcloud compute instances create "${INSTANCE_NAME}" \
    --project="${PROJECT_ID}" \
    --zone="${ZONE}" \
    --machine-type="${MACHINE_TYPE}" \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --boot-disk-size="${DISK_SIZE}" \
    --boot-disk-type="${DISK_TYPE}" \
    --tags="${NETWORK_TAG}" \
    --metadata=enable-oslogin=TRUE \
    --shielded-secure-boot \
    --shielded-vtpm \
    --shielded-integrity-monitoring
fi

# 2) 방화벽 규칙
#   인바운드: SSH(22)만. Qdrant 6333/6334는 외부에 열지 않는다.
#   외부 접근은 Cloudflare Tunnel(outbound)로만 처리.
RULE_NAME="allow-ssh-${NETWORK_TAG}"
if gcloud compute firewall-rules describe "${RULE_NAME}" \
    --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Firewall rule ${RULE_NAME} already exists, skipping."
else
  gcloud compute firewall-rules create "${RULE_NAME}" \
    --project="${PROJECT_ID}" \
    --direction=INGRESS \
    --action=ALLOW \
    --rules=tcp:22 \
    --target-tags="${NETWORK_TAG}" \
    --source-ranges=0.0.0.0/0 \
    --description="SSH only. Qdrant ports closed; Cloudflare Tunnel handles inbound."
fi

# 3) 외부 IP 출력 (운영 참고용; 외부 IP는 직접 노출되지 않음)
EXTERNAL_IP=$(gcloud compute instances describe "${INSTANCE_NAME}" \
  --project="${PROJECT_ID}" --zone="${ZONE}" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo ""
echo "✅ Provisioned ${INSTANCE_NAME}"
echo "   External IP: ${EXTERNAL_IP} (참고용; 외부 직접 접근 차단됨)"
echo ""
echo "Next:"
echo "   gcloud compute scp --zone=${ZONE} --recurse ./infra/qdrant-vm ${INSTANCE_NAME}:~/qdrant-vm"
echo "   gcloud compute ssh ${INSTANCE_NAME} --zone=${ZONE} --command='bash ~/qdrant-vm/setup-vm.sh'"
