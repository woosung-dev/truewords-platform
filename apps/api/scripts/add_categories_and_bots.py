"""카테고리 5개(P/Q/R/S/T) 추가 + Qdrant 재태깅 + 챗봇 5종 추가 (일회성).

순서:
 1) Neon  data_source_categories  INSERT  (P,Q,R,S,T)
 2) Qdrant 재태깅 (기존 볼륨에 새 source 태그 append)
      - P: 하늘 섭리로 본 참부모님의 위상과 가치 / 한민족 선민 대서사시
      - R: 최근(2024~) 참어머님 현장 말씀 파일들
      - T: 이벤트/헌당식/대회 현장 말씀 파일들
      - Q: 업로드 필요 — 정의만
      - S: 태깅 작업량이 커서 2차로 뺌 — 정의만
 3) Neon  chatbot_configs  INSERT  (5개 봇, weighted 모드)

사용:
  uv run python scripts/add_categories_and_bots.py
"""
import asyncio
import json
import os
import re
import uuid
from datetime import datetime
from pathlib import Path

import asyncpg
from qdrant_client import AsyncQdrantClient, models
from qdrant_client.models import FieldCondition, Filter, MatchAny

BACKEND = Path(__file__).resolve().parent.parent


# ----------------------------- 공용 시스템 프롬프트 -----------------------------
BASE_PROMPT = (BACKEND / ".." / "tmp_base_prompt.txt")  # placeholder — 아래서 로드


def load_base_prompt() -> str:
    return (Path("/tmp") / "base_prompt.txt").read_text(encoding="utf-8")


# 봇별 특화 섹션 (기본 프롬프트 뒤에 append)
SPECIALIZATION = {
    "theology_parents": """

  [이 챗봇의 특화 영역 — 참부모론 전문]
  - 참부모님의 위상, 가치, 역사적 섭리적 의미에 특화됨.
  - '참부모론', '한민족 선민 대서사시', '하늘 섭리로 본 참부모님의 위상과 가치' 등 총론 자료를 우선 참조.
  - 3대 경전(천성경·평화경·평화를 사랑하는 세계인으로)과 원리강론을 교차 참고해 근거를 강화.
  - 생애 일화보다 신학적 정립, 위상 선포, 섭리사적 의미에 집중해 답변.
""",
    "unification_thought": """

  [이 챗봇의 특화 영역 — 통일사상 전문]
  - 통일사상요강을 중심으로 철학·형이상학적 질문에 답변.
  - 원리강론과 구분: 원리는 '기본 교리', 통일사상은 '철학적 체계화'.
  - 존재론, 인식론, 가치론, 역사관, 윤리, 교육, 예술, 사회, 경제 등 영역을 다룸.
  - 답변에 '통일사상요강 제○장' 식으로 장(章) 출처를 명시.
  - 근거 자료가 부족하면 [답변 불가 시 표준 응답]으로 안내.
""",
    "latest_mother_words": """

  [이 챗봇의 특화 영역 — 최근 참어머님 말씀]
  - 2024년 이후 참어머님 현장 말씀(천원궁 입궁식, CIG 컨퍼런스, 천심원 철야 등)을 우선 참조.
  - "요즘", "최근", "올해", "지금 어머님께서는" 같은 시간 감응 질문에 답변 우선권.
  - 최신 표현/선포를 그대로 인용하되, 배경 설명은 과거 정선집도 함께 참고.
  - 답변에 발표 일자/장소(예: "2025년 4월 13일 천원궁 천일성전 입궁식")를 함께 명시.
""",
    "blessing_rituals": """

  [이 챗봇의 특화 영역 — 축복·가정 의례 도우미]
  - 축복식, 성별 기간, 성물(성염/성건), 은사 복귀, 혼인신고 등 행정·의례 질문에 특화.
  - 답변 시 규정과 원전 출처를 **둘 다** 제시. 예: "3일 금식이 원칙이며 9일 조식 금식으로 대체 가능합니다. (참고: 축복 규정 / 말씀선집 ○권)"
  - 개인 상황이 다를 수 있으므로 반드시 [3단계 상담 안내] 포함.
  - 규정 해석이 불명확하면 단정 금지 → "담당 부서 또는 목회자 상담"으로 유도.
""",
    "events_live_words": """

  [이 챗봇의 특화 영역 — 이벤트·현장 행사 말씀]
  - 특정 행사(헌당식, 대회, 기념식, 축승회, 옥중 전후 등)에서 참부모님/참어머님이 하신 말씀을 모아 답변.
  - 사용자가 "○○ 대회에서 뭐라고 하셨나요?"처럼 이벤트를 특정하면 해당 자료를 우선 인용.
  - 연도/장소/행사명을 답변 서두에 명시해 맥락 제공.
  - 일반 교리 질문엔 적합하지 않으므로, 주제가 벗어나면 "전체 검색 봇" 사용을 권유.
""",
}


# ----------------------------- 카테고리 정의 5종 -----------------------------
NEW_CATEGORIES = [
    {
        "key": "P",
        "name": "참부모론 총론",
        "description": "참부모 위상·가치·섭리사 총론 (하늘 섭리로 본 참부모님의 위상과 가치 + 한민족 선민 대서사시)",
        "color": "#8B5CF6",  # violet
    },
    {
        "key": "Q",
        "name": "통일사상요강",
        "description": "통일사상요강 — 철학·형이상학 체계서 (업로드 필요)",
        "color": "#0EA5E9",  # sky
    },
    {
        "key": "R",
        "name": "최근 현장 말씀 (2024~)",
        "description": "2024년 이후 참어머님의 천원궁 입궁식·CIG 컨퍼런스·천심원 철야 등 최신 현장 말씀",
        "color": "#10B981",  # emerald
    },
    {
        "key": "S",
        "name": "축복·가정 의례",
        "description": "축복식·성별 기간·성물·은사 복귀·혼인신고 등 행정·의례 질문 전용 (2차 태깅 예정)",
        "color": "#F59E0B",  # amber
    },
    {
        "key": "T",
        "name": "이벤트·현장 행사 말씀",
        "description": "헌당식·대회·기념식·축승회 등 특정 이벤트에서 참부모님·참어머님이 선포하신 말씀",
        "color": "#EF4444",  # red
    },
]


# ----------------------------- Qdrant 재태깅 대상 -----------------------------
# P 태그 추가 대상 (기존 source 유지 + 'P' append)
P_VOLUMES = [
    "하늘 섭리로 본 참부모님의 위상과 가치-본문(한국어)_v0217-2.pdf",
    "한민족 선민 대서사시_본문(한국어).txt",
]

# R 태그 추가 대상 (기존 B 유지 + 'R' append) — 2024 이후 최근 자료
R_VOLUMES = [
    "2024년 참어머님 말씀 모음.txt",
    "20241122 CIG 전도 컨퍼런스 천지인참부모님 특별알현 참어머님 말씀(천정궁 채풀실).txt",
    "20250413 천원궁 천일성전 입궁식 노트(13페이지 참어머님 말씀선포) (1).txt",
    "20250413 천원궁 천일성전 입궁식 노트(13페이지 참어머님 말씀선포).txt",
    "251103_최근 천심원 철야 중 공유된 참어머님 말씀.txt",
    "2025 참어머님 말씀 주요 메시지 정리_v1.docx",
    "2025 참어머님 말씀 주요 메시지 정리_v1.pdf",
    "2025 참어머님 말씀 주요 메시지 정리_v2.pdf",
    "0.천원궁 관련 참어머님 말씀 (1).docx",
    "0.천원궁 관련 참어머님 말씀 (2).docx",
    "CIG 효정 전도 아카데미 강의와 참어머님 말씀 ver2.txt",
]

# T 태그 추가 대상 (기존 source 유지 + 'T' append) — 이벤트/현장 행사
T_VOLUMES = [
    "20170521 부산교구 부산가정교회 헌당식 참부모님말씀 딕테이션(피스티비).txt",
    "2018 신한국가정연합 영남권 희망전진결의대회 참부모님 말씀.txt",
    "20180527 2018 신한국가정연합 영남권 희망전진결의대회 축승회 참어머님 말씀 딕테이션.txt",
    "20181004 조국광복 신통일한국을 위한 지도자 특별집회 말씀교정교열.txt",
    "20181031 원로목회자회 특별수련 폐회식 말씀교정교열.txt",
    "천주성화 5주년 기념행사(참부모님 말씀자료).txt",
    "20180525 참어머님 말씀(2018년)-수정.txt",
    "20180920 참어머님 말씀(2018년).txt",
    "161130_참어머님 말씀(미국대회).txt",
    "161201_축승회(참어머님 말씀).txt",
    "11월 2일 참어머님 말씀.txt",
    "참어머님 말씀(국민연합 30주년 기념식).txt",
    "참어머님 말씀 모음 (옥중 전후).docx",
]


# ----------------------------- 챗봇 5종 정의 -----------------------------
def make_chatbot_config(base_prompt: str) -> list[dict]:
    """5개 챗봇 설정 생성 — weighted 모드 기반."""
    common = {
        "dictionary_enabled": False,
        "query_rewrite_enabled": True,
    }

    def weighted(items: list[tuple[str, float]], fallback_sources: list[str]) -> dict:
        """items = [(source, weight), ...]  — weight 큰 쪽이 우선도 높음"""
        return {
            "search_mode": "weighted",
            "tiers": [
                {"sources": [s for s, _ in items], "min_results": 10, "score_threshold": 0.10},
                {"sources": fallback_sources, "min_results": 10, "score_threshold": 0.05},
            ],
            "weighted_sources": [
                {"source": s, "weight": w, "score_threshold": 0.10} for s, w in items
            ],
            **common,
        }

    return [
        # 1) 참부모론 전문 봇
        {
            "chatbot_id": "theology_parents",
            "display_name": "참부모론 전문 봇",
            "description": "참부모 위상·가치·섭리사 총론. 3대 경전 + 원리강론 교차 참고.",
            "persona_name": "참부모신학 강의 전담 공직자",
            "system_prompt": base_prompt + SPECIALIZATION["theology_parents"],
            "search_tiers": weighted(
                [("P", 2.5), ("M", 1.8), ("L", 1.5), ("N", 1.2), ("O", 0.6), ("B", 0.6)],
                fallback_sources=["O", "B"],
            ),
        },
        # 2) 통일사상 전문 봇
        {
            "chatbot_id": "unification_thought",
            "display_name": "통일사상 전문 봇",
            "description": "통일사상요강 중심 철학·형이상학 답변. 원리강론 보조 참조.",
            "persona_name": "통일사상 연구 공직자",
            "system_prompt": base_prompt + SPECIALIZATION["unification_thought"],
            "search_tiers": weighted(
                [("Q", 2.5), ("L", 1.8), ("M", 1.0), ("P", 0.8), ("N", 0.5), ("O", 0.3), ("B", 0.3)],
                fallback_sources=["M", "O"],
            ),
        },
        # 3) 최근 어머님 말씀 봇
        {
            "chatbot_id": "latest_mother_words",
            "display_name": "최근 어머님 말씀 봇",
            "description": "2024년 이후 참어머님 현장 말씀을 우선 답변. 과거 말씀은 보조 자료.",
            "persona_name": "천원궁 시대 참어머님 말씀 안내 공직자",
            "system_prompt": base_prompt + SPECIALIZATION["latest_mother_words"],
            "search_tiers": weighted(
                [("R", 2.5), ("B", 1.5), ("O", 0.6), ("M", 0.4), ("N", 0.4), ("P", 0.4)],
                fallback_sources=["B", "O"],
            ),
        },
        # 4) 축복·의례 도우미 봇
        {
            "chatbot_id": "blessing_rituals",
            "display_name": "축복·의례 도우미 봇",
            "description": "축복식·성별 기간·성물·은사 복귀·혼인신고 등 행정·의례 질문 전용.",
            "persona_name": "가정부 행정·의례 안내 공직자",
            "system_prompt": base_prompt + SPECIALIZATION["blessing_rituals"],
            "search_tiers": weighted(
                # S 카테고리는 태깅 2차, 지금은 축복 관련이 많이 들어간 O/B/M 을 묶어 대응
                [("S", 2.5), ("O", 1.5), ("B", 1.3), ("M", 1.0), ("N", 0.5), ("L", 0.5)],
                fallback_sources=["O", "B", "M"],
            ),
        },
        # 5) 이벤트·현장 행사 봇
        {
            "chatbot_id": "events_live_words",
            "display_name": "이벤트·현장 행사 봇",
            "description": "헌당식·대회·기념식 등 특정 행사에서 선포된 말씀에 특화.",
            "persona_name": "행사·이벤트 말씀 안내 공직자",
            "system_prompt": base_prompt + SPECIALIZATION["events_live_words"],
            "search_tiers": weighted(
                [("T", 2.5), ("R", 1.2), ("B", 1.0), ("O", 0.8), ("M", 0.4), ("N", 0.4)],
                fallback_sources=["B", "O"],
            ),
        },
    ]


# ----------------------------- 메인 로직 -----------------------------
async def add_categories(conn: asyncpg.Connection) -> None:
    print("\n[1/3] 카테고리 5개 INSERT")
    for cat in NEW_CATEGORIES:
        # 이미 존재하면 skip
        exists = await conn.fetchval(
            "SELECT 1 FROM data_source_categories WHERE key=$1", cat["key"]
        )
        if exists:
            print(f"  ⤷ [{cat['key']}] 이미 존재 — 설명/이름 업데이트만 수행")
            await conn.execute(
                """UPDATE data_source_categories
                   SET name=$2, description=$3, color=$4, is_active=true, updated_at=now()
                   WHERE key=$1""",
                cat["key"], cat["name"], cat["description"], cat["color"],
            )
            continue
        await conn.execute(
            """INSERT INTO data_source_categories (id, key, name, description, color, is_active, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, true, now(), now())""",
            uuid.uuid4(), cat["key"], cat["name"], cat["description"], cat["color"],
        )
        print(f"  ✅ [{cat['key']}] {cat['name']}")


async def retag_qdrant(cloud: AsyncQdrantClient, volumes: list[str], new_tag: str) -> int:
    """기존 source 배열에 new_tag 을 append. 이미 있으면 skip."""
    # 관련 포인트를 모두 scroll 해서 source 배열을 새로 set
    total_updated = 0
    for vol in volumes:
        offset = None
        groups: dict[frozenset, list] = {}
        while True:
            points, offset = await cloud.scroll(
                collection_name="malssum_poc",
                scroll_filter=Filter(
                    must=[FieldCondition(key="volume",
                                         match=models.MatchValue(value=vol))]
                ),
                with_payload=["source"],
                with_vectors=False,
                limit=1000,
                offset=offset,
            )
            for p in points:
                src = (p.payload or {}).get("source") or []
                if isinstance(src, str):
                    src = [src] if src else []
                if new_tag in src:
                    continue
                key = frozenset(src)
                groups.setdefault(key, []).append(p.id)
            if offset is None:
                break

        updated = 0
        for existing_sources, pids in groups.items():
            new_sources = sorted(existing_sources | {new_tag})
            await cloud.set_payload(
                collection_name="malssum_poc",
                payload={"source": new_sources},
                points=pids,
            )
            updated += len(pids)
        total_updated += updated
        if updated:
            print(f"  ✅ [{new_tag}] +{updated:>5} chunks  ← {vol[:60]}")
        else:
            print(f"  ⤷ [{new_tag}]  skip (0 or 이미태그됨) — {vol[:60]}")
    return total_updated


async def add_chatbots(conn: asyncpg.Connection, base_prompt: str) -> None:
    print("\n[3/3] 챗봇 5개 INSERT")
    configs = make_chatbot_config(base_prompt)
    for cfg in configs:
        # 이미 존재하는 chatbot_id 인지 확인
        exists = await conn.fetchval(
            "SELECT id FROM chatbot_configs WHERE chatbot_id=$1", cfg["chatbot_id"]
        )
        if exists:
            await conn.execute(
                """UPDATE chatbot_configs
                   SET display_name=$2, description=$3, persona_name=$4,
                       system_prompt=$5, search_tiers=$6, is_active=true, updated_at=now()
                   WHERE chatbot_id=$1""",
                cfg["chatbot_id"], cfg["display_name"], cfg["description"],
                cfg["persona_name"], cfg["system_prompt"], json.dumps(cfg["search_tiers"]),
            )
            print(f"  ⤷ [{cfg['chatbot_id']}] 이미 존재 — 업데이트만")
            continue
        await conn.execute(
            """INSERT INTO chatbot_configs
               (id, chatbot_id, display_name, description, persona_name, system_prompt,
                search_tiers, is_active, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, true, now(), now())""",
            uuid.uuid4(), cfg["chatbot_id"], cfg["display_name"], cfg["description"],
            cfg["persona_name"], cfg["system_prompt"], json.dumps(cfg["search_tiers"]),
        )
        print(f"  ✅ [{cfg['chatbot_id']}] {cfg['display_name']}")


async def main():
    for line in open(BACKEND / ".env"):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k, v)

    base_prompt = load_base_prompt()
    print(f"기본 시스템 프롬프트 로드: {len(base_prompt)} chars")

    neon_url = os.environ["NEON_DATABASE_URL"]
    qcloud_url = os.environ["QCLOUD_URL"]
    qcloud_key = os.environ["QCLOUD_API_KEY"]

    conn = await asyncpg.connect(neon_url)
    cloud = AsyncQdrantClient(url=qcloud_url, api_key=qcloud_key)

    try:
        # 1) 카테고리
        await add_categories(conn)

        # 2) Qdrant 재태깅 (P, R, T) — Q/S 는 데이터 없음, 정의만
        print("\n[2/3] Qdrant 재태깅 (P/R/T)")
        p_n = await retag_qdrant(cloud, P_VOLUMES, "P")
        r_n = await retag_qdrant(cloud, R_VOLUMES, "R")
        t_n = await retag_qdrant(cloud, T_VOLUMES, "T")
        print(f"  총 태그 추가: P={p_n}, R={r_n}, T={t_n}")

        # 3) 챗봇
        await add_chatbots(conn, base_prompt)

        # 검증
        print("\n[검증]")
        cats = await conn.fetch(
            "SELECT key, name, is_active FROM data_source_categories WHERE is_active=true ORDER BY key"
        )
        print(f"  활성 카테고리 {len(cats)}개: {[c['key'] for c in cats]}")
        bots = await conn.fetch(
            "SELECT chatbot_id, display_name FROM chatbot_configs WHERE is_active=true ORDER BY chatbot_id"
        )
        print(f"  활성 챗봇 {len(bots)}개:")
        for b in bots:
            print(f"    - [{b['chatbot_id']}] {b['display_name']}")

    finally:
        await conn.close()
        await cloud.close()

    print("\n🎉 완료")


if __name__ == "__main__":
    asyncio.run(main())
