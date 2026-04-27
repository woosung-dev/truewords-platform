"use client";

import { useCallback, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataAPI, dataSourceCategoryAPI, type OnDuplicateMode } from "@/features/data-source/api";
import { useActiveCategories } from "@/features/data-source/hooks";
import DuplicateConfirmDialog, {
  type DuplicateDecision,
} from "@/features/data-source/components/duplicate-confirm-dialog";
import type { DuplicateCheckResponse } from "@/features/data-source/types";
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
  const [mode, setMode] = useState<"standard" | "batch">("standard");

  // 중복 업로드 확인 다이얼로그 상태
  const [duplicateDialog, setDuplicateDialog] = useState<{
    open: boolean;
    pendingFile: PendingFile | null;
    duplicate: DuplicateCheckResponse | null;
  }>({ open: false, pendingFile: null, duplicate: null });

  // Gemini 티어 조회 (유료 전용 배치 모드 활성화 여부)
  const { data: configData } = useQuery({
    queryKey: ["admin-config"],
    queryFn: () => fetchAPI<{ gemini_tier: string }>("/admin/settings/config"),
  });
  const isPaidTier = configData?.gemini_tier === "paid";

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

  const performUpload = async (pf: PendingFile, onDuplicate: OnDuplicateMode = "merge") => {
    setPendingFiles((prev) =>
      prev.map((f) => (f.id === pf.id ? { ...f, status: "uploading" as const } : f))
    );
    try {
      await dataAPI.uploadFile(pf.file, pf.source, mode, onDuplicate);
      // 업로드 성공 → "처리 중" 상태로 변경
      setPendingFiles((prev) =>
        prev.map((f) =>
          f.id === pf.id ? { ...f, status: "processing" as const } : f
        )
      );
      toast.success(`${pf.file.name} 업로드 완료, 백그라운드 처리 시작`);
      queryClient.invalidateQueries({ queryKey: ["ingest-status"] });
      queryClient.invalidateQueries({ queryKey: ["category-stats"] });
      queryClient.invalidateQueries({ queryKey: ["all-volumes"] });
      // 10초 후 processing 상태 제거 (status 폴링이 처리 결과를 가져옴)
      setTimeout(() => {
        setPendingFiles((prev) => prev.filter((f) => f.id !== pf.id));
      }, 10000);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `${pf.file.name} 업로드 실패`
      );
      setPendingFiles((prev) =>
        prev.map((f) => (f.id === pf.id ? { ...f, status: "pending" as const } : f))
      );
    }
  };

  const uploadOne = async (pf: PendingFile) => {
    // 1. 업로드 전 중복 검사
    try {
      const dup = await dataAPI.checkDuplicate(pf.file.name);
      if (dup.exists) {
        setDuplicateDialog({ open: true, pendingFile: pf, duplicate: dup });
        return;
      }
    } catch (err) {
      // 중복 검사 실패는 업로드를 막지 않음 (경고만 토스트)
      console.warn("중복 검사 실패, 그대로 진행", err);
    }
    // 2. 중복 없으면 바로 업로드
    await performUpload(pf);
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

  const uploadAll = async () => {
    const toUpload = pendingFiles.filter((f) => f.status === "pending");
    for (const pf of toUpload) {
      await uploadOne(pf);
    }
  };

  const pendingCount = pendingFiles.filter((f) => f.status === "pending").length;
  const hasAnyUploading = pendingFiles.some((f) => f.status === "uploading");

  return (
    <div className="max-w-5xl space-y-6">
      {/* 중복 업로드 확인 다이얼로그 */}
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

          {/* 처리 방식 선택 */}
          <div className="rounded-xl border bg-card p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">처리 방식</p>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="upload-mode"
                  value="standard"
                  checked={mode === "standard"}
                  onChange={() => setMode("standard")}
                  className="accent-primary"
                />
                <span className="text-sm">즉시 처리</span>
              </label>
              <label className={`flex items-center gap-2 ${!isPaidTier ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                <input
                  type="radio"
                  name="upload-mode"
                  value="batch"
                  checked={mode === "batch"}
                  onChange={() => isPaidTier && setMode("batch")}
                  disabled={!isPaidTier}
                  className="accent-primary"
                />
                <span className="text-sm">배치 처리 (50% 할인)</span>
                {!isPaidTier && (
                  <Badge variant="outline" className="text-xs">유료 전용</Badge>
                )}
              </label>
            </div>
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

          {/* 배치 작업 목록 */}
          <BatchJobList />

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

interface BatchJobItem {
  id: string;
  filename: string;
  total_chunks: number;
  status: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

function BatchJobList() {
  const { data: jobs = [] } = useQuery({
    queryKey: ["batch-jobs"],
    queryFn: () => fetchAPI<BatchJobItem[]>("/admin/data-sources/batch-jobs"),
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      const hasActive = data.some(
        (j: BatchJobItem) => j.status === "pending" || j.status === "processing"
      );
      return hasActive ? 10000 : false;
    },
  });

  if (jobs.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <h3 className="font-semibold text-sm">배치 작업</h3>
      <div className="space-y-2">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex items-center justify-between text-sm border-b pb-2 last:border-0"
          >
            <span className="truncate max-w-[200px]">{job.filename}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{job.total_chunks} 청크</span>
              <Badge
                variant={
                  job.status === "completed"
                    ? "default"
                    : job.status === "failed"
                      ? "destructive"
                      : "secondary"
                }
              >
                {job.status === "pending"
                  ? "대기 중"
                  : job.status === "processing"
                    ? "처리 중"
                    : job.status === "completed"
                      ? "완료"
                      : "실패"}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
