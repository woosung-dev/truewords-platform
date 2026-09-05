// 데이터 소스 파일별 사용자 친화적 표시명을 인라인 편집하는 컴포넌트.
"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { dataAPI } from "@/features/data-source/api";
import { Input } from "@/components/ui/input";

export interface DisplayNameEditorProps {
  volumeKey: string;
  initialValue: string | null;
  /** 미설정 시 placeholder 로 보일 권장 표시명 (예: 권번호 + filename 추출) */
  placeholder?: string;
}

/**
 * blur 또는 Enter 시 변경된 값만 자동 저장. 빈 문자열은 백엔드에서 NULL 로 정규화 →
 * chat 응답이 기존 volume/source 로 fallback.
 */
export function DisplayNameEditor({
  volumeKey,
  initialValue,
  placeholder,
}: DisplayNameEditorProps) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(initialValue ?? "");
  const [savedValue, setSavedValue] = useState(initialValue ?? "");
  const [justSaved, setJustSaved] = useState(false);

  // jobs query refetch 로 initialValue 가 바뀌면 동기화 (편집 중인 경우 외).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 전환 중 query 갱신에 따른 기존 편집 값 동기화를 보존한다.
    setValue(initialValue ?? "");
    setSavedValue(initialValue ?? "");
  }, [initialValue]);

  const mutation = useMutation({
    mutationFn: () =>
      dataAPI.updateDisplayName({
        volume_key: volumeKey,
        display_name: value.trim() || null,
      }),
    onSuccess: () => {
      const normalized = value.trim();
      setSavedValue(normalized);
      setValue(normalized);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
      // 목록 자체에는 영향이 없으나 다른 화면(예: chat)이 같은 데이터를 캐시 중일 수 있어
      // jobs query 만 invalidate.
      queryClient.invalidateQueries({ queryKey: ["ingestion-jobs"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "표시명 저장 실패");
      // 실패 시 사용자가 수정 중인 값은 유지 — 이전 저장값으로 강제 복원하지 않음.
    },
  });

  const dirty = value.trim() !== savedValue.trim();

  const commit = () => {
    if (!dirty || mutation.isPending) return;
    mutation.mutate();
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        placeholder={placeholder ?? "표시명 미설정"}
        className="h-7 text-xs"
        aria-label="파일 표시명"
        disabled={mutation.isPending}
      />
      {mutation.isPending && (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
      )}
      {justSaved && !mutation.isPending && (
        <Check className="h-3.5 w-3.5 text-success" aria-label="저장됨" />
      )}
    </div>
  );
}
