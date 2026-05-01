"use client";

import { Dialog } from "@base-ui/react/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DuplicateCheckResponse } from "@/features/data-source/types";

// ADR-30: 재업로드 시 사용자 의사결정.
//   merge   — 기존 분류 보존 + 신규 분류 합집합 + 콘텐츠 갱신 (default 권장)
//   add-tag — 임베딩 없이 카테고리 태그만 추가 (volume-tags API)
//   replace — 신규 분류로 통째 교체 + 콘텐츠 갱신 (위험)
//   cancel  — 업로드 중단
export type DuplicateDecision = "merge" | "add-tag" | "replace" | "cancel";

// 신규 — /admin/data-sources/check-duplicate/analyze 응답
interface AnalyzeResponse {
  filename: string;
  existing_content_hash: string | null;
  new_content_hash: string;
  content_match: boolean | null;
  existing_chunk_count: number;
  estimated_new_chunk_count: number;
  chunk_delta: number;
  sources: string[];
}

interface DuplicateConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filename: string;
  targetSource: string;       // 사용자가 이번 업로드에 선택한 카테고리 key (빈 문자열 = 미분류)
  duplicate: DuplicateCheckResponse | null;
  onDecision: (decision: DuplicateDecision) => void;
  pendingFile?: File | null;  // 신규 — 내용 비교 분석에 사용
}

export default function DuplicateConfirmDialog({
  open,
  onOpenChange,
  filename,
  targetSource,
  duplicate,
  onDecision,
  pendingFile,
}: DuplicateConfirmDialogProps) {
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // dialog 닫힐 때 state reset
  useEffect(() => {
    if (!open) {
      setAnalysis(null);
      setAnalyzing(false);
    }
  }, [open]);

  const runAnalyze = async () => {
    if (!pendingFile || analyzing) return;
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("file", pendingFile);
      const r = await fetch("/admin/data-sources/check-duplicate/analyze", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setAnalysis((await r.json()) as AnalyzeResponse);
    } catch (e) {
      toast.error(`내용 비교 분석 실패: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setAnalyzing(false);
    }
  };

  if (!duplicate) return null;

  // "태그만 추가" 조건:
  // 1) 사용자가 카테고리를 선택했고 (미분류 아님)
  // 2) 기존 문서에 해당 태그가 아직 없고
  // 3) Qdrant에 청크가 실제로 존재할 때 (실제 포인트가 있어야 태그 추가 가능)
  const canAddTag =
    targetSource !== "" &&
    !duplicate.sources.includes(targetSource) &&
    duplicate.chunk_count > 0;

  const existingSourcesLabel =
    duplicate.sources.length > 0 ? duplicate.sources.join(", ") : "미분류";

  const targetLabel = targetSource ? targetSource : "미분류";

  // merge 결과 미리보기 — 기존 ∪ 신규 (실제 backend 계산과 동일 시맨틱)
  const mergedPreview = (() => {
    const set = new Set(duplicate.sources.filter((s) => s));
    if (targetSource) set.add(targetSource);
    const arr = Array.from(set).sort();
    return arr.length > 0 ? arr.join(", ") : "미분류";
  })();

  const lastUploadedLabel = duplicate.last_uploaded_at
    ? new Date(duplicate.last_uploaded_at).toLocaleString("ko-KR")
    : "-";

  const decide = (decision: DuplicateDecision) => {
    onDecision(decision);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-0 z-50 m-auto flex h-fit w-full max-w-md flex-col rounded-2xl bg-popover shadow-2xl transition duration-200 data-ending-style:opacity-0 data-ending-style:scale-95 data-starting-style:opacity-0 data-starting-style:scale-95">
          {/* 헤더 */}
          <div className="flex items-center justify-between border-b px-6 py-4">
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              동일 파일이 이미 존재합니다
            </Dialog.Title>
            <Dialog.Close
              aria-label="닫기"
              className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* 본문 */}
          <div className="space-y-4 px-6 py-5">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0 w-20">파일명</span>
                <span className="font-medium break-all">{filename}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0 w-20">기존 분류</span>
                <div className="flex flex-wrap gap-1">
                  {duplicate.sources.length > 0 ? (
                    duplicate.sources.map((src) => (
                      <Badge key={src} variant="outline" className="text-xs">
                        {src}
                      </Badge>
                    ))
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-xs bg-amber-50 text-amber-700 border-amber-200"
                    >
                      미분류
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0 w-20">기존 청크 수</span>
                <span>{duplicate.chunk_count.toLocaleString()}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0 w-20">최근 업로드</span>
                <span className="text-muted-foreground">{lastUploadedLabel}</span>
              </div>

              {/* 내용 비교 분석 — 분석 전 / 분석 중 / 분석 완료 3 상태 */}
              <div className="border-t pt-2 mt-1 space-y-2">
                <div className="flex gap-2 items-center">
                  <span className="text-muted-foreground shrink-0 w-20">내용 비교</span>
                  {analyzing ? (
                    <Badge
                      variant="outline"
                      className="text-xs bg-blue-50 text-blue-700 border-blue-200"
                    >
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      분석 중...
                    </Badge>
                  ) : analysis === null ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={runAnalyze}
                      disabled={!pendingFile}
                      className="h-6 text-xs px-2 gap-1"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                      내용 비교 분석 (3초 소요)
                    </Button>
                  ) : analysis.content_match === true ? (
                    <Badge className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      내용 동일 (hash 일치)
                    </Badge>
                  ) : analysis.content_match === false ? (
                    <Badge className="text-xs bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      내용 변경됨 (hash 불일치)
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      기존 hash 없음 (신규 적재)
                    </Badge>
                  )}
                </div>

                {analysis && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground shrink-0 w-20">예상 청크 수</span>
                    <span className="text-sm">
                      {analysis.estimated_new_chunk_count.toLocaleString()}
                      {analysis.chunk_delta === 0 ? (
                        <span className="ml-1 text-muted-foreground text-xs">(변동 없음)</span>
                      ) : (
                        <span
                          className={`ml-1 text-xs font-medium ${
                            analysis.chunk_delta > 0 ? "text-amber-600" : "text-blue-600"
                          }`}
                        >
                          ({analysis.chunk_delta > 0 ? "+" : ""}
                          {analysis.chunk_delta.toLocaleString()})
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 권장 hint — 분석 결과에 따라 다른 색상 + 메시지 */}
            {analysis && (
              <div
                className={`rounded-lg border p-3 text-xs leading-relaxed ${
                  analysis.content_match === true
                    ? "bg-emerald-50/50 border-emerald-200 text-emerald-900"
                    : analysis.content_match === false
                      ? "bg-blue-50/50 border-blue-200 text-blue-900"
                      : "bg-muted/30 border-border text-muted-foreground"
                }`}
              >
                {analysis.content_match === true ? (
                  <>
                    <Sparkles className="w-3.5 h-3.5 inline mr-1" />
                    <strong>임베딩 절감 가능</strong> — 내용이 동일하므로 재처리 시
                    Gemini 호출이 0회입니다. &quot;내용 갱신&quot; 선택 시 청크 삭제
                    후 동일 결과로 재적재됩니다.
                  </>
                ) : analysis.content_match === false ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                    <strong>재청킹 필요</strong> — 내용이 변경되어 기존 청크{" "}
                    {analysis.existing_chunk_count.toLocaleString()}개 삭제 후 약{" "}
                    {analysis.estimated_new_chunk_count.toLocaleString()}개로 새로
                    적재됩니다.
                  </>
                ) : (
                  <>
                    <HelpCircle className="w-3.5 h-3.5 inline mr-1" />
                    기존 IngestionJob hash 가 없어 비교 불가 (구버전 데이터).
                    &quot;내용 갱신&quot; 으로 새로 적재 권장.
                  </>
                )}
              </div>
            )}

            <div className="text-sm text-muted-foreground leading-relaxed">
              아래 옵션을 선택하세요. 기본은 <span className="font-medium text-foreground">내용 갱신 (분류 유지)</span>로,
              기존 분류(<span className="font-medium text-foreground">{existingSourcesLabel}</span>)에 이번 업로드 분류
              (<span className="font-medium text-foreground">{targetLabel}</span>)를 합쳐{" "}
              <span className="font-medium text-foreground">{mergedPreview}</span>로 적재됩니다.
            </div>

            {/* 스크린 리더 알림 */}
            <div className="sr-only" aria-live="polite">
              {analysis?.content_match === true
                ? "내용 동일 — hash 일치, 임베딩 절감 가능"
                : analysis?.content_match === false
                  ? `내용 변경 감지 — 청크 수 ${analysis.estimated_new_chunk_count}개로 변동`
                  : ""}
            </div>
          </div>

          {/* 액션 — ADR-30 결정 매트릭스. 분석 후 권장 액션은 ring 강조. */}
          <div className="flex flex-col gap-2 border-t px-6 py-4">
            <Button
              variant="default"
              autoFocus
              className={`w-full justify-center whitespace-normal break-words text-left ${
                analysis?.content_match === true
                  ? "ring-2 ring-emerald-300 ring-offset-2"
                  : ""
              }`}
              onClick={() => decide("merge")}
            >
              {analysis?.content_match === true && (
                <Sparkles className="w-4 h-4 mr-1.5 shrink-0" />
              )}
              내용 갱신 (분류 유지: {mergedPreview})
              {analysis?.content_match === true && (
                <span className="ml-1 text-xs opacity-90">— 권장</span>
              )}
            </Button>
            {canAddTag && (
              <Button
                variant="outline"
                className="w-full justify-center whitespace-normal break-words"
                onClick={() => decide("add-tag")}
              >
                임베딩 없이 &quot;{targetSource}&quot; 태그만 추가
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full justify-center whitespace-normal break-words border-amber-300 text-amber-700 hover:bg-amber-50"
              aria-describedby="replace-warning-text"
              onClick={() => decide("replace")}
            >
              덮어쓰기 (분류를 &quot;{targetLabel}&quot;로 교체)
            </Button>
            <span id="replace-warning-text" className="sr-only">
              위험: 기존 분류가 사라지고 신규 분류로 통째 교체됩니다.
            </span>
            <Button
              variant="ghost"
              className="w-full justify-center"
              onClick={() => decide("cancel")}
            >
              취소
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
