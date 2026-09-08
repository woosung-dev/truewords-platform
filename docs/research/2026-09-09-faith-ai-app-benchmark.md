# 종교 AI 앱 벤치마크 — 기독교 중심 12개 서비스와 훈독 PWA 적용 결정

- 문서 ID: `RES-BENCH-002`
- 조사 기준일: 2026-09-09
- 조사 범위: 공식 홈페이지·스토어·개발사 공개 자료·제3자 리뷰(2026년 기준). 로그인 후 실기기 조작은 하지 않았다.
- 선행 문서: [초원AI 벤치마크](2026-08-30-chowon-ai-benchmark.md) (`RES-BENCH-001`, 2026-08-31), [PWA 제품 방향](2026-08-30-pwa-app-direction.md), 사용자 NotebookLM 조사(기획국 "말씀 앱 개발 — 자료 조사", 초원·Hallow·Eightfold Path 3종)
- 표기: `[확인]` 공개 출처에서 직접 확인 · `[추론]` 둘 이상의 확인 사실 종합 · `[가정]` 후속 검증 필요 · `[제안]` 훈독 PWA 적용 제안
- 후속 문서: [PRD-HOONDOK-001](../prd/17-hoondok-pwa-prd.md), [디자인 루프 기록](../prd/2026-09-09-hoondok-design-loops.md)

---

## 1. 결론 (먼저 읽기)

1. `[추론]` 2026년 기독교 AI 앱 시장은 **"AI 채팅"이 더 이상 차별점이 아니다.** Bible Chat(2,500만 다운로드), 초원(80만+), Hallow AI, YouVersion AI 인사이트까지 모두 채팅·검색·데일리 콘텐츠를 갖췄다. 리뷰어들이 앱을 가르는 기준은 **인용의 정확성·출처 투명성·페이월 압박·사생활**이다.
2. `[확인]` 신뢰의 붕괴 지점은 **성구 오인용**이다. YouVersion CEO는 최고 모델도 성경을 15~60% 오인용한다고 공개 경고했고, Bible Chat·Haven 리뷰는 "정확한 구절을 틀린 책에 귀속"하는 사례를 기록했다. Doxa는 생성 대신 **검증된 원문을 소환(Scripture summoned)** 하는 아키텍처로 이를 회피한다. → TrueWords의 문단 단위 인용·원문 보기 RAG 는 이 경쟁 축의 정답 쪽에 있다.
3. `[확인]` 리텐션은 스트릭 손실 회피에서 **완만한 진행·관계형 동기**로 이동 중이다. Glorify는 스트릭 대신 "신앙 나무" 를 자주 자라게 재설계했고, 2026 습관 앱 리뷰는 Finch(애정 기반) 를 최고로 꼽으며 "스트릭 상실을 재앙처럼 느끼게 하지 말라" 고 권고한다.
4. `[확인]` 커뮤니티는 **소규모·초대형 기도 그룹**이 표준이다(Hallow Prayer Families, Glorify 기도 그룹, 초원 그룹 통독). 공개 피드형은 없다.
5. `[확인]` 가정연합 기존 앱(훈독가정교회·Heavenly Calendar)은 **콘텐츠 열람·천력 위젯**에 머문다. AI 질문·출처 계층·감정 맞춤·소그룹 나눔은 비어 있는 자리다.

---

## 2. 앱별 스냅샷

### 2.1 개신교 — 한국

| 앱 | 확인 내용 | 훈독에 주는 교훈 |
|---|---|---|
| **초원(Chowon)** — 어웨이크코퍼레이션 | `[확인]` 6개 역본·오디오(0.5~3배속)·31,102절 해설·12명 목회자 QT·AI 질문·그룹 통독·교회 지도·교회용 설교 RAG. 2026 송구영신 "키워드 3개 + 기도제목 3개 → 맞춤 성구" 캠페인. 유료화 후 접근성 불만 반복. 상세: [RES-BENCH-001](2026-08-30-chowon-ai-benchmark.md) | 감정·상황 입력 → 말씀 추천은 이미 검증된 진입점. 다만 5탭·달란트·씨앗 성장은 복제 금지(승인 결정). 무료 코어(원문·출처)와 유료(고급 개인화) 경계를 처음부터 명시 |
| **갓피플성경** | `[확인]` 53개 기능·68개 맞춤 설정, 인앱 역본 구매, 통독 최적화·묵상노트·관주·iPad 분할 | 기능 밀도의 반면교사. 훈독은 "오늘 할 한 가지"를 첫 화면에 압축 |
| **큐티한스푼** | `[확인]` 무료, 오늘의 말씀+해설+질문, 일일 알림, 감사노트, 글꼴·배경 조정 | 큰 글씨·배경 조정·감사노트는 고령 식구에게 필수 |
| **매일성경(성서유니온)** | `[확인]` 출판 QT 본문의 모바일판, 일 단위 편성 | 편성 주체가 분명한 콘텐츠 운영 모델(훈독 "오늘의 훈독" 편성 담당자 필요) |

### 2.2 개신교 — 해외

| 앱 | 확인 내용 | 훈독에 주는 교훈 |
|---|---|---|
| **YouVersion Bible** | `[확인]` 2025 AI 구절 인사이트(비생성형·간결 맥락 노트), 2026 Guided Scripture/Prayer 스와이프 뷰어, 탭 가능한 상호참조, QR 공유, 읽기 플랜 친구 멘션. CEO가 AI 오인용 15~60% 공개 경고, 인간 큐레이션 포지셔닝. 리뷰 9.2/10 | **AI를 '생성'보다 '맥락 노트'로 제한**하는 선택지. 스와이프형 가이드 뷰어·상호참조 탭은 훈독 원문 화면에 차용 |
| **Bible Chat** (ai.blble_pics) | `[확인]` 2,500만 DL, 자연어 구절 검색, 2분 AI 데일리 묵상, 기도 의도 트래커(진행/응답/보관 + 알림 주기), 주제 플랜, 잠금 화면 위젯·Apple Watch·"패닉 버튼" 호흡 플로우. 비판: 확신에 찬 오인용, 교단 편향, 출처 불투명, 공격적 A/B 페이월(월 $9.99·연 $49.99) | 기도제목 트래커(진행/응답/보관)와 "패닉 버튼" 은 훈독 기도제목·감정 진입에 직접 적용. 페이월 압박·출처 불투명은 반대로 간다 |
| **Hallow** (가톨릭) | `[확인]` App Store 전체 1위 이력. 2026 Hallow AI 는 교리서·교부·교황 문헌·성경에 근거. 기도 가족(Prayer Families)로 기도 의도·저널 공유, 리마인더·스트릭, 오프라인 세션(1~60분), 저널, 수면 콘텐츠, 2026 동방 가톨릭 기도 추가 | **가족 단위 기도 공유**는 가정연합 "가정" 가치와 정합. 저널(성찰 기록)·길이 선택(1/5/15분)은 훈독 시간 선택에 적용 |
| **Glorify** | `[확인]` 데일리 묵상·가이드 성찰·커뮤니티. UX 개편(Contra 케이스): 스트릭 대신 **Tree of Faith** 를 자주 성장·보상하도록 재설계, 기도 그룹·기도 요청·댓글·리액션, Evangelist 리더보드, 모듈형 페이월로 트라이얼 전환 기록 경신, AI 컴패니언(프리셋+자유 입력) | 완만한 진행 표시는 채택, 리더보드·랭킹은 미채택(비감시 원칙). "프리셋 질문 + 자유 입력" 은 훈독 AI 질문 첫 화면에 적용 |
| **Doxa Engage** | `[확인]` AI 가 생성하지 않고 성경 전문·1,700+ 검증 간증·사용자 기록 3개 출처만 소환. 표시 전 공개 도메인 원문과 단어 단위 대조. "AI 컴패니언 패턴(가짜 우정)"과 "AI 오라클 패턴(신학 주장 생성)" 을 명시적으로 거부. 음성+텍스트, 격려 우선 | **권위 층 분리·원문 대조**의 가장 강한 선례. 훈독의 AI 설명(점선)·공식 원문(굵은 선) 분리와 "확인할 수 없음" 중단을 뒷받침 |
| **Haven / Grace Bible Chat** | `[확인]` Haven 은 "목회자에게 미루기" 태도로 7.0점, 주 단위 과금 비판. Grace 는 교단 설정이 답변을 실제로 바꾸며 개발사 투명성 부족 비판 | "누가 검수했는가" 를 화면에 두는 것이 신뢰 점수를 가른다 → O1~O5/R 배지·검수일 표시 유지 |

### 2.3 타 종교

| 앱 | 확인 내용 | 훈독에 주는 교훈 |
|---|---|---|
| **Eightfold Path — Noah AI** (불교) | `[확인]` 제작자 10년 팟캐스트 200편+저서만 학습한 폐쇄형 RAG. 정답을 강요하지 않는 "거울" 대화, 대본 아카이브 검색, 단계별 무료 코스, 유료 맥락 유지 | 좁고 명확한 코퍼스 + 비권위 톤. 훈독 AI 톤 가이드("스스로 원문으로 돌아가게")의 근거 |
| **Muslim Pro** (이슬람) | `[확인]` 1.8억 DL. 기도 시간·아잔·키블라·꾸란·이슬람 달력을 하나로. 2026 라마단 모드 | **시간 기반 루틴**(하루 5회)이 앱 자체를 일과에 고정. 훈독은 새벽 훈독 시각 + 천력(Heavenly Calendar) 절기를 루틴 축으로 |
| **Insight Timer** (명상) | `[확인]` 미니멀 UI·큰 이미지·즉시 시작. 콘텐츠 제작자 가이드 운영 | 첫 화면에서 "지금 시작" 1탭. 장식보다 여백 |

### 2.4 가정연합 기존 디지털 자산

| 자산 | 확인 내용 | 빈 자리 |
|---|---|---|
| **훈독가정교회 앱** (App Store id1459869688) | `[확인]` 천성경 일일 훈독 본문(글자 크기 조절)+오디오, 성가 3버전(AR/MR/MV), 참부모님 기도 일일 갱신, 천일국 뉴스 영상, 원리강론 본문+오디오, 가정연합 소개 | 검색·출처 메타·용어·AI 질문·개인 기록·그룹 나눔·설치형 웹·알림 설정 없음 `[추론]` |
| **Heavenly Calendar** (v6.1.605, 2026-08-03) | `[확인]` 천력(음력 기반) 날짜 위젯, 주요 절기·기념일, 가정맹세·천일국 국가 수록 | 천력 병기·절기 알림은 훈독 캘린더에 통합할 표준 데이터 소스 `[가정]` 권리 확인 필요 |
| 천원사 전자도서관·familyfedihq 리소스 | `[확인]` 저작권 보호 명시(S0 문서) | 정본 권리 원장 없이는 전재 불가 — 프로토타입은 예시 텍스트만 |

---

## 3. 기능 매트릭스

| 기능 | 초원 | Bible Chat | Hallow | Glorify | YouVersion | Doxa | 훈독가정교회 | **훈독 PWA(제안)** |
|---|---|---|---|---|---|---|---|---|
| 오늘의 말씀/QT | ● 12목회자 | ● AI 2분 | ● 오디오 | ● | ● | ○ | ● 천성경 | ● 편성+감정 맞춤 |
| AI 질문 | ● 생성 | ● 생성 | ● 문헌 근거 | ● | △ 인사이트 | ● 소환 전용 | – | ● **근거 우선·중단 가능** |
| 문단 단위 출처·판본 | △ | ✕ | △ | ✕ | ● 상호참조 | ● 단어 대조 | – | ● O등급·검수일·판본 병기 |
| 용어 사전 | △ 해설 | ✕ | ✕ | ✕ | ✕ | ✕ | – | ● 복수 정의·원문 연결 |
| 감정/상황 입력 | ● 캠페인 | ● 패닉 버튼 | △ | ● 프리셋 | ✕ | ● 격려 | – | ● 온보딩·홈 진입 |
| 기도제목/의도 | ● | ● 진행/응답 | ● 가족 공유 | ● 그룹 | ✕ | ✕ | ● 참부모님 기도 | ● 그룹 내 비공개 |
| 소그룹 | ● 그룹 통독 | ✕ | ● Prayer Families | ● 기도 그룹 | △ 플랜 친구 | ✕ | – | ● 초대제·리더 승인 |
| 숏폼/공유 카드 | ● 말씀카드 | △ | △ | ● 공유 | ● 구절 이미지 | ✕ | – | ● 9:16·권리 원장 연동 |
| 행사/캘린더 | ● 교회 지도 | ✕ | △ 절기 | ✕ | ✕ | ✕ | △ 천력(별도 앱) | ● 천력 병기 |
| 진행 표시 | ● 달란트·연속 | △ 암묵 | ● 스트릭 | ● 나무 | ● 스트릭 | ✕ | – | ● **완만·비처벌** |
| 알림 | ● | ● 잠금 화면 묵상 | ● | ● | ● | ● | ✕ | ● 중립 문구·앱 내 알림함 |
| PWA/웹 | ✕ 네이티브 | ✕ 모바일 전용 | ✕ | ✕ | ● 웹 | ● 웹 | ✕ | ● **설치형 웹 우선** |
| 무료 코어 | △ 유료화 반발 | △ 제한 | △ | △ | ● | △ | ● | ● 원문·출처·오늘은 무료 [제안] |

● 제공 · △ 부분 · ✕ 없음 · – 해당 없음

---

## 4. 패턴별 교훈

### 4.1 신뢰 — "인용 100%, 95%가 아니다"

- `[확인]` warmpeach 리뷰: "이 카테고리는 인용된 구절이 실제이고 올바르게 귀속되는지에 생사가 달렸다. 기준은 95%가 아니라 100%다."
- `[확인]` Doxa: 생성 대신 소환, 표시 전 단어 단위 대조. YouVersion: 비생성형 인사이트.
- `[제안]` 훈독 적용: ① AI 설명·공식 원문·공식 해설·내 메모 4개 권위 층을 색이 아닌 형태로 분리 ② 모든 핵심 주장에 문단 인용 ③ 근거 부족 시 "확인할 수 없음" 종료 + 공식 문의 경로 ④ O1~O5/R 배지·검수일 텍스트 ⑤ 판본 차이 병기. 이는 PRD `REQ-PWA-004/005/012` 로 이미 정의됐고 본 조사로 근거가 강화됐다.

### 4.2 리텐션 — 손실 회피에서 완만한 진행으로

- `[확인]` Glorify 는 스트릭 대신 나무 성장으로 "더 자주 보상", Finch 는 애정 기반 동기, 2026 가이드는 "스트릭 상실을 재앙처럼 만들지 말라·보호 기능·비처벌 리셋".
- `[확인]` Bible Chat 은 스트릭 숫자 없이 데일리 묵상 알림 루프만으로 습관을 만든다.
- `[제안]` 훈독: 연속 기록·달란트·순위 없음(승인 원칙 유지). 대신 **"이번 주 함께 읽은 날"** 점 7개 표시, 놓친 날은 비어 있을 뿐 경고·리셋 없음. 그룹에서는 "함께 읽은 사람 수" 만 표시(개인 순위 없음).

### 4.3 커뮤니티 — 작고 닫힌 기도 그룹

- `[확인]` Hallow Prayer Families, Glorify 기도 그룹(요청·댓글·리액션), 초원 그룹 통독·교회 단체 구독. 모두 초대·가입형이며 공개 타임라인이 아니다.
- `[확인]` Bible Chat 기도 트래커: 진행/응답/보관 상태 + 리마인더 주기.
- `[제안]` 훈독: 초대 링크 + 리더 승인 소그룹, 기도제목은 그룹 내 공개·앱 전체 비공개, 상태(기도 중/응답/보관), 리액션 3종(함께 기도·은혜·감사), AI 주간 요약은 리더 요청 시만 생성(원문 보관 없이 요약만). 미성년 보호·신고·차단은 `[확인 필요]` 게이트.

### 4.4 감정·상황 진입

- `[확인]` 초원 송구영신 캠페인(키워드+기도제목 → 성구), Bible Chat 패닉 버튼, Glorify 프리셋+자유 입력, Doxa 격려 우선.
- `[제안]` 훈독 온보딩 1화면: 감정 칩 6개 + 자유 입력 1줄 → 오늘의 훈독 문단 추천. 추천 근거(어떤 주제 태그로 매칭됐는지)를 한 줄로 표시해 "AI가 내 마음을 읽는다" 는 인상을 피한다. 입력은 기본 저장 안 함.

### 4.5 수익·접근성

- `[확인]` 초원·Bible Chat·Haven 모두 유료화·페이월 압박이 최다 불만. Faith Guide 류는 "완전 무료" 를 무기로 삼는다.
- `[제안]` 베타 단계 가격 미확정(승인 결정). 원문·출처·오늘의 훈독·검색은 무료 코어로 두고, 비용이 설명되는 층(대용량 AI·기관 관리·리더 대시보드)만 후일 유료 후보.

### 4.6 PWA·플랫폼

- `[확인]` 조사한 기독교 앱 중 설치형 웹(PWA) 을 주 채널로 쓰는 곳은 없다(YouVersion·Doxa 는 웹 병행). iOS Web Push 는 16.4+ 홈 화면 설치 시만 가능(S0 문서).
- `[확인]` Serwist 9 는 Next.js 16 Turbopack 을 `@serwist/turbopack` 으로 지원한다. 이번 셸은 의존성 없이 수기 Service Worker 로 시작하고, M5 본구현 시 Serwist 전환을 ADR 후보로 둔다.
- `[제안]` 설치·알림은 첫 가치 경험 뒤 제안, iOS 는 "공유 → 홈 화면에 추가" 안내 시트를 별도 화면으로 둔다.

---

## 5. 디자인 관찰 (프로토타입 루프 입력)

| 관찰 | 출처 | 훈독 반영 |
|---|---|---|
| 베이지·웜 뉴트럴이 "차분함" 으로 평가됨 | 초원 스토어 리뷰 `[확인]` | 웜 뉴트럴 바탕은 유지하되 초원 녹색 회피 |
| 미니멀·큰 이미지·즉시 시작 | Insight Timer `[확인]` | 홈 상단 1행동("오늘 훈독 시작") |
| 잠금 화면 위젯·스와이프 가이드 뷰어 | Bible Chat·YouVersion `[확인]` | 9:16 말씀 카드 스와이프, 원문 화면 상호참조 탭 |
| 나무 성장 = 비처벌 진행 | Glorify `[확인]` | 주간 점 7개(비처벌), 그룹은 인원 수만 |
| 권위 층 시각 분리 | Doxa `[확인]`, PRD | 점선(AI)·굵은 왼쪽 선(원문)·점선 테두리(메모) |
| 고령 사용자 큰 글씨·배경 조정 | 큐티한스푼·훈독가정교회 `[확인]` | 큰 글씨 토글(본문 22px)·고대비·44px 터치 |

---

## 6. 훈독 PWA 적용 결정표

| 항목 | 결정 | 근거 앱 | 상태 |
|---|---|---|---|
| AI 위치 | 원문으로 돌려보내는 연결부. 생성 답변보다 인용 문단이 위 | Doxa·YouVersion | 승인 원칙(S0) |
| 감정 진입 | 온보딩·홈에서 감정 칩+한 줄 → 추천 근거 표시 | 초원·Bible Chat·Glorify | `[제안]` PRD REQ-016 |
| 소그룹 | 초대제·리더 승인·그룹 내 공개 | Hallow·Glorify | 사용자 확정 2026-09-09(범위 포함) |
| 기도제목 | 진행/응답/보관 + 리액션 3종, 알림 주기 | Bible Chat·Glorify | `[제안]` PRD REQ-017 |
| 진행 표시 | 주간 점 7개, 리셋·경고 없음 | Glorify·Finch | `[제안]` |
| 말씀 카드 | 9:16 스와이프, 공유 권리 원장 확인 뒤 노출 | YouVersion·초원 | `[제안]` PRD REQ-018 |
| 캘린더 | 천력 병기·절기·소그룹 행사 RSVP | Muslim Pro·Heavenly Calendar | `[제안]` PRD REQ-019, 천력 데이터 권리 `[확인 필요]` |
| 알림 | 중립 문구 기본, 앱 내 알림함 | S0 승인·Bible Chat | 승인 원칙 |
| 수익 | 베타 미확정, 무료 코어 명시 | 초원 반발 | 승인 원칙 |
| 복제 금지 | 초원 녹색·씨앗/나무·달란트·5탭·리더보드·페이월 A/B | — | 승인 원칙 |

---

## 7. 출처

### 공식·스토어
- [Hallow Features](https://hallow.com/features/) · [Hallow — Wikipedia](https://en.wikipedia.org/wiki/Hallow_(app))
- [초원 공식](https://chowon.in/) · [초원 App Store](https://apps.apple.com/kr/app/id6450424532) · [초원 Google Play](https://play.google.com/store/apps/details?id=com.chowon.app&hl=en_US) · [초원 AI 2026 송구영신 말씀카드 — KCT USA](http://www.kctusa.org/news/articleView.html?idxno=78866)
- [Bible Chat — Google Play](https://play.google.com/store/apps/details?id=ai.blble_pics&hl=en_US) · [Bible AI — Google Play](https://play.google.com/store/apps/details?id=ai.bible.christian)
- [Muslim Pro](https://www.muslimpro.com/) · [Muslim Pro App Store](https://apps.apple.com/US/app/id388389451)
- [훈독가정교회 — App Store](https://apps.apple.com/kr/app/%ED%9B%88%EB%8F%85%EA%B0%80%EC%A0%95%EA%B5%90%ED%9A%8C/id1459869688) · [Heavenly Calendar 6.1.605](https://heavenly-calendar.soft112.com/) · [세계평화통일가정연합](https://www.ffwp.org/) · [FFWPU Mission Support](https://familyfedihq.org/)
- [갓피플성경 — App Store](https://apps.apple.com/kr/app/%EA%B0%93%ED%94%BC%ED%94%8C%EC%84%B1%EA%B2%BD/id511852665) · [큐티한스푼 — App Store](https://apps.apple.com/kr/app/%ED%81%90%ED%8B%B0%ED%95%9C%EC%8A%A4%ED%91%BC-qt-%EA%B0%9C%EC%97%AD%EA%B0%9C%EC%A0%95-%EC%84%B1%EA%B2%BD-%EB%A7%90%EC%94%80-%ED%95%B4%EC%84%A4/id6680197079?l=ko) · [매일성경 — App Store](https://apps.apple.com/kr/app/%EB%A7%A4%EC%9D%BC%EC%84%B1%EA%B2%BD-%EB%AA%A8%EB%B0%94%EC%9D%BC/id821689528)
- [Eightfold Path](https://eightfoldpath.com/)

### 리뷰·케이스 스터디
- [Doxa — Best Bible Apps With AI 2026](https://doxa.app/blog/best-bible-apps-with-ai) · [Doxa — Prayer app comparison](https://doxa.app/blog/prayer-app-comparison)
- [Bible Chat Review 2026 — learnofchrist](https://learnofchrist.com/resources/bible-chat) · [Best Bible Chat Apps 2026 — warmpeach](https://www.warmpeach.com/blog/best-bible-chat-apps)
- [YouVersion Review 2026 — Psalmo](https://psalmo.app/blog/youversion-app-review) · [7 Best AI Bible Study Apps 2026 — Bible Copilot](https://mybiblecopilot.com/blog/best-ai-bible-study-apps-2026/) · [Top 4 Bible Apps 2026 — CP Deals](https://deals.christianpost.com/article/top-4-bible-apps-in-north-america-for-2026-enhancing-your-digital-devotion.html)
- [Glorify UX·페이월·게이미피케이션 케이스 — Contra](https://contra.com/p/kUPYQgEP-glorify-app-ux-paywall-design-and-gamified-faith-features) · [Glorify Prayers Flow — Dribbble](https://dribbble.com/shots/24416951-Glorify-App-Prayers-Flow-Communal-Personal-Prayer-Journey)
- [Insight Timer — DesignRush](https://www.designrush.com/best-designs/apps/insight-timer) · [Best Muslim Apps 2026 — fiveprayer](https://www.fiveprayer.app/blog/best-muslim-apps-2026)
- [Streaks & Milestones 2026 — AppStorys](https://appstorys.com/blog-Streaks-Milestones-Habit-Gamification) · [Gamified habit apps 2026 — Gamification+](https://gamificationplus.uk/which-gamified-habit-building-app-do-i-think-is-best-in-2026/)
- [5 Best Free Prayer Apps 2026 — PrayForge](https://prayforge.app/blog/best-free-prayer-apps-2026/)

### 기술
- [Next.js 16 PWA offline — LogRocket](https://blog.logrocket.com/nextjs-16-pwa-offline-support/) · [@serwist/turbopack — npm](https://www.npmjs.com/package/@serwist/turbopack) · [Serwist Next getting started](https://serwist.pages.dev/docs/next/getting-started) · [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps)
