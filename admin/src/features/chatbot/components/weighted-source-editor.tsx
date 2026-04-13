"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import type { WeightedSource } from "@/features/chatbot/types";
import { useSearchableCategories } from "@/features/data-source/hooks";

interface WeightedSourceEditorProps {
  sources: WeightedSource[];
  onChange: (sources: WeightedSource[]) => void;
}

export default function WeightedSourceEditor({
  sources,
  onChange,
}: WeightedSourceEditorProps) {
  const { data: categories = [] } = useSearchableCategories();

  const totalWeight = sources.reduce((sum, s) => sum + s.weight, 0);

  function addSource() {
    const usedSources = new Set(sources.map((s) => s.source));
    const available = categories.find((c) => !usedSources.has(c.key));
    if (!available) return;
    onChange([
      ...sources,
      { source: available.key, weight: 1, score_threshold: 0.1 },
    ]);
  }

  function removeSource(index: number) {
    if (sources.length <= 1) return;
    onChange(sources.filter((_, i) => i !== index));
  }

  function updateSource(index: number, updates: Partial<WeightedSource>) {
    onChange(
      sources.map((s, i) => (i === index ? { ...s, ...updates } : s))
    );
  }

  const usedSources = new Set(sources.map((s) => s.source));
  const hasAvailable = categories.some((c) => !usedSources.has(c.key));

  return (
    <div className="space-y-3">
      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          소스를 추가하세요
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_80px_100px_40px_60px] gap-2 px-1 text-xs font-medium text-muted-foreground">
            <span>소스</span>
            <span>비중</span>
            <span>점수 임계값</span>
            <span></span>
            <span className="text-right">비율</span>
          </div>

          {sources.map((s, i) => {
            const pct =
              totalWeight > 0
                ? ((s.weight / totalWeight) * 100).toFixed(1)
                : "0.0";
            const catName =
              categories.find((c) => c.key === s.source)?.name ?? s.source;
            return (
              <div
                key={`${s.source}-${i}`}
                className="grid grid-cols-[1fr_80px_100px_40px_60px] gap-2 items-center"
              >
                <select
                  value={s.source}
                  onChange={(e) => updateSource(i, { source: e.target.value })}
                  className="text-sm border rounded-md px-2 py-1.5 bg-background"
                >
                  <option value={s.source}>
                    {catName} ({s.source})
                  </option>
                  {categories
                    .filter(
                      (c) => !usedSources.has(c.key) || c.key === s.source
                    )
                    .map(
                      (c) =>
                        c.key !== s.source && (
                          <option key={c.key} value={c.key}>
                            {c.name} ({c.key})
                          </option>
                        )
                    )}
                </select>

                <Input
                  type="number"
                  min={0.1}
                  max={100}
                  step="any"
                  value={s.weight}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 0.1)
                      updateSource(i, { weight: val });
                  }}
                  className="h-8 text-sm text-center"
                />

                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={s.score_threshold}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      updateSource(i, {
                        score_threshold:
                          Math.round(Math.max(0, Math.min(1, val)) * 100) / 100,
                      });
                    }
                  }}
                  className="h-8 text-sm text-center"
                />

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSource(i)}
                  disabled={sources.length <= 1}
                  className="h-8 w-8 p-0"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>

                <span className="text-sm text-right tabular-nums text-muted-foreground">
                  {pct}%
                </span>
              </div>
            );
          })}

          <div className="flex justify-between items-center pt-2 border-t text-sm">
            <span className="text-muted-foreground">합계: {totalWeight}</span>
            <span className="tabular-nums font-medium">
              {totalWeight > 0 ? "100.0%" : "0%"}
            </span>
          </div>
        </>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={addSource}
        disabled={!hasAvailable}
        className="w-full"
      >
        <Plus className="w-3.5 h-3.5 mr-1.5" />
        소스 추가
      </Button>

      <p className="text-xs text-muted-foreground">
        비중은 비율로 자동 계산됩니다. 예: 5:3:2 → 50%, 30%, 20%. 점수 임계값은
        RRF fusion 기준 0.05~0.3 범위를 권장합니다.
      </p>
    </div>
  );
}
