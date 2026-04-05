"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataAPI } from "@/lib/api";
import { useDataSourceCategories } from "@/lib/hooks/use-data-source-categories";
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
} from "lucide-react";

interface PendingFile {
  id: string;
  file: File;
  source: string;
  uploading: boolean;
}

export default function DataSourcesPage() {
  const queryClient = useQueryClient();
  const { data: categories = [] } = useDataSourceCategories();
  const [dragActive, setDragActive] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);

  const defaultSource = categories[0]?.key ?? "";

  const { data: status } = useQuery({
    queryKey: ["ingest-status"],
    queryFn: dataAPI.getStatus,
    refetchInterval: 3000,
  });

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
          uploading: false,
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
      e.target.value = ""; // 같은 파일 재선택 허용
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

  const uploadOne = async (pf: PendingFile) => {
    setPendingFiles((prev) =>
      prev.map((f) => (f.id === pf.id ? { ...f, uploading: true } : f))
    );
    try {
      await dataAPI.uploadFile(pf.file, pf.source);
      toast.success(`${pf.file.name} 업로드 시작`);
      queryClient.invalidateQueries({ queryKey: ["ingest-status"] });
      setPendingFiles((prev) => prev.filter((f) => f.id !== pf.id));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `${pf.file.name} 업로드 실패`
      );
      setPendingFiles((prev) =>
        prev.map((f) => (f.id === pf.id ? { ...f, uploading: false } : f))
      );
    }
  };

  const uploadAll = async () => {
    const toUpload = pendingFiles.filter((f) => !f.uploading);
    for (const pf of toUpload) {
      await uploadOne(pf);
    }
  };

  const completedEntries = Object.entries(status?.completed ?? {});
  const failedEntries = Object.entries(status?.failed ?? {});
  const hasAnyUploading = pendingFiles.some((f) => f.uploading);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">데이터 소스</h1>
        <p className="text-sm text-muted-foreground mt-1">
          RAG 파이프라인에 문서를 업로드하고 임베딩 상태를 관리합니다
        </p>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileText className="w-3.5 h-3.5" />
            <span className="text-xs">총 파일</span>
          </div>
          <p className="text-2xl font-bold">
            {status?.summary.total_files ?? "—"}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Database className="w-3.5 h-3.5" />
            <span className="text-xs">생성 청크</span>
          </div>
          <p className="text-2xl font-bold text-primary">
            {status?.summary.total_chunks?.toLocaleString() ?? "—"}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="text-xs">처리 완료</span>
          </div>
          <p className="text-2xl font-bold text-emerald-600">
            {status?.summary.completed_count ?? "—"}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="text-xs">실패</span>
          </div>
          <p
            className={`text-2xl font-bold ${
              (status?.summary.failed_count ?? 0) > 0
                ? "text-destructive"
                : "text-muted-foreground"
            }`}
          >
            {status?.summary.failed_count ?? "—"}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 업로드 패널 */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div>
            <h3 className="font-semibold text-sm">문서 업로드</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              파일을 먼저 추가한 뒤, 분류를 확인하고 업로드하세요
            </p>
          </div>

          {/* 드래그 앤 드롭 영역 */}
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`relative flex h-32 flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all ${
              dragActive
                ? "border-primary bg-primary/5 scale-[1.01]"
                : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-accent/30"
            } cursor-pointer`}
          >
            <Upload
              className={`w-5 h-5 mb-1.5 transition-colors ${
                dragActive ? "text-primary" : "text-muted-foreground"
              }`}
            />
            <p className="text-sm font-medium">
              파일을 드래그하거나 클릭하여 추가
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
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

          {/* 대기 목록 */}
          {pendingFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                대기 중 ({pendingFiles.length}개)
              </p>
              <div className="space-y-1.5">
                {pendingFiles.map((pf) => (
                  <div
                    key={pf.id}
                    className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2"
                  >
                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span
                      className="text-xs truncate flex-1 min-w-0"
                      title={pf.file.name}
                    >
                      {pf.file.name}
                    </span>
                    <select
                      value={pf.source}
                      onChange={(e) => updateSource(pf.id, e.target.value)}
                      disabled={pf.uploading}
                      className="text-xs border rounded-md px-2 py-1 bg-background shrink-0"
                    >
                      {categories.map((cat) => (
                        <option key={cat.key} value={cat.key}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      disabled={pf.uploading}
                      onClick={() => uploadOne(pf)}
                    >
                      {pf.uploading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Upload className="w-3 h-3" />
                      )}
                    </Button>
                    <button
                      type="button"
                      onClick={() => removePending(pf.id)}
                      disabled={pf.uploading}
                      className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {pendingFiles.length >= 2 && (
                <Button
                  size="sm"
                  className="w-full"
                  disabled={hasAnyUploading}
                  onClick={uploadAll}
                >
                  {hasAnyUploading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      업로드 중...
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5 mr-1.5" />
                      전체 업로드 ({pendingFiles.length}개)
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* 처리 현황 패널 */}
        <div className="rounded-xl border bg-card p-5 space-y-5">
          <div>
            <h3 className="font-semibold text-sm">처리 현황</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              3초마다 자동 갱신
            </p>
          </div>

          {completedEntries.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                완료 ({completedEntries.length}개)
              </p>
              <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                {completedEntries
                  .reverse()
                  .slice(0, 15)
                  .map(([filename, chunks]) => (
                    <div
                      key={filename}
                      className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2"
                    >
                      <span
                        className="text-xs text-emerald-800 truncate"
                        title={filename}
                      >
                        {filename}
                      </span>
                      <Badge className="shrink-0 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0 text-xs">
                        {chunks}청크
                      </Badge>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {failedEntries.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-destructive uppercase tracking-wider">
                실패 ({failedEntries.length}개)
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                {failedEntries.map(([filename, error]) => (
                  <div
                    key={filename}
                    className="rounded-lg bg-red-50 border border-red-100 px-3 py-2"
                  >
                    <p
                      className="text-xs font-medium text-red-800 truncate"
                      title={filename}
                    >
                      {filename}
                    </p>
                    <p className="text-xs text-red-600 mt-0.5 break-all">
                      {error}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {completedEntries.length === 0 && failedEntries.length === 0 && (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              <p className="text-sm">처리된 파일이 없습니다</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
