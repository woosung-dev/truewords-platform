"use client";

/**
 * 챗봇 생성/수정 공통 폼 컴포넌트 (§13.3 S3).
 *
 * new/page.tsx · edit/page.tsx 에 중복됐던 state / JSX 를 한 곳으로 추출.
 * `mode="create"` 에서만 chatbot_id 입력 필드를 노출. 나머지 필드/검색 설정은 동일.
 */

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SearchModeSelector from "@/features/chatbot/components/search-mode-selector";
import SearchTierEditor from "@/features/chatbot/components/search-tier-editor";
import WeightedSourceEditor from "@/features/chatbot/components/weighted-source-editor";
import type { SearchTier, WeightedSource } from "@/features/chatbot/types";
import { Info, Search, User } from "lucide-react";

export type ChatbotFormMode = "create" | "edit";

export interface ChatbotFormValues {
  chatbot_id: string;
  display_name: string;
  description: string;
  persona_name: string;
  system_prompt: string;
  is_active: boolean;
  search_tiers: {
    search_mode: "cascading" | "weighted";
    tiers: SearchTier[];
    weighted_sources: WeightedSource[];
    dictionary_enabled: boolean;
    query_rewrite_enabled: boolean;
  };
}

export interface ChatbotFormProps {
  mode: ChatbotFormMode;
  initialValues?: Partial<ChatbotFormValues>;
  onSubmit: (values: ChatbotFormValues) => void | Promise<unknown>;
  isSubmitting: boolean;
  submitLabel: string;
  submitPendingLabel: string;
  onCancel: () => void;
  cancelLabel: string;
}

function buildInitial(initial?: Partial<ChatbotFormValues>): ChatbotFormValues {
  return {
    chatbot_id: initial?.chatbot_id ?? "",
    display_name: initial?.display_name ?? "",
    description: initial?.description ?? "",
    persona_name: initial?.persona_name ?? "",
    system_prompt: initial?.system_prompt ?? "",
    is_active: initial?.is_active ?? true,
    search_tiers: {
      search_mode: initial?.search_tiers?.search_mode ?? "cascading",
      tiers: initial?.search_tiers?.tiers ?? [],
      weighted_sources: initial?.search_tiers?.weighted_sources ?? [],
      dictionary_enabled: initial?.search_tiers?.dictionary_enabled ?? false,
      query_rewrite_enabled: initial?.search_tiers?.query_rewrite_enabled ?? false,
    },
  };
}

export function ChatbotForm({
  mode,
  initialValues,
  onSubmit,
  isSubmitting,
  submitLabel,
  submitPendingLabel,
  onCancel,
  cancelLabel,
}: ChatbotFormProps) {
  const [values, setValues] = useState<ChatbotFormValues>(() =>
    buildInitial(initialValues),
  );
  // edit 모드에서 initialValues 가 비동기(useQuery) 로 들어오는 경우 1회 반영.
  const [initialized, setInitialized] = useState(
    mode === "create" || initialValues !== undefined,
  );

  useEffect(() => {
    if (mode === "edit" && initialValues && !initialized) {
      setValues(buildInitial(initialValues));
      setInitialized(true);
    }
  }, [mode, initialValues, initialized]);

  function patch<K extends keyof ChatbotFormValues>(
    key: K,
    value: ChatbotFormValues[K],
  ) {
    setValues((s) => ({ ...s, [key]: value }));
  }
  function patchSearch<K extends keyof ChatbotFormValues["search_tiers"]>(
    key: K,
    value: ChatbotFormValues["search_tiers"][K],
  ) {
    setValues((s) => ({
      ...s,
      search_tiers: { ...s.search_tiers, [key]: value },
    }));
  }

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    void onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* 섹션 1: 기본 정보 */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 border-b pb-3">
          <Info className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">기본 정보</h3>
        </div>

        {mode === "create" && (
          <div className="space-y-1.5">
            <Label htmlFor="chatbot-id">
              Chatbot ID <span className="text-destructive">*</span>
            </Label>
            <Input
              id="chatbot-id"
              value={values.chatbot_id}
              onChange={(e) => patch("chatbot_id", e.target.value)}
              placeholder="malssum_priority"
              required
            />
            <p className="text-xs text-muted-foreground">
              한번 설정 후 변경 불가. 영문 소문자, 숫자, 언더스코어만 사용
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="display-name">
            표시 이름 <span className="text-destructive">*</span>
          </Label>
          <Input
            id="display-name"
            value={values.display_name}
            onChange={(e) => patch("display_name", e.target.value)}
            placeholder={mode === "create" ? "말씀선집 우선" : undefined}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">설명</Label>
          <Input
            id="description"
            value={values.description}
            onChange={(e) => patch("description", e.target.value)}
            placeholder={mode === "create" ? "챗봇 설명 (선택)" : undefined}
          />
        </div>

        <div className="flex items-center gap-2.5">
          <Checkbox
            id="is-active"
            checked={values.is_active}
            onCheckedChange={(c) => patch("is_active", c === true)}
          />
          <Label htmlFor="is-active" className="cursor-pointer">
            활성화
          </Label>
        </div>
      </div>

      {/* 섹션 2: 페르소나 */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 border-b pb-3">
          <User className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">페르소나 설정</h3>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="persona-name">페르소나 이름</Label>
          <Input
            id="persona-name"
            value={values.persona_name}
            onChange={(e) => patch("persona_name", e.target.value)}
            placeholder="예: 30년 경력 목회공직자"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="system-prompt">시스템 프롬프트</Label>
          <textarea
            id="system-prompt"
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm min-h-[180px] resize-y transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
            value={values.system_prompt}
            onChange={(e) => patch("system_prompt", e.target.value)}
            placeholder="봇의 역할, 응답 규칙, 가드레일 등을 입력하세요."
          />
          <p className="text-xs text-muted-foreground">
            비워두면 기본 시스템 프롬프트가 적용됩니다
          </p>
        </div>
      </div>

      {/* 섹션 3: 검색 설정 */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 border-b pb-3">
          <Search className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">검색 티어 설정</h3>
        </div>

        <div className="flex items-center gap-2.5">
          <Checkbox
            id="query-rewrite-enabled"
            checked={values.search_tiers.query_rewrite_enabled}
            onCheckedChange={(c) =>
              patchSearch("query_rewrite_enabled", c === true)
            }
          />
          <Label
            htmlFor="query-rewrite-enabled"
            className="cursor-pointer text-sm"
          >
            Query Rewriting
          </Label>
          <span className="text-xs text-muted-foreground">
            사용자 질문을 종교 용어로 자동 재작성
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <Checkbox
            id="dictionary-enabled"
            checked={values.search_tiers.dictionary_enabled}
            onCheckedChange={(c) =>
              patchSearch("dictionary_enabled", c === true)
            }
            disabled
          />
          <Label
            htmlFor="dictionary-enabled"
            className="cursor-not-allowed opacity-50 text-sm"
          >
            용어 사전 자동 주입 (D)
          </Label>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
            준비중
          </span>
        </div>

        <SearchModeSelector
          mode={values.search_tiers.search_mode}
          onChange={(m) => patchSearch("search_mode", m)}
        />

        <div className="mt-4">
          {values.search_tiers.search_mode === "cascading" ? (
            <SearchTierEditor
              tiers={values.search_tiers.tiers}
              onChange={(t) => patchSearch("tiers", t)}
            />
          ) : (
            <WeightedSourceEditor
              sources={values.search_tiers.weighted_sources}
              onChange={(s) => patchSearch("weighted_sources", s)}
            />
          )}
        </div>
      </div>

      {/* 하단 액션 바 */}
      <div className="sticky bottom-0 flex gap-3 border-t bg-background/80 backdrop-blur-sm py-4 -mx-6 px-6">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? submitPendingLabel : submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </form>
  );
}
