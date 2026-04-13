"use client";

interface SearchModeSelectorProps {
  mode: "cascading" | "weighted";
  onChange: (mode: "cascading" | "weighted") => void;
}

export default function SearchModeSelector({
  mode,
  onChange,
}: SearchModeSelectorProps) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-foreground mb-2">
        검색 전략
      </legend>
      <label className="flex items-start gap-3 cursor-pointer rounded-lg border p-3 transition-colors hover:bg-accent/30 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input
          type="radio"
          name="search_mode"
          value="cascading"
          checked={mode === "cascading"}
          onChange={() => onChange("cascading")}
          className="mt-0.5 accent-primary"
        />
        <div>
          <div className="text-sm font-medium">순차 검색 (Cascading)</div>
          <div className="text-xs text-muted-foreground">
            우선순위 순서로 검색하고, 결과가 충분하면 다음 단계를 건너뜁니다
          </div>
        </div>
      </label>
      <label className="flex items-start gap-3 cursor-pointer rounded-lg border p-3 transition-colors hover:bg-accent/30 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input
          type="radio"
          name="search_mode"
          value="weighted"
          checked={mode === "weighted"}
          onChange={() => onChange("weighted")}
          className="mt-0.5 accent-primary"
        />
        <div>
          <div className="text-sm font-medium">비중 검색 (Weighted)</div>
          <div className="text-xs text-muted-foreground">
            모든 소스를 동시에 검색하고, 비중에 따라 결과를 혼합합니다
          </div>
        </div>
      </label>
    </fieldset>
  );
}
