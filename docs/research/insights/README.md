# Insights — 외부 코드베이스 분석 및 패턴 참고

> 다른 프로젝트에서 발견한 우수 패턴, 반면교사, 적용 가능한 인사이트를 정리합니다.
> 이 문서는 과거 외부 코드 조사이다. 적용 여부는 현재 코드와 테스트로 판단한다.

---

## 문서 목록

| # | 문서 | 소스 프로젝트 | 핵심 인사이트 |
|:-:|------|-------------|-------------|
| 1 | [Recovery Doctor 분석](01-recovery-doctor-analysis.md) | recovery-doctor (뇌졸중 AI 챗봇) | 적응형 임계값, Kiwi 형태소 분석, Temperature 분리, 질문 분류 파이프라인 |
| 2 | [Nexus Core 분석](02-nexus-core-analysis.md) | nexus-core (멀티 페르소나 챗봇) | 통합 예외 계층, ABC+Factory, JWKS 인증, SSE 프로토콜, Docstring 체계 |

---

## 활용 방법

### 1. 당시 적용 후보

아래 패턴은 당시 검토한 후보이며, 현재 채택 여부를 뜻하지 않습니다:

- **통합 예외 계층** (Nexus Core) → `src/common/exceptions.py` 신규 생성
- **ErrorResponse 통합 스키마** (Nexus Core) → API 응답 일관성
- **Temperature 분리** (Recovery Doctor) → RAG=0.3, 일반대화=0.7
- **적응형 임계값** (Recovery Doctor) → 키워드 매칭 유무에 따른 동적 threshold
- **Docstring 체계** (Nexus Core) → 모듈-레벨 + Args/Returns/Raises

### 2. 중기 검토 패턴

- **ABC + Factory** (Nexus Core) → LLM 프로바이더 추상화
- **SSE 메타데이터 프로토콜** (Nexus Core) → 스트리밍 UX 개선
- **Kiwi 형태소 분석기** (Recovery Doctor) → BM25 대체/보완

### 3. 반면교사 (하지 말 것)

- 7,269줄 단일 파일 (Recovery Doctor)
- CORS allow_origins=["*"] (Recovery Doctor)
- 테스트 없음 (Nexus Core)
- Admin 권한 검증 누락 (Nexus Core)
- Rate Limiting 없음 (Nexus Core)
