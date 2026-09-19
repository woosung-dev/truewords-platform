# 훈독 프로토타입 (단일 소스)

`app.html` 한 벌 + `hoondok.css` 한 장이 폰(390)과 PC(1280)를 모두 그린다. 값과 규칙의 원본은 이 두 파일이고, 근거는 [`docs/specs/web/hoondok-design-system.md`](../../../specs/web/hoondok-design-system.md)에 있다.

```
cd docs/prd/prototypes/hoondok-ds && python3 -m http.server 8765
open http://localhost:8765/            # index.html: 16화면을 폰·PC 나란히
open http://localhost:8765/app.html?screen=ask
```

| 쿼리 | 값 |
|---|---|
| `screen` | today · read · words · library · search · onboarding · ask · ask-log · ask-detail · worship · challenge · sermons · sermon-request · garden · settings · family |
| `sheet` | jeongseong (정성 기간 시트, 홈 위에 열림) |
| `nav` | top(기본, 1024px 이상 상단 헤더 4) · rail(좌측 레일, §4.1 대조용) |
| `serif` | 1 이면 말씀 원문만 세리프 |

모든 말씀·인물·교회·수치는 예시다. 검색·질문 입력은 마크업만 있고 동작하지 않는다.
