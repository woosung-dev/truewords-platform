"""
사용법: uv run python scripts/evaluate.py
서버가 localhost:8000에서 실행 중이어야 합니다.
"""
import json
import httpx
from pathlib import Path

TEST_QUESTIONS = [
    "축복행정이란 무엇인가?",
    "국제결혼을 위한 조건은 무엇인가?",
    "축복식 절차는 어떻게 되는가?",
    "참부모님의 축복에 대한 내용은?",
    "축복가정의 의무와 책임은 무엇인가?",
]


def evaluate():
    results = []
    client = httpx.Client(timeout=60.0)

    for q in TEST_QUESTIONS:
        try:
            response = client.post("http://localhost:8000/chat", json={"query": q})
            data = response.json()
            results.append({
                "question": q,
                "answer": data.get("answer", ""),
                "sources": [s["volume"] for s in data.get("sources", [])],
            })
            print(f"\n질문: {q}")
            print(f"답변: {data.get('answer', '')[:300]}...")
            print(f"출처: {[s['volume'] for s in data.get('sources', [])]}")
        except Exception as e:
            print(f"\n질문: {q}")
            print(f"오류: {e}")
            results.append({"question": q, "answer": f"오류: {e}", "sources": []})

    output_path = Path(__file__).parent.parent / "eval_results.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\n\n평가 완료. 결과 저장: {output_path}")


if __name__ == "__main__":
    evaluate()
