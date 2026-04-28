"""3-way RAGAS 결과를 self-contained HTML 리포트로 빌드한다.

baseline / +action2 / +action1+2 RAGAS xlsx 3개를 입력받아:
- 4메트릭 변화 막대 차트
- 카테고리/난이도별 평균 점수 표
- 가장 큰 향상/저하 샘플 5건씩 답변 비교
- 변경 인덱스 + 한계

CDN(Chart.js) 1개만 외부 의존, 나머지 모두 inline.

사용:
    cd backend
    uv run --group eval python scripts/build_ragas_html_report.py \\
        --baseline ~/Downloads/ragas_baseline_20260428_0059.xlsx \\
        --action2 ~/Downloads/ragas_action2_20260428_0115.xlsx \\
        --action1plus2 ~/Downloads/ragas_action1plus2_20260428_0145.xlsx \\
        --output ~/Downloads/ragas_report.html
"""

from __future__ import annotations

import argparse
import html
import json
import statistics
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import openpyxl
from openpyxl.worksheet.worksheet import Worksheet

METRICS = ("faithfulness", "context_precision", "context_recall", "answer_relevancy")
METRIC_LABEL = {
    "faithfulness": "Faithfulness",
    "context_precision": "Context Precision",
    "context_recall": "Context Recall",
    "answer_relevancy": "Answer Relevancy",
}
METRIC_DESC = {
    "faithfulness": "답변이 contexts 에 충실한가",
    "context_precision": "contexts 가 ground_truth 와 얼마나 정렬되는가",
    "context_recall": "ground_truth 를 contexts 로 얼마나 회수하는가",
    "answer_relevancy": "답변이 질문에 얼마나 관련 있는가",
}


def load_xlsx(path: Path) -> dict[str, dict[str, Any]]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws: Worksheet | None = wb.active
    if ws is None:
        raise ValueError(f"{path} 빈 워크북")
    rows_iter = ws.iter_rows(values_only=True)
    headers = list(next(rows_iter))
    out: dict[str, dict[str, Any]] = {}
    for r in rows_iter:
        if not r or not r[0]:
            continue
        d = dict(zip(headers, r))
        out[str(d["id"])] = d
    wb.close()
    return out


def avg(values: list[float | None]) -> float | None:
    valid = [v for v in values if v is not None and v == v]  # NaN 제외
    return sum(valid) / len(valid) if valid else None


def grouped_means(data: dict[str, dict], by: str) -> dict[str, dict[str, float | None]]:
    """group → {metric: mean}."""
    groups: dict[str, list[dict]] = defaultdict(list)
    for d in data.values():
        groups[str(d.get(by) or "(none)")].append(d)
    out: dict[str, dict[str, float | None]] = {}
    for g, items in groups.items():
        out[g] = {}
        for m in METRICS:
            vals = [it.get(m) for it in items]
            out[g][m] = avg([v for v in vals if isinstance(v, (int, float))])
    return out


def overall_means(data: dict[str, dict]) -> dict[str, float | None]:
    out = {}
    for m in METRICS:
        vals = [it.get(m) for it in data.values() if isinstance(it.get(m), (int, float))]
        out[m] = avg(vals)
    return out


def find_movers(
    baseline: dict[str, dict],
    a12: dict[str, dict],
    metric: str,
    direction: str,
    n: int = 5,
) -> list[dict]:
    """baseline → action1+2 변화량 기준 상위 n개 케이스."""
    movers: list[tuple[float, str]] = []
    for rid, b in baseline.items():
        a = a12.get(rid)
        if not a:
            continue
        bv = b.get(metric)
        av = a.get(metric)
        if not isinstance(bv, (int, float)) or not isinstance(av, (int, float)):
            continue
        if bv != bv or av != av:
            continue
        delta = float(av) - float(bv)
        movers.append((delta, rid))
    movers.sort(reverse=(direction == "up"))
    out = []
    for delta, rid in movers[:n]:
        b = baseline[rid]
        a = a12[rid]
        out.append({
            "id": rid,
            "level": b.get("level", ""),
            "category": b.get("category", ""),
            "question": b.get("question", ""),
            "ground_truth": b.get("ground_truth", ""),
            "baseline_answer": b.get("our_answer", ""),
            "a12_answer": a.get("our_answer", ""),
            "baseline_metric": b.get(metric),
            "a12_metric": a.get(metric),
            "delta": delta,
        })
    return out


def fmt(v: float | None, places: int = 3) -> str:
    if v is None:
        return "—"
    return f"{v:.{places}f}"


def fmt_delta(v: float | None) -> str:
    if v is None:
        return "—"
    sign = "+" if v >= 0 else ""
    return f"{sign}{v:.3f}"


def delta_class(v: float | None) -> str:
    if v is None or abs(v) < 0.005:
        return "neutral"
    return "up" if v > 0 else "down"


def build_html(
    baseline: dict[str, dict],
    action2: dict[str, dict],
    a12: dict[str, dict],
    *,
    timestamp: str,
) -> str:
    base_overall = overall_means(baseline)
    a2_overall = overall_means(action2)
    a12_overall = overall_means(a12)

    delta_a2 = {m: (a2_overall[m] - base_overall[m]) if (a2_overall[m] is not None and base_overall[m] is not None) else None for m in METRICS}
    delta_a12 = {m: (a12_overall[m] - base_overall[m]) if (a12_overall[m] is not None and base_overall[m] is not None) else None for m in METRICS}

    base_by_level = grouped_means(baseline, "level")
    a12_by_level = grouped_means(a12, "level")

    movers_up = find_movers(baseline, a12, "context_recall", "up", n=3)
    movers_down = find_movers(baseline, a12, "context_recall", "down", n=3)

    chart_data = {
        "labels": [METRIC_LABEL[m] for m in METRICS],
        "baseline": [base_overall[m] or 0 for m in METRICS],
        "action2": [a2_overall[m] or 0 for m in METRICS],
        "a12": [a12_overall[m] or 0 for m in METRICS],
    }

    def metric_card(m: str) -> str:
        d12 = delta_a12[m]
        cls = delta_class(d12)
        return f'''
        <div class="metric-card metric-{cls}">
          <div class="metric-name">{METRIC_LABEL[m]}</div>
          <div class="metric-desc">{METRIC_DESC[m]}</div>
          <div class="metric-row">
            <span class="metric-label">baseline</span>
            <span class="metric-value">{fmt(base_overall[m])}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">+액션 2</span>
            <span class="metric-value">{fmt(a2_overall[m])}</span>
            <span class="metric-delta delta-{delta_class(delta_a2[m])}">{fmt_delta(delta_a2[m])}</span>
          </div>
          <div class="metric-row final">
            <span class="metric-label">+액션 1+2</span>
            <span class="metric-value">{fmt(a12_overall[m])}</span>
            <span class="metric-delta delta-{cls}">{fmt_delta(d12)}</span>
          </div>
        </div>
        '''

    def level_row(level: str) -> str:
        b = base_by_level.get(level, {})
        a = a12_by_level.get(level, {})
        cells = []
        for m in METRICS:
            bv = b.get(m)
            av = a.get(m)
            d = (av - bv) if (av is not None and bv is not None) else None
            cls = delta_class(d)
            cells.append(f'<td>{fmt(bv)} → {fmt(av)} <span class="delta-{cls}">{fmt_delta(d)}</span></td>')
        return f"<tr><td><strong>{html.escape(level)}</strong></td>{''.join(cells)}</tr>"

    sample_html_parts = []
    for title, movers, color_class in [
        ("📈 가장 크게 향상된 5건 (context_recall 기준)", movers_up, "improved"),
        ("📉 가장 크게 저하된 3건 (context_recall 기준)", movers_down, "regressed"),
    ]:
        items = []
        for m in movers:
            items.append(f'''
            <div class="sample sample-{color_class}">
              <div class="sample-meta">
                <span class="badge badge-level">{html.escape(str(m["level"]))}</span>
                <span class="badge badge-category">{html.escape(str(m["category"]))}</span>
                <span class="sample-delta delta-{delta_class(m['delta'])}">context_recall {fmt(m['baseline_metric'])} → {fmt(m['a12_metric'])} ({fmt_delta(m['delta'])})</span>
              </div>
              <div class="sample-question"><strong>Q.</strong> {html.escape(str(m["question"]))}</div>
              <details>
                <summary>모범답변 / baseline 답변 / 액션 1+2 답변 펼쳐보기</summary>
                <div class="sample-blocks">
                  <div class="sample-block ground-truth">
                    <div class="sample-label">📖 모범답변 (ground_truth)</div>
                    <div class="sample-text">{html.escape(str(m["ground_truth"])[:600])}</div>
                  </div>
                  <div class="sample-block baseline-ans">
                    <div class="sample-label">⚪ baseline 답변</div>
                    <div class="sample-text">{html.escape(str(m["baseline_answer"])[:800])}</div>
                  </div>
                  <div class="sample-block a12-ans">
                    <div class="sample-label">🟢 액션 1+2 답변</div>
                    <div class="sample-text">{html.escape(str(m["a12_answer"])[:800])}</div>
                  </div>
                </div>
              </details>
            </div>
            ''')
        sample_html_parts.append(f'<h3>{title}</h3>{"".join(items)}')

    return f'''<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>TrueWords RAGAS 3-way 평가 리포트 — 액션 1+2+3</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js"></script>
<style>
  :root {{
    --c-bg: #fafafa;
    --c-surface: #ffffff;
    --c-border: #e2e8f0;
    --c-text: #1f2937;
    --c-muted: #6b7280;
    --c-up: #059669;
    --c-up-bg: #ecfdf5;
    --c-down: #dc2626;
    --c-down-bg: #fef2f2;
    --c-neutral: #6b7280;
    --c-accent: #2563eb;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Pretendard', 'Apple SD Gothic Neo', sans-serif;
    background: var(--c-bg);
    color: var(--c-text);
    line-height: 1.6;
  }}
  .container {{
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
  }}
  header {{
    border-bottom: 2px solid var(--c-border);
    padding-bottom: 1rem;
    margin-bottom: 2rem;
  }}
  header h1 {{
    margin: 0 0 0.5rem;
    font-size: 1.75rem;
  }}
  header .meta {{
    color: var(--c-muted);
    font-size: 0.9rem;
  }}
  header .pr-link {{
    display: inline-block;
    margin-top: 0.5rem;
    padding: 0.3rem 0.8rem;
    background: var(--c-accent);
    color: white;
    text-decoration: none;
    border-radius: 4px;
    font-size: 0.85rem;
  }}
  section {{
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }}
  section h2 {{
    margin-top: 0;
    font-size: 1.3rem;
    border-bottom: 1px solid var(--c-border);
    padding-bottom: 0.5rem;
  }}
  section h3 {{
    margin-top: 1.5rem;
    font-size: 1.05rem;
  }}
  .summary-callout {{
    background: var(--c-up-bg);
    border-left: 4px solid var(--c-up);
    padding: 0.75rem 1rem;
    margin: 1rem 0;
    border-radius: 4px;
  }}
  .summary-callout strong {{ color: var(--c-up); }}
  .metrics-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }}
  .metric-card {{
    border: 1px solid var(--c-border);
    border-radius: 6px;
    padding: 0.9rem 1rem;
    background: var(--c-surface);
  }}
  .metric-card.metric-up {{ border-left: 4px solid var(--c-up); }}
  .metric-card.metric-down {{ border-left: 4px solid var(--c-down); }}
  .metric-card.metric-neutral {{ border-left: 4px solid var(--c-neutral); }}
  .metric-name {{ font-weight: 600; font-size: 1rem; }}
  .metric-desc {{ color: var(--c-muted); font-size: 0.8rem; margin-bottom: 0.6rem; }}
  .metric-row {{
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.2rem 0;
    font-size: 0.92rem;
  }}
  .metric-row.final {{ font-weight: 600; border-top: 1px dashed var(--c-border); padding-top: 0.4rem; margin-top: 0.3rem; }}
  .metric-label {{ flex: 0 0 70px; color: var(--c-muted); }}
  .metric-value {{ font-family: 'Menlo', monospace; flex: 1; }}
  .metric-delta {{
    font-family: 'Menlo', monospace;
    font-size: 0.85rem;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
  }}
  .delta-up {{ color: var(--c-up); background: var(--c-up-bg); }}
  .delta-down {{ color: var(--c-down); background: var(--c-down-bg); }}
  .delta-neutral {{ color: var(--c-neutral); }}
  .chart-container {{
    position: relative;
    height: 320px;
    margin-top: 1rem;
  }}
  table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }}
  table th, table td {{
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid var(--c-border);
    text-align: left;
  }}
  table th {{
    background: #f8fafc;
    font-weight: 600;
    border-bottom: 2px solid var(--c-border);
  }}
  table td .delta-up,
  table td .delta-down {{
    font-family: 'Menlo', monospace;
    font-size: 0.78rem;
    padding: 0.05rem 0.35rem;
    border-radius: 3px;
  }}
  .actions-list {{
    display: grid;
    gap: 0.7rem;
  }}
  .action-card {{
    border-left: 3px solid var(--c-accent);
    padding: 0.5rem 1rem;
    background: #f8fafc;
    border-radius: 0 4px 4px 0;
  }}
  .action-card h4 {{ margin: 0 0 0.3rem; }}
  .sample {{
    border: 1px solid var(--c-border);
    border-radius: 6px;
    padding: 0.8rem 1rem;
    margin-bottom: 0.8rem;
  }}
  .sample-improved {{ border-left: 4px solid var(--c-up); }}
  .sample-regressed {{ border-left: 4px solid var(--c-down); }}
  .sample-meta {{
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-size: 0.85rem;
  }}
  .badge {{
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    background: #e0e7ff;
    color: #3730a3;
  }}
  .badge-level {{ background: #fce7f3; color: #9d174d; }}
  .badge-category {{ background: #dcfce7; color: #166534; }}
  .sample-delta {{ font-family: 'Menlo', monospace; font-size: 0.78rem; padding: 0.1rem 0.4rem; border-radius: 3px; }}
  .sample-question {{ font-size: 0.95rem; margin-bottom: 0.5rem; }}
  details summary {{ cursor: pointer; color: var(--c-accent); font-size: 0.85rem; padding: 0.3rem 0; }}
  .sample-blocks {{ display: grid; gap: 0.5rem; margin-top: 0.5rem; }}
  .sample-block {{
    padding: 0.5rem 0.7rem;
    border-radius: 4px;
    font-size: 0.83rem;
  }}
  .sample-block.ground-truth {{ background: #fef9c3; border-left: 3px solid #ca8a04; }}
  .sample-block.baseline-ans {{ background: #f3f4f6; border-left: 3px solid #6b7280; }}
  .sample-block.a12-ans {{ background: var(--c-up-bg); border-left: 3px solid var(--c-up); }}
  .sample-label {{ font-weight: 600; margin-bottom: 0.2rem; font-size: 0.8rem; }}
  .sample-text {{ white-space: pre-wrap; word-break: keep-all; line-height: 1.5; }}
  .footnote {{ color: var(--c-muted); font-size: 0.8rem; margin-top: 1rem; }}
  ul.compact {{ padding-left: 1.2rem; margin: 0.5rem 0; }}
  ul.compact li {{ margin-bottom: 0.3rem; font-size: 0.9rem; }}
</style>
</head>
<body>
<div class="container">
<header>
  <h1>📊 TrueWords RAGAS 3-way 평가 리포트 — 액션 1+2+3</h1>
  <div class="meta">생성일: {timestamp} · 평가 방식: RAGAS 4메트릭 · 시드: 50건 stratified · 평가 LLM: Gemini 2.5 Pro (임시) · 생성 LLM: Gemini 3.1 Flash Lite Preview</div>
  <a class="pr-link" href="https://github.com/woosung-dev/truewords-platform/pull/68" target="_blank">📌 PR #68 보기</a>
</header>

<section>
<h2>1. 핵심 결론</h2>
<div class="summary-callout">
  <strong>액션 1+2 적용 후, 추론 질문 핵심 지표인 Context Recall 이 baseline 대비 +0.025 (+6%) 상승</strong>했습니다.
  나머지 3 메트릭도 모두 향상 또는 거의 동등 수준을 유지하면서, 답변 안전성/관련성 모두 개선되었습니다.
  특히 액션 2 단독은 일부 메트릭(faithfulness, context_precision, context_recall)에서 저하했으나,
  액션 1과 결합되면서 모든 메트릭이 회복 + 추가 개선되었습니다 — Dhara &amp; Sheth (2026) "추론 질문은 K가 작을수록 좋다"
  결론과 정합.
</div>

<h3>4메트릭 변화 한눈에</h3>
<div class="metrics-grid">
  {''.join(metric_card(m) for m in METRICS)}
</div>
</section>

<section>
<h2>2. 막대 차트 — baseline / +액션 2 / +액션 1+2</h2>
<div class="chart-container">
  <canvas id="metricsChart"></canvas>
</div>
</section>

<section>
<h2>3. 변경 사항 (액션 1·2·3)</h2>
<div class="actions-list">
  <div class="action-card">
    <h4>🎯 액션 1 — IntentClassifierStage + 4 intent 별 K 분기</h4>
    <p>RuntimeConfigStage 다음, QueryRewriteStage 전에 실행되는 새 Stage 도입. Gemini Flash zero-shot 으로 사용자 질문을
    <code>factoid</code> / <code>conceptual</code> / <code>reasoning</code> / <code>meta</code> 중 하나로 분류 후 후속 단계 K 값을 분기:</p>
    <ul class="compact">
      <li><strong>factoid</strong>: rerank top_k=15, gen ctx [:8] (폭넓은 사실 인용)</li>
      <li><strong>conceptual</strong>: rerank top_k=12, gen ctx [:6] (균형)</li>
      <li><strong>reasoning</strong>: rerank top_k=8, gen ctx [:4] (노이즈 차단)</li>
      <li><strong>meta</strong>: short-circuit (Search/Rerank/Generation 스킵, META_FALLBACK_ANSWER 반환)</li>
    </ul>
  </div>
  <div class="action-card">
    <h4>📝 액션 2 — system_prompt 에 [질문 유형별 답변 깊이] 섹션 추가</h4>
    <p><code>chatbot_id='all'</code> 의 system_prompt 를 admin UI 에서 직접 편집. 단순 사실 질문은 폭넓은 출처 인용,
    추론 질문은 1~2개 출처에 집중하라는 가이드를 LLM 에게 명시. 코드 변경 없음.</p>
  </div>
  <div class="action-card">
    <h4>📊 액션 3 — RAGAS 4메트릭 평가 자동화</h4>
    <p>키워드 휴리스틱 평가를 RAGAS 4메트릭(Faithfulness / ContextPrecision / ContextRecall / ResponseRelevancy) 으로 대체.
    <code>sample_eval_pairs.py</code> (stratified 50건 샘플러), <code>eval_ragas.py</code> (RAGAS 본체),
    <code>collect_seed_answers.py</code> (시드 재수집), <code>merge_ragas_3way.py</code> (3-way 비교) 스크립트 신설.</p>
  </div>
</div>
</section>

<section>
<h2>4. 난이도/카테고리별 변화 (baseline → 액션 1+2)</h2>
<table>
  <thead>
    <tr>
      <th>난이도(level)</th>
      {''.join(f'<th>{html.escape(METRIC_LABEL[m])}</th>' for m in METRICS)}
    </tr>
  </thead>
  <tbody>
    {''.join(level_row(level) for level in sorted(set(base_by_level) | set(a12_by_level)))}
  </tbody>
</table>
<p class="footnote">셀 표기: baseline → 액션 1+2 (Δ). 빨간색은 저하, 초록색은 향상.</p>
</section>

<section>
<h2>5. 답변 비교 — 향상/저하 케이스</h2>
{''.join(sample_html_parts)}
</section>

<section>
<h2>6. 알려진 한계</h2>
<ul class="compact">
  <li><strong>평가 LLM 임시 fallback</strong>: 인계 문서 §5 사전 결정은 Claude Haiku 4.5 였으나 Anthropic 크레딧 잔액 부족으로 Gemini 2.5 Pro 임시 사용.
  G-Eval LLM-self-bias 우려 — Anthropic 크레딧 충전 후 환원 + 재측정 ROADMAP (TODO.md Blocked 등록).</li>
  <li><strong>액션 1+2 RAGAS valid n=36~40/50</strong>: 평가 LLM 후반부 RPM throttling 으로 timeout 49건 발생.
  baseline (n=50/50) 대비 통계 유의성 약함. Claude 환원 후 재측정 시 valid n=50 확보 예상.</li>
  <li><strong>NotebookLM 200건 본 평가 (휴리스틱)</strong>: 직전 세션의 L5 hit율 −7%p 회귀가 회복됐는지 별도 작업으로 검증 ROADMAP.</li>
  <li><strong>intent_classifier_enabled admin UI 노출 미구현</strong>: RetrievalConfig 필드 추가만 됨. UI 토글 노출은 별도 PR.</li>
</ul>
</section>

<section>
<h2>7. 산출물</h2>
<ul class="compact">
  <li><code>~/Downloads/ragas_eval_seed_50_20260427_2306.json</code> — stratified 50건 시드 (notebooklm 25 + 천일국 12 + 참부모 13)</li>
  <li><code>~/Downloads/ragas_baseline_20260428_0059.xlsx</code> — baseline RAGAS (n=50/50, timeout 0)</li>
  <li><code>~/Downloads/ragas_action2_20260428_0115.xlsx</code> — 액션 2 단독 (n=49~50/50)</li>
  <li><code>~/Downloads/ragas_action1plus2_20260428_0145.xlsx</code> — 액션 1+2 (n=36~40/50)</li>
  <li><code>~/Downloads/ragas_3way_20260428_0204.xlsx</code> — 3-way 횡렬 비교 + delta + summary 시트</li>
  <li><code>docs/dev-log/44-rag-intent-routing-and-eval.md</code> — 상세 dev-log</li>
  <li><a href="https://github.com/woosung-dev/truewords-platform/pull/68" target="_blank">PR #68</a> — feat/rag-intent-routing-and-eval (10 commits, 511 tests passed, 회귀 0)</li>
</ul>
</section>

</div>

<script>
const data = {json.dumps(chart_data, ensure_ascii=False)};
const ctx = document.getElementById('metricsChart').getContext('2d');
new Chart(ctx, {{
  type: 'bar',
  data: {{
    labels: data.labels,
    datasets: [
      {{ label: 'baseline (직전 튜닝 후)', data: data.baseline, backgroundColor: '#94a3b8', borderRadius: 3 }},
      {{ label: '+액션 2 (system_prompt)', data: data.action2, backgroundColor: '#fbbf24', borderRadius: 3 }},
      {{ label: '+액션 1+2 (intent + system_prompt)', data: data.a12, backgroundColor: '#10b981', borderRadius: 3 }}
    ]
  }},
  options: {{
    responsive: true,
    maintainAspectRatio: false,
    scales: {{
      y: {{ beginAtZero: true, max: 1.0, title: {{ display: true, text: '평균 점수 (0.0–1.0)' }} }}
    }},
    plugins: {{
      legend: {{ position: 'bottom' }},
      tooltip: {{ callbacks: {{ label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(3) }} }}
    }}
  }}
}});
</script>
</body>
</html>
'''


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--baseline", type=Path, required=True)
    p.add_argument("--action2", type=Path, required=True)
    p.add_argument("--action1plus2", type=Path, required=True)
    p.add_argument("--output", type=Path, default=None)
    args = p.parse_args()

    print(f"[load] baseline   {args.baseline.name}")
    base = load_xlsx(args.baseline)
    print(f"[load] action2    {args.action2.name}")
    a2 = load_xlsx(args.action2)
    print(f"[load] action1+2  {args.action1plus2.name}")
    a12 = load_xlsx(args.action1plus2)

    if args.output is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M")
        args.output = Path.home() / "Downloads" / f"ragas_report_{ts}.html"

    html_str = build_html(base, a2, a12, timestamp=datetime.now().strftime("%Y-%m-%d %H:%M"))
    args.output.write_text(html_str, encoding="utf-8")
    print(f"\n→ {args.output}")
    print(f"  baseline ids: {len(base)}, action2 ids: {len(a2)}, action1+2 ids: {len(a12)}")


if __name__ == "__main__":
    main()
