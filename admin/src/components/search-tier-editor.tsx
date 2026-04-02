"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent } from "@/components/ui/card";
import type { SearchTier } from "@/lib/api";

const DATA_SOURCES = [
  { value: "A", label: "A: 말씀선집" },
  { value: "B", label: "B: 어머니말씀" },
  { value: "C", label: "C: 원리강론" },
] as const;

interface SearchTierEditorProps {
  tiers: SearchTier[];
  onChange: (tiers: SearchTier[]) => void;
}

export default function SearchTierEditor({
  tiers,
  onChange,
}: SearchTierEditorProps) {
  function addTier() {
    onChange([
      ...tiers,
      { sources: ["A"], min_results: 3, score_threshold: 0.75 },
    ]);
  }

  function removeTier(index: number) {
    onChange(tiers.filter((_, i) => i !== index));
  }

  function updateTier(index: number, updates: Partial<SearchTier>) {
    onChange(tiers.map((t, i) => (i === index ? { ...t, ...updates } : t)));
  }

  function moveTier(index: number, direction: -1 | 1) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= tiers.length) return;
    const next = [...tiers];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    onChange(next);
  }

  function toggleSource(index: number, source: string) {
    const tier = tiers[index];
    const sources = tier.sources.includes(source)
      ? tier.sources.filter((s) => s !== source)
      : [...tier.sources, source];
    if (sources.length > 0) {
      updateTier(index, { sources });
    }
  }

  if (tiers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          검색 티어가 없습니다. 추가하세요.
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={addTier}>
          + 티어 추가
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tiers.map((tier, index) => (
        <Card key={index}>
          <CardContent className="space-y-4 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Tier {index + 1}
                {index === 0 ? " (최우선)" : ""}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => moveTier(index, -1)}
                  disabled={index === 0}
                  title="위로 이동"
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => moveTier(index, 1)}
                  disabled={index === tiers.length - 1}
                  title="아래로 이동"
                >
                  ↓
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeTier(index)}
                  className="text-destructive"
                  title="삭제"
                >
                  ✕
                </Button>
              </div>
            </div>

            {/* 데이터 소스 */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                데이터 소스
              </Label>
              <div className="flex gap-4">
                {DATA_SOURCES.map((ds) => (
                  <label
                    key={ds.value}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={tier.sources.includes(ds.value)}
                      onCheckedChange={() => toggleSource(index, ds.value)}
                    />
                    {ds.label}
                  </label>
                ))}
              </div>
            </div>

            {/* 최소 결과 수 */}
            <div className="space-y-2">
              <Label htmlFor={`min-results-${index}`} className="text-xs text-muted-foreground">
                최소 결과 수
                <span className="ml-1 text-[10px]">
                  (이 티어에서 최소 몇 개 결과를 찾아야 하는지)
                </span>
              </Label>
              <Input
                id={`min-results-${index}`}
                type="number"
                min={1}
                max={20}
                value={tier.min_results}
                onChange={(e) =>
                  updateTier(index, {
                    min_results: Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                  })
                }
                className="w-24"
              />
            </div>

            {/* 점수 임계값 */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                점수 임계값: {tier.score_threshold.toFixed(2)}
                <span className="ml-1 text-[10px]">
                  (높을수록 정확한 결과만 표시, 0.6~0.8 권장)
                </span>
              </Label>
              <Slider
                value={[tier.score_threshold]}
                onValueChange={(val) => {
                  const v = Array.isArray(val) ? val[0] : val;
                  updateTier(index, { score_threshold: Math.round(v * 100) / 100 });
                }}
                min={0}
                max={1}
                step={0.05}
                className="w-full"
              />
            </div>
          </CardContent>
        </Card>
      ))}

      <Button variant="outline" size="sm" onClick={addTier}>
        + 티어 추가
      </Button>
    </div>
  );
}
