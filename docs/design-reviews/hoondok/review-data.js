window.HOONDOK_REVIEW = {
  "title": "훈독 디자인 검토 · 31개 화면",
  "baselineCommit": "0ef11993",
  "reviewCommit": "3503e25b2e87cafa5c623683358fb96013e33579",
  "reviewedAt": "2026-10-24",
  "summary": "훈독 사용자 화면만 검토했습니다. 읽기 중심 B 수정안을 선택하고 출처 첫 줄과 기존 개인화의 경계를 보존했습니다. 세 대안의 원형·채택하지 않은 요소·페이지별 전후 근거·재검토 이력을 함께 남깁니다.",
  "method": {
    "ux": [
      {
        "label": "목적·과업 명료성",
        "weight": 20
      },
      {
        "label": "탐색·정보 구조",
        "weight": 20
      },
      {
        "label": "조작·상태 피드백",
        "weight": 20
      },
      {
        "label": "접근성·한국어 가독성",
        "weight": 25
      },
      {
        "label": "반응형·성능",
        "weight": 15
      }
    ],
    "design": [
      {
        "label": "제품·페이지 목적 적합성",
        "weight": 25
      },
      {
        "label": "타이포·시각적 위계",
        "weight": 25
      },
      {
        "label": "여백·밀도·구성",
        "weight": 20
      },
      {
        "label": "컴포넌트·시각 언어 일관성",
        "weight": 15
      },
      {
        "label": "카피·장식의 필요성·고유성",
        "weight": 15
      }
    ],
    "environment": [
      "원본 0ef11993과 변경본을 별도 Next.js 서버에서 실행하고 같은 격리 E2E 데이터로 비교했습니다.",
      "기준 캡처: 로그인된 합성 계정, 한국어, 동작 줄이기, 390×844 / 768×1024 / 1280×900. 실제 프리뷰 5개를 포함합니다.",
      "책갈피는 phone 첫 수령 전, tablet·desktop 수령 후입니다. 같은 viewport의 전후만 비교하고 상태 차이를 디자인 차이로 해석하지 않습니다.",
      "10~20년차 시니어 관점을 역할 기준으로 삼아 제품 디렉터·비주얼·UX를 분리해 심사했습니다. 실제 경력을 가진 사람의 평가가 아닌 독립 AI 리뷰입니다.",
      "UI/UX Pro Max와 Taste의 공식 점수가 아닙니다. 고정 배점과 0 실패 / 1 심각 / 2 부분 / 3 충족 / 4 정교 척도로 가중 합산했습니다."
    ],
    "limitations": [
      "실사용자 연구·실제 iPhone·Safari·보조기술 전체 검증이나 WCAG 인증을 의미하지 않습니다.",
      "Taste의 랜딩 전용 히어로·이미지·다크 모드 규칙은 제품 UI에 강제하지 않았습니다.",
      "대표 상태의 전수 검토입니다. 모든 데이터 조합·네트워크 속도·기기 조합을 시각 검사한 것은 아닙니다.",
      "프리뷰의 인물·기록·말씀은 예시입니다. 마음 한 장 공유 시트 시각은 프리뷰이며 실제 외부 앱 전송은 수행하지 않았습니다.",
      "반응형·성능 축의 화면 점수는 구조적 판단입니다. 별도 Lighthouse는 대표 페이지의 로컬 실험실 측정이며 필드 INP·운영 CWV를 보장하지 않습니다.",
      "글꼴 optional의 실제 DevTools 저속망 결과와 기본 simulate 결과를 모두 기록했습니다. 측정 방법이 다른 수치를 전후 개선율로 비교하지 않습니다. 느린 첫 방문에서는 시스템 대체 글꼴을 유지할 수 있습니다."
    ]
  },
  "directions": [
    {
      "id": "A",
      "title": "오늘 한 가지",
      "description": "작은 사진과 오늘의 실천을 먼저 배치해 반복 과업에 빠르게 진입하는 안입니다. 비교 시안 UX 69.17점. 시안 점수는 최종 구현의 합격 점수가 아닙니다.",
      "selected": false,
      "selectionLabel": "비교 후 제외",
      "score": 70.0,
      "pros": [
        "사진을 줄이고 오늘 실천을 위로 올려 기존 습관 루프의 진입 위치가 빨라진다.",
        "기존 브랜드와 카드 상호작용을 거의 유지해 시각적 전환 부담이 낮다."
      ],
      "cons": [
        "실천 3행에 준비 중 기도가 같은 크기로 섞여 있고 카드 반복이 계속된다.",
        "맞춤 책갈피가 실천 목록 아래로 밀려 사용자 비전인 내게 닿는 말씀의 중심성이 약해진다.",
        "읽기는 기존 외곽 카드·메타·긴 중복 제목이 그대로여서 핵심 독서 화면의 밀도를 해결하지 못한다."
      ],
      "reason": "매일 완료하는 행동은 강화하지만 이미 추가된 맞춤 말씀의 중심성을 약화하고 읽기의 구조적 문제를 남긴다.",
      "conditions": [],
      "screenshots": [
        {
          "label": "A안 · 홈 · 모바일",
          "src": "assets/direction-A-home-phone.jpg"
        },
        {
          "label": "A안 · 홈 · PC",
          "src": "assets/direction-A-home-desktop.jpg"
        },
        {
          "label": "A안 · 훈독하기 · 모바일",
          "src": "assets/direction-A-read-phone.jpg"
        },
        {
          "label": "A안 · 훈독하기 · PC",
          "src": "assets/direction-A-read-desktop.jpg"
        },
        {
          "label": "A안 · 책갈피 · 모바일",
          "src": "assets/direction-A-bookmark-phone.jpg"
        },
        {
          "label": "A안 · 책갈피 · PC",
          "src": "assets/direction-A-bookmark-desktop.jpg"
        }
      ]
    },
    {
      "id": "B",
      "title": "내게 닿은 한 줄",
      "description": "텍스트 인사와 책갈피·읽기 중심의 안입니다. 원형의 제목 선행은 거부하고 출처 우선으로 수정 채택했습니다. 비교 시안 UX 74.58점. 시안 점수는 최종 구현의 합격 점수가 아닙니다.",
      "selected": true,
      "selectionLabel": "B 수정안 채택",
      "score": 81.25,
      "pros": [
        "홈의 사진 장식을 걷어 내 인사→맞춤 책갈피→실천의 순서가 분명해지고 말씀에 더 빨리 도달한다.",
        "읽기에서 외곽 카드를 덜어 제목·출처·원문의 위계가 직접 드러나며 글을 읽는 화면으로 보인다.",
        "책갈피 이미지와 원문으로 돌아가는 주 행동은 보존해 제품의 고유한 따뜻함이 남는다."
      ],
      "cons": [
        "읽기의 긴 첫 문장형 제목과 본문 중복은 최종 구현에서 추가 조정이 필요하다.",
        "정원·준비 중 항목·보조 안내의 밀도는 이 대표 시안만으로 해결되지 않으므로 전수 개선에 반영해야 한다.",
        "원형 시안의 제목 우선 배치는 출처 첫 줄 보존 정책과 충돌하므로 그대로 채택할 수 없다."
      ],
      "reason": "개인화된 말씀을 먼저 만나고 원문을 읽으며 나눔은 선택적으로 이어지는 제품 목적에 가장 맞는다. 다만 원형 B 전체를 그대로 채택하지 않고, 출처 첫 줄 보존을 조건으로 사진 축소·콘텐츠 중심 위계·읽기 외곽 제거를 수정 채택한다.",
      "conditions": [
        "출처를 첫 줄에 보존합니다. 원본 B의 제목 선행은 채택하지 않습니다.",
        "Pretendard·감귤색·라이트 모드와 책·리본 상호작용을 유지합니다.",
        "실제 개인화와 예시를 구분하고 새로운 수집·추천 기능을 추가하지 않습니다."
      ],
      "screenshots": [
        {
          "label": "B안 · 홈 · 모바일",
          "src": "assets/direction-B-home-phone.jpg"
        },
        {
          "label": "B안 · 홈 · PC",
          "src": "assets/direction-B-home-desktop.jpg"
        },
        {
          "label": "B안 · 훈독하기 · 모바일",
          "src": "assets/direction-B-read-phone.jpg"
        },
        {
          "label": "B안 · 훈독하기 · PC",
          "src": "assets/direction-B-read-desktop.jpg"
        },
        {
          "label": "B안 · 책갈피 · 모바일",
          "src": "assets/direction-B-bookmark-phone.jpg"
        },
        {
          "label": "B안 · 책갈피 · PC",
          "src": "assets/direction-B-bookmark-desktop.jpg"
        }
      ]
    },
    {
      "id": "C",
      "title": "읽고 마음을 나누기",
      "description": "함께 읽기와 나눔을 강조한 안입니다. 개인 읽기와 원문 탐색이 뒤로 밀리는 문제가 있어 채택하지 않았습니다. 비교 시안 UX 62.5점. 시안 점수는 최종 구현의 합격 점수가 아닙니다.",
      "selected": false,
      "selectionLabel": "비교 후 제외",
      "score": 60.0,
      "pros": [
        "함께 읽는 사람과 모임을 앞에 배치해 공동체의 존재를 빨리 전달한다.",
        "책갈피의 건네기를 채움 버튼으로 올려 공유 행동이 명확해진다."
      ],
      "cons": [
        "홈에서 모임 카드가 실천보다 먼저 나타나 개인의 오늘 읽기 진입이 더 아래로 밀린다.",
        "공유가 원문 읽기보다 강한 CTA가 되어 사용자가 먼저 읽고 스스로 나눌지를 고르는 흐름이 약해진다.",
        "읽기 외곽의 액센트 테두리는 독서에 새 정보를 주지 않으면서 시각적 무게를 더한다."
      ],
      "reason": "공동체는 중요하지만 처음부터 나눔을 우선하면 개인의 읽기와 자율성을 덜 드러낸다. 모임·공유 화면에서만 필요한 강조를 가져오고 전체 기본 방향으로는 선택하지 않는다.",
      "conditions": [],
      "screenshots": [
        {
          "label": "C안 · 홈 · 모바일",
          "src": "assets/direction-C-home-phone.jpg"
        },
        {
          "label": "C안 · 홈 · PC",
          "src": "assets/direction-C-home-desktop.jpg"
        },
        {
          "label": "C안 · 훈독하기 · 모바일",
          "src": "assets/direction-C-read-phone.jpg"
        },
        {
          "label": "C안 · 훈독하기 · PC",
          "src": "assets/direction-C-read-desktop.jpg"
        },
        {
          "label": "C안 · 책갈피 · 모바일",
          "src": "assets/direction-C-bookmark-phone.jpg"
        },
        {
          "label": "C안 · 책갈피 · PC",
          "src": "assets/direction-C-bookmark-desktop.jpg"
        }
      ]
    }
  ],
  "pages": [
    {
      "id": "home",
      "path": "/hoondok",
      "title": "오늘 훈독",
      "purpose": "오늘 내게 닿는 말씀과 실천을 찾고 읽기 루프를 시작한다.",
      "primaryAction": "오늘의 책갈피를 열거나 훈독하기로 이동한다.",
      "before": {
        "ux": 63.75,
        "design": 60.0,
        "uxRatings": [
          2,
          3,
          3,
          2,
          3
        ],
        "designRatings": [
          2,
          3,
          2,
          3,
          2
        ],
        "notes": [
          "UX: 인사 사진과 책갈피가 첫 훈독 행동보다 앞서며, phone에서 훈독 미션은 y710 이후에 시작한다.",
          "UX: 오늘의 실천 2가지 안내 아래 준비 중 기도까지 유사한 카드·완료원으로 보여 행동 위계가 분산된다.",
          "디자인: 사진 인사와 책갈피·실천·정성·모임이 동등한 둥근 카드로 이어져, 개인화된 말씀과 매일 읽기의 우선순위가 분산된다.",
          "디자인: 휴대폰 첫 화면은 사진과 책갈피가 대부분을 차지하고 오늘 훈독 진입은 접힌다. PC에서도 300px 인사 사진 뒤로 실천이 밀린다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 81.25,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "짧은 개인 인사 뒤에 책갈피와 관심사 연결 이유가 보이고, 기도 준비 카드가 실제 읽기보다 약해졌다. 책·리본 비유를 유지한다.",
          "UX: 사진 인사가 텍스트 날짜·인사로 줄어 책갈피 primary가 phone y368에 나타난다(before y496).",
          "UX: 본문16px·섹션18px·메타13.5px로 행동/출처 위계가 분명해졌고 준비중 기도는 별도 카드외곽을 없애 실제행동과 구별한다.",
          "디자인: 큰 인사 사진 대신 짧은 인사와 날짜가 놓여 맞춤 책갈피와 읽기 행동이 빠르게 보인다.",
          "디자인: 준비 중 기도 행의 외곽을 낮춰 현재 가능한 실천과의 차이가 드러난다. 책갈피의 실제 물성과 기존 상호작용은 보존된다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-home-phone.jpg",
          "after": "assets/after-home-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-home-tablet.jpg",
          "after": "assets/after-home-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-home-desktop.jpg",
          "after": "assets/after-home-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 63.75,
          "design": 60.0,
          "note": "사진 인사 다음에 닫힌 책 이미지·저작물 이름·꺼내기 설명이 이어진다. 실제 오늘 말씀의 제목과 실천은 그 아래다. 모바일에서도 책갈피 CTA는 첫 화면에 보인다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 81.25,
          "note": "짧은 개인 인사 뒤에 책갈피와 관심사 연결 이유가 보이고, 기도 준비 카드가 실제 읽기보다 약해졌다. 책·리본 비유를 유지한다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "오늘 편성·기기에서 고른 답의 맞춤 카드 이유를 구분한다. 본문 전체 대신 읽기 진입을 제공하고, 함께 읽기 숫자를 부풀리거나 미완료자를 표시하지 않는다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "편성 있음",
        "편성 없음·철회",
        "공개·개인 편성 조회 중",
        "기기 답 없음·맞춤 카드 있음·대체 편성",
        "비로그인·로그인",
        "이미 완료",
        "모임·설치 안내 조건 충족"
      ],
      "productPreserved": "개인 이름 인사, 책·리본의 책갈피 비유, 실제 관심사 연결 이유, 완료·함께 읽기·베타 고지.",
      "productDecision": "구성 개선"
    },
    {
      "id": "read",
      "path": "/hoondok/read",
      "title": "훈독하기",
      "purpose": "오늘의 공개 또는 정성 말씀을 출처와 함께 읽고 개인 성찰·완료로 잇는다.",
      "primaryAction": "말씀을 읽고 오늘 훈독을 완료한다.",
      "before": {
        "ux": 63.75,
        "design": 63.75,
        "uxRatings": [
          3,
          2,
          3,
          2,
          3
        ],
        "designRatings": [
          3,
          2,
          2,
          3,
          3
        ],
        "notes": [
          "UX: 본문 첫 문장을 긴 제목으로 반복하여 phone 제목이 3줄이며 원문과 정보 위계가 중복된다.",
          "UX: 날짜·판본·공식성의 미확인 정보는 숨기지 않지만 11~12.5px 작은 라벨로 밀집되어 읽기 시작 전에 처리해야 할 정보가 많다.",
          "디자인: 출처·권리 배지와 원문이 분리되고, 완료 이후 한 줄 나눔까지 이어지는 흐름은 이해된다.",
          "디자인: 본문 첫 문장을 길게 잘라 제목으로 반복한 뒤 원문에서 다시 읽게 한다. 제목·메타·배지·인용선이 첫 독서 화면을 밀도 높게 만든다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "출처·미확인 배지가 발췌 제목보다 먼저다. 외곽 카드가 없어지고 본문이 넓고 편안하게 읽힌다.",
          "UX: 정책대로 출처를 첫줄에 유지하면서 카드외곽/내부패딩을 제거하고 제목19px·원문18px로 위계를 재조정했다.",
          "UX: 출처→등급→제목→인용의 간격이 분리되어 기존 밀집 인지부담이 줄었다. title/본문 첫문장 중복은 남아 정교4는 부여하지 않는다.",
          "디자인: 출처 첫 줄과 권리 배지를 보존하면서 외곽 카드를 덜어 원문과 성찰의 흐름이 직접 보인다.",
          "디자인: 18px 본문과 여유 있는 행간, 낮춘 긴 제목의 상대적 비중이 독서 가독성을 개선한다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-read-phone.jpg",
          "after": "assets/after-read-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-read-tablet.jpg",
          "after": "assets/after-read-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-read-desktop.jpg",
          "after": "assets/after-read-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 63.75,
          "design": 63.75,
          "note": "출처·미확인 배지 뒤에 긴 발췌 제목이 있고, 같은 구절이 본문 시작에서 반복된다. 본문 왼쪽 굵은 선은 원문을 분명히 구분한다. 완료 후 모임 나눔 진입이 이어진다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 75.0,
          "note": "출처·미확인 배지가 발췌 제목보다 먼저다. 외곽 카드가 없어지고 본문이 넓고 편안하게 읽힌다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "개인 편성 조회와 공개 편성 대체 이유를 표시한다. 권리 철회·편성 없음과 네트워크 실패를 구분한다. 한 줄 성찰은 선택이며 근거 원문과 혼동하지 않는다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "공개·개인 편성 조회 중",
        "공개·개인 말씀 있음",
        "편성 없음·철회",
        "조회 실패·대체 안내",
        "성찰 없음·있음",
        "비로그인 소급 안내·완료 제출·이미 완료"
      ],
      "productPreserved": "공식 원문 형태, 전체 원문, 미확인 정보 표시, 개인 한 줄과 모임 나눔의 공개 범위 구분, 완료 후 다음 행동.",
      "productDecision": "가독성 개선"
    },
    {
      "id": "onboarding",
      "path": "/hoondok/onboarding",
      "title": "시작하기",
      "purpose": "베타 성격을 이해한 뒤 일반 사용자로 가입·로그인하거나 공개 범위를 둘러본다.",
      "primaryAction": "가입 또는 로그인한다.",
      "before": {
        "ux": 68.75,
        "design": 60.0,
        "uxRatings": [
          3,
          3,
          3,
          2,
          3
        ],
        "designRatings": [
          2,
          3,
          2,
          3,
          2
        ],
        "notes": [
          "UX: 로그인 상태와 계속하기·로그아웃의 우선순위가 구분되며 phone에서 주 행동이 초기 viewport 안에 보인다.",
          "UX: 장식 사진이 phone 상단 약300px을 차지하고, 계정·이용 관련 중요한 하단 안내는 작은 글자로 압축되어 있다.",
          "디자인: 기본 사진과 타이포는 브랜드에 맞지만 로그인된 상태에서도 큰 사진·가입 설명 뒤에 계속하기를 배치한다.",
          "디자인: 로그인된 사용자에게 이메일·비밀번호로 시작한다는 진입 설명을 반복해 현재 상태에 대한 화면 목적이 흐려진다."
        ]
      },
      "after": {
        "ux": 80,
        "design": 75.0,
        "uxRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "비공식 베타·이미 로그인 상태·계속하기가 명확하며 설명이 읽기 쉬워졌다.",
          "UX: 로그인된경우 불필요한 소개사진/신규가입문장을 숨겨 현재상태→계속하기/로그아웃이첫화면에서직접보인다.",
          "UX: 최신phone/desktop을재열람해 주행동이기존phone y600에서 y133으로올라온것을확인했다. 이명확한과업집중을근거로목적과업4로조정했다.",
          "디자인: 이미 로그인된 상태에서는 큰 소개 사진과 가입용 카피를 접고 현재 계정과 계속하기를 상단에 놓아 목적과 첫 행동이 맞아졌다.",
          "디자인: 미로그인 소개까지 없애는 전면 변경이 아니라 실제 상태에 맞춘 분기이며, 작은 베타·정보 안내는 남아 있다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-onboarding-phone.jpg",
          "after": "assets/after-onboarding-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-onboarding-tablet.jpg",
          "after": "assets/after-onboarding-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-onboarding-desktop.jpg",
          "after": "assets/after-onboarding-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 68.75,
          "design": 60.0,
          "note": "사진·가치 제안 뒤에 이미 로그인한 사용자 안내와 계속하기·로그아웃이 보인다. 실제 가입 입력은 캡처되지 않았다."
        },
        {
          "title": "첫 재심사: 추가 수정 필요",
          "reviewer": "비주얼 독립 심사",
          "design": 60.0,
          "ratings": [
            2,
            3,
            2,
            3,
            2
          ],
          "note": "로그인된 상태에서도 300px 사진과 가입용 가치 설명이 그대로 남아 있다. 이미 로그인된 사용자의 계속하기보다 초기 소개가 더 큰 비중을 차지하므로 최초 감점의 근거가 해결되지 않았다. 최소 수정: 로그인된 상태에서는 큰 소개 영역을 접고 현재 계정·계속하기를 상단에 배치한다. 미로그인 소개는 보존할 수 있다.",
          "screenshots": [
            {
              "label": "첫 재심사 / phone",
              "src": "assets/round1-onboarding-phone.jpg"
            },
            {
              "label": "첫 재심사 / desktop",
              "src": "assets/round1-onboarding-desktop.jpg"
            }
          ]
        },
        {
          "title": "최소 수정 후 재심사",
          "reviewer": "비주얼 독립 심사",
          "design": 75.0,
          "ratings": [
            3,
            3,
            3,
            3,
            3
          ],
          "note": "이미 로그인된 상태에서는 큰 소개 사진과 가입용 카피를 접고 현재 계정과 계속하기를 상단에 놓아 목적과 첫 행동이 맞아졌다. 미로그인 소개까지 없애는 전면 변경이 아니라 실제 상태에 맞춘 분기이며, 작은 베타·정보 안내는 남아 있다. 휴대폰과 PC에서 현재 상태와 두 행동이 같은 기준선으로 정돈되어 첫 재심사의 목적·밀도 감점이 해소됐다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 80,
          "design": 75.0,
          "note": "비공식 베타·이미 로그인 상태·계속하기가 명확하며 설명이 읽기 쉬워졌다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "시연 계정 인증과 섞지 않는다. 비공식 베타·기기 기록 처리·초대 조건을 유지하며, 실명·소속 교회를 강제하지 않는다. 초대·기존 과업 returnTo를 보존한다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "가입·로그인 모드",
        "이미 로그인",
        "초대 코드 없음·미리 채움·필요·만료",
        "유효성 오류·인증 실패·중복 이메일",
        "제출 중·성공·네트워크 실패",
        "로그아웃 실패"
      ],
      "productPreserved": "비공식 베타 고지, 로그인 없이 둘러보기 정책, 안전한 복귀 경로와 인증 분리.",
      "productDecision": "상태별 다듬기"
    },
    {
      "id": "offline",
      "path": "/hoondok/offline",
      "title": "오프라인",
      "purpose": "연결 상태와 기록의 보존 위치를 이해하고 복귀한다.",
      "primaryAction": "다시 시도로 오늘 훈독을 연다.",
      "before": {
        "ux": 73.75,
        "design": 81.25,
        "uxRatings": [
          4,
          3,
          3,
          2,
          3
        ],
        "designRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 현재 상태·기록 보존·다시 시도라는 회복 경로가 한 영역에 명료하다.",
          "UX: 복구 설명은 12.5px급으로 작고 넓은 desktop에서도 같은 작은 크기를 유지한다.",
          "디자인: 오프라인 상태와 다시 시도라는 하나의 복구 행동이 즉시 이해된다.",
          "디자인: 완료 기록이 사라지지 않는다는 안내가 사용자의 실제 우려를 직접 해소한다."
        ]
      },
      "after": {
        "ux": 80.0,
        "design": 81.25,
        "uxRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "원인·기록 안내·다시 시도의 단일 과업을 유지하고 불필요한 장식을 추가하지 않았다.",
          "UX: 오프라인 상태·기록보존·다시시도 복구행동이 한 영역에 명료하다.",
          "UX: 복구설명이13.5px로 올라가 phone/desktop 모두 본문과 구별되며 읽힌다.",
          "디자인: 현재 상태·복구 행동·완료 기록 보존 안내가 하나의 명확한 상태 화면으로 유지된다.",
          "디자인: 빈 공간을 장식으로 채우지 않아 다시 시도라는 목적에 집중할 수 있다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-offline-phone.jpg",
          "after": "assets/after-offline-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-offline-tablet.jpg",
          "after": "assets/after-offline-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-offline-desktop.jpg",
          "after": "assets/after-offline-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 73.75,
          "design": 81.25,
          "note": "짧은 상태 제목·두 줄 설명·큰 다시 시도 버튼이 있고 나머지는 비어 있다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 80.0,
          "design": 81.25,
          "note": "원인·기록 안내·다시 시도의 단일 과업을 유지하고 불필요한 장식을 추가하지 않았다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "정적 오프라인 안내로 데이터 요청을 하지 않는다. 완료 기록의 서버 보존과 실제 오프라인 범위를 과장하지 않는다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "오프라인 폴백",
        "연결 회복 후 재시도"
      ],
      "productPreserved": "원인과 다음 행동 하나, 서버 완료 기록 안내, 과장된 오프라인 기능을 넣지 않음.",
      "productDecision": "유지하며 다듬기"
    },
    {
      "id": "start",
      "path": "/hoondok/start",
      "title": "첫 말씀 고르기",
      "purpose": "관심사와 현재 마음을 선택해 기기에서 고른 첫 말씀을 만난다.",
      "primaryAction": "질문을 선택·건너뛰고 첫 말씀을 읽는다.",
      "before": {
        "ux": 80.0,
        "design": 75.0,
        "uxRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 질문할 항목과 선택 항목·기기 저장·건너뛰기 경로를 시작 전에 설명하여 기대를 명확히 한다.",
          "UX: phone·tablet은 세로, desktop은 사진/설명 분할로 실제 재배치되며 CTA가 각 초기 viewport에 들어간다.",
          "디자인: 세 질문의 내용·선택 항목·기기 저장·건너뛰기가 구분되어 첫 진입 목적이 명확하다.",
          "디자인: PC의 사진·설명 2열은 정돈되어 있다. 휴대폰 사진을 더 작게 잡으면 질문 안내에 더 빨리 도달할 수 있다."
        ]
      },
      "after": {
        "ux": 80.0,
        "design": 75.0,
        "uxRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "환영 사진·세 질문 예고·기기 저장·질문 없이 시작하기의 구조를 보존했다.",
          "UX: 질문목록·선택항목·기기저장·건너뛰기가 시작전 명료하게 보인다.",
          "UX: phone사진/설명 세로배치와 desktop분할배치를 보존하고 보충문장16px을 유지한다.",
          "디자인: 세 질문 안내·기기 저장·건너뛰기와 시작 CTA의 기존 구성이 보존된다.",
          "디자인: 사진과 타이포의 2열 PC 구성은 여전히 정돈되어 있으며 화면이 기능을 과장하지 않는다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-start-phone.jpg",
          "after": "assets/after-start-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-start-tablet.jpg",
          "after": "assets/after-start-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-start-desktop.jpg",
          "after": "assets/after-start-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 80.0,
          "design": 75.0,
          "note": "환영 사진 아래 세 질문의 주제와 기기 저장 안내, 시작하기·질문 없이 시작하기가 한 화면에 보인다. PC는 사진과 설명을 나눠 배치한다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 80.0,
          "design": 75.0,
          "note": "환영 사진·세 질문 예고·기기 저장·질문 없이 시작하기의 구조를 보존했다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "선택값을 URL·서버·분석·오류 수집으로 보내지 않는다. 소속 교회·직분을 묻지 않고 선택 제한·저장 위치·위기 안내를 보존한다. 단계마다 제목·포커스를 갱신한다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "책갈피 플래그",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "환영",
        "관심 주제 선택",
        "요즘 마음 두 개 제한·위기 선택",
        "읽는 때·길이 선택 또는 건너뛰기",
        "첫 말씀 로딩·오류·빈 풀·대체 편성",
        "기존 답으로 다시 시작"
      ],
      "productPreserved": "질문 선택권·건너뛰기, 기기 저장 안내, 소속·직분을 묻지 않는 정책, 단계별 포커스.",
      "productDecision": "가치와 선택권 강조"
    },
    {
      "id": "pray",
      "path": "/hoondok/pray",
      "title": "마음 한 장",
      "purpose": "지금 마음과 만나는 실제 말씀을 읽고 선택적으로 한 줄을 남긴다.",
      "primaryAction": "마음을 골라 말씀을 읽고 한 줄 또는 건네기로 이어간다.",
      "before": {
        "ux": 75.0,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 하나의 마음 선택과 말씀 받기라는 현재 과업이 명료하고 선택 전 버튼 비활성이 드러난다.",
          "UX: 48px 칩과 충분한 간격·22px 질문 제목을 유지한다. phone의 하단 행동은 고정, tablet/desktop에서는 본문 흐름으로 바뀐다.",
          "디자인: 질문 하나와 마음 선택지, 하단 말씀 받기가 분리되어 성찰 흐름의 시작을 이해하기 쉽다.",
          "디자인: 빈 공간은 한 질문에 집중하는 역할을 하므로 장식이나 카드로 채울 이유가 없다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "첫 마음 선택과 말씀 받기 버튼이 같은 흐름 가까이 있어 선택 후 행동이 명확하다.",
          "UX: 첫마음선택뿐아니라실제조작으로이어진2/4말씀·3/4메모·4/4건네기·공유시트이미지를추가열람했다.",
          "UX: 본문앞출처·기기저장범위·메모나만봄·공유에는말씀카드만포함된다는설명이각단계에보인다.",
          "디자인: 마음 하나를 고르는 질문과 말씀 받기 행동이 붙어 있어 단계 시작을 이해하기 쉽다.",
          "디자인: 하단 빈 공간을 의미 없는 그림으로 채우지 않았고 선택지·설명은 기존 흐름을 보존한다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-pray-phone.jpg",
          "after": "assets/after-pray-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-pray-tablet.jpg",
          "after": "assets/after-pray-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-pray-desktop.jpg",
          "after": "assets/after-pray-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 75.0,
          "design": 75.0,
          "note": "지금 마음 하나를 고르는 칩과 하단 말씀 받기 버튼이 명확하다. 모바일 가운데 여백은 크지만 경쟁하는 콘텐츠가 없다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 75.0,
          "note": "첫 마음 선택과 말씀 받기 버튼이 같은 흐름 가까이 있어 선택 후 행동이 명확하다.",
          "screenshots": [
            {
              "label": "말씀 받기",
              "src": "assets/state-pray-card.jpg"
            },
            {
              "label": "한 줄 적기",
              "src": "assets/state-pray-note.jpg"
            },
            {
              "label": "카드만 건네기",
              "src": "assets/state-pray-share.jpg"
            },
            {
              "label": "공유 시트 · 프리뷰",
              "src": "assets/state-pray-share-sheet.jpg"
            },
            {
              "label": "실제 카드 이미지 · 프리뷰 OFF",
              "src": "assets/state-pray-production-share.jpg"
            }
          ]
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "이 순간 마음은 기존 관심사 답을 바꾸지 않는다. 적은 한 줄은 기기에만 남으며 공유에는 말씀 카드만 포함된다. 위기 선택이면 말씀보다 안내를 먼저 표시한다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "책갈피 플래그",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "마음 미선택·선택",
        "위기 선택·안내",
        "말씀 로딩·오류·없음·대체 편성",
        "한 줄 작성·건너뛰기",
        "공유 시트·성공·취소",
        "마침"
      ],
      "productPreserved": "한 가지 마음 선택, 위기 선택 안내, 개인 메모 기기 저장과 카드만 공유하는 경계.",
      "productDecision": "집중형 흐름 유지"
    },
    {
      "id": "interests",
      "path": "/hoondok/garden/interests",
      "title": "관심사와 마음",
      "purpose": "기기에 저장한 관심 주제·요즘 마음·읽는 때와 길이를 직접 바꾼다.",
      "primaryAction": "선택을 수정하고 저장한다.",
      "before": {
        "ux": 65,
        "design": 70.0,
        "uxRatings": [
          3,
          3,
          3,
          2,
          2
        ],
        "designRatings": [
          3,
          3,
          2,
          3,
          3
        ],
        "notes": [
          "UX: 관심/마음/읽는 때를 제목으로 묶고 선택 상태를 색과 체크로 함께 표현한다.",
          "UX: phone 하단 막대가 준비된 저장 상태를 안내하며 tablet/desktop은 칩과 행동 막대를 실제로 재배치한다.",
          "디자인: 주제·마음·읽는 때·길이의 구분과 선택 체크가 명확하고, 초록 등 의미 없는 색을 추가하지 않는다.",
          "디자인: 긴 칩 묶음과 하단 고정 저장 영역이 한 화면 안에서 경쟁한다. 휴대폰에서는 읽는 때·길이까지 여러 번 스크롤해야 한다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 76.25,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          4,
          2,
          3,
          3
        ],
        "notes": [
          "선택 칩·선택 수·두 개 제한·기기 저장·지우기 확인의 의미를 유지하고 글자 위계가 읽기 쉽다.",
          "UX: 섹션18px/선택칩16px으로 분리하고 선택상태를 체크와 색으로 함께 제공한다.",
          "UX: ps-bar를sticky로바꾼 수정과 root의200%가림 Red→Green 검증을 근거로 기존critical을 해결상태로 분리한다.",
          "디자인: 주제·마음·읽기 선택의 글자 크기, 체크, 그룹 제목이 정교하게 일치해 선택 상태와 각 선택군의 관계가 더 잘 읽힌다.",
          "디자인: 긴 선택군과 저장 영역으로 생기는 스크롤 밀도는 남아 있어 밀도 등급 2를 유지한다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-interests-phone.jpg",
          "after": "assets/after-interests-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-interests-tablet.jpg",
          "after": "assets/after-interests-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-interests-desktop.jpg",
          "after": "assets/after-interests-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 65,
          "design": 70.0,
          "note": "많은 주제·마음 칩이 충분한 높이로 줄바꿈되며 선택된 항목은 체크와 액센트로 구분된다. 저장 막대가 고정되고 읽는 때·길이는 아래에 이어진다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 76.25,
          "note": "선택 칩·선택 수·두 개 제한·기기 저장·지우기 확인의 의미를 유지하고 글자 위계가 읽기 쉽다.",
          "screenshots": []
        },
        {
          "title": "확대 시 가림 재현 → 수정",
          "note": "200% 글자에서 마지막 버튼이 저장 막대에 11.09px 가렸습니다. 고정 높이 여유 대신 sticky 문서 흐름으로 수정하고 실제 클릭 회귀 테스트를 통과했습니다."
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "선택은 기기에만 저장하고 서버 동기화로 표현하지 않는다. 마음은 두 개 제한이며, 위기 선택을 재노출하지 않는다. 모두 지우기는 확인 후 실행한다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "책갈피 플래그",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "저장값 없음·있음",
        "변경 없음·미저장 변경",
        "마음 두 개 제한",
        "저장 완료",
        "모두 지우기 확인·완료"
      ],
      "productPreserved": "주제·마음·읽기 조건 그룹, 체크와 색의 동시 표시, 저장 전후 구분, 모두 지우기 확인, 기기 저장.",
      "productDecision": "선택 가독성 개선"
    },
    {
      "id": "ask",
      "path": "/hoondok/ask",
      "title": "AI 질문",
      "purpose": "말씀을 읽다 생긴 물음을 직접 적어 근거 있는 탐구를 시작한다.",
      "primaryAction": "질문을 적고 물어보기를 누른다.",
      "before": {
        "ux": 68.75,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 질문 입력·근거 원칙·세 가지 예시가 한 방향을 가리키고 전송 전 비활성 피드백이 있다.",
          "UX: 현재 말씀의 문장형 제목이 여러 줄로 잘리며 입력 라벨·근거/저장 도움말·예시 안내는 11~12.5px급이다.",
          "디자인: 오늘 읽은 말씀과 질문 입력, 예시 질문, 내 질문 기록이 기능적으로 구분되어 있다.",
          "디자인: 입력 전 비활성 버튼과 근거 안내가 보인다. 감성적인 홍보보다 질문 과업에 집중하는 현재 방향이 적합하다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "질문 입력·근거 설명·시작 문장·기기 기록 진입을 그대로 두고 도움말의 가독성이 높아졌다.",
          "UX: 질문label·근거원칙·예시·저장기록이 한 입력행동으로 연결된다.",
          "UX: 입력16.5px/보충13.5px/예시16px로 작은 안내의 판독 부담이줄었다.",
          "디자인: 읽은 말씀 맥락과 질문 입력·예시·기록이 구분된 구성은 유지되고 보조 설명의 글자가 더 읽기 쉬워졌다.",
          "디자인: 큰 새 장식 없이 입력 과업을 중심으로 유지한 판단이 적절하다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-ask-phone.jpg",
          "after": "assets/after-ask-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-ask-tablet.jpg",
          "after": "assets/after-ask-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-ask-desktop.jpg",
          "after": "assets/after-ask-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 68.75,
          "design": 75.0,
          "note": "오늘 말씀 긴 제목·출처가 위에 있고 질문 라벨·큰 textarea·보내기 버튼·시작 문장이 순서대로 보인다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 75.0,
          "note": "질문 입력·근거 설명·시작 문장·기기 기록 진입을 그대로 두고 도움말의 가독성이 높아졌다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "예시 문장은 입력만 채우고 자동 전송하지 않는다. 근거가 없으면 확인할 수 없다고 알리며, 질문·답의 기기 저장 경계를 보존한다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "빈 입력·전송 가능 입력",
        "질문 쿼리로 미리 채움",
        "오늘 말씀 있음·없음",
        "질문 기록 수 있음·없음"
      ],
      "productPreserved": "라벨 있는 입력, 근거 없는 답변을 멈춘다는 설명, 예시는 채우기만 함, 기기 질문 기록.",
      "productDecision": "입력 중심 다듬기"
    },
    {
      "id": "ask-log",
      "path": "/hoondok/ask/log",
      "title": "질문 기록",
      "purpose": "이 기기에 남긴 질문과 저장한 답을 다시 찾는다.",
      "primaryAction": "내 질문 또는 저장한 답 탭에서 질문을 연다.",
      "before": {
        "ux": 63.75,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          2,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 질문 항목·저장됨·기기 저장 범위가 표시되지만 목록 위 준비 중인 식구들 질문이 활성 탭과 유사한 비중을 차지한다.",
          "UX: 근거 건수·저장 배지·미리보기 설명이 11~12.5px급이라 신뢰·보관 정보를 읽기 어렵게 만든다.",
          "디자인: 질문과 저장한 답을 구분하고 기기 저장 안내를 함께 보여 주어 기록 화면의 목적이 전달된다.",
          "디자인: 짧은 목록의 빈 공간은 데이터 양에 따른 결과다. 보기 좋은 목록을 만들려고 가짜 항목을 추가할 이유가 없다."
        ]
      },
      "after": {
        "ux": 75,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "내 질문·저장한 답·준비 중 탭이 구분되고 질문이 주 콘텐츠로 보인다.",
          "UX: 최신phone/tablet/desktop 이미지를 다시 직접 열람했다. 미지원 탭 안에 식구들질문+준비중을 함께 표시하여 조작전에 사용할수없음을읽을수있다.",
          "UX: 명시된미지원문구와disabled 상태를근거로 baseline의조작상태2를3으로조정했다.",
          "디자인: 내 질문과 저장한 답의 수·준비 중 탭·기기 저장 안내가 서로 구별된다.",
          "디자인: 실제 기록이 적다는 이유로 가짜 목록이나 시각적 채움 요소를 추가하지 않은 구성이 적절하다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-ask-log-phone.jpg",
          "after": "assets/after-ask-log-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-ask-log-tablet.jpg",
          "after": "assets/after-ask-log-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-ask-log-desktop.jpg",
          "after": "assets/after-ask-log-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 63.75,
          "design": 75.0,
          "note": "내 질문·저장한 답·준비 중 탭 뒤에 한 개 질문과 작은 근거·저장 메타가 보인다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75,
          "design": 75.0,
          "note": "내 질문·저장한 답·준비 중 탭이 구분되고 질문이 주 콘텐츠로 보인다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "기기 전용 기록임을 알리고 식구들 질문은 준비 중으로 유지한다. 서버 동기화·공개 피드처럼 표현하지 않는다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "내 질문·저장한 답",
        "각 탭 비어 있음·기록 있음",
        "저장 표시",
        "기기 기록 없음"
      ],
      "productPreserved": "기기 기록 안내, 활성 탭과 준비 중 구분, 질문 자체를 주요 읽을거리로 제시.",
      "productDecision": "기록 가독성 다듬기"
    },
    {
      "id": "ask-detail",
      "path": "/hoondok/ask/{id}",
      "title": "질문",
      "purpose": "AI 설명의 근거를 검토하고 실제 말씀 원문으로 이동한다.",
      "primaryAction": "근거 말씀을 확인하고 허용된 원문을 연다.",
      "before": {
        "ux": 68.75,
        "design": 75,
        "uxRatings": [
          3,
          3,
          3,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 실제 UI 제출·SSE sources1로 교체한 before phone/desktop 이미지를 재열람했다. AI 설명→출처 인용→원문 보기→후속 질문 순서가 실제로 존재한다.",
          "UX: AI설명·공식해설아님은 섹션과 카드 안에 반복되나 권위층은 시각적으로 구별된다. 출처/등급/저장 안내11~12.5px이 가독성 감점 근거다.",
          "디자인: 실제 SSE 테스트 응답으로 재캡처한 화면에서 근거 1, AI 설명, 원문 보기의 권위 구분을 확인했다.",
          "디자인: 질문→AI 설명→근거 말씀→이어 묻기 순서가 명확하다. 점선 패턴은 공식 원문과 다른 정보층을 표현하므로 의미 없는 장식으로 감점하지 않았다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "AI 설명·공식 해설 아님·근거 말씀·원문 보기·기기 저장이 분리돼 보인다. 실제 근거 첫 줄에 출처와 공식성 미확인이 있다.",
          "UX: 실제SSE sources1 상태의 설명·인용·원문보기·후속질문이순차로보인다.",
          "UX: 출처13.5/등급12/섹션18로 AI설명과근거의판독성이개선됐다. 패턴배경·면책반복은정교함의추가개선영역이다.",
          "디자인: AI 설명과 공식 원문의 다른 형태, 근거 수, 원문 보기가 유지된다.",
          "디자인: 정책을 나타내는 점 패턴을 단순히 AI slop으로 취급해 없애지 않았고 메타 정보의 크기가 개선됐다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-ask-detail-phone.jpg",
          "after": "assets/after-ask-detail-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-ask-detail-tablet.jpg",
          "after": "assets/after-ask-detail-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-ask-detail-desktop.jpg",
          "after": "assets/after-ask-detail-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 68.75,
          "design": 75,
          "note": "AI 설명 라벨이 반복되고 근거 말씀 섹션은 비어 있다. 화면 상단에는 근거 0, 아래에는 합성 AI 답이 보인다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 75.0,
          "note": "AI 설명·공식 해설 아님·근거 말씀·원문 보기·기기 저장이 분리돼 보인다. 실제 근거 첫 줄에 출처와 공식성 미확인이 있다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "AI 설명과 공식 원문을 형태·라벨로 구분한다. 근거 0건이면 답을 숨긴다. 원문 권한 확인 전 링크를 열지 않으며, 질문·답은 기기에만 저장한다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "저장소 읽기 전",
        "질문 없음",
        "답변 대기·중단",
        "답변 실패·재시도",
        "근거 없음",
        "답변 있음",
        "원문 권한 조회 중·불명·허용",
        "저장 여부·공유 결과"
      ],
      "productPreserved": "AI가 공식 해설이 아니라는 명확한 구분, 실제 근거와 원문 권한, 기기 저장 경계.",
      "productDecision": "검증 데이터 보정 후 평가"
    },
    {
      "id": "library",
      "path": "/hoondok/library",
      "title": "말씀",
      "purpose": "공개가 허용된 저작물과 이어 읽을 원문을 찾는다.",
      "primaryAction": "저작물을 고르거나 이어 읽기를 연다.",
      "before": {
        "ux": 68.75,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 최종 비교는0ef11993 별도서버에서 같은DB상태로 캡처했다. phone·desktop 모두 검색/이어읽기/저작물 선택이 나타난다.",
          "UX: 권리·공식성은 숨기지 않지만11~12.5px 작은배지/메타로 처리된다.",
          "디자인: 검색 진입과 저작물 목록이 분리되고, 공식성 확인 상태가 목록마다 보인다.",
          "디자인: 작은 합성 목록에 맞는 간결한 행 구조다. 마케팅용 세 카드 금지나 실사 이미지 강제를 적용하지 않는다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "검색·이어 읽기·허용된 저작물·공식성 배지가 분명하고 권리 안내를 유지했다.",
          "UX: 검색·이어읽기·저작물선택이 서로 구별되고 desktop은2열목록으로대응한다.",
          "UX: 메타13.5/등급12로 저작물공식성·권수 설명을 읽기쉽게했다.",
          "디자인: 검색·이어 읽기·저작물 목록이 역할에 따라 구분되고 공개·공식성 상태가 눈에 보인다.",
          "디자인: 이어 읽기의 출현은 저장 데이터 상태에 따른 것이며 새 디자인 기능 추가로 평가하지 않았다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-library-phone.jpg",
          "after": "assets/after-library-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-library-tablet.jpg",
          "after": "assets/after-library-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-library-desktop.jpg",
          "after": "assets/after-library-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 68.75,
          "design": 75.0,
          "note": "상단 검색 진입과 저작물 목록 두 개가 보이고 각 항목에 미확인 공식성 배지가 붙어 있다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 75.0,
          "note": "검색·이어 읽기·허용된 저작물·공식성 배지가 분명하고 권리 안내를 유지했다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "실제 허용된 저작물만 노출하고 출처·공식성 미확인 값을 지어내지 않는다. 검색·원문 공개 권한을 구분한다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "목록 로딩·오류",
        "공개 저작물 없음·있음",
        "이어 읽기 있음·없음",
        "저작물·검색 진입"
      ],
      "productPreserved": "실제 저작물 목록·검색 진입·권리와 공식성 미확인 표시.",
      "productDecision": "검색·선택 위계 다듬기"
    },
    {
      "id": "series",
      "path": "/hoondok/library/{series}",
      "title": "저작물",
      "purpose": "선택한 저작물의 공개된 권과 읽을 수 있는 범위를 확인한다.",
      "primaryAction": "허용된 권을 열거나 검색 인용으로 이동한다.",
      "before": {
        "ux": 68.75,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 권 목록이 단순하며 phone 1열에서 desktop 2열로 재배치된다.",
          "UX: 긴 저작물명 때문에 phone 앱바 제목이 두 줄로 되며 2권 공개·공식성·단락/장 개수는 작은 보조 글자다.",
          "디자인: 저작물 제목·권 목록·공개 상태가 차례대로 놓여 원문을 찾는 목적에 맞다.",
          "디자인: 긴 저작물 제목이 두 줄이 되는 것은 내용 보존에 따른 결과다. 무조건 줄이거나 장식적 타이틀로 바꿀 이유가 없다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "저작물 이름·권 목록·단락 수·공식성 미확인·권리 안내가 유지된다.",
          "UX: 권목록이phone1열/desktop2열로명확히재배치된다.",
          "UX: 섹션18px·권항목17px·개수/권리13.5px로위계가분명하다. 긴앱바제목의2줄은 잘림없이보인다.",
          "디자인: 저작물·권 목록·공개 상태의 기존 위계가 보존되고 메타 글자의 읽기가 개선됐다.",
          "디자인: 긴 정식 저작물 이름을 잘라내지 않고 두 줄로 표시하는 판단이 적절하다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-series-phone.jpg",
          "after": "assets/after-series-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-series-tablet.jpg",
          "after": "assets/after-series-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-series-desktop.jpg",
          "after": "assets/after-series-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 68.75,
          "design": 75.0,
          "note": "긴 저작물 이름이 모바일 앱바에서 두 줄로 보이고 권 목록은 짧고 명확하다. 공개 정보·미확인 배지는 작은 글자다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 75.0,
          "note": "저작물 이름·권 목록·단락 수·공식성 미확인·권리 안내가 유지된다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "검색만 허용된 권을 원문 공개로 오인하게 하지 않는다. 판본·화자·공식성 미확인 값을 지어내지 않는다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "경로 디코딩 실패: 404",
        "권 목록 조회 중·실패",
        "미공개 저작물",
        "권 목록 있음·없음",
        "원문 공개·검색 인용만 허용"
      ],
      "productPreserved": "저작물 이름·권별 진입·검색 인용과 원문 공개 권한의 구분.",
      "productDecision": "긴 제목 처리 개선"
    },
    {
      "id": "search",
      "path": "/hoondok/search",
      "title": "말씀 검색",
      "purpose": "기억나는 단어·구절·뜻으로 허용된 말씀을 찾아 출처와 문맥을 확인한다.",
      "primaryAction": "검색어를 제출하고 결과에서 원문을 연다.",
      "before": {
        "ux": 80.0,
        "design": 75.0,
        "uxRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 단어·구절·상황 예시와 AI 질문 이동을 구분하여 검색/질문의 차이를 행동으로 설명한다.",
          "UX: 입력 위 명시 라벨과 큰 입력/찾기, example chip의 다른 길이를 정리한 배열이 보인다.",
          "디자인: 검색 입력과 단어·구절·상황 예시가 의미에 따라 묶여 있어 무엇을 입력할지 이해하기 쉽다.",
          "디자인: AI 질문으로 넘어가는 보조 행동도 검색과 구분된다. 다만 예시 칩과 본문 메타의 작은 글자는 확대 상태에서 재확인할 필요가 있다."
        ]
      },
      "after": {
        "ux": 80.0,
        "design": 75.0,
        "uxRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "단어·구절·상황 예시와 실제 검색 입력의 과업이 그대로 보이며 AI 질문 이동은 보조다.",
          "UX: 단어/구절/상황 예시와 질문이동을구분해 사용자가검색방식을고를수있다.",
          "UX: visible label/큰입력/찾기/예시칩을유지하고 본문16px·메타13.5px로올렸다.",
          "디자인: 검색 입력, 단어·구절·상황 예시, AI 질문 보조 행동이 명확하게 나뉜다.",
          "디자인: 작은 메타와 입력 텍스트의 읽기가 개선됐으며 기존의 간단한 구조를 보존했다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-search-phone.jpg",
          "after": "assets/after-search-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-search-tablet.jpg",
          "after": "assets/after-search-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-search-desktop.jpg",
          "after": "assets/after-search-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 80.0,
          "design": 75.0,
          "note": "검색창과 단어·구절·상황별 예시, 질문으로 이동하는 보조 안내가 보인다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 80.0,
          "design": 75.0,
          "note": "단어·구절·상황 예시와 실제 검색 입력의 과업이 그대로 보이며 AI 질문 이동은 보조다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "최근 검색은 기기에만 저장한다. 검색어 직접 일치와 뜻이 가까운 결과를 구분하고 검색만 허용된 인용을 원문 공개처럼 표현하지 않는다. 오류와 0건을 구분한다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "검색 전·최근 검색·예시",
        "입력·검색 중",
        "검색 오류·재시도",
        "결과 0건",
        "직접 일치·의미 유사 결과",
        "원문 허용·검색 인용만 허용"
      ],
      "productPreserved": "검색 입력과 직접 일치·뜻 유사 구분 정책, 실제 검색만 허용한 자료 경계, 기기 최근 검색.",
      "productDecision": "검색 시작점 유지"
    },
    {
      "id": "words",
      "path": "/hoondok/words/{id}",
      "title": "원문 읽기",
      "purpose": "말씀을 앞뒤 문맥·판본·출처와 함께 읽고 자기 기록을 남긴다.",
      "primaryAction": "목표 단락을 읽고 이어 읽기·형광펜·노트 도구를 사용한다.",
      "before": {
        "ux": 68.75,
        "design": 70.0,
        "uxRatings": [
          3,
          3,
          3,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          2,
          3,
          3
        ],
        "notes": [
          "UX: 본문·AI 설명·노트·듣기·형광펜을 구별하며 desktop은 실제 목차와 제한된 읽기 폭을 제공한다.",
          "UX: 권리 라벨·음성 상태·긴누르기 안내·단락 번호는 11~12.5px급이고 도구층이 많다. 본문 자체는 DOM16.5px로, 긴 스크린샷 축소를 실제 작은 글자로 오판하지 않았다.",
          "디자인: 본문은 충분한 행간과 제한된 읽기 폭을 갖고, PC에는 목차가 별도 레일로 배치된다.",
          "디자인: 휴대폰 첫 화면에서 출처·탭·오디오·사용법·하단 도구가 동시에 노출되어 읽기 전에 처리할 정보가 많다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 76.25,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          4,
          2,
          3,
          3
        ],
        "notes": [
          "원문·단락 번호·낭독·본문/AI/노트·구간 끝 읽기 행동을 보존한다.",
          "UX: 본문/AI설명/노트/듣기와 desktop목차를 구별하는 읽기구조를유지한다.",
          "UX: 메타13.5/본문17/섹션18로 정보층의읽기크기가개선됐다. 긴이미지축소를실제폰트크기로오판하지않았다.",
          "디자인: 원문 읽기 폭과 행간, 출처·장·본문의 타이포 위계가 정교하게 연결되고 PC 목차 레일이 유지된다.",
          "디자인: 첫 화면의 탭·오디오·사용법·하단 도구가 많다는 밀도 등급 2는 그대로 남긴다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-words-phone.jpg",
          "after": "assets/after-words-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-words-tablet.jpg",
          "after": "assets/after-words-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-words-desktop.jpg",
          "after": "assets/after-words-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 68.75,
          "design": 70.0,
          "note": "원문 탭·낭독 바·출처 뒤 긴 25단락 문서가 이어지고 선택 도구·구간 끝 다음 읽기 행동이 보인다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 76.25,
          "note": "원문·단락 번호·낭독·본문/AI/노트·구간 끝 읽기 행동을 보존한다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "공식 원문·AI 설명·개인 노트의 권위 층을 유지한다. 검색어 임시 밑줄과 저장 형광펜을 구분하며 권리 없는 원문은 열지 않는다. 카드·검색·목차 진입 단락을 잃지 않는다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "경로 오류·미공개·404",
        "원문 로딩·실패",
        "본문·AI 설명·노트 탭",
        "목차·페이지·검색·책갈피·이어 읽기 도착",
        "단락 선택·형광펜·메모",
        "브라우저·음성 낭독 재생·일시정지·실패",
        "읽음 기록·원문 끝·시트"
      ],
      "productPreserved": "원문 전체와 단락 번호, 출처·판본 경계, 임시 검색 표시와 저장 형광펜 구분, 낭독·노트 접근.",
      "productDecision": "읽기 도구 가독성 개선"
    },
    {
      "id": "garden",
      "path": "/hoondok/garden",
      "title": "나의 정원",
      "purpose": "자신의 읽기 기록과 정성을 돌아보고 관심사·마음·계정을 관리한다.",
      "primaryAction": "읽기 기록을 확인하고 필요한 개인 기능으로 이동한다.",
      "before": {
        "ux": 58.75,
        "design": 60.0,
        "uxRatings": [
          2,
          2,
          3,
          2,
          3
        ],
        "designRatings": [
          2,
          3,
          2,
          3,
          2
        ],
        "notes": [
          "UX: 연속일 숫자와 큰 월 달력이 상단을 차지하여 개인 맞춤/기록/계정 관리가 phone에서 깊은 스크롤 뒤에 나온다.",
          "UX: 정성 없음·기록 없음이 큰 별도 카드로 반복되어 이미 없는 정보가 실제 다음 행동보다 높은 비중을 차지한다.",
          "디자인: 달력·정성 빈 상태·기록 빈 상태가 큰 독립 카드로 반복되어 개인화와 책갈피 진입이 화면 아래로 밀린다.",
          "디자인: 정성 없음과 기록 없음이 각각 큰 빈 화면을 차지하는 대신, 현재 할 수 있는 행동을 중심으로 압축할 여지가 크다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "관심사와 마음·마음 한 장이 프로필 바로 다음에 있어 개인 비전에 맞는 첫 행동이 된다. 빈 정성·기록은 단순한 형태로 줄었다.",
          "UX: 나에게맞추기를프로필다음으로올려 개인화행동이달력/빈상태보다먼저보인다.",
          "UX: 정성없음/기록없음은작은좌측정렬행동구조로바뀌어반복큰빈카드의시각비중이줄었다.",
          "디자인: 나에게 맞추기를 위로 올려 관심사·마음 한 장이 기록 대시보드 아래에 묻히지 않는다.",
          "디자인: 정성·기록의 큰 반복 빈 상태를 왼쪽의 짧은 안내로 정리해 현재 가능한 행동과 후속 기록의 구분이 더 명확해졌다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-garden-phone.jpg",
          "after": "assets/after-garden-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-garden-tablet.jpg",
          "after": "assets/after-garden-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-garden-desktop.jpg",
          "after": "assets/after-garden-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 58.75,
          "design": 60.0,
          "note": "큰 월 달력과 진행 정성 빈 상태 뒤에 관심사·마음 한 장이 나온다. 다시 큰 기록 빈 카드가 있고 나머지 진입·계정이 이어져 모바일 전체 높이가 2136px이다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 75.0,
          "note": "관심사와 마음·마음 한 장이 프로필 바로 다음에 있어 개인 비전에 맞는 첫 행동이 된다. 빈 정성·기록은 단순한 형태로 줄었다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "개인 기록과 기기 전용 기록을 구분하고, 로그인 없이 읽을 수 있는 안내를 유지한다. 정성은 N일차로 표현하며 빠진 날·순위를 부각하지 않는다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "인증 조회·비로그인·로그인",
        "통계·달력 로딩·실패·데이터 있음",
        "진행 정성 있음·없음",
        "나의 기록 있음·없음",
        "개인 답·마음 한 장 진입",
        "책갈피·가족 플래그",
        "로그아웃 실패"
      ],
      "productPreserved": "비처벌 기록, 정성 N일차, 개인·기기 기록 구분, 계정 하단 배치, 달력과 자기 기록의 존재.",
      "productDecision": "정보 위계 재구성"
    },
    {
      "id": "records",
      "path": "/hoondok/records",
      "title": "나의 기록",
      "purpose": "자신이 남긴 형광펜과 노트를 조건별로 찾아 원문 맥락으로 돌아간다.",
      "primaryAction": "형광펜·노트 탭과 필터에서 기록을 연다.",
      "before": {
        "ux": 73.75,
        "design": 75.0,
        "uxRatings": [
          4,
          3,
          3,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 빈 기록의 이유·기록하는 방법·말씀 서고 이동이 함께 있어 막힌 상태에서의 다음 행동이 명료하다.",
          "UX: 기록 방법과 비공개 안내는 12.5px급으로 작다. 본문이 짧아 핵심 CTA를 찾기 쉽다.",
          "디자인: 기록이 없다는 상태, 기록을 만드는 방법, 말씀 서고로 가는 행동이 하나의 흐름으로 묶인다.",
          "디자인: 나만 본다는 안내가 있고 과장된 성취나 가짜 채움 데이터가 없다. 현재 기본 구성은 목적에 맞다."
        ]
      },
      "after": {
        "ux": 80.0,
        "design": 75.0,
        "uxRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "빈 기록 안내와 말씀 서고 CTA가 같은 좌측 위계로 정리됐고 개인 비공개 설명을 유지한다.",
          "UX: 빈기록의이유·만드는방법·말씀서고이동이한영역에서명료하다.",
          "UX: 좌측정렬/낮아진빈상태높이와커진도움말로다음행동을더빨리읽을수있다.",
          "디자인: 빈 상태 문장과 CTA를 같은 왼쪽 기준선으로 정리해 안내 묶음이 짧고 명확해졌다.",
          "디자인: 개인 기록의 비공개 설명과 기록을 만들기 위한 실제 진입은 보존된다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-records-phone.jpg",
          "after": "assets/after-records-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-records-tablet.jpg",
          "after": "assets/after-records-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-records-desktop.jpg",
          "after": "assets/after-records-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 73.75,
          "design": 75.0,
          "note": "기록 없음 카드와 말씀 서고로 가기 버튼, 개인 기록 안내가 보인다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 80.0,
          "design": 75.0,
          "note": "빈 기록 안내와 말씀 서고 CTA가 같은 좌측 위계로 정리됐고 개인 비공개 설명을 유지한다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "계정 소유 기록만 보이고 원문 공개 권한을 보존한다. 서버 기록과 이 기기 전용 질문·한 줄을 같은 저장 위치로 표현하지 않는다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "인증 조회·비로그인",
        "기록 로딩·오류·재시도",
        "전체 기록 없음",
        "형광펜·노트 탭",
        "색·권 필터",
        "필터 결과 없음·목차 조회"
      ],
      "productPreserved": "빈 결과를 정직하게 표시하고 다음 행동 하나를 제공하며 가족·모임 비공개를 알림.",
      "productDecision": "빈 상태 다듬기"
    },
    {
      "id": "device",
      "path": "/hoondok/records/device",
      "title": "이 기기에만 있는 기록",
      "purpose": "기기에만 남은 오늘의 한 줄과 저장한 AI 답을 확인하고 보존 한계를 이해한다.",
      "primaryAction": "한 줄을 복사하거나 저장한 AI 답으로 이동한다.",
      "before": {
        "ux": 68.75,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 최종 비교는0ef11993 별도서버에서 같은DB상태로 캡처한 빈기록 상태다. 기기저장 범위·삭제조건과 빈기록 안내를 나눈다.",
          "UX: 삭제·로그아웃·계정로그인·이전기능부재를 한 긴 안내문에 담아 phone에서 읽기 부담이 크고12.5px급 보조 설명이다.",
          "디자인: 기기 저장 범위 설명과 이 기기에 남은 기록 없음 상태가 구분되어 있다.",
          "디자인: 정보 안내 본문은 길지만 기기 저장·로그아웃·삭제의 차이를 설명한다. 현재 기록이 없다는 상태와 혼동되지 않는다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "기기 저장과 삭제 가능성·계정 이전 없음이 먼저 보이며 실제 빈 상태를 정직하게 표시한다.",
          "UX: 최종before와같은빈기록상태에서기기저장범위·삭제조건과기록방법을비교했다.",
          "UX: 도움말13.5/본문16/빈상태제목17로읽기크기를올렸고빈상태를좌측정렬해내용의시작을맞췄다.",
          "디자인: 이 브라우저의 기록이라는 안내와 빈 상태를 별도의 표면으로 구분한다.",
          "디자인: 설명·기록 없음 상태의 왼쪽 정렬이 일관되고 읽기 크기가 개선됐다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-device-phone.jpg",
          "after": "assets/after-device-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-device-tablet.jpg",
          "after": "assets/after-device-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-device-desktop.jpg",
          "after": "assets/after-device-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 68.75,
          "design": 75.0,
          "note": "상단 회색 정보 박스의 긴 문장이 기기 저장·삭제 조건을 설명하고 저장한 AI 답 진입 하나가 이어진다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 75.0,
          "note": "기기 저장과 삭제 가능성·계정 이전 없음이 먼저 보이며 실제 빈 상태를 정직하게 표시한다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "서버 동기화·계정 이전 기능이 없음을 알린다. 브라우저 정리·로그아웃·계정 전환 시 지워질 수 있고 AI 답은 공식 해설이 아님을 유지한다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "저장소 읽기 전",
        "기록 없음",
        "한 줄 있음·저장한 답 있음",
        "복사 성공·실패"
      ],
      "productPreserved": "동기화·계정 이전 없음, 삭제 가능 조건, AI는 공식 해설 아님, 서버로 보내지 않는 기록.",
      "productDecision": "저장 경계 가독성 개선"
    },
    {
      "id": "settings",
      "path": "/hoondok/settings",
      "title": "알림·설치",
      "purpose": "지원 환경에 맞게 훈독 알림과 앱 설치를 직접 관리한다.",
      "primaryAction": "지원 환경에서 훈독 알림을 켜거나 설치 안내를 따른다.",
      "before": {
        "ux": 58.75,
        "design": 66.25,
        "uxRatings": [
          2,
          3,
          2,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          2,
          3,
          2
        ],
        "notes": [
          "UX: 설치 안내는 실제 다음 행동을 설명하나 알림·조용한 시간 등 주요 구역 대부분이 준비 중이다.",
          "UX: 준비중 안내는 있으나 설정 행이 실제 설정과 비슷한 구조라 가능한 조작을 먼저 구별하기 어렵다. 신규 기능 구현을 요구하는 판정은 아니다.",
          "디자인: 설치·알림·계정 데이터 삭제가 그룹으로 구분된다.",
          "디자인: 현재 환경에서는 준비 중인 알림·조용한 시간 항목들이 활성 기능과 같은 카드 비중을 차지해, 지금 가능한 행동이 무엇인지 약하다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "작동 가능한 설치·계정 삭제와 준비 중 알림·조용한 시간의 시각 형태가 구분된다. 조용한 시간은 현재 제공되지 않음을 명시한다.",
          "UX: 설치/실제데이터삭제가카드로남고 준비중설정은평면행과명시문장으로구별된다.",
          "UX: 조용한시간은설정된값처럼보이던표현대신기능준비중이라고설명한다.",
          "디자인: 준비 중인 보조 알림·조용한 시간의 외곽 카드를 덜어 설치·실제 데이터 삭제와의 시각적 차이가 생겼다.",
          "디자인: 준비 중인 조용한 시간을 확정된 설정처럼 보여 주던 문구를 준비 상태 설명으로 바꿔 현재 가능한 행동을 정직하게 전달한다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-settings-phone.jpg",
          "after": "assets/after-settings-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-settings-tablet.jpg",
          "after": "assets/after-settings-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-settings-desktop.jpg",
          "after": "assets/after-settings-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 58.75,
          "design": 66.25,
          "note": "설치 안내 아래 알림·조용한 시간·내 데이터 삭제가 비슷한 카드 형태다. 실제 불가 상태와 이동 가능한 듯한 행이 함께 보인다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 75.0,
          "note": "작동 가능한 설치·계정 삭제와 준비 중 알림·조용한 시간의 시각 형태가 구분된다. 조용한 시간은 현재 제공되지 않음을 명시한다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "알림 권한 요청은 사용자 클릭으로 시작한다. 실제 알림은 훈독하기만 제공하며 기도·가정예배·공지·조용한 시간은 준비 중이다. 지원하지 않는 환경을 작동하는 것처럼 표시하지 않는다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "기본",
      "stateCoverage": [
        "인앱 브라우저·설치 가능·설치 완료",
        "알림 지원·미지원",
        "비로그인·로그인",
        "권한 기본·허용·차단",
        "구독 조회·변경 중·오류",
        "준비 중 알림 종류"
      ],
      "productPreserved": "환경별 설치 안내, 사용자 제스처 권한 요청, 준비 중 기능의 정직한 표시.",
      "productDecision": "실제 기능·준비 상태 구분"
    },
    {
      "id": "group-new",
      "path": "/hoondok/groups/new",
      "title": "모임 만들기",
      "purpose": "초대할 소그룹 훈독 모임을 만들고 선택적으로 모임 정성을 연다.",
      "primaryAction": "이름·모임 시각 등을 입력해 모임을 만든다.",
      "before": {
        "ux": 63.75,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          2,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 종류·모임이름·표시이름·시간·선택 정성을 순차로 묶고 입력 위 label이 있다.",
          "UX: 가족 모임은 준비 중으로 구분하지만 폼이 길고 제출 오류는 폼 하단 한 곳과 필드 focus로 나뉜다. aria-invalid/오류 연결 실측 필요.",
          "디자인: 모임 유형·이름·모임 안 이름·시간이 라벨과 도움말로 구분되어 폼 목적이 명확하다.",
          "디자인: 가족 모임 준비 상태와 개인정보 안내가 실제 정책을 전달한다. 도움말을 일괄 삭제하는 시각 단순화는 부적절하다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "필수 이름·선택 시각·선택 정성이 더 읽기 쉽게 묶이고 준비 중 가족 유형·비검색·비경쟁 안내가 남아 있다.",
          "UX: label있는모임명/이름/시간/선택정성을순서대로제공하고준비중가족유형을분리한다.",
          "UX: field별aria-invalid/aria-describedby오류연결을추가한코드를확인했다. 오류전후실측은root테스트결과에귀속된다.",
          "디자인: 폼 순서·라벨·선택 상태를 유지하고 긴 설명도 읽을 수 있는 크기로 개선했다.",
          "디자인: 가족 모임의 준비 상태·모임 검색 및 순위 금지와 같은 설명이 삭제되지 않았다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-group-new-phone.jpg",
          "after": "assets/after-group-new-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-group-new-tablet.jpg",
          "after": "assets/after-group-new-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-group-new-desktop.jpg",
          "after": "assets/after-group-new-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 63.75,
          "design": 75.0,
          "note": "소그룹 선택·가족 준비 상태·이름 입력·시각이 긴 단일 양식으로 이어진다. 필수·선택 설명이 작은 글자로 많다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 75.0,
          "note": "필수 이름·선택 시각·선택 정성이 더 읽기 쉽게 묶이고 준비 중 가족 유형·비검색·비경쟁 안내가 남아 있다.",
          "screenshots": []
        },
        {
          "title": "키보드 초점 가림 재현 → 수정",
          "note": "하단 탭이 초점을 받은 컨트롤을 덮는 것을 실측했습니다. scroll-margin으로 초점 스크롤 여유를 확보하고 실제 크기·중앙 hit-test·키보드 조작을 확인했습니다."
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "오늘 범위는 공식 편성을 따르고 임의 본문 선택을 만들지 않는다. 소속 교회 수집을 강요하지 않으며 가족 유형 등 준비 상태를 유지한다. 생성 후 초대 코드는 새로고침에도 다시 확인할 수 있다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "함께 읽기 플래그",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "비로그인·인증 조회",
        "입력 중·필수값 오류",
        "모임 정성 끔·켬·기간 오류",
        "생성 중·개수 제한·실패",
        "생성 완료·초대 코드 로딩·공유"
      ],
      "productPreserved": "소속 비강제, 실제 지원 모임 유형과 준비 상태 구분, 선택 정성, 모임 비검색·비경쟁 정책.",
      "productDecision": "양식 위계 다듬기"
    },
    {
      "id": "group-join",
      "path": "/hoondok/groups/join",
      "title": "모임 참여",
      "purpose": "초대받은 모임과 공개 범위를 확인한 뒤 참여한다.",
      "primaryAction": "초대 코드를 확인하고 모임에서 쓸 이름으로 참여한다.",
      "before": {
        "ux": 73.75,
        "design": 75.0,
        "uxRatings": [
          4,
          3,
          3,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 초대코드/초대한 사람/모임정보/이미 가입 상태를 나눠 보여 중복 가입 대신 모임 이동을 명확히 제공한다.",
          "UX: 코드 입력과 확인은 큰 대상이지만 리더·공식 편성·퇴장시 삭제되는 데이터 설명은 작은 보조 크기다.",
          "디자인: 초대 코드 확인, 들어갈 모임 정보, 이미 가입한 경우 모임으로 가기가 순서대로 구분된다.",
          "디자인: 공유한 사람과 나갈 수 있다는 안내가 있어 참여의 결과를 예측할 수 있다."
        ]
      },
      "after": {
        "ux": 80.0,
        "design": 75.0,
        "uxRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "이미 모임원 상태와 모임으로 가기가 명확하며 초대 코드가 보존돼 있다.",
          "UX: 초대코드·초대한사람·모임정보·이미가입된상태에서모임으로가기까지명료하다.",
          "UX: 개인정보·리더·퇴장영향안내13.5로기존작은도움말을개선했다.",
          "디자인: 초대 코드·모임 정보·이미 참여한 경우의 행동이 단계에 따라 명확하게 구분된다.",
          "디자인: 초대자와 탈퇴 가능 안내를 현재 흐름 안에서 보존했다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-group-join-phone.jpg",
          "after": "assets/after-group-join-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-group-join-tablet.jpg",
          "after": "assets/after-group-join-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-group-join-desktop.jpg",
          "after": "assets/after-group-join-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 73.75,
          "design": 75.0,
          "note": "입력된 초대 코드·초대 링크 안내·모임 정보 뒤에 이미 식구라는 상태와 모임으로 가기 버튼이 보인다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 80.0,
          "design": 75.0,
          "note": "이미 모임원 상태와 모임으로 가기가 명확하며 초대 코드가 보존돼 있다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "가입 후에도 초대 코드를 보존한다. 참여 전 이름·읽은 시각·한 줄의 공개 범위와 질문·노트 비공개를 알린다. 만료·없는 코드는 같은 안내를 사용한다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "함께 읽기 플래그",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "비로그인·인증 조회",
        "코드 없음·링크 미리 채움",
        "코드 검증·미리보기 조회·실패",
        "이미 모임원",
        "이름 중복·정원·참여 개수 제한",
        "참여 중·성공·실패"
      ],
      "productPreserved": "초대 코드 유지, 모임 미리보기, 이미 참여 상태 안내, 나가기·기록 경계.",
      "productDecision": "상태 중심 다듬기"
    },
    {
      "id": "group",
      "path": "/hoondok/groups/{id}",
      "title": "훈독 모임",
      "purpose": "같은 오늘 말씀을 읽는 식구의 존재와 한 줄 나눔을 확인한다.",
      "primaryAction": "오늘 범위를 읽거나 모임에 한 줄을 남긴다.",
      "before": {
        "ux": 63.75,
        "design": 68.75,
        "uxRatings": [
          3,
          2,
          3,
          2,
          3
        ],
        "designRatings": [
          2,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 모임 이름·읽기 범위·읽은 식구·한줄 나눔이 구분되며 미완료자를 노출하지 않는 안내가 있다.",
          "UX: 초대하기가 주색 primary이고 매일 핵심 행동인 훈독하기는 카드의 작은 글자 링크라 실제 과업 우선순위가 분산된다.",
          "디자인: 공식 편성·읽은 식구·나눔이 나뉘고 미완료자를 드러내지 않는 규칙을 설명한다.",
          "디자인: 반복 방문 화면에서 초대하기가 유일한 채움 CTA이고 오늘 범위의 훈독하기는 작은 텍스트 링크여서 매일 읽기보다 관리 행동이 강조된다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "초대하기가 보조 버튼으로 낮아져 오늘 범위·훈독하기·한 줄 남기기가 내용의 중심이다.",
          "UX: 초대하기주색을낮춰오늘범위의훈독하기/오늘한줄행동과경쟁하던시각강도를완화했다.",
          "UX: 출처13.5·본문16·섹션18로긴제목과모임상태를구별한다.",
          "디자인: 초대하기를 보조 버튼으로 낮춰 모임 관리가 오늘 읽기보다 먼저 강하게 보이던 위계를 개선했다.",
          "디자인: 공식 편성·읽은 사람·한 줄 나눔의 구분과 비공개 규칙은 유지된다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-group-phone.jpg",
          "after": "assets/after-group-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-group-tablet.jpg",
          "after": "assets/after-group-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-group-desktop.jpg",
          "after": "assets/after-group-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 63.75,
          "design": 68.75,
          "note": "모임 제목 아래 초대하기가 유일한 채움 버튼이고 오늘 읽기와 한 줄 남기기는 작은 텍스트 행동이다. 오늘 완료자는 한 명만 표시된다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 75.0,
          "note": "초대하기가 보조 버튼으로 낮아져 오늘 범위·훈독하기·한 줄 남기기가 내용의 중심이다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "오늘 완료자만 가나다순으로 표시한다. 미완료자·전체 인원·순위는 노출하지 않는다. 반응 수는 내 한 줄에 나에게만 보이며, 공식·모임 정성을 구분한다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "함께 읽기 플래그",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "인증 조회·비로그인",
        "조회 중·실패·없는 모임·제외됨",
        "오늘 범위 있음·없음",
        "오늘 완료자 있음·없음",
        "나눔 있음·없음",
        "반응·삭제 확인·실패",
        "초대 공유"
      ],
      "productPreserved": "오늘 완료자만 표시·가나다순·모임 안 공개·반응 수 비공개·권리 있는 오늘 범위.",
      "productDecision": "일상 행동 우선순위 개선"
    },
    {
      "id": "group-share",
      "path": "/hoondok/groups/{id}/share",
      "title": "한 줄 나눔",
      "purpose": "오늘 읽은 말씀에 대한 마음을 해당 모임에 선택적으로 남긴다.",
      "primaryAction": "100자 이내 한 줄을 작성하거나 기존 한 줄을 고쳐 남긴다.",
      "before": {
        "ux": 68.75,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 읽은 말씀 맥락·라벨 있는 한줄 입력·최대100자·모임에 보이는 범위·취소가 함께 있다.",
          "UX: 출처/글자수/공개범위는 12.5px급이며 첫 제안문은 열린 인용부호로 끝나 실제 완성 예시와 다르게 보인다.",
          "디자인: 오늘 읽은 말씀에서 한 줄을 작성하고 모임에 보낸다는 흐름이 명확하다.",
          "디자인: 본문 요약·작성란·시작 문장 예시가 구분되며 예시 버튼은 장식이 아닌 작성 지원이다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "원문 출처→오늘 말씀→모임에 남길 한 줄→공개 범위→선택적 시작 문장이 유지된다.",
          "UX: 말씀맥락·한줄label·최대100자·공개범위·취소가현재과업과함께보인다.",
          "UX: 16px입력/13.5px글자수와공개범위로가독성이개선됐다.",
          "디자인: 말씀 맥락·작성란·시작 문장 예시·보내기의 기존 흐름이 유지된다.",
          "디자인: 공개 범위와 삭제 가능 안내의 글자가 더 잘 읽힌다. 이 안내를 시각적으로 덜어내지 않은 판단이 적절하다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-group-share-phone.jpg",
          "after": "assets/after-group-share-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-group-share-tablet.jpg",
          "after": "assets/after-group-share-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-group-share-desktop.jpg",
          "after": "assets/after-group-share-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 68.75,
          "design": 75.0,
          "note": "오늘 말씀 요약 카드가 먼저 보이고 그 아래 textarea·공개 안내·시작 문장 세 개·나눔 버튼이 있다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 75.0,
          "note": "원문 출처→오늘 말씀→모임에 남길 한 줄→공개 범위→선택적 시작 문장이 유지된다.",
          "screenshots": []
        },
        {
          "title": "키보드 초점 가림 재현 → 수정",
          "note": "하단 탭이 초점을 받은 컨트롤을 덮는 것을 실측했습니다. scroll-margin으로 초점 스크롤 여유를 확보하고 실제 크기·중앙 hit-test·키보드 조작을 확인했습니다."
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "오늘 훈독을 마친 뒤만 게시한다. 모임에만 공개됨과 직접 삭제 가능함을 밝히며, 남기지 않고 돌아가기를 제공한다. 개인 마음 한 장의 기기 메모와 자동 연결하지 않는다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "함께 읽기 플래그",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "비로그인·모임 조회 중·실패·제외됨",
        "오늘 훈독 미완료",
        "새 글·기존 글 수정",
        "공백·길이 검증",
        "제출 중·성공·실패·제한"
      ],
      "productPreserved": "해당 모임에만 공개·직접 삭제 가능·선택적 나눔·100자·읽기 선행 조건.",
      "productDecision": "작성 집중도 개선"
    },
    {
      "id": "group-settings",
      "path": "/hoondok/groups/{id}/settings",
      "title": "모임 설정",
      "purpose": "자신의 역할에 맞게 모임·표시 이름·초대·회원 관계를 관리한다.",
      "primaryAction": "필요한 설정을 수정하고 저장한다.",
      "before": {
        "ux": 68.75,
        "design": 70.0,
        "uxRatings": [
          3,
          3,
          3,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          2,
          3,
          3
        ],
        "notes": [
          "UX: 모임/표시이름 저장, 식구, 초대코드, 위험행동을 섹션으로 나눴다.",
          "UX: 나가기와 삭제는 별도 설명을 갖지만 같은 색/작은 버튼 계층으로 보여 파급 차이를 읽는 데 작은 도움말에 의존한다.",
          "디자인: 이름 저장·식구 목록·초대 코드·위험 행동을 구분하고 삭제 안내를 함께 제공한다.",
          "디자인: 초대 코드 영역에 테두리·점선·여러 버튼이 중첩되어 해당 섹션의 시각적 무게가 크고 페이지가 길어진다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "평상 이름 변경·식구·초대와 위험 행동이 별도 영역으로 유지된다. 설명이 충분히 읽힌다.",
          "UX: 저장/식구/초대/위험행동이구역으로나뉘고나가기·삭제의영향설명이읽기쉬워졌다.",
          "UX: 메타13.5/본문16로만료일·코드재생성·파괴범위를커진글자로제공한다.",
          "디자인: 초대 코드 내부의 점선 경계를 덜고 연한 배경으로 구분해 외곽 카드와의 중첩 테두리 무게를 줄였다.",
          "디자인: 코드·공유·복사·재발급·위험 행동의 설명과 순서는 유지되고, 모바일과 PC에서 코드의 중심성이 명확하다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-group-settings-phone.jpg",
          "after": "assets/after-group-settings-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-group-settings-tablet.jpg",
          "after": "assets/after-group-settings-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-group-settings-desktop.jpg",
          "after": "assets/after-group-settings-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 68.75,
          "design": 70.0,
          "note": "이름 입력 두 개·식구 목록·큰 초대 코드·나가기/삭제가 차례로 보인다. 위험 행동은 하단 별도 영역에 있다."
        },
        {
          "title": "첫 재심사: 추가 수정 필요",
          "reviewer": "비주얼 독립 심사",
          "design": 70.0,
          "ratings": [
            3,
            3,
            2,
            3,
            3
          ],
          "note": "이름·식구·초대·위험 행동의 구분과 도움말은 유지되고 글자 크기는 개선됐다. 초대 코드 영역의 외곽 카드·내부 점선 박스·여러 버튼이 중첩된 시각적 무게는 그대로 남는다. 최소 수정: 초대 코드의 중첩 경계를 하나 덜고 코드·복사·재발급 설명은 그대로 보존한다.",
          "screenshots": [
            {
              "label": "첫 재심사 / phone",
              "src": "assets/round1-group-settings-phone.jpg"
            },
            {
              "label": "첫 재심사 / desktop",
              "src": "assets/round1-group-settings-desktop.jpg"
            }
          ]
        },
        {
          "title": "최소 수정 후 재심사",
          "reviewer": "비주얼 독립 심사",
          "design": 75.0,
          "ratings": [
            3,
            3,
            3,
            3,
            3
          ],
          "note": "초대 코드 내부의 점선 경계를 덜고 연한 배경으로 구분해 외곽 카드와의 중첩 테두리 무게를 줄였다. 코드·공유·복사·재발급·위험 행동의 설명과 순서는 유지되고, 모바일과 PC에서 코드의 중심성이 명확하다. 초대 코드의 과도한 중첩 경계에 대한 밀도 감점이 해소됐다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 75.0,
          "note": "평상 이름 변경·식구·초대와 위험 행동이 별도 영역으로 유지된다. 설명이 충분히 읽힌다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "리더 권한은 서버가 판정한다. 전체 인원은 리더 설정에서만 보이고 식구 목록에 읽음 상태를 넣지 않는다. 내보내기·나가기·삭제·코드 재발급은 영향 안내와 인라인 확인을 유지한다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "함께 읽기 플래그",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "비로그인·인증 조회",
        "모임 조회 중·실패·권한 상실",
        "리더·모임원",
        "이름 저장·검증 오류·중복 이름",
        "초대 코드 재발급 확인",
        "내보내기·나가기·삭제 확인",
        "리더 나가기 제한·403·404"
      ],
      "productPreserved": "역할별 권한, 전체 인원은 리더만, 식구 목록에서 읽음 상태 없음, 되돌릴 수 없는 동작 확인.",
      "productDecision": "설정·위험 행동 구분"
    },
    {
      "id": "bookmark",
      "path": "/hoondok/bookmark",
      "title": "오늘의 책갈피",
      "purpose": "오늘 편성 또는 고른 관심사와 마음에 맞는 실제 말씀 카드를 받아 읽는다.",
      "primaryAction": "책갈피를 읽고 원문에서 앞뒤 읽기로 이어간다.",
      "before": {
        "ux": 75.0,
        "design": 81.25,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 짧은 말씀과 출처를 중심에 두고 원문/내 책갈피/건네기 행동을 분리한다.",
          "UX: 책에 다시 꽂기라는 은유는 앞뒤 문맥을 원문에서 읽는다는 하위 문장으로 설명된다.",
          "디자인: 한 장의 말씀과 원문으로 돌아가는 행동이 선명하며, 책갈피의 시각적 물성이 제품의 정체성을 만든다.",
          "디자인: 실제 구절을 보여 주는 카드와 책갈피 동작은 가짜 제품 스크린샷이 아니다. 현재 사진 배경을 유지해도 무방하다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 81.25,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "말씀 카드·출처·책갈피 모티브를 보존하고 책에 다시 꽂기/원문 앞뒤 읽기가 강한 주 행동이다.",
          "UX: 말씀/출처/원문문맥primary/보관·건네기를서로다른역할로보존한다.",
          "UX: 보조버튼16px로올랐고phone에서한줄라벨과충분한폭을유지한다.",
          "디자인: 한 구절을 읽고 원문으로 돌아가는 주 행동이 유지된다. 공유는 보조 행동으로 남는다.",
          "디자인: 이미지와 실제 책갈피 상호작용은 기존 제품 고유성을 보존하는 방향으로 유지했다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-bookmark-phone.jpg",
          "after": "assets/after-bookmark-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-bookmark-tablet.jpg",
          "after": "assets/after-bookmark-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-bookmark-desktop.jpg",
          "after": "assets/after-bookmark-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 75.0,
          "design": 81.25,
          "note": "말씀 한 장과 출처가 중앙 카드에 집중되고 원문으로 돌아가기·나의 책갈피·건네기가 아래에 보인다. 카드 하단의 컵·가지 사진은 여백을 크게 차지한다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 81.25,
          "note": "말씀 카드·출처·책갈피 모티브를 보존하고 책에 다시 꽂기/원문 앞뒤 읽기가 강한 주 행동이다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "첫 수령과 재열람을 구분하고 reduced-motion을 존중한다. 맞춤 실패 시 오늘 편성으로 돌아간다. 말씀·출처·원문 연결을 보존하며, 없는 카드를 꾸미지 않는다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "책갈피 플래그",
      "stateCoverage": [
        "플래그 꺼짐: 홈 이동",
        "기기 답·카드 선택 조회 중",
        "맞춤 카드·오늘 편성 대체",
        "카드 없음",
        "첫 수령 모션·재열람",
        "읽기·책에 다시 꽂기",
        "공유 시트·공유 성공·취소·실패"
      ],
      "productPreserved": "말씀·출처·책갈피 비유, 원문 우선 행동, 선택적 공유, 수령·재열람·reduced-motion.",
      "productDecision": "제품 고유성 유지"
    },
    {
      "id": "bookmarks",
      "path": "/hoondok/bookmarks",
      "title": "나의 책갈피",
      "purpose": "받거나 건넨 말씀을 책별로 돌아보고 다시 읽는다.",
      "primaryAction": "받은·건넨 탭 또는 책 필터에서 책갈피를 연다.",
      "before": {
        "ux": 73.75,
        "design": 75.0,
        "uxRatings": [
          4,
          3,
          3,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 받은/건넨 탭과 빈 상태 다음 행동인 오늘의 책갈피가 명료하다.",
          "UX: 비어 있는 이유와 시작 방법이 작은 12.5px 보조 설명으로 처리된다.",
          "디자인: 받은 책갈피·건넨 책갈피 구분과 비어 있을 때 오늘의 책갈피로 가는 행동이 명확하다.",
          "디자인: 데이터가 없는 상태의 여백은 적절하다. 빈 공간을 기능 없는 카드나 샘플 데이터로 채울 필요가 없다."
        ]
      },
      "after": {
        "ux": 80.0,
        "design": 75.0,
        "uxRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "받은·건넨 탭과 정직한 빈 상태·오늘 책갈피 CTA를 유지한다.",
          "UX: 받은/건넨탭과빈상태이유·오늘의책갈피이동이명료하다.",
          "UX: 최신phone/desktop을재열람해빈상태문구와CTA가같은중앙축으로정렬된것을확인했다.",
          "디자인: 빈 상태의 아이콘·제목·설명·CTA가 다시 중앙 기준선으로 일치한다.",
          "디자인: 정원용 압축 정렬 규칙의 영향 범위를 좁혀 책갈피 목록에서 발생한 정렬 회귀가 해소됐다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-bookmarks-phone.jpg",
          "after": "assets/after-bookmarks-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-bookmarks-tablet.jpg",
          "after": "assets/after-bookmarks-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-bookmarks-desktop.jpg",
          "after": "assets/after-bookmarks-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 73.75,
          "design": 75.0,
          "note": "받은·건넨 탭과 받은 책갈피 없음 안내·오늘 책갈피 CTA가 보인다."
        },
        {
          "title": "첫 재심사: 추가 수정 필요",
          "reviewer": "비주얼 독립 심사",
          "design": 71.25,
          "ratings": [
            3,
            3,
            3,
            2,
            3
          ],
          "note": "빈 상태 제목·설명은 중앙 정렬인데 오늘의 책갈피 CTA만 왼쪽으로 이동해 같은 묶음의 정렬이 어긋난다. 최소 수정: 이 빈 상태의 CTA를 다시 가운데 정렬하거나 제목·설명과 함께 일관된 왼쪽 정렬로 바꾼다.",
          "screenshots": [
            {
              "label": "첫 재심사 / phone",
              "src": "assets/round1-bookmarks-phone.jpg"
            },
            {
              "label": "첫 재심사 / desktop",
              "src": "assets/round1-bookmarks-desktop.jpg"
            }
          ]
        },
        {
          "title": "최소 수정 후 재심사",
          "reviewer": "비주얼 독립 심사",
          "design": 75.0,
          "ratings": [
            3,
            3,
            3,
            3,
            3
          ],
          "note": "빈 상태의 아이콘·제목·설명·CTA가 다시 중앙 기준선으로 일치한다. 정원용 압축 정렬 규칙의 영향 범위를 좁혀 책갈피 목록에서 발생한 정렬 회귀가 해소됐다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 80.0,
          "design": 75.0,
          "note": "받은·건넨 탭과 정직한 빈 상태·오늘 책갈피 CTA를 유지한다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "날짜 빈칸·연속일·열람 수로 압박하지 않는다. 계정 기록과 비로그인 안내를 구분하며 건넨 기록을 수신자 열람으로 표현하지 않는다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "책갈피 플래그",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "인증 조회·비로그인",
        "목록 로딩·실패",
        "받은·건넨 탭",
        "각 탭 비어 있음",
        "책 필터 선택·해제"
      ],
      "productPreserved": "받은·건넨 구분, 날짜 빈칸·열람 수로 압박하지 않음, 실제 개인 기록.",
      "productDecision": "빈 상태 유지"
    },
    {
      "id": "shared-card",
      "path": "/hoondok/c/{id}",
      "title": "받은 책갈피",
      "purpose": "외부에서 받은 말씀의 출처와 앞뒤 맥락을 가입 없이 확인한다.",
      "primaryAction": "원문에서 앞뒤 읽기를 누른다.",
      "before": {
        "ux": 80.0,
        "design": 81.25,
        "uxRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 외부에서 들어온 독자가 말씀과 출처를 읽고 원문 문맥/매일 받기로 이동할 수 있으며 가입없이 읽는 범위를 명시한다.",
          "UX: 원문에서 앞뒤 읽기와 매일 한장 받기의 서로 다른 의도가 primary/secondary로 구분된다.",
          "디자인: 외부 수신자가 구절을 읽고 원문을 열거나 앱의 매일 읽기로 들어가는 두 행동을 구분할 수 있다.",
          "디자인: 가입 없이 볼 수 있다는 안내가 CTA와 가까워 강제 가입으로 오인할 여지를 줄인다."
        ]
      },
      "after": {
        "ux": 80.0,
        "design": 81.25,
        "uxRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          4,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "가입 없이 카드와 원문을 볼 수 있고 원문에서 앞뒤 읽기가 매일 받기보다 강하다.",
          "UX: 외부방문자가말씀→원문문맥/매일받기를고를수있고가입없는열람범위를명시한다.",
          "UX: primary/secondary를유지하며라벨16px로판독성을올렸다.",
          "디자인: 외부 수신자가 읽기→원문 확인→매일 한 장 받기로 이어지는 선택을 분명하게 볼 수 있다.",
          "디자인: 원문의 합성 테스트 문장은 실제 콘텐츠 품질에 대한 감점이나 칭찬에 사용하지 않았다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-shared-card-phone.jpg",
          "after": "assets/after-shared-card-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-shared-card-tablet.jpg",
          "after": "assets/after-shared-card-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-shared-card-desktop.jpg",
          "after": "assets/after-shared-card-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 80.0,
          "design": 81.25,
          "note": "공유 카드가 중심이고 원문에서 앞뒤 읽기가 가장 강한 버튼이며 가입 없이 볼 수 있다는 안내가 있다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 80.0,
          "design": 81.25,
          "note": "가입 없이 카드와 원문을 볼 수 있고 원문에서 앞뒤 읽기가 매일 받기보다 강하다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "로그인 없이 카드와 허용된 원문을 읽는다. 열람 수를 세지 않고 철회·없는 카드는 404로 처리한다. 출처가 포함된 공유 메타데이터를 유지한다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "책갈피 플래그",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "유효한 공개 카드",
        "카드 없음·철회: 404",
        "원문 이동·훈독 홈 진입"
      ],
      "productPreserved": "비로그인 원문 진입, 실제 카드 출처, 열람 추적·가입 강제 없음.",
      "productDecision": "읽기 진입 유지"
    },
    {
      "id": "worship",
      "path": "/hoondok/worship",
      "title": "5분 설교",
      "purpose": "예시 설교와 가정예배 진입 흐름을 미리 살펴본다.",
      "primaryAction": "이번 주 설교를 살펴보거나 순서지로 이동한다.",
      "before": {
        "ux": 58.75,
        "design": 75.0,
        "uxRatings": [
          2,
          3,
          2,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 이번 주 설교/많이 본 설교/설교 요청/순서지의 IA는 읽히나 재생 준비중 이미지가 최상위 시각 비중을 차지한다.",
          "UX: 프리뷰 안내는 있지만 재생/요청을 실제 기능과 비슷한 표현으로 제시해 준비중 범위가 조작전 명확하지 않다.",
          "디자인: 대표 설교·많이 본 설교·설교 요청·가정예배가 시각적 형식을 달리하며 배열된다.",
          "디자인: 실제 미디어 목록을 표현하는 썸네일 행은 정당한 구성이다. 같은 사진 카드의 반복이라는 이유로 마케팅 규칙을 적용하지 않는다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 78.75,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          4
        ],
        "notes": [
          "눈에 띄는 프리뷰 안내와 현재 전송되지 않는다는 요청 설명으로 실제 운영 기능과의 경계가 선명해졌다.",
          "UX: 상단큰프리뷰안내가미지원동작범위를명시하고설교요청설명도실제요청을보내지않는다고바뀌었다.",
          "UX: 메타13.5/등급12로화자·분류·프리뷰범위를판독하기쉬워졌다.",
          "디자인: 프리뷰이며 재생·전송·저장이 준비 중이라는 상단 안내가 실제 동작 범위를 명확하게 전달한다.",
          "디자인: 썸네일 목록·요청·순서지 진입의 기존 구성은 실제 미디어 탐색 패턴으로 보존한다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-worship-phone.jpg",
          "after": "assets/after-worship-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-worship-tablet.jpg",
          "after": "assets/after-worship-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-worship-desktop.jpg",
          "after": "assets/after-worship-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 58.75,
          "design": 75.0,
          "note": "풍경 포스터·설교 목록·교회장 아바타·요청 CTA가 있어 완성된 콘텐츠 서비스처럼 읽히지만 상단은 미리보기, 재생은 준비 중이다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 78.75,
          "note": "눈에 띄는 프리뷰 안내와 현재 전송되지 않는다는 요청 설명으로 실제 운영 기능과의 경계가 선명해졌다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "재생 준비 중과 미리보기 성격을 명확하게 유지한다. 운영 설교·실제 조회수로 꾸미지 않고 게시자·출처·O5 지역 콘텐츠를 구분한다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "프리뷰 전용",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "예시 이번 주·많이 본 설교",
        "재생 준비 중",
        "설교 요청·순서지 진입"
      ],
      "productPreserved": "미리보기·재생 준비·O5 지역 콘텐츠·실제 사람 자리의 이니셜.",
      "productDecision": "준비 상태 선명화"
    },
    {
      "id": "order",
      "path": "/hoondok/worship/order",
      "title": "순서지·챌린지",
      "purpose": "가정예배 순서와 챌린지 예시를 차례대로 살펴본다.",
      "primaryAction": "순서지를 읽고 예시 챌린지 상세를 연다.",
      "before": {
        "ux": 63.75,
        "design": 70.0,
        "uxRatings": [
          3,
          3,
          2,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          2,
          3,
          3
        ],
        "notes": [
          "UX: 6단계 순서지를 번호/행동으로 묶고 챌린지를 별도 섹션에 둔다.",
          "UX: 프리뷰 상단 고지는 있으나 가족에게 보내기·편집은 준비중임을 버튼 가까이서 구분하기 어렵다.",
          "디자인: 순서지·가족 공유·챌린지의 목적은 구분되며 순서지의 단계 번호는 실제 진행 정보를 준다.",
          "디자인: 사진 히어로 뒤 큰 순서 카드 안에 출처·6단계·CTA·보조 안내가 모두 들어가 첫 콘텐츠의 밀도가 높다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 78.75,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          4
        ],
        "notes": [
          "미리보기 배너가 먼저 보이고 출처·여섯 순서의 의미·가족 범위·개인 순위 없음이 유지된다.",
          "UX: 순서지6단계/챌린지를보존하고큰프리뷰안내를내용진입전에제공한다.",
          "UX: 주제목18/본문16/설명13.5로단계내용과보충정보의위계를개선했다.",
          "디자인: 사진 히어로를 120px로 줄여 실제 순서 단계와 원문 출처에 더 빠르게 도달하게 했다.",
          "디자인: 짧아진 사진에서도 균일한 어두운 배경과 밝은 글자로 제목·날짜가 읽히며 원문의 권위 표시는 보존된다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-order-phone.jpg",
          "after": "assets/after-order-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-order-tablet.jpg",
          "after": "assets/after-order-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-order-desktop.jpg",
          "after": "assets/after-order-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 63.75,
          "design": 70.0,
          "note": "사진 아래 여섯 순서가 명확한 세로 목록이고 공유·편집 버튼은 실제 제공처럼 보인다. 아래에 진행률 카드가 이어진다."
        },
        {
          "title": "첫 재심사: 추가 수정 필요",
          "reviewer": "비주얼 독립 심사",
          "design": 73.75,
          "ratings": [
            3,
            3,
            2,
            3,
            4
          ],
          "note": "프리뷰의 동작 한계를 명확히 고지하고 6단계 순서·공식 원문·공유 역할이 구분된다. 큰 사진 히어로 뒤 순서 카드가 이어져 실제 진행 단계에 도달하기 전의 시각적 높이가 여전히 크다. 최소 수정: 이 순서지의 장식 사진 높이를 줄이거나 사진을 덜어 단계 목록을 더 빨리 보여 준다. 순서지의 제목·날짜·출처는 보존한다.",
          "screenshots": [
            {
              "label": "첫 재심사 / phone",
              "src": "assets/round1-order-phone.jpg"
            },
            {
              "label": "첫 재심사 / desktop",
              "src": "assets/round1-order-desktop.jpg"
            }
          ]
        },
        {
          "title": "최소 수정 후 재심사",
          "reviewer": "비주얼 독립 심사",
          "design": 78.75,
          "ratings": [
            3,
            3,
            3,
            3,
            4
          ],
          "note": "사진 히어로를 120px로 줄여 실제 순서 단계와 원문 출처에 더 빠르게 도달하게 했다. 짧아진 사진에서도 균일한 어두운 배경과 밝은 글자로 제목·날짜가 읽히며 원문의 권위 표시는 보존된다. 준비 중 동작을 상단에서 명확히 고지하는 개선을 유지하면서, 순서지보다 사진의 비중이 컸던 밀도 감점이 해소됐다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 78.75,
          "note": "미리보기 배너가 먼저 보이고 출처·여섯 순서의 의미·가족 범위·개인 순위 없음이 유지된다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "순서지는 의미 있는 세로 순서를 유지한다. 출처·공식성 표시를 보존하고 가족 공유·편집은 실제 전송·저장 없이 준비 중을 알린다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "프리뷰 전용",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "예시 순서지·챌린지 목록",
        "공유·편집 준비 중 인라인 안내"
      ],
      "productPreserved": "순서 의미·원문 출처·가족 범위·개인 순위 없음·프리뷰 무전송.",
      "productDecision": "순서 읽기 유지·상태 개선"
    },
    {
      "id": "request",
      "path": "/hoondok/worship/request",
      "title": "설교 섭외",
      "purpose": "설교 섭외 입력 흐름을 미리 확인한다.",
      "primaryAction": "예시 폼을 작성하고 현재 접수 준비 상태를 확인한다.",
      "before": {
        "ux": 63.75,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          2,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 누구/형식/주제/시기/선택메모를 visible label로 순차 배치하며 선택 상태가 명확하다.",
          "UX: 미리보기임에도 실제로 접수되는 것 같은 요청 보내기와 응답 안내가 있어 제출 이전에 기능 범위를 구별할 단서가 멀다.",
          "디자인: 요청 대상·형식·주제·시기·선택 메모가 라벨과 선택 상태로 명확하게 구분된다.",
          "디자인: 폼 데이터는 프리뷰임을 고지하며 과장된 성공 약속이나 시각적 성과 장식이 없다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 78.75,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          4
        ],
        "notes": [
          "폼 전에 프리뷰·전송 준비 상태가 잘 보이고 입력 양식과 공개 범위가 유지된다.",
          "UX: 미리보기안내가폼보다먼저나와전송미지원범위를조작전에읽을수있다.",
          "UX: visible label과선택상태를보존하고보충설명13.5/본문16을사용한다.",
          "디자인: 상단에서 실제 요청·전송이 동작하지 않는 프리뷰라는 점을 명확하게 밝혔다.",
          "디자인: 대상·형식·주제·시기·선택 메모의 폼 구조와 선택 위계는 보존된다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-request-phone.jpg",
          "after": "assets/after-request-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-request-tablet.jpg",
          "after": "assets/after-request-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-request-desktop.jpg",
          "after": "assets/after-request-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 63.75,
          "design": 75.0,
          "note": "폼이 실제 접수 화면처럼 자세하고 상단·설명은 응답 알림을 약속하는 표현이다. 미리보기 표시는 작은 한 줄이다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 78.75,
          "note": "폼 전에 프리뷰·전송 준비 상태가 잘 보이고 입력 양식과 공개 범위가 유지된다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "운영 주체 미정으로 네트워크·저장·접수를 하지 않는다. 제출 후 준비 중·미전송을 알리고 실제 신청 완료처럼 표현하지 않는다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "프리뷰 전용",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "대상·형식·주제·시기·선택 메모 입력",
        "브라우저 필수값 검증",
        "제출 후 접수 준비 중·입력 유지"
      ],
      "productPreserved": "예시·미전송·접수 준비 중, 선택 메모, 개인정보 공개 범위, 입력값 보존.",
      "productDecision": "접수 불가 사전 인지"
    },
    {
      "id": "challenge",
      "path": "/hoondok/worship/challenge/{id}",
      "title": "챌린지",
      "purpose": "예시 챌린지의 목표·기간·함께 읽기 구조를 이해한다.",
      "primaryAction": "예시 내용과 준비 상태를 살펴본다.",
      "before": {
        "ux": 63.75,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          2,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 개인 순위 대신 완료날/남은날/오늘 읽은 가족을 표시하고 미완료자는 감춘다는 안내가 있다.",
          "UX: 프리뷰임에도 완료로 표시하기가 primary라 실제 기록 반영 여부를 조작 전에 명확히 읽기 어렵다.",
          "디자인: 오늘 완료 표시, 기간 진행률, 함께 읽은 사람, 지난 날짜가 정보 목적에 따라 나뉜다.",
          "디자인: 숫자·진행 막대는 실제 진행 상태를 전달하므로 랜딩 페이지의 장식용 점수 막대 금지 규칙을 적용하지 않는다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 78.75,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          4
        ],
        "notes": [
          "프리뷰 고지·완료자만 표시·개인 순위 없음이 유지되고 수치·달력의 의미가 분명하다.",
          "UX: 프리뷰의미지원범위를첫영역에서알리고공동읽기기록의비공개원칙을보존한다.",
          "UX: 메타13.5/본문16/제목18로가족·날짜·통계의판독부담을줄였다.",
          "디자인: 프리뷰 고지로 완료 표시·저장이 실제 서비스 상태로 오인되지 않게 개선했다.",
          "디자인: 기간·오늘 완료·완료한 식구·지난 날짜가 목적에 맞게 구분되고 순위로 사람을 비교하지 않는다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-challenge-phone.jpg",
          "after": "assets/after-challenge-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-challenge-tablet.jpg",
          "after": "assets/after-challenge-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-challenge-desktop.jpg",
          "after": "assets/after-challenge-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 63.75,
          "design": 75.0,
          "note": "큰 진행 수치·완료한 날·남은 날이 먼저 보이고 오늘 완료자·달력이 이어진다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 78.75,
          "note": "프리뷰 고지·완료자만 표시·개인 순위 없음이 유지되고 수치·달력의 의미가 분명하다.",
          "screenshots": []
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "실제 참여·완료 기록을 만들지 않는다. 완료자만 보이는 구조와 순위·독촉 없음 원칙을 유지하며, 없는 fixture는 404다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "프리뷰 전용",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "예시 챌린지 있음·없는 id: 404",
        "준비 중 행동 안내"
      ],
      "productPreserved": "완료자만 표시·읽지 않은 날 비노출·순위 없음·실제 서버 기록을 만들지 않는 프리뷰.",
      "productDecision": "비경쟁·프리뷰 유지"
    },
    {
      "id": "family",
      "path": "/hoondok/family",
      "title": "가족·친구",
      "purpose": "가족·친구 관계와 공개 범위를 미리 살펴본다.",
      "primaryAction": "예시 관계와 공개 범위를 살펴본다.",
      "before": {
        "ux": 63.75,
        "design": 75.0,
        "uxRatings": [
          3,
          3,
          2,
          2,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "notes": [
          "UX: 가족/친구/공개범위를 구분하고 노트와 질문은 항상 비공개임을 표시한다.",
          "UX: 켜지는 토글은 실제 저장되는 설정처럼 보이지만 저장 준비중 안내는 설정 구역 하단에 있다.",
          "디자인: 가족과 친구 목록, 초대 진입, 공개 범위 설정이 분리되어 관계 화면의 목적을 전달한다.",
          "디자인: 이니셜 아바타는 개인정보 보호와 일관성을 위한 선택이므로 가짜 사진으로 바꿀 이유가 없다."
        ]
      },
      "after": {
        "ux": 75.0,
        "design": 78.75,
        "uxRatings": [
          3,
          3,
          3,
          3,
          3
        ],
        "designRatings": [
          3,
          3,
          3,
          3,
          4
        ],
        "notes": [
          "관계·공개 범위가 예시이며 현재 초대·저장이 안 된다는 안내가 행동보다 먼저 보인다.",
          "UX: 상단프리뷰고지와공개범위설명의예시표현으로토글이실제저장기능이라는오인을줄였다.",
          "UX: 공개범위/동의/보호자안내가13.5로커지고설정저장준비중을구역하단에도명시한다.",
          "디자인: 상단 프리뷰 고지와 공개 범위 설명이 실제 저장·관계 연결로 오인할 가능성을 낮춘다.",
          "디자인: 가족·친구·공개 범위가 역할에 따라 구분되고 이니셜 아바타를 유지한다."
        ]
      },
      "evidence": [
        {
          "viewport": "390 × 844",
          "before": "assets/before-family-phone.jpg",
          "after": "assets/after-family-phone.jpg"
        },
        {
          "viewport": "768 × 1024",
          "before": "assets/before-family-tablet.jpg",
          "after": "assets/after-family-tablet.jpg"
        },
        {
          "viewport": "1280 × 900",
          "before": "assets/before-family-desktop.jpg",
          "after": "assets/after-family-desktop.jpg"
        }
      ],
      "iterations": [
        {
          "title": "초회 감사",
          "reviewer": "독립 UX·비주얼 심사",
          "ux": 63.75,
          "design": 75.0,
          "note": "가족·친구 행이 반복되고 공개 범위 토글이 화면 아래에 있다. 저장 준비 중 안내는 토글 뒤에 나온다."
        },
        {
          "title": "개선 후 독립 재평가",
          "reviewer": "UX·비주얼 심사 담당",
          "ux": 75.0,
          "design": 78.75,
          "note": "관계·공개 범위가 예시이며 현재 초대·저장이 안 된다는 안내가 행동보다 먼저 보인다.",
          "screenshots": []
        },
        {
          "title": "키보드 초점 가림 재현 → 수정",
          "note": "하단 탭이 초점을 받은 컨트롤을 덮는 것을 실측했습니다. scroll-margin으로 초점 스크롤 여유를 확보하고 실제 크기·중앙 hit-test·키보드 조작을 확인했습니다."
        }
      ],
      "checks": {
        "실제 화면·세 가지 폭": {
          "status": "pass",
          "note": "390 / 768 / 1280px에서 HTTP 200, 가로 넘침 0, pageerror 0."
        },
        "제품 목적·권리 구별": {
          "status": "pass",
          "note": "미리보기이며 연결·초대·공개 범위 저장은 준비 중임을 표시한다. 네트워크·저장이 없고 노트·질문은 항상 비공개다. 이니셜 아바타를 실제 인물 사진으로 바꾸지 않는다."
        },
        "독립 점수 기준": {
          "status": "pass",
          "note": "UI/UX와 디자인을 각각 75점 이상으로 평가. 화면 상태의 증거에 한정한 AI 전문가 역할 심사입니다."
        },
        "기능·접근성 최종 게이트": {
          "status": "pass",
          "note": "회귀 E2E, 확대·키보드 재현 테스트, axe와 부분 가림 수동 검증. 실제 iPhone·스크린리더 인증은 포함하지 않습니다."
        }
      },
      "availability": "프리뷰 전용",
      "stateCoverage": [
        "플래그 꺼짐: 404",
        "예시 가족·친구 목록",
        "공개 범위 선택 변경",
        "저장·초대·친구 추가 준비 중"
      ],
      "productPreserved": "양쪽 동의·언제든 끊기·질문/노트 비공개·준비 중·이니셜.",
      "productDecision": "공개·준비 상태 선명화"
    }
  ],
  "validation": [
    {
      "label": "저장소 CI",
      "status": "pass",
      "detail": "make ci 통과: API 1,519 passed·7 skipped·1 xfailed, web 770·admin 239·SDK 13 테스트, 계약·문서·경계·CSS·lint·빌드·타입 검사. 최종 글꼴 정책의 프로덕션 빌드와 CSS 검사도 통과했습니다."
    },
    {
      "label": "통합 E2E",
      "status": "pass",
      "detail": "make e2e: 127/127 passed (2.3분), exit 0. 기본 브라우저 fixture를 테스트별 문서용 IPv6로 분리한 뒤 기존 실패한 이어 읽기도 통과했습니다. 해당 실행의 API 429·500·503은 0건이며 운영 제한은 변경하지 않았습니다."
    },
    {
      "label": "31개 화면 × 세 가지 폭",
      "status": "pass",
      "detail": "원본·변경본 각각 93장. 390/768/1280px에서 HTTP 200, 가로 넘침 0, pageerror 0. 같은 viewport의 전후 상태를 맞췄습니다."
    },
    {
      "label": "확대·키보드 회귀",
      "status": "pass",
      "detail": "200% 관심사 버튼 가림, 교회장 가로 목록 키보드 탐색, 폼 초점의 하단 탭 가림을 실제 조작으로 검증했습니다. 부분 노출 3곳은 초점 후 크기·중앙 hit-test 통과."
    },
    {
      "label": "접근성 자동 검사와 한계",
      "status": "pass",
      "detail": "axe-core 4.14.0으로 31개 화면 검사. 검출된 대비 위반은 0건. 가로 목록 초점 결함을 수정했고 부분 노출 3건은 실제 초점·스크롤로 확인했습니다. 도구의 판정 불가 항목은 원자료에 보존하며 WCAG 인증을 주장하지 않습니다."
    },
    {
      "label": "실제 카드 공유·기기 전용 메모",
      "status": "pass",
      "detail": "PREVIEW=0 프로덕션 빌드: 공유 이미지 image/png HTTP 200, 개인 메모를 담은 요청 0, 공유 URL에 메모 없음, 메모 기기 저장, Esc 뒤 초점 복귀. 외부 앱으로 실제 전송하지 않았습니다."
    },
    {
      "label": "모바일 저속망 성능 측정",
      "status": "na",
      "detail": "Lighthouse 13.5.0 실제 DevTools slow4G: 홈/훈독하기/시작 성능 97/98/95, 접근성 모두 100, LCP 2.00/1.99/2.34초. 기본 simulate는 세 페이지 모두 성능 55, LCP 13.36~13.51초입니다. 두 방법을 전후 개선율로 비교하지 않으며 실사용자 CWV/INP는 측정하지 않았습니다."
    },
    {
      "label": "검토 HTML",
      "status": "pass",
      "detail": "375/1280px 넘침 0, 31개 화면·3개 대안, 검색·상태 필터·이미지 확대·Esc 초점 복귀 확인. 외부 스크립트/이미지 요청 없이 폴더 단위로 열 수 있습니다."
    }
  ]
};
