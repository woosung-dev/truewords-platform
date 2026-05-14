import { useCallback, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  dataAPI,
  dataSourceCategoryAPI,
  type OnDuplicateMode,
} from "./api";
import type {
  DataSourceCategory,
  CategoryDocumentStats,
  DuplicateCheckResponse,
  IngestionJobInfo,
  PredictedOutcome,
  UploadResponse,
  VolumeTagRequest,
  VolumeInfo,
  VolumeTagsBulkRequest,
} from "./types";
import type { BulkPrecheckEntry } from "./components/bulk-precheck-dialog";
import type { DuplicateDecision } from "./components/duplicate-confirm-dialog";

export function useDataSourceCategories() {
  return useQuery({
    queryKey: ["data-source-categories"],
    queryFn: dataSourceCategoryAPI.list,
    staleTime: 5 * 60 * 1000, // 5분 캐시
  });
}

export function useActiveCategories() {
  const query = useDataSourceCategories();
  return {
    ...query,
    data: query.data?.filter((c: DataSourceCategory) => c.is_active),
  };
}

export function useSearchableCategories() {
  const query = useDataSourceCategories();
  return {
    ...query,
    data: query.data?.filter((c: DataSourceCategory) => c.is_searchable && c.is_active),
  };
}

export function useCategoryStats() {
  return useQuery<CategoryDocumentStats[]>({
    queryKey: ["category-stats"],
    queryFn: dataSourceCategoryAPI.getCategoryStats,
    staleTime: 60_000, // 60초 캐시
  });
}

export function useAddVolumeTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: VolumeTagRequest) => dataSourceCategoryAPI.addVolumeTag(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["category-stats"] });
    },
  });
}

export function useRemoveVolumeTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: VolumeTagRequest) => dataSourceCategoryAPI.removeVolumeTag(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["category-stats"] });
    },
  });
}

export function useAllVolumes() {
  return useQuery<VolumeInfo[]>({
    queryKey: ["all-volumes"],
    queryFn: dataSourceCategoryAPI.getAllVolumes,
    staleTime: 60_000,
  });
}

export function useAddVolumeTagsBulk() {
  return useMutation({
    mutationFn: (data: VolumeTagsBulkRequest) =>
      dataSourceCategoryAPI.addVolumeTagsBulk(data),
  });
}

export function useRemoveVolumeTagsBulk() {
  return useMutation({
    mutationFn: (data: VolumeTagsBulkRequest) =>
      dataSourceCategoryAPI.removeVolumeTagsBulk(data),
  });
}

export function useIngestionJobs() {
  return useQuery<IngestionJobInfo[]>({
    queryKey: ["ingestion-jobs"],
    queryFn: dataAPI.getJobs,
    staleTime: 30_000,
  });
}

// 적재 처리 방식은 PR #95 이후 항상 standard. 상수로 고정.
const UPLOAD_MODE = "standard" as const;

export interface PendingFile {
  id: string;
  file: File;
  source: string;
  status: "pending" | "uploading" | "processing";
}

export interface DuplicateDialogState {
  open: boolean;
  pendingFile: PendingFile | null;
  duplicate: DuplicateCheckResponse | null;
}

export interface BulkPrecheckDialogState {
  open: boolean;
  files: PendingFile[];
  duplicates: BulkPrecheckEntry[];
  newCount: number;
}

/**
 * 데이터 소스 업로드 워크플로우 상태머신.
 *
 * - 파일 추가/소스 편집/제거 (addFiles, updateSource, removePending)
 * - 단건 업로드 (uploadOne) — 중복 시 단건 dialog open
 * - 일괄 업로드 (uploadAll) — Promise.all 사전 검사 → 정책 결정 모달 → runBulkUpload
 * - 사용자 의사결정 핸들러 (handleDuplicateDecision, handleBulkPrecheck*)
 */
export function useDocumentUploadWorkflow() {
  const queryClient = useQueryClient();
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  // ADR-30 follow-up: 일괄 업로드 시 이미 적재된 파일은 건너뛰는 skip 모드 토글.
  // 단건 업로드(파일 1개)는 dialog가 사용자 선택을 받으므로 이 토글의 영향을 받지 않는다.
  const [bulkSkipMode, setBulkSkipMode] = useState(false);
  const [duplicateDialog, setDuplicateDialog] = useState<DuplicateDialogState>({
    open: false,
    pendingFile: null,
    duplicate: null,
  });
  // ADR-30 follow-up: 일괄 업로드 사전 검사 다이얼로그.
  // BUG-A 해결 — uploadAll 진입 시 모든 파일을 병렬 checkDuplicate 후 한 번에 정책 결정.
  const [bulkPrecheckDialog, setBulkPrecheckDialog] =
    useState<BulkPrecheckDialogState>({
      open: false,
      files: [],
      duplicates: [],
      newCount: 0,
    });

  const addFiles = useCallback((files: FileList | File[]) => {
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
        source: "",
        status: "pending",
      });
    }

    if (newPending.length > 0) {
      setPendingFiles((prev) => [...prev, ...newPending]);
    }
  }, []);

  const updateSource = useCallback((id: string, source: string) => {
    setPendingFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, source } : f)),
    );
  }, []);

  const removePending = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const performUpload = useCallback(
    async (
      pf: PendingFile,
      onDuplicate: OnDuplicateMode = "merge",
      options: { silent?: boolean } = {},
    ): Promise<UploadResponse | null> => {
      setPendingFiles((prev) =>
        prev.map((f) =>
          f.id === pf.id ? { ...f, status: "uploading" as const } : f,
        ),
      );
      try {
        const res = await dataAPI.uploadFile(pf.file, pf.source, UPLOAD_MODE, onDuplicate);
        // 업로드 성공 → "처리 중" 상태로 변경
        setPendingFiles((prev) =>
          prev.map((f) =>
            f.id === pf.id ? { ...f, status: "processing" as const } : f,
          ),
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
          err instanceof Error ? err.message : `${pf.file.name} 업로드 실패`,
        );
        setPendingFiles((prev) =>
          prev.map((f) =>
            f.id === pf.id ? { ...f, status: "pending" as const } : f,
          ),
        );
        return null;
      }
    },
    [queryClient],
  );

  const uploadOne = useCallback(
    async (
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
    },
    [performUpload],
  );

  const handleDuplicateDecision = useCallback(
    async (decision: DuplicateDecision) => {
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
            `${pendingFile.file.name}에 "${pendingFile.source}" 태그 추가 완료`,
          );
          setPendingFiles((prev) => prev.filter((f) => f.id !== pendingFile.id));
          queryClient.invalidateQueries({ queryKey: ["category-stats"] });
          queryClient.invalidateQueries({ queryKey: ["all-volumes"] });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "태그 추가 실패");
        }
      }
    },
    [duplicateDialog, performUpload, queryClient],
  );

  // ADR-30 follow-up — 일괄 업로드 실제 실행 (사전 검사 후 호출).
  // 단건 dialog 우회 + silent 토스트 + 끝에 1회만 통계 토스트.
  const runBulkUpload = useCallback(
    async (files: PendingFile[], policy: OnDuplicateMode) => {
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
    },
    [performUpload],
  );

  const uploadAll = useCallback(async () => {
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
  }, [pendingFiles, bulkSkipMode, runBulkUpload]);

  const handleBulkPrecheckConfirm = useCallback(
    async (policy: OnDuplicateMode) => {
      const files = bulkPrecheckDialog.files;
      setBulkPrecheckDialog({ open: false, files: [], duplicates: [], newCount: 0 });
      await runBulkUpload(files, policy);
    },
    [bulkPrecheckDialog.files, runBulkUpload],
  );

  const handleBulkPrecheckCancel = useCallback(() => {
    setBulkPrecheckDialog({ open: false, files: [], duplicates: [], newCount: 0 });
  }, []);

  const pendingCount = pendingFiles.filter((f) => f.status === "pending").length;
  const hasAnyUploading = pendingFiles.some((f) => f.status === "uploading");
  const hasProcessing = pendingFiles.some((f) => f.status === "processing");
  const processingFiles = pendingFiles.filter((f) => f.status === "processing");

  return {
    pendingFiles,
    duplicateDialog,
    setDuplicateDialog,
    bulkPrecheckDialog,
    setBulkPrecheckDialog,
    bulkSkipMode,
    setBulkSkipMode,
    addFiles,
    updateSource,
    removePending,
    uploadOne,
    uploadAll,
    handleDuplicateDecision,
    handleBulkPrecheckConfirm,
    handleBulkPrecheckCancel,
    pendingCount,
    hasAnyUploading,
    hasProcessing,
    processingFiles,
  };
}
