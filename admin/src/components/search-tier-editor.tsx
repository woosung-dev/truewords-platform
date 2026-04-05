"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ChevronUp, ChevronDown, X, Plus, GripVertical } from "lucide-react";
import type { SearchTier } from "@/lib/api";

const DATA_SOURCES = [
  { value: "A", label: "A" },
  { value: "B", label: "B" },
  { value: "C", label: "C" },
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

  function handleScoreInput(index: number, raw: string) {
    const val = parseFloat(raw);
    if (isNaN(val)) return;
    updateTier(index, {
      score_threshold: Math.round(Math.max(0, Math.min(1, val)) * 100) / 100,
    });
  }

  if (tiers.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">
          검색 티어가 없습니다. 티어를 추가해주세요.
        </p>
        <Button variant="outline" size="sm" onClick={addTier}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          티어 추가
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tiers.map((tier, index) => (
        <div
          key={index}
          className="rounded-xl border bg-muted/20 overflow-hidden"
        >
          {/* 티어 헤더 */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
            <div className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-muted-foreground/50" />
              <span className="text-sm font-medium">Tier {index + 1}</span>
              {index === 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                  최우선
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => moveTier(index, -1)}
                disabled={index === 0}
                title="위로 이동"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => moveTier(index, 1)}
                disabled={index === tiers.length - 1}
                title="아래로 이동"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => removeTier(index)}
                title="삭제"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <div className="px-4 py-4 space-y-4">
            {/* 데이터 소스 토글 */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                데이터 소스
              </Label>
              <div className="flex gap-1.5">
                {DATA_SOURCES.map((ds) => {
                  const isSelected = tier.sources.includes(ds.value);
                  return (
                    <button
                      key={ds.value}
                      type="button"
                      onClick={() => toggleSource(index, ds.value)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground"
                      }`}
                    >
                      {ds.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                선택된 소스:{" "}
                <span className="font-medium">{tier.sources.join(", ")}</span>
              </p>
            </div>

            {/* 최소 결과 수 */}
            <div className="space-y-1.5">
              <Label
                htmlFor={`min-results-${index}`}
                className="text-xs text-muted-foreground"
              >
                최소 결과 수
                <span className="ml-1 text-[10px] text-muted-foreground/70">
                  (이 티어에서 최소 몇 개가 나와야 통과)
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
                    min_results: Math.max(
                      1,
                      Math.min(20, Number(e.target.value) || 1)
                    ),
                  })
                }
                className="w-24 h-8 text-sm"
              />
            </div>

            {/* 점수 임계값 — 슬라이더 + 입력값 연동 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  점수 임계값
                  <span className="ml-1 text-[10px] text-muted-foreground/70">
                    (높을수록 정확한 결과만 표시, 0.6~0.8 권장)
                  </span>
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <Slider
                  value={[tier.score_threshold]}
                  onValueChange={(val) => {
                    const v = Array.isArray(val) ? val[0] : val;
                    updateTier(index, {
                      score_threshold: Math.round(v * 100) / 100,
                    });
                  }}
                  min={0}
                  max={1}
                  step={0.05}
                  className="flex-1"
                />
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={tier.score_threshold}
                  onChange={(e) => handleScoreInput(index, e.target.value)}
                  className="w-20 h-8 text-sm text-center"
                />
              </div>
            </div>
          </div>
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={addTier}>
        <Plus className="w-3.5 h-3.5 mr-1.5" />
        티어 추가
      </Button>
    </div>
  );
}
