"use client";

import { useCallback, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataAPI, dataSourceCategoryAPI, type OnDuplicateMode } from "@/features/data-source/api";
import { useActiveCategories } from "@/features/data-source/hooks";
import DuplicateConfirmDialog, {
  type DuplicateDecision,
} from "@/features/data-source/components/duplicate-confirm-dialog";
import BulkPrecheckDialog, {
  type BulkPrecheckEntry,
} from "@/features/data-source/components/bulk-precheck-dialog";
import type {
  DuplicateCheckResponse,
  PredictedOutcome,
  UploadResponse,
} from "@/features/data-source/types";
import { fetchAPI } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Upload,
  FileText,
  Database,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
  FolderOpen,
  Clock,
  ArrowUpFromLine,
  RotateCcw,
} from "lucide-react";
import CategoryTab from "./category-tab";

interface PendingFile {
  id: string;
  file: File;
  source: string;
  status: "pending" | "uploading" | "processing";
}

export default function DataSourcesPage() {
  const queryClient = useQueryClient();
  const { data: categories = [] } = useActiveCategories();
  const [dragActive, setDragActive] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [activeTab, setActiveTab] = useState<"upload" | "categories">("upload");
  // Batch API 처리 방식은 PR #95 에서 제거됨. 항상 standard 로 호출 (인자 호환).
  const mode = "standard" as const;
  // ADR-30 follow-up: 일괄 업로드 시 이미 적재된 파일은 건너뛰는 skip 모드 토글.
  // 단건 업로드(파일 1개)는 dialog가 사용자 선택을 받으므로 이 토글의 영향을 받지 않는다.
  const [bulkSkipMode, setBulkSkipMode] = useState(false);

  // 중복 업로드 확인 다이얼로그 상태
  const [duplicateDialog, setDuplicateDialog] = useState<{
    open: boolean;
    pendingFile: PendingFile | null;
    duplicate: DuplicateCheckResponse | null;
  }>({ open: false, pendingFile: null, duplicate: null });

  // ADR-30 follow-up: 일괄 업로드 사전 검사 다이얼로그.
  // BUG-A 해결 — uploadAll 진입 시 모든 파일을 병렬 checkDuplicate 후 한 번에 정책 결정.
  const [bulkPrecheckDialog, setBulkPrecheckDialog] = useState<{
    open: boolean;
    files: PendingFile[];
    duplicates: BulkPrecheckEntry[];
    newCount: number;
  }>({ open: false, files: [], duplicates: [], newCount: 0 });

  // Gemini 티어 조회 (유료 전용 배치 모드 활성화 여부)
  // Batch API 제거 (PR #95) 후 gemini_tier 기반 UI 분기 미사용.
  const defaultSource = "";

  const hasProcessing = pendingFiles.some((f) => f.status === "processing");
  const { data: status } = useQuery({
    queryKey: ["ingest-status"],
    queryFn: dataAPI.getStatus,
    // 처리 중 파일이 있을 때만 5초 폴링. 없으면 OFF (페이지 진입 시 1회만)
    refetchInterval: hasProcessing ? 5000 : false,
  });

  // 처리 현황 데이터
  const completedEntries = useMemo(
    () => Object.entries(status?.completed ?? {}).reverse(),
    [status?.completed]
  );
  const failedEntries = useMemo(
    () => Object.entries(status?.failed ?? {}),
    [status?.failed]
  );
  const inProgressEntries = useMemo(
    () => Object.entries(status?.in_progress ?? {}),
    [status?.in_progress]
  );

  const processingFiles = pendingFiles.filter((f) => f.status === "processing");

  // 통계
  const totalFiles = (status?.summary?.completed_count ?? 0) + (status?.summary?.failed_count ?? 0);
  const totalChunks = status?.summary?.total_chunks ?? 0;
  const completedCount = status?.summary?.completed_count ?? 0;
  const failedCount = status?.summary?.failed_count ?? 0;

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const allowed = [".txt", ".pdf", ".docx"];
      const newPending: PendingFile[] = [];

      for (const file of Array.from(files)) {
        const ext = "." + (file.name.split(".").pop()?.toLowerCase() ?? "");
        if (!allowed.includes(ext)) {
          toast.error(`${file.name}: TXT, PDF, DOCX만 지원합니다`);
          continue;
        }
        newPending.push({
          id: crypto.randomUUID(),
          file,
          source: defaultSource,
          status: "pending",
        });
      }

      if (newPending.length > 0) {
        setPendingFiles((prev) => [...prev, ...newPending]);
      }
    },
    [defaultSource]
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files?.length) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      addFiles(e.target.files);
      e.target.value = "";
    }
  };

  const updateSource = (id: string, source: string) => {
    setPendingFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, source } : f))
    );
  };

  const removePending = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const performUpload = async (
    pf: PendingFile,
    onDuplicate: OnDuplicateMode = "merge",
    options: { silent?: boolean } = {},
  ): Promise<UploadResponse | null> => {
    setPendingFiles((prev) =>
      prev.map((f) => (f.id === pf.id ? { ...f, status: "uploading" as const } : f))
    );
    try {
      const res = await dataAPI.uploadFile(pf.file, pf.source, mode, onDuplicate);
      // 업로드 성공 → "처리 중" 상태로 변경
      setPendingFiles((prev) =>
        prev.map((f) =>
          f.id === pf.id ? { ...f, status: "processing" as const } : f
        )
      );
      // ADR-30 follow-up: 일괄 업로드는 끝에 통계 토스트 1회만 표시 (BUG-C 픽스).
      if (!options.silent) {
        toast.success(`${pf.file.name} 업로드 완료, 백그라운드 처리 시작`);
      }
      queryClient.invalidateQueries({ queryKey: ["ingest-status"] });
      queryClient.invalidateQueries({ queryKey: ["category-stats"] });
      queryClient.invalidateQueries({ queryKey: ["all-volumes"] });
      // 10초 후 processing 상태 제거 (status 폴링이 처리 결과를 가져옴)
      setTimeout(() => {
        setPendingFiles((prev) => prev.filter((f) => f.id !== pf.id));
      }, 10000);
      return res;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `${pf.file.name} 업로드 실패`
      );
      setPendingFiles((prev) =>
        prev.map((f) => (f.id === pf.id ? { ...f, status: "pending" as const } : f))
      );
      return null;
    }
  };

  const uploadOne = async (
    pf: PendingFile,
    onDuplicate: OnDuplicateMode = "merge",
  ): Promise<UploadResponse | null> => {
    // 1. 업로드 전 중복 검사
    try {
      const dup = await dataAPI.checkDuplicate(pf.file.name);
      if (dup.exists) {
        // ADR-30: 일괄 업로드(onDuplicate=skip 등 명시적 정책 전달)는 모달 우회.
        // 단건(default merge)일 때만 사용자 의사 확인 모달을 띄운다.
        if (onDuplicate === "merge") {
          setDuplicateDialog({ open: true, pendingFile: pf, duplicate: dup });
          return null;
        }
      }
    } catch (err) {
      // 중복 검사 실패는 업로드를 막지 않음 (경고만 토스트)
      console.warn("중복 검사 실패, 그대로 진행", err);
    }
    // 2. 중복 없거나 일괄 정책 명시 → 그대로 업로드
    return await performUpload(pf, onDuplicate);
  };

  const handleDuplicateDecision = async (decision: DuplicateDecision) => {
    const { pendingFile, duplicate } = duplicateDialog;
    if (!pendingFile || !duplicate) return;

    if (decision === "cancel") {
      // 대기 상태 유지 — 사용자가 다시 업로드 버튼 누를 수 있도록
      return;
    }

    // ADR-30: merge / replace 는 backend on_duplicate 파라미터로 그대로 전달.
    if (decision === "merge" || decision === "replace") {
      await performUpload(pendingFile, decision);
      return;
    }

    if (decision === "add-tag") {
      if (!pendingFile.source) {
        toast.error("태그 추가는 카테고리 선택이 필요합니다");
        return;
      }
      try {
        await dataSourceCategoryAPI.addVolumeTag({
          volume: duplicate.volume_key,
          source: pendingFile.source,
        });
        toast.success(
          `${pendingFile.file.name}에 "${pendingFile.source}" 태그 추가 완료`
        );
        setPendingFiles((prev) => prev.filter((f) => f.id !== pendingFile.id));
        queryClient.invalidateQueries({ queryKey: ["category-stats"] });
        queryClient.invalidateQueries({ queryKey: ["all-volumes"] });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "태그 추가 실패");
      }
    }
  };

  // ADR-30 follow-up — 일괄 업로드 실제 실행 (사전 검사 후 호출).
  // 단건 dialog 우회 + silent 토스트 + 끝에 1회만 통계 토스트.
  const runBulkUpload = async (
    files: PendingFile[],
    policy: OnDuplicateMode,
  ) => {
    const stats: Record<PredictedOutcome, number> = {
      new: 0,
      merge: 0,
      replace: 0,
      skip: 0,
    };
    let attempted = 0;
    let failed = 0;
    for (const pf of files) {
      const res = await performUpload(pf, policy, { silent: true });
      attempted += 1;
      if (res) {
        stats[res.predicted_outcome] += 1;
      } else {
        failed += 1;
      }
    }
    const failedSuffix = failed > 0 ? ` · 실패 ${failed}` : "";
    toast.success(
      `일괄 업로드 (${attempted}개): 신규 ${stats.new} · 병합 ${stats.merge} · 덮어쓰기 ${stats.replace} · 스킵 ${stats.skip}${failedSuffix}`,
    );
  };

  const uploadAll = async () => {
    const toUpload = pendingFiles.filter((f) => f.status === "pending");
    if (toUpload.length === 0) return;

    // ADR-30 follow-up: 모든 파일을 병렬 사전 검사. BUG-A(단건 dialog 충돌) 해결의 핵심.
    const checks = await Promise.all(
      toUpload.map(async (pf) => {
        try {
          const dup = await dataAPI.checkDuplicate(pf.file.name);
          return { pf, dup: dup.exists ? dup : null };
        } catch (err) {
          console.warn("checkDuplicate 실패, 신규로 간주", pf.file.name, err);
          return { pf, dup: null };
        }
      }),
    );

    const duplicates: BulkPrecheckEntry[] = checks
      .filter((c) => c.dup !== null)
      .map((c) => ({ filename: c.pf.file.name, duplicate: c.dup! }));
    const newCount = checks.length - duplicates.length;

    // 중복 없으면 사용자 default 정책으로 바로 일괄 적재.
    if (duplicates.length === 0) {
      await runBulkUpload(toUpload, bulkSkipMode ? "skip" : "merge");
      return;
    }

    // 중복 있으면 사전 검사 모달로 정책 결정 (단일 모달, 단건 dialog 우회).
    setBulkPrecheckDialog({
      open: true,
      files: toUpload,
      duplicates,
      newCount,
    });
  };

  const handleBulkPrecheckConfirm = async (policy: OnDuplicateMode) => {
    const files = bulkPrecheckDialog.files;
    setBulkPrecheckDialog({ open: false, files: [], duplicates: [], newCount: 0 });
    await runBulkUpload(files, policy);
  };

  const handleBulkPrecheckCancel = () => {
    setBulkPrecheckDialog({ open: false, files: [], duplicates: [], newCount: 0 });
  };

  const pendingCount = pendingFiles.filter((f) => f.status === "pending").length;
  const hasAnyUploading = pendingFiles.some((f) => f.status === "uploading");

  return (
    <div className="max-w-5xl space-y-6">
      {/* 중복 업로드 확인 다이얼로그 (단건) */}
      <DuplicateConfirmDialog
        open={duplicateDialog.open}
        onOpenChange={(open) =>
          setDuplicateDialog((prev) => ({ ...prev, open }))
        }
        filename={duplicateDialog.pendingFile?.file.name ?? ""}
        targetSource={duplicateDialog.pendingFile?.source ?? ""}
        duplicate={duplicateDialog.duplicate}
        onDecision={handleDuplicateDecision}
      />

      {/* ADR-30 follow-up — 일괄 업로드 사전 검사 다이얼로그 */}
      <BulkPrecheckDialog
        open={bulkPrecheckDialog.open}
        onOpenChange={(open) =>
          setBulkPrecheckDialog((prev) => ({ ...prev, open }))
        }
        newCount={bulkPrecheckDialog.newCount}
        duplicates={bulkPrecheckDialog.duplicates}
        defaultPolicy={bulkSkipMode ? "skip" : "merge"}
        onConfirm={handleBulkPrecheckConfirm}
        onCancel={handleBulkPrecheckCancel}
      />

      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">데이터 소스</h1>
        <p className="text-sm text-muted-foreground mt-1">
          RAG 파이프라인에 문서를 업로드하고 임베딩 상태를 관리합니다
        </p>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">총 파일</span>
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold mt-1">{totalFiles}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">생성 청크</span>
            <Database className="w-3.5 h-3.5 text-primary" />
          </div>
          <p className="text-2xl font-bold mt-1 text-primary">
            {totalChunks.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">처리 완료</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold mt-1 text-emerald-600">
            {completedCount}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">실패</span>
            <AlertCircle
              className={`w-3.5 h-3.5 ${failedCount > 0 ? "text-destructive" : "text-muted-foreground"}`}
            />
          </div>
          <p
            className={`text-2xl font-bold mt-1 ${failedCount > 0 ? "text-destructive" : "text-muted-foreground"}`}
          >
            {failedCount}
          </p>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setActiveTab("upload")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "upload"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Upload className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
          문서 업로드
          {processingFiles.length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
              {processingFiles.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("categories")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "categories"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FolderOpen className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
          카테고리 관리
        </button>
      </div>

      {/* 탭 콘텐츠 */}
      {activeTab === "categories" ? (
        <CategoryTab />
      ) : (
        <div className="space-y-5">
          {/* 드래그 앤 드롭 영역 */}
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`relative flex h-36 flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all ${
              dragActive
                ? "border-primary bg-primary/5 scale-[1.01]"
                : "border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-accent/20"
            } cursor-pointer`}
          >
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 transition-colors ${
                dragActive ? "bg-primary/10" : "bg-muted"
              }`}
            >
              <ArrowUpFromLine
                className={`w-5 h-5 ${dragActive ? "text-primary" : "text-muted-foreground"}`}
              />
            </div>
            <p className="text-sm font-medium">
              파일을 드래그하거나 클릭하여 추가
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              TXT, PDF, DOCX · 최대 50MB
            </p>
            <input
              type="file"
              multiple
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={handleFileInput}
              accept=".txt,.pdf,.docx"
            />
          </div>

          {/* ADR-30 follow-up — 일괄 업로드 사전 검사 모달의 default 정책에 영향.
              Batch API 처리 방식은 PR #95 에서 제거됨 (polling 인프라 미완성).
              항상 즉시 처리(standard) 로 동작. */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={bulkSkipMode}
                onChange={(e) => setBulkSkipMode(e.target.checked)}
                className="accent-primary mt-0.5"
                aria-describedby="bulk-skip-mode-hint"
              />
              <span className="text-sm">
                일괄 업로드 default를 <strong>skip</strong>으로 설정
                <span
                  id="bulk-skip-mode-hint"
                  className="block text-xs text-muted-foreground"
                >
                  사전 검사 모달에서 권장 옵션이 skip으로 미리 선택됩니다 — 콘텐츠 동일 시 Gemini 호출 0회로 비용 절감.
                  단건 업로드는 별도 모달이 사용자 의사를 확인합니다.
                </span>
              </span>
            </label>
          </div>

          {/* 대기 목록 */}
          {pendingFiles.length > 0 && (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">
                    파일 목록
                  </span>
                  {pendingCount > 0 && (
                    <Badge variant="outline" className="text-xs">
                      대기 {pendingCount}
                    </Badge>
                  )}
                  {processingFiles.length > 0 && (
                    <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-0 text-xs">
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      처리 중 {processingFiles.length}
                    </Badge>
                  )}
                </div>
                {pendingCount >= 2 && (
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={hasAnyUploading}
                    onClick={uploadAll}
                  >
                    {hasAnyUploading ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Upload className="w-3 h-3 mr-1" />
                    )}
                    전체 업로드
                  </Button>
                )}
              </div>
              <div className="divide-y">
                {pendingFiles.map((pf) => (
                  <div
                    key={pf.id}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                      pf.status === "processing"
                        ? "bg-amber-50/50"
                        : pf.status === "uploading"
                          ? "bg-primary/5"
                          : "hover:bg-accent/30"
                    }`}
                  >
                    {/* 상태 아이콘 */}
                    {pf.status === "processing" ? (
                      <Clock className="w-4 h-4 text-amber-500 shrink-0 animate-pulse" />
                    ) : pf.status === "uploading" ? (
                      <Loader2 className="w-4 h-4 text-primary shrink-0 animate-spin" />
                    ) : (
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}

                    {/* 파일명 */}
                    <span
                      className="text-sm truncate flex-1 min-w-0"
                      title={pf.file.name}
                    >
                      {pf.file.name}
                    </span>

                    {/* 파일 크기 */}
                    <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                      {(pf.file.size / 1024).toFixed(0)}KB
                    </span>

                    {/* 상태 표시 */}
                    {pf.status === "processing" ? (
                      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-0 text-xs shrink-0">
                        처리 중...
                      </Badge>
                    ) : pf.status === "uploading" ? (
                      <Badge className="bg-primary/10 text-primary hover:bg-primary/10 border-0 text-xs shrink-0">
                        업로드 중
                      </Badge>
                    ) : (
                      <>
                        {/* 소스 선택 */}
                        <select
                          value={pf.source}
                          onChange={(e) => updateSource(pf.id, e.target.value)}
                          className="text-xs border rounded-md px-2 py-1.5 bg-background shrink-0 cursor-pointer"
                        >
                          <option value="">미분류 (선택 안함)</option>
                          {categories.map((cat) => (
                            <option key={cat.key} value={cat.key}>
                              {cat.name} ({cat.key})
                            </option>
                          ))}
                        </select>

                        {/* 업로드 버튼 */}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-xs shrink-0"
                          onClick={() => uploadOne(pf)}
                          title="업로드"
                        >
                          <Upload className="w-3 h-3" />
                        </Button>

                        {/* 삭제 버튼 */}
                        <button
                          type="button"
                          onClick={() => removePending(pf.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          title="제거"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 중단된 파일 — 재개 업로드 */}
          {inProgressEntries.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-amber-200 bg-amber-50/50 flex items-center gap-2">
                <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-xs font-medium text-amber-700">중단된 파일 — 재개 가능</span>
                <span className="text-xs text-amber-600/70">같은 파일을 다시 업로드하면 중단 지점부터 이어서 처리합니다</span>
              </div>
              <div className="divide-y divide-amber-100">
                {inProgressEntries.map(([filename, entry]) => {
                  const pct = Math.round((entry.next_chunk / entry.total) * 100);
                  return (
                    <div key={`inprogress-${filename}`} className="flex items-center gap-3 px-4 py-3">
                      <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate" title={filename}>{filename}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1.5 bg-amber-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-400 rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-amber-600 shrink-0">
                            {entry.next_chunk.toLocaleString()} / {entry.total.toLocaleString()} ({pct}%)
                          </span>
                        </div>
                      </div>
                      <label className="cursor-pointer">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 shrink-0 pointer-events-none"
                          tabIndex={-1}
                        >
                          <Upload className="w-3 h-3 mr-1" />
                          재개 업로드
                        </Button>
                        <input
                          type="file"
                          className="hidden"
                          accept=".txt,.pdf,.docx"
                          onChange={(e) => {
                            if (e.target.files?.length) {
                              addFiles(e.target.files);
                              e.target.value = "";
                            }
                          }}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 처리 이력 */}
          {(completedEntries.length > 0 || failedEntries.length > 0) && (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/30">
                <span className="text-xs font-medium">처리 이력</span>
                <span className="text-xs text-muted-foreground ml-2">
                  자동 갱신
                </span>
              </div>
              <div className="divide-y max-h-72 overflow-y-auto">
                {/* 실패 항목 (상단 표시) */}
                {failedEntries.map(([filename, error]) => (
                  <div
                    key={`fail-${filename}`}
                    className="flex items-center gap-3 px-4 py-3 bg-red-50/50"
                  >
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" title={filename}>
                        {filename}
                      </p>
                      <p className="text-xs text-destructive mt-0.5 truncate" title={String(error)}>
                        {String(error)}
                      </p>
                    </div>
                    <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-0 text-xs shrink-0">
                      실패
                    </Badge>
                  </div>
                ))}

                {/* 완료 항목 */}
                {completedEntries.slice(0, 20).map(([filename, chunks]) => (
                  <div
                    key={`done-${filename}`}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span
                      className="text-sm truncate flex-1 min-w-0"
                      title={filename}
                    >
                      {filename}
                    </span>
                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0 text-xs shrink-0">
                      {chunks}청크
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 빈 상태 */}
          {pendingFiles.length === 0 &&
            completedEntries.length === 0 &&
            failedEntries.length === 0 && (
              <div className="rounded-xl border bg-card flex flex-col items-center justify-center py-16 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Upload className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">아직 업로드된 문서가 없습니다</p>
                <p className="text-xs text-muted-foreground mt-1">
                  위 영역에 파일을 드래그하거나 클릭하여 시작하세요
                </p>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

// BatchJobList 컴포넌트는 PR #95 에서 제거됨 (Gemini Batch API 폴링 인프라
// 미완성으로 batch 결과 영구 미반영 결함 발견 → 즉시 처리 standard 단일 모드).
