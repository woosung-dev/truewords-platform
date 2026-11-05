// 임베딩 항목 전체 목록과 표시명 인라인 편집·영구 삭제를 제공하는 관리 컴포넌트.
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Database, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { StatusTone } from "@/components/status-badge";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dataAPI } from "@/features/data-source/api";
import { useIngestionJobs } from "@/features/data-source/hooks";
import type { IngestionJobInfo } from "@/features/data-source/types";
import DeleteConfirmDialog, { type DeleteTarget } from "./delete-confirm-dialog";
import { DisplayNameEditor } from "./display-name-editor";

const PAGE_SIZE = 20;

const JOB_STATUS_CONFIG: Record<string, { tone: StatusTone; label: string }> = {
  completed: { tone: "success", label: "완료" },
  failed: { tone: "danger", label: "실패" },
  running: { tone: "warning", label: "처리중" },
  partial: { tone: "warning", label: "처리중" },
};

function JobStatusBadge({ status }: { status: string }) {
  const { tone, label } = JOB_STATUS_CONFIG[status] ?? { tone: "neutral" as StatusTone, label: "대기" };
  return (
    <StatusBadge tone={tone} className="text-xs">
      {label}
    </StatusBadge>
  );
}

function DeleteJobButton({ job, onDelete }: { job: IngestionJobInfo; onDelete: (job: IngestionJobInfo) => void }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
      aria-label={`${job.filename} 영구 삭제`}
      title="파일 영구 삭제 (Qdrant + DB 모두)"
      onClick={() => onDelete(job)}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

function JobTableRow({ job, onDelete }: { job: IngestionJobInfo; onDelete: (job: IngestionJobInfo) => void }) {
  return (
    <TableRow>
      <TableCell className="max-w-[200px]">
        <span className="block truncate font-mono text-xs" title={job.filename}>
          {job.filename}
        </span>
      </TableCell>
      <TableCell className="min-w-[180px]">
        <DisplayNameEditor
          volumeKey={job.volume_key}
          initialValue={job.display_name ?? null}
          placeholder="표시명 미설정"
        />
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums">{(job.total_chunks ?? 0).toLocaleString()}</TableCell>
      <TableCell>
        <JobStatusBadge status={job.status} />
      </TableCell>
      <TableCell>
        <DeleteJobButton job={job} onDelete={onDelete} />
      </TableCell>
    </TableRow>
  );
}

function JobCard({ job, onDelete }: { job: IngestionJobInfo; onDelete: (job: IngestionJobInfo) => void }) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 truncate font-mono text-xs" title={job.filename}>
          {job.filename}
        </span>
        <JobStatusBadge status={job.status} />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{(job.total_chunks ?? 0).toLocaleString()}청크</span>
        <span className="ml-auto">
          <DeleteJobButton job={job} onDelete={onDelete} />
        </span>
      </div>
      <DisplayNameEditor
        volumeKey={job.volume_key}
        initialValue={job.display_name ?? null}
        placeholder="표시명 미설정"
      />
    </div>
  );
}

export function JobsManager() {
  const { data: jobs = [], isLoading } = useIngestionJobs();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openDelete = (job: IngestionJobInfo) => {
    // 미분류·실패 항목도 여기서 지울 수 있다. 분류 태그는 이 목록 응답에 없어 비워 둔다.
    setDeleteTarget({ volume: job.volume_key, sources: [], chunkCount: job.total_chunks ?? 0 });
  };

  const closeDelete = () => {
    setDeleteTarget(null);
    setDeleting(false);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await dataAPI.deleteVolume(deleteTarget.volume);
      const skipped = (res.skipped ?? []).length;
      toast.success(
        `파일 영구 삭제 완료 (총 ${(res.total_chunks_deleted ?? 0).toLocaleString()}개 청크${skipped > 0 ? ` · 스킵 ${skipped}` : ""})`,
      );
      for (const key of ["ingestion-jobs", "category-stats", "all-volumes", "ingest-status"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      closeDelete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "삭제 실패: 다시 시도해주세요");
      setDeleting(false);
    }
  };

  const filtered = useMemo(() => {
    // NFC 정규화: 맥OS NFD 파일명과 브라우저 NFC 입력 간 불일치 방지
    const q = search.trim().toLowerCase().normalize("NFC");
    if (!q) return jobs;
    return jobs.filter(
      (j) =>
        j.filename.normalize("NFC").toLowerCase().includes(q) ||
        (j.display_name ?? "").normalize("NFC").toLowerCase().includes(q),
    );
  }, [jobs, search]);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Card className="p-0 overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 border-b bg-admin-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">임베딩 항목 관리</span>
          {!isLoading && (
            <Badge variant="outline" className="text-xs">
              전체 {jobs.length.toLocaleString()}
            </Badge>
          )}
        </div>
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="파일명 또는 표시명 검색"
            className="h-7 pl-8 text-xs"
            aria-label="항목 검색"
          />
        </div>
      </div>

      {/* 로딩 스켈레톤 */}
      {isLoading && (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {/* 빈 상태 */}
      {!isLoading && filtered.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {search ? `"${search}" 검색 결과 없음` : "적재된 항목이 없습니다"}
          </p>
        </div>
      )}

      {/* 데스크톱 테이블 */}
      {!isLoading && paginated.length > 0 && (
        <>
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">파일명</TableHead>
                  <TableHead>표시명</TableHead>
                  <TableHead className="w-[80px] text-right">청크</TableHead>
                  <TableHead className="w-[80px]">상태</TableHead>
                  <TableHead className="w-[48px]">
                    <span className="sr-only">삭제</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((job) => (
                  <JobTableRow key={job.volume_key} job={job} onDelete={openDelete} />
                ))}
              </TableBody>
            </Table>
          </div>

          {/* 모바일 카드 목록 */}
          <div className="space-y-2 p-3 sm:hidden">
            {paginated.map((job) => (
              <JobCard key={job.volume_key} job={job} onDelete={openDelete} />
            ))}
          </div>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs text-muted-foreground">
              <span>
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} / {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  aria-label="이전 페이지"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-2">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  aria-label="다음 페이지"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeDelete();
        }}
        targets={deleteTarget ? [deleteTarget] : []}
        busy={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={closeDelete}
      />
    </Card>
  );
}
