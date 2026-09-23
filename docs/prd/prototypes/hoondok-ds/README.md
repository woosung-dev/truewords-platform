# 훈독 프로토타입 (단일 소스)

`app.html` 한 벌 + `hoondok.css` 한 장이 폰(390)과 PC(1280)를 모두 그린다. 값과 규칙의 원본은 이 두 파일이고, 근거는 [`docs/specs/web/hoondok-design-system.md`](../../../specs/web/hoondok-design-system.md)에 있다.

```
cd docs/prd/prototypes/hoondok-ds && python3 -m http.server 8765
open http://localhost:8765/            # index.html: 20화면을 폰·PC 나란히
open http://localhost:8765/app.html?screen=ask
```

| 쿼리 | 값 |
|---|---|
| `screen` | today · read · words · library · search · onboarding · ask · ask-log · ask-detail · worship · challenge · sermons · sermon-request · garden · settings · family · group · group-join · group-create · group-share |
| `together` | default(모임 있음, 기본) · small(익명 숫자가 기준 미만) · none(모임 없음). 홈 "함께 읽는 사람들"과 훈독하기 완료 뒤 한 줄에 적용 (`DEC-PWA-023`) |
| `done` | 1 이면 훈독하기(`read`) 완료 뒤 상태 |
| `via` | link 이면 모임 참여(`group-join`)가 카카오톡 링크로 들어온 상태 |
| `created` | 1 이면 모임 만들기(`group-create`) 뒤 초대 코드가 열린 상태 |
| `sheet` | jeongseong (정성 기간 시트, 홈 위에 열림) |
| `nav` | top(기본, 1024px 이상 상단 헤더 4) · rail(좌측 레일, §4.1 대조용) |
| `serif` | 1 이면 말씀 원문만 세리프 |

모든 말씀·인물·교회·수치는 예시다. 검색·질문 입력은 마크업만 있고 동작하지 않는다.
