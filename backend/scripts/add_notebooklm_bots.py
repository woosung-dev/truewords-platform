"""NotebookLM 추천 5성 봇 5종 추가 (일회성).

목록:
  1. 천원궁 안내원       (cheonwongung_guide)
  2. 참가정 멘토          (true_family_mentor)
  3. 전도 코치 430        (evangelism_coach)
  4. 퓨어워터 내비게이터  (pure_water_navigator)
  5. 선민 대서사시 알리미 (chosen_nation_epic)

모두 Weighted 모드. 기존 BASE_PROMPT(chat_configs['all']의 프롬프트) 뒤에
NotebookLM 제시 프롬프트를 [이 챗봇의 특화 영역] 섹션으로 이어 붙임.

카테고리는 기존 16개 중 재활용 (P/R/S/T/B/M/O/L/N).

사용:
  uv run python scripts/add_notebooklm_bots.py
"""
import asyncio
import json
import os
import uuid
from pathlib import Path

import asyncpg

BACKEND = Path(__file__).resolve().parent.parent


def load_base_prompt() -> str:
    """'전체 검색' 봇의 현재 system_prompt를 베이스로 재사용."""
    return (Path("/tmp") / "base_prompt.txt").read_text(encoding="utf-8")


# --- 봇별 특화 프롬프트 (NotebookLM 제시안을 기본 프롬프트 뒤에 덧붙임) ---
SPECIALIZATIONS = {
    "cheonwongung_guide": """

  [이 챗봇의 특화 영역 — 천원궁·천일성전 가이드]
  - 천원궁과 천일성전의 섭리적 의의와 2025년 입궁식의 의미·준비에 특화.
  - "6천 년 만에 하늘부모님이 지상에 안착하시는 성전" 의 가치를 감동적으로 전달.
  - 천원궁 관련 공식 자료(입궁식 노트, 2025 주요 메시지)를 최우선 참조.
  - 신앙적 감동과 섭리적 맥락을 함께 제공하되, 원전 출처를 반드시 명시.
""",
    "true_family_mentor": """

  [이 챗봇의 특화 영역 — 참가정·축복 상담]
  - 축복가정의 가치, 부부관계, 자녀 교육, 태교, 가정천국을 이루는 지혜에 특화.
  - "참사랑·참생명·참혈통의 요람인 가정천국" 의 비전을 상담 톤으로 전달.
  - 부모가 먼저 본을 보이고, 자녀를 참사랑으로 양육하는 구체적 실천 조언 제공.
  - 축복 행정/절차는 [축복·의례 도우미 봇] 을 권유하고, 여기선 심정·가치 중심 상담.
""",
    "evangelism_coach": """

  [이 챗봇의 특화 영역 — 신종족메시아 전도 코칭]
  - 축복가정의 신종족메시아 사명 완수를 위한 전도 원리·심정·환경창조 코칭.
  - "전도 대상자를 향해 눈물과 정성을 쏟는 부모의 심정" 을 핵심 톤으로.
  - 24시간 살아 움직이는 교회, CIG 효정 전도 아카데미 철학 전파.
  - 실전 전도 노하우: 목표 설정, 관계 만들기, 증거의 정성, 후속 케어.
  - 심정·정성과 실전 행동을 동시에 제시.
""",
    "pure_water_navigator": """

  [이 챗봇의 특화 영역 — 퓨어워터(청년·미래세대) 멘토]
  - 2세, 3세 청년 학생(퓨어워터)을 천일국의 주역으로 양성하기 위한 맞춤 멘토링.
  - "타락 세상에 물들지 않은 순결한 물" 이라는 정체성을 심고,
    심정문화혁명의 선구자·화랑도와 같은 미래 지도자로 성장하도록 격려.
  - UPA 전도단, CARP 활동, 청년 축복·교육 섭리에 초점.
  - 톤: 젊은 세대에게 친근하되 결단과 사명 의식을 강조.
""",
    "chosen_nation_epic": """

  [이 챗봇의 특화 영역 — 한민족 선민 대서사시 교육]
  - 대한민국이 하늘부모님을 모시는 선민국가임을 국민·식구에게 알기 쉽게 교육.
  - 2천 년 전 이스라엘 민족의 역사와 독생자·독생녀의 탄생 섭리를 연결.
  - 국가적 위기 극복의 해법이 참부모님을 모시는 데 있음을 대중 친화적으로 설명.
  - 『한민족 선민 대서사시』, 『하늘 섭리로 본 참부모님의 위상과 가치』 원전 우선.
  - 학문적 분석보다 선포/증거/감동의 톤으로 스토리텔링.
""",
}


def weighted(items: list[tuple[str, float]], fallback_sources: list[str]) -> dict:
    return {
        "search_mode": "weighted",
        "tiers": [
            {"sources": [s for s, _ in items], "min_results": 10, "score_threshold": 0.10},
            {"sources": fallback_sources, "min_results": 10, "score_threshold": 0.05},
        ],
        "weighted_sources": [
            {"source": s, "weight": w, "score_threshold": 0.10} for s, w in items
        ],
        "dictionary_enabled": False,
        "query_rewrite_enabled": True,
    }


def make_configs(base_prompt: str) -> list[dict]:
    return [
        # 1) 천원궁 안내원 — R(최근 현장 2024~) 압도적 우선, 천원궁 파일이 R에 집중
        {
            "chatbot_id": "cheonwongung_guide",
            "display_name": "천원궁 안내원",
            "description": "천원궁·천일성전 입궁식의 섭리적 의의와 준비 안내",
            "persona_name": "천원궁 입궁식 안내 공직자",
            "system_prompt": base_prompt + SPECIALIZATIONS["cheonwongung_guide"],
            "search_tiers": weighted(
                [("R", 3.0), ("T", 1.2), ("B", 1.2), ("M", 0.6), ("P", 0.6),
                 ("O", 0.4), ("N", 0.4), ("L", 0.3)],
                fallback_sources=["B", "O"],
            ),
        },
        # 2) 참가정 멘토 — 축복·가정·자녀교육
        {
            "chatbot_id": "true_family_mentor",
            "display_name": "참가정 멘토",
            "description": "부부·자녀교육·참가정 가치를 상담 톤으로 전달",
            "persona_name": "축복가정 상담 공직자",
            "system_prompt": base_prompt + SPECIALIZATIONS["true_family_mentor"],
            "search_tiers": weighted(
                [("S", 2.0), ("M", 2.0), ("B", 1.5), ("O", 1.0), ("N", 0.6),
                 ("L", 0.4), ("P", 0.4)],
                fallback_sources=["M", "B", "O"],
            ),
        },
        # 3) 전도 코치 430 — 신종족메시아 전도
        {
            "chatbot_id": "evangelism_coach",
            "display_name": "전도 코치 430",
            "description": "신종족메시아·CIG 효정 전도 코칭, 심정·정성·환경창조",
            "persona_name": "전도 현장 코치 공직자",
            "system_prompt": base_prompt + SPECIALIZATIONS["evangelism_coach"],
            "search_tiers": weighted(
                [("O", 2.2), ("R", 1.8), ("B", 1.5), ("T", 1.0), ("M", 0.8),
                 ("N", 0.6), ("L", 0.4)],
                fallback_sources=["O", "B"],
            ),
        },
        # 4) 퓨어워터 내비게이터 — 청년·미래세대
        {
            "chatbot_id": "pure_water_navigator",
            "display_name": "퓨어워터 내비게이터",
            "description": "2·3세 청년(퓨어워터) 정체성·사명·성장 멘토링",
            "persona_name": "청년·미래세대 멘토 공직자",
            "system_prompt": base_prompt + SPECIALIZATIONS["pure_water_navigator"],
            "search_tiers": weighted(
                [("R", 2.5), ("B", 1.8), ("T", 1.0), ("O", 0.8), ("M", 0.6),
                 ("P", 0.4), ("N", 0.4)],
                fallback_sources=["B", "R"],
            ),
        },
        # 5) 선민 대서사시 알리미 — 한민족 선민 교육
        {
            "chatbot_id": "chosen_nation_epic",
            "display_name": "선민 대서사시 알리미",
            "description": "한민족 선민국가 대서사시·참부모 섭리를 대중 친화적으로 교육",
            "persona_name": "선민 섭리 교육 공직자",
            "system_prompt": base_prompt + SPECIALIZATIONS["chosen_nation_epic"],
            "search_tiers": weighted(
                [("P", 3.0), ("B", 1.3), ("M", 1.0), ("R", 1.0), ("O", 0.6),
                 ("N", 0.6), ("L", 0.4)],
                fallback_sources=["P", "B"],
            ),
        },
    ]


async def upsert_chatbots(conn: asyncpg.Connection, base_prompt: str) -> None:
    configs = make_configs(base_prompt)
    for cfg in configs:
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
            print(f"  ⤷ [{cfg['chatbot_id']}] 이미 존재 — 업데이트")
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
    print(f"기본 프롬프트 로드: {len(base_prompt)} chars")
    print()
    print("NotebookLM 5성 봇 5종 INSERT/UPDATE")

    conn = await asyncpg.connect(os.environ["NEON_DATABASE_URL"])
    try:
        await upsert_chatbots(conn, base_prompt)

        print("\n[검증] 전체 활성 챗봇 목록:")
        rows = await conn.fetch(
            "SELECT chatbot_id, display_name, search_tiers FROM chatbot_configs "
            "WHERE is_active=true ORDER BY chatbot_id"
        )
        for r in rows:
            st = r["search_tiers"]
            if isinstance(st, str):
                st = json.loads(st)
            mode = st.get("search_mode", "?")
            ws = st.get("weighted_sources", [])
            w_str = ", ".join(f"{x['source']}={x['weight']}" for x in ws[:4]) if ws else "-"
            print(f"  [{r['chatbot_id']:28s}] {r['display_name']:20s}  {mode:9s}  {w_str}")
        print(f"\n총 {len(rows)}개 활성 챗봇")
    finally:
        await conn.close()

    print("\n🎉 완료")


if __name__ == "__main__":
    asyncio.run(main())
