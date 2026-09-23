# 열린 작업과 결정

2026-09-24 기준. 완료 내역과 검증 결과는 Git/PR 이력 및 해당 runbook에서 확인한다. 아래 항목은 실행 또는 사용자 결정이 아직 필요한 것만 기록한다.

## 운영·출시

- [ ] 훈독 실기기 검증: Android와 iOS 16.4+에서 설치 → 가입 → 훈독 → 완료를 확인한다. [증거 양식](runbooks/hoondok-pwa-rollout.md#실기기-증거)
- [ ] 훈독 편성 재고 보충: 2026-09-20 투입한 8일분이 9월 27일경 소진된다. 운영 admin 편성 화면과 [후보 찾기](plans/active/2026-09-20-hoondok-curation-assist.md)를 사용한다.
- [ ] 말씀 서고 개통: 권리 원장 시드·본문 추출 후 admin에서 각 저작물을 승인한다. 현재 미승인 항목은 사용자에게 보이지 않는다. [운영 절차](runbooks/hoondok-pwa-rollout.md#말씀-서고-개통-절차-plan-hd-007)
- [ ] 훈독 알림 운영 ON: 실기기 증거, 7일간의 `mission_logs`, 베타 지표 확인과 별도 승인 후 VAPID를 설정한다. [알림 계획](plans/active/2026-09-22-hoondok-notifications.md)
- [ ] GitHub Actions 비용 차단 재발 여부와 실패 시 Issue 알림 동작을 확인한다. [CI/CD 결정](adr/2026-09-05-cicd-audit-decisions.md)

## 제품·권리 결정

- [ ] 독립 베타의 법적 주체, 약관, 개인정보처리방침, 14세 미만 가입 정책과 FFWPU 공식 승인 절차를 확정한다. 모임의 공개 안내·동의 문구도 함께 검토한다. 현재는 동의를 수집하지 않고 베타 고지만 표시한다. [PRD 결정](prd/17-ffwpu-pwa-prd.md)
- [ ] 초기 정본 목록과 저작물별 전재·검색·임베딩·AI 요약·오프라인·푸시 인용 권리 범위를 확정한다. 콘텐츠 검수·철회 책임자도 정한다. [권리 명세](specs/domain/hoondok-entities.md)
- [ ] 가족 모임 개통 시점, 협회 공식 정성 공지의 수신 채널, 가정예배·설교 섭외 운영 주체를 정한다. 현재 가정예배는 프리뷰 셸이다. [훈독 PRD](prd/17-ffwpu-pwa-prd.md)
- [ ] 계정 삭제의 보존 기간과 물리 삭제 정책, 비밀번호 재설정 방식 및 메일 제공자를 정한다. 현재 재설정은 운영자 수동이다. [API 명세](specs/api/hoondok-api.md)
- [ ] 가족·친구 공개 범위의 단계별 문구, 서고 초기 3종의 권위 등급 시드값(O1 제안)을 승인한다. [디자인 명세](specs/web/hoondok-design-system.md)

## 코드·품질 후속

- [ ] 원문 읽기에서 청크 경계의 단어 끊김·목차 붙음을 해결할 원본 파일 기반 방안을 검토한다. 원본 형식(PDF/HWP/DOCX)을 확인해야 한다. [원문 계획](plans/active/2026-09-23-hoondok-reader-polish.md)
- [ ] 훈독 편성 제목이 본문 첫 문장 발췌로 보이는 로컬 데이터 문제를 운영 데이터와 대조한다. 편성자가 짧은 제목을 입력하는 방안을 우선 확인한다.
- [ ] 말씀 서고의 시드/추출 dry-run, 단락 position 충돌, API rate limit·페이지네이션, 노트·형광펜 동작, AI 설명 탭 복귀, `MarkInput.volume` 소속 검증을 코드 이슈로 분리해 우선순위를 판단한다. [서고 계획](plans/active/2026-09-23-hoondok-library.md)
- [ ] 알림 발송기의 암호화 실패 재시도와 전건 실패 시 prune 보호 여부를 운영 로그를 보고 결정한다. [알림 계획](plans/active/2026-09-22-hoondok-notifications.md)
- [ ] `ops-check.sh` JSON escaping·backend 장애 중복 진단, Gemini transport 예외 재시도 및 모델 상수 중복을 정리한다. [VM 운영](../infra/oracle-vm/README.md)
- [ ] 데이터셋 A/B/C/D 확보 후 인제스트, 답변 품질·출처 정확도 평가와 실제 챗봇 조합 검증을 수행한다.

새 이슈는 가능하면 GitHub Issue에 둔다. 이 파일에는 운영 차단 사항과 여러 이슈를 묶는 미결정만 유지한다.
