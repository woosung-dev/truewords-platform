"use client";

import { useCallback } from "react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataAPI } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, Database, AlertCircle, CheckCircle2 } from "lucide-react";

const DATA_SOURCES = [
  {
    value: "A",
    label: "말씀선집",
    desc: "615권 텍스트 데이터",
    color: "text-indigo-600 bg-indigo-50 border-indigo-200",
    activeRing: "ring-2 ring-indigo-500 border-indigo-500",
  },
  {
    value: "B",
    label: "어머니말씀",
    desc: "주요 어록 및 연설",
    color: "text-violet-600 bg-violet-50 border-violet-200",
    activeRing: "ring-2 ring-violet-500 border-violet-500",
  },
  {
    value: "C",
    label: "원리강론",
    desc: "기본 교리서",
    color: "text-blue-600 bg-blue-50 border-blue-200",
    activeRing: "ring-2 ring-blue-500 border-blue-500",
  },
  {
    value: "D",
    label: "용어사전",
    desc: "동적 프롬프트 인젝션용",
    color: "text-slate-500 bg-slate-50 border-slate-200",
    activeRing: "ring-2 ring-slate-400 border-slate-400",
  },
] as const;

export default function DataSourcesPage() {
  const queryClient = useQueryClient();
  const [selectedSource, setSelectedSource] = useState<string>("A");
  const [dragActive, setDragActive] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["ingest-status"],
    queryFn: dataAPI.getStatus,
    refetchInterval: 3000,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => dataAPI.uploadFile(file, selectedSource),
    onSuccess: () => {
      toast.success("업로드 시작 — 백그라운드에서 처리됩니다");
      queryClient.invalidateQueries({ queryKey: ["ingest-status"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "업로드 실패");
    },
  });

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
      if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedSource]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0]);
  };

  const handleFile = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["txt", "pdf", "docx"].includes(ext ?? "")) {
      toast.error("TXT, PDF, DOCX 파일만 업로드 가능합니다");
      return;
    }
    uploadMutation.mutate(file);
  };

  const isUploading = uploadMutation.isPending;
  const completedEntries = Object.entries(status?.completed ?? {});
  const failedEntries = Object.entries(status?.failed ?? {});

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
        <div className="rounded-xl border bg-card p-5 space-y-5">
          <div>
            <h3 className="font-semibold text-sm">문서 업로드</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              TXT, PDF, DOCX 지원 · 최대 50MB · HWP는 TXT 변환 후 업로드
            </p>
          </div>

          {/* 소스 선택 */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              대상 소스
            </label>
            <div className="grid grid-cols-2 gap-2">
              {DATA_SOURCES.map((s) => {
                const isSelected = selectedSource === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSelectedSource(s.value)}
                    className={`flex flex-col items-start rounded-lg border p-3 text-left transition-all ${
                      isSelected
                        ? `${s.activeRing} ${s.color}`
                        : "border-border hover:bg-accent/50"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span
                        className={`text-xs font-bold px-1.5 py-0.5 rounded-sm ${
                          isSelected ? "bg-white/60" : "bg-muted"
                        }`}
                      >
                        {s.value}
                      </span>
                      <span className="font-medium text-sm">{s.label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {s.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 드래그 앤 드롭 영역 */}
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`relative flex h-36 flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all ${
              dragActive
                ? "border-primary bg-primary/5 scale-[1.01]"
                : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-accent/30"
            } ${isUploading ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}
          >
            <Upload
              className={`w-6 h-6 mb-2 transition-colors ${
                dragActive ? "text-primary" : "text-muted-foreground"
              }`}
            />
            <p className="text-sm font-medium">
              {isUploading ? "업로드 중..." : "파일을 드래그하거나 클릭"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              선택된 소스: <span className="font-medium">{selectedSource}</span>
            </p>
            <input
              type="file"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={handleChange}
              accept=".txt,.pdf,.docx"
              disabled={isUploading}
            />
          </div>
        </div>

        {/* 처리 현황 패널 */}
        <div className="rounded-xl border bg-card p-5 space-y-5">
          <div>
            <h3 className="font-semibold text-sm">처리 현황</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              3초마다 자동 갱신
            </p>
          </div>

          {/* 성공 이력 */}
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

          {/* 실패 내역 */}
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
                    <p className="text-xs font-medium text-red-800 truncate" title={filename}>
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
