"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import type { JSONContent } from "@tiptap/react";
import type { SummaryMediaResponse } from "@truewords/api-client-ts/types";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { rightsAPI } from "@/features/hoondok/rights-api";
import { ApiError } from "@/lib/api";
import { summariesAPI, type SummaryInput, type SummaryAdminResponse, type SummaryTocItem } from "./api";
import { SummaryEditor, summaryExtensions } from "./editor";
import { SourcePicker } from "./source-picker";
import "./summaries.css";

type Status = "draft" | "review" | "published" | "withdrawn";
type ImageKind = "concept" | "scene";
const STATUS: Record<Status | "none", string> = {
  none: "콘텐츠 없음",
  draft: "초안",
  review: "검수 중",
  published: "공개",
  withdrawn: "내림",
};
// 발행 관리 트리·편집 화면이 같은 색으로 상태를 읽게 한다
const STATUS_TONE: Record<Status | "none", StatusTone> = {
  none: "neutral",
  draft: "info",
  review: "warning",
  published: "success",
  withdrawn: "danger",
};
const STATUS_ORDER: (Status | "none")[] = ["published", "review", "draft", "withdrawn", "none"];
const KIND_LABEL: Record<ImageKind, string> = { concept: "개념 그림", scene: "장면 그림" };
// 서버 값은 소문자지만 예전 값·대문자가 와도 같은 상태로 읽는다.
export function normalizeStatus(value: unknown): Status | "none" {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  return status in STATUS ? (status as Status | "none") : "draft";
}
const EMPTY: SummaryInput = {
  content_right_id: "",
  slug: "",
  group_title: "",
  position: undefined,
  title: "",
  lead: "",
  key_points: ["", "", ""],
  body: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "쉽게 풀어 읽기" }],
      },
      { type: "paragraph" },
    ],
  },
  evidence: [],
  reflection_questions: [""],
  uncertainty: [],
  source: {
    edition: "",
    locator: "",
    text: "",
    sha256: "",
    chunk_ids: [],
    verified: false,
  },
  images: [],
};
function payload(value: SummaryInput): SummaryInput {
  return {
    content_right_id: value.content_right_id,
    slug: value.slug,
    group_title: value.group_title ?? "",
    position: value.position,
    title: value.title,
    lead: value.lead ?? "",
    key_points: value.key_points ?? [],
    body: value.body ?? EMPTY.body,
    body_version: value.body_version ?? 1,
    source_range_id: value.source_range_id,
    source_range_version: value.source_range_version,
    evidence: value.evidence ?? [],
    reflection_questions: value.reflection_questions ?? [],
    uncertainty: value.uncertainty ?? [],
    source: value.source ?? EMPTY.source,
    images: value.images ?? [],
    ...(value.generation ? { generation: value.generation } : {}),
  };
}
// 이 탭에서 작성한 임시 값만 복구한다. 손상된 저장 값은 무시한다.
function isStoredDraft(value: unknown): value is SummaryInput {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  const source = data.source as Record<string, unknown> | undefined;
  const body = data.body as Record<string, unknown> | undefined;
  return (
    ["content_right_id", "slug", "group_title", "title", "lead"].every(
      (key) => typeof data[key] === "string",
    ) &&
    (data.position === undefined || (typeof data.position === "number" && Number.isFinite(data.position))) &&
    [data.key_points, data.reflection_questions, data.uncertainty].every(
      (list) => Array.isArray(list) && list.every((item) => typeof item === "string"),
    ) &&
    Array.isArray(data.evidence) &&
    !!body &&
    body.type === "doc" &&
    Array.isArray(body.content) &&
    !!source &&
    ["edition", "locator", "text", "sha256"].every((key) => typeof source[key] === "string") &&
    typeof source.verified === "boolean" &&
    Array.isArray(source.chunk_ids) &&
    source.chunk_ids.every((id) => typeof id === "string") &&
    Array.isArray(data.images) &&
    data.images.every(
      (image) =>
        image &&
        typeof image === "object" &&
        (image.kind === "concept" || image.kind === "scene") &&
        typeof image.asset_id === "string" &&
        typeof image.alt === "string" &&
        typeof image.caption === "string",
    )
  );
}
function isStoredRecord(value: unknown): value is SummaryAdminResponse {
  if (!isStoredDraft(value)) return false;
  const data = value as unknown as Record<string, unknown>;
  return (
    typeof data.id === "string" &&
    typeof data.version === "number" &&
    typeof data.review_status === "string" &&
    typeof data.published === "boolean" &&
    Array.isArray(data.assets) &&
    data.assets.every(
      (asset: unknown) =>
        !!asset &&
        typeof asset === "object" &&
        typeof (asset as Record<string, unknown>).id === "string" &&
        typeof (asset as Record<string, unknown>).url === "string",
    )
  );
}
function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return `${error.message} 편집 내용을 복사해 둔 뒤 최신 내용을 다시 불러와 주세요.`;
    if (error.status === 422) return `${error.message} 원문 위치·필수 입력값과 그림 설명을 확인해 주세요.`;
    return error.message;
  }
  return "저장하지 못했습니다. 입력 내용은 유지되어 있어요. 연결을 확인한 뒤 다시 시도해 주세요.";
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="summary-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function ListField({
  label,
  items,
  addLabel,
  onChange,
}: {
  label: string;
  items: string[];
  addLabel: string;
  onChange: (items: string[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      {items.map((item, index) => (
        <div className="flex gap-2" key={index}>
          <Input
            aria-label={`${label} ${index + 1}`}
            value={item}
            onChange={(e) => onChange(items.map((v, i) => (i === index ? e.target.value : v)))}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${label} ${index + 1} 삭제`}
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, ""])}>
        <Plus className="size-4" />
        {addLabel}
      </Button>
    </fieldset>
  );
}

function groupToc(rows: SummaryTocItem[]) {
  const pyeons = new Map<number, { title: string; jangs: Map<number, { title: string; rows: SummaryTocItem[] }> }>();
  for (const row of rows) {
    const pyeon = pyeons.get(row.pyeon_no) ?? { title: row.pyeon_title, jangs: new Map() };
    const jang = pyeon.jangs.get(row.jang_no) ?? { title: row.jang_title, rows: [] };
    jang.rows.push(row);
    pyeon.jangs.set(row.jang_no, jang);
    pyeons.set(row.pyeon_no, pyeon);
  }
  return pyeons;
}

export function SummaryList() {
  const query = useQuery({ queryKey: ["summary-admin", "toc"], queryFn: summariesAPI.toc });
  const [status, setStatus] = useState("");
  const [pyeon, setPyeon] = useState("");
  const [missing, setMissing] = useState("");
  const all = query.data ?? [];
  const pyeonOptions = Array.from(groupToc(all), ([no, item]) => ({ no, title: item.title }));
  const rows = all.filter(
    (row) =>
      (!status || normalizeStatus(row.status) === status) && (!pyeon || row.pyeon_no === Number(pyeon)),
  );
  const counts = all.reduce<Record<string, number>>((acc, row) => {
    const key = normalizeStatus(row.status);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="page-wide space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">천성경 AI 요약 발행 관리</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          천성경 {all.length || 199}절의 AI 요약 상태를 보고, 검수·공개·내리기를 관리합니다.
        </p>
      </header>
      <div className="flex flex-wrap items-end gap-4">
        <Field label="상태">
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">전체 상태</option>
            {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((key) => (
              <option key={key} value={key}>
                {STATUS[key]} ({counts[key] ?? 0})
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="편">
          <NativeSelect value={pyeon} onChange={(e) => setPyeon(e.target.value)}>
            <option value="">전체 편</option>
            {pyeonOptions.map((item) => (
              <option key={item.no} value={item.no}>
                제{item.no}편 {item.title}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <p className="pb-2 text-sm text-muted-foreground" aria-live="polite">
          {rows.length}절 표시
        </p>
      </div>
      {all.length > 0 && (
        <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="상태별 절 수">
          {STATUS_ORDER.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <dt>
                <StatusBadge tone={STATUS_TONE[key]}>{STATUS[key]}</StatusBadge>
              </dt>
              <dd className="font-medium tabular-nums">{counts[key] ?? 0}</dd>
            </div>
          ))}
        </dl>
      )}
      {query.isPending && <p role="status">발행 목록을 불러오고 있어요.</p>}
      {query.isError && (
        <div role="alert" className="space-y-3">
          <p>{message(query.error)}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            다시 불러오기
          </Button>
        </div>
      )}
      {Array.from(groupToc(rows), ([pyeonNo, pyeonItem]) => (
        <section key={pyeonNo} className="space-y-3" aria-label={`제${pyeonNo}편 ${pyeonItem.title}`}>
          <h2 className="text-lg font-semibold">
            제{pyeonNo}편 {pyeonItem.title}
          </h2>
          {Array.from(pyeonItem.jangs, ([jangNo, jang]) => (
            <div key={jangNo} className="overflow-hidden rounded-xl border bg-card">
              <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2">
                <h3 className="text-sm font-medium">
                  제{jangNo}장 {jang.title}
                </h3>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  공개 {jang.rows.filter((row) => normalizeStatus(row.status) === "published").length} /{" "}
                  {jang.rows.length}절
                </span>
              </div>
              <ul className="divide-y">
                {jang.rows.map((row) => {
                  const rowStatus = normalizeStatus(row.status);
                  const inner = (
                    <>
                      <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                        <span className="font-medium">
                          {row.jeol_no}절 {row.jeol_title}
                        </span>
                        <span className="ml-2 whitespace-nowrap text-xs text-muted-foreground">
                          말씀 {row.paragraph_count}개
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
                        <StatusBadge tone={STATUS_TONE[rowStatus]}>{STATUS[rowStatus]}</StatusBadge>
                        {row.published && rowStatus !== "published" && (
                          <StatusBadge tone="success">공개 중</StatusBadge>
                        )}
                        {row.unit_id && <span>그림 {row.image_count}장</span>}
                        {row.text_score != null && <span>점수 {row.text_score}</span>}
                        {row.updated_at && <span>{new Date(row.updated_at).toLocaleDateString("ko-KR")}</span>}
                      </span>
                    </>
                  );
                  return (
                    <li key={row.slug}>
                      {row.unit_id ? (
                        <Link
                          href={`/hoondok/summaries/${row.unit_id}/edit`}
                          className="flex min-h-11 flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="flex min-h-11 w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                          aria-describedby={missing === row.slug ? `missing-${row.slug}` : undefined}
                          onClick={() => setMissing(row.slug)}
                        >
                          {inner}
                        </button>
                      )}
                      {missing === row.slug && (
                        <p id={`missing-${row.slug}`} role="status" className="px-4 pb-3 text-sm text-muted-foreground">
                          콘텐츠 없음: 이 절의 AI 요약을 아직 가져오지 않았어요.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export function SummaryEditPage({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["summary-admin", id],
    queryFn: () => summariesAPI.get(id),
  });
  if (query.isPending) return <p role="status">요약을 불러오고 있어요.</p>;
  if (query.isError)
    return (
      <div role="alert">
        <p>{message(query.error)}</p>
        <Button onClick={() => void query.refetch()}>다시 불러오기</Button>
      </div>
    );
  return <SummaryForm initial={query.data} />;
}

export function SummaryForm({ initial }: { initial?: SummaryAdminResponse }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const rights = useQuery({
    queryKey: ["hoondok", "content-rights"],
    queryFn: rightsAPI.list,
  });
  const [values, setValues] = useState<SummaryInput>(() => (initial ? payload(initial) : structuredClone(EMPTY)));
  const [record, setRecord] = useState(initial);
  const recordRef = useRef(initial);

  const [assets, setAssets] = useState<SummaryMediaResponse[]>(initial?.assets ?? []);
  const [saved, setSaved] = useState(() => JSON.stringify(initial ? payload(initial) : EMPTY));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [mobile, setMobile] = useState(true);
  const [previewKind, setPreviewKind] = useState<ImageKind>("concept");
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const recoveryKey = `truewords:summary-draft:${initial?.id ?? "new"}:${initial?.version ?? 0}`;
  const dirty = JSON.stringify(values) !== saved;
  const selectedRight = rights.data?.find((right) => right.id === values.content_right_id);
  const initialId = initial?.id;
  const initialVersion = initial?.version;
  const initialRightId = initial?.content_right_id;
  const initialSlug = initial?.slug;
  useEffect(() => {
    const key = `truewords:summary-draft:${initialId ?? "new"}:${initialVersion ?? 0}`;
    try {
      const stored = window.sessionStorage.getItem(key);
      let candidate: unknown = null;
      try {
        const parsed: unknown = stored ? JSON.parse(stored) : null;
        const envelope = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
        candidate = envelope?.values ?? parsed;
        const recoveredRecord = envelope?.record;
        if (!initialId && isStoredDraft(candidate) && isStoredRecord(recoveredRecord)) {
          recordRef.current = recoveredRecord;
          // 서버 렌더에는 없는 탭 저장소를 마운트 후 한 번 복구한다.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setRecord(recoveredRecord);
          setAssets(recoveredRecord.assets);
          setSaved(JSON.stringify(payload(recoveredRecord)));
        }
      } catch {
        window.sessionStorage.removeItem(key);
      }
      if (
        isStoredDraft(candidate) &&
        (!initialId || (candidate.content_right_id === initialRightId && candidate.slug === initialSlug))
      ) {
        setValues(payload(candidate));

        setRecovered(true);
        setNotice("이 탭에서 작성하던 내용을 복구했습니다. 아직 서버에 저장하지 않은 내용입니다.");
      }
    } catch {
      setStorageUnavailable(true);
    }
    setRecoveryReady(true);
  }, [initialId, initialVersion, initialRightId, initialSlug]);
  useEffect(() => {
    if (!recoveryReady || storageUnavailable) return;
    try {
      if (dirty)
        window.sessionStorage.setItem(
          recoveryKey,
          JSON.stringify({ values: payload(values), record: record ? { ...record, assets } : undefined }),
        );
      else window.sessionStorage.removeItem(recoveryKey);
    } catch {
      // 외부 저장소의 실제 쓰기 실패를 표시하며 이후 쓰기 시도를 중단한다.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStorageUnavailable(true);
    }
  }, [values, record, assets, dirty, recoveryKey, recoveryReady, storageUnavailable]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const navigate = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (target && !window.confirm("저장하지 않은 변경 내용이 있어요. 이 페이지에서 나갈까요?"))
        event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
  function patch<K extends keyof SummaryInput>(key: K, value: SummaryInput[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setNotice("");
  }
  function sourcePatch(key: string, value: string | string[] | boolean) {
    setValues((current) => ({
      ...current,
      source: {
        ...current.source,
        [key]: value,
        sha256: "",
        ...(key !== "verified" && key !== "note" ? { verified: false } : {}),
      },
    }));
  }
  function apply(result: SummaryAdminResponse) {
    const next = payload(result);
    try {
      window.sessionStorage.removeItem(recoveryKey);
    } catch {
      /* 저장 차단 환경에서도 서버 저장은 유지한다. */
    }

    recordRef.current = result;
    setRecord(result);
    setValues(next);
    setSaved(JSON.stringify(next));
    setAssets(result.assets);
    queryClient.setQueryData(["summary-admin", result.id], result);
    void queryClient.invalidateQueries({ queryKey: ["summary-admin"] });
  }
  async function save() {
    if (!values.content_right_id) {
      setError("말씀 선택·변경에서 연결할 원문 범위를 먼저 선택해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = payload(values);
      const result = record
        ? await summariesAPI.update(record.id, {
            ...data,
            version: record.version,
          })
        : await summariesAPI.create(data);
      apply(result);
      setNotice("초안을 저장했습니다.");
      if (!initial) router.replace(`/hoondok/summaries/${result.id}/edit`);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function action(actionName: "request_review" | "return_to_draft" | "publish" | "withdraw") {
    if (!record || dirty) return;
    if (
      actionName === "withdraw" &&
      !window.confirm("이 요약을 내릴까요? 사용자 화면에서 요약과 그림을 볼 수 없게 됩니다.")
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      apply(
        await summariesAPI.action(record.id, {
          action: actionName,
          version: record.version,
        }),
      );
      setNotice(
        {
          request_review: "검수를 요청했습니다.",
          return_to_draft: "초안으로 되돌렸습니다.",
          publish: "요약을 공개했습니다.",
          withdraw: "요약을 내렸습니다.",
        }[actionName],
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function uploadAsset(file: File): Promise<SummaryMediaResponse> {
    let target = recordRef.current;
    if (!target) {
      if (!values.content_right_id || !values.title.trim()) throw new Error("말씀과 제목을 먼저 선택해 주세요.");
      target = await summariesAPI.create(payload(values));
      recordRef.current = target;
      setRecord(target);
      setSaved(JSON.stringify(payload(target)));
      // 업로드 중 추가로 입력한 제목·본문은 유지하고 서버 식별값만 반영한다.
      const created = target;
      setValues((current) => ({ ...current, slug: created.slug, position: created.position }));
    }
    const asset = await summariesAPI.upload(target.id, file);
    setAssets((current) => (current.some((a) => a.id === asset.id) ? current : [...current, asset]));
    return asset;
  }
  async function uploadImage(kind: ImageKind, file: File) {
    setBusy(true);
    setError("");
    try {
      const asset = await uploadAsset(file);
      setValues((current) => {
        const previous = (current.images ?? []).find((image) => image.kind === kind);
        return {
          ...current,
          images: [
            ...(current.images ?? []).filter((image) => image.kind !== kind),
            { kind, asset_id: asset.id, alt: previous?.alt ?? "", caption: previous?.caption ?? "" },
          ],
        };
      });
      setNotice(`${KIND_LABEL[kind]}을 바꿨습니다. 대체 텍스트를 확인한 뒤 초안을 저장해 주세요.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message(cause));
    } finally {
      setBusy(false);
    }
  }
  function patchImage(kind: ImageKind, key: "alt" | "caption", value: string) {
    patch(
      "images",
      (values.images ?? []).map((image) => (image.kind === kind ? { ...image, [key]: value } : image)),
    );
  }
  const images = values.images ?? [];
  const imageUrl = (kind: ImageKind) => {
    const image = images.find((item) => item.kind === kind);
    return image ? assets.find((asset) => asset.id === image.asset_id)?.url : undefined;
  };
  const previewImage = images.find((image) => image.kind === previewKind);
  const previewUrl = imageUrl(previewKind);
  const evidence = values.evidence ?? [];
  const status = record ? normalizeStatus(record.review_status) : null;
  const body = values.body as JSONContent;
  return (
    <div className="page-wide summary-d-workspace">
      <header className="summary-d-heading">
        <div>
          <Link href="/hoondok/summaries" className="text-sm text-muted-foreground underline underline-offset-4">
            AI 요약 목록
          </Link>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">{record ? "요약 편집" : "새 요약 작성"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            핵심 한 줄·요점·해설·근거·그림을 확인하고 검수·공개합니다.
          </p>
        </div>
        <Button variant="outline" onClick={() => setPreview(true)}>
          PC·모바일 미리보기
        </Button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="summary-editor-workspace summary-d-grid"
      >
        <div className="summary-d-document">
          <section className="summary-source-chip" aria-label="연결된 말씀">
            <div>
              <span className="text-xs text-muted-foreground">연결된 말씀</span>
              <p className="mt-1 font-medium">
                {selectedRight?.work_title || (values.source?.locator ? "선택한 말씀" : "아직 선택하지 않았어요")}
                {values.source?.locator ? ` / ${values.source.locator}` : ""}
              </p>
              {values.source?.text && (
                <p className="mt-2 line-clamp-2 text-xs leading-6 text-muted-foreground">{values.source.text}</p>
              )}
            </div>
            <SourcePicker
              contentRightId={values.content_right_id || undefined}
              lockBook={Boolean(record)}
              onApply={(range) => {
                if (record && range.content_right_id !== record.content_right_id) {
                  setError("작성 중인 책 안에서 말씀을 선택해 주세요.");
                  return;
                }
                setValues((current) => ({
                  ...current,
                  content_right_id: range.content_right_id,
                  source: range.source,
                  source_range_id: range.id,
                  source_range_version: range.version,
                  group_title: range.group_title || current.group_title,
                  title: current.title || range.title,
                }));
                setNotice("선택한 말씀 범위를 연결했습니다. 내용을 확인한 뒤 초안을 저장해 주세요.");
              }}
            />
          </section>
          <label className="sr-only" htmlFor="summary-title">
            제목
          </label>
          <textarea
            rows={2}
            id="summary-title"
            className="summary-d-title"
            required
            maxLength={200}
            value={values.title}
            placeholder="제목을 입력해 주세요"
            onChange={(e) => patch("title", e.target.value)}
          />
          <label className="sr-only" htmlFor="summary-lead">
            핵심 한 줄
          </label>
          <textarea
            id="summary-lead"
            className="summary-d-lead"
            value={values.lead ?? ""}
            rows={2}
            placeholder="이 절의 핵심을 한 줄로 적어 주세요"
            onChange={(e) => patch("lead", e.target.value)}
          />
          <section className="summary-editor-section space-y-4" aria-label="요점">
            <ListField
              label="요점"
              items={values.key_points ?? []}
              addLabel="요점 추가"
              onChange={(items) => patch("key_points", items)}
            />
          </section>
          <section className="summary-d-carousel" aria-label="그림">
            <h2 className="font-semibold">그림</h2>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              개념 그림과 장면 그림을 한 장씩 둡니다. 공개하려면 두 장 모두 대체 텍스트가 필요해요.
            </p>
            <div className="summary-d-cards">
              {(["concept", "scene"] as const).map((kind) => {
                const image = images.find((item) => item.kind === kind);
                const url = imageUrl(kind);
                return (
                  <div className="summary-d-card" key={kind}>
                    <h3 className="text-sm font-medium">{KIND_LABEL[kind]}</h3>
                    {url ? (
                      <Image unoptimized width={600} height={400} src={url} alt={image?.alt || `${KIND_LABEL[kind]} 미리보기`} />
                    ) : (
                      <p className="summary-d-empty">아직 그림이 없어요</p>
                    )}
                    <label className="summary-upload-button">
                      <ImagePlus className="size-4" />
                      {image ? "그림 교체" : "그림 올리기"}
                      <input
                        className="sr-only"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={busy}
                        aria-label={`${KIND_LABEL[kind]} 업로드`}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) void uploadImage(kind, file);
                        }}
                      />
                    </label>
                    {image && (
                      <>
                        <Field label={`${KIND_LABEL[kind]} 대체 텍스트`}>
                          <Input value={image.alt ?? ""} onChange={(e) => patchImage(kind, "alt", e.target.value)} />
                        </Field>
                        <Field label={`${KIND_LABEL[kind]} 캡션`}>
                          <textarea
                            className="summary-textarea"
                            rows={2}
                            value={image.caption ?? ""}
                            onChange={(e) => patchImage(kind, "caption", e.target.value)}
                          />
                        </Field>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          <SummaryEditor
            key={`${initialId ?? "new"}-${recovered}`}
            content={body}
            assets={assets}
            onUpload={uploadAsset}
            onChange={(next) => {
              patch("body", next);
              patch("body_version", 2);
            }}
          />
          <section className="summary-editor-section space-y-4" aria-label="근거 확인하기">
            <h2 className="font-semibold">근거 확인하기</h2>
            <p className="text-xs leading-6 text-muted-foreground">요약 문장마다 절 안의 말씀 번호 범위를 적어요.</p>
            {evidence.map((item, index) => (
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_80px_80px_auto]" key={index}>
                <Input
                  aria-label={`근거 ${index + 1} 문장`}
                  value={item.claim}
                  onChange={(e) =>
                    patch(
                      "evidence",
                      evidence.map((v, i) => (i === index ? { ...v, claim: e.target.value } : v)),
                    )
                  }
                />
                {(["from", "to"] as const).map((key) => (
                  <Input
                    key={key}
                    type="number"
                    min={1}
                    aria-label={`근거 ${index + 1} ${key === "from" ? "시작" : "끝"} 말씀 번호`}
                    value={item[key]}
                    onChange={(e) =>
                      patch(
                        "evidence",
                        evidence.map((v, i) => (i === index ? { ...v, [key]: Number(e.target.value) } : v)),
                      )
                    }
                  />
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`근거 ${index + 1} 삭제`}
                  onClick={() =>
                    patch(
                      "evidence",
                      evidence.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => patch("evidence", [...evidence, { claim: "", from: 1, to: 1 }])}
            >
              <Plus className="size-4" />
              근거 추가
            </Button>
          </section>
          <section className="summary-editor-section">
            <ListField
              label="되새길 물음"
              items={values.reflection_questions ?? []}
              addLabel="물음 추가"
              onChange={(items) => patch("reflection_questions", items)}
            />
          </section>
          <section className="summary-editor-section space-y-3" aria-label="확인 필요 (관리자 전용)">
            <ListField
              label="확인 필요 (관리자 전용)"
              items={values.uncertainty ?? []}
              addLabel="확인 사항 추가"
              onChange={(items) => patch("uncertainty", items)}
            />
            {values.generation && (
              <p className="text-xs leading-6 text-muted-foreground">
                생성 기록(관리자 전용): {values.generation.text_model || "모델 미기록"} · 글 점수{" "}
                {values.generation.text_score ?? 0} · 글 {values.generation.text_rounds ?? 0}회 · 그림 점수{" "}
                {Object.entries(values.generation.image_scores ?? {})
                  .map(([kind, score]) => `${KIND_LABEL[kind as ImageKind] ?? kind} ${score}`)
                  .join(", ") || "없음"}
              </p>
            )}
          </section>
        </div>
        <aside className="summary-d-settings" aria-label="게시글 설정">
          <h2 className="font-semibold">게시글 설정</h2>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <StatusBadge tone={status ? STATUS_TONE[status] : "neutral"}>{status ? STATUS[status] : "새 초안"}</StatusBadge>
            {record?.published && status !== "published" && <StatusBadge tone="success">이전 공개본 공개 중</StatusBadge>}
          </div>
          <p className="mt-4 text-xs leading-6 text-muted-foreground">
            {selectedRight && selectedRight.status !== "allowed"
              ? "이 책은 공개 권한을 확인해야 합니다."
              : values.source?.text
                ? "말씀 범위가 연결되어 있습니다."
                : "목차에서 사용할 말씀 범위를 선택해 주세요."}
          </p>
          {values.source?.text && (
            <details className="summary-source-review">
              <summary>연결한 원문 확인</summary>
              <p className="mt-3 text-xs text-muted-foreground">
                {values.source.edition} / {values.source.locator}
              </p>
              <div className="summary-source-review-text">{values.source.text}</div>
              <label className="mt-3 flex items-start gap-2 text-xs leading-6">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={values.source.verified ?? false}
                  onChange={(e) => sourcePatch("verified", e.target.checked)}
                />
                선택한 범위와 원문을 대조했습니다.
              </label>
            </details>
          )}
          <Button type="submit" className="mt-5 w-full" disabled={busy}>
            {busy ? "저장 중…" : "초안 저장"}
          </Button>
          <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => setPreview(true)}>
            사용자 화면 보기
          </Button>
          {record && (
            <div className="mt-5 grid gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || dirty || status !== "draft"}
                onClick={() => void action("request_review")}
              >
                검수 요청
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || dirty || status !== "review"}
                onClick={() => void action("return_to_draft")}
              >
                초안으로 되돌리기
              </Button>
              <Button
                type="button"
                disabled={busy || dirty || (status !== "review" && status !== "withdrawn")}
                onClick={() => void action("publish")}
              >
                {status === "withdrawn" ? "다시 공개하기" : "공개하기"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy || dirty || !record.published}
                onClick={() => void action("withdraw")}
              >
                내리기
              </Button>
            </div>
          )}
          <details className="summary-d-meta">
            <summary>표시 위치와 검수 메모</summary>
            <div className="mt-4 space-y-4">
              <Field label="책">
                <NativeSelect
                  disabled={Boolean(record)}
                  value={values.content_right_id}
                  onChange={(e) => patch("content_right_id", e.target.value)}
                >
                  <option value="">책 선택</option>
                  {rights.data?.map((right) => (
                    <option key={right.id} value={right.id}>
                      {right.work_title || right.volume}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="그룹·목차">
                <Input value={values.group_title ?? ""} onChange={(e) => patch("group_title", e.target.value)} />
              </Field>
              <Field label="순서">
                <Input
                  type="number"
                  min={1}
                  value={values.position ?? ""}
                  placeholder="자동 배정"
                  onChange={(e) => patch("position", e.target.value ? Number(e.target.value) : undefined)}
                />
              </Field>
              <Field label="검수 메모 (관리자 전용)">
                <textarea
                  className="summary-textarea"
                  value={values.source?.note ?? ""}
                  onChange={(e) => sourcePatch("note", e.target.value)}
                />
              </Field>
            </div>
          </details>
          {rights.isError && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              책 목록을 불러오지 못했습니다.{" "}
              <button type="button" className="underline" onClick={() => void rights.refetch()}>
                다시 불러오기
              </button>
            </p>
          )}
          {dirty && (
            <p className="mt-4 text-xs leading-6 text-muted-foreground">
              저장하지 않은 변경 내용이 있습니다. 검수·공개 전에 초안을 저장해 주세요.
            </p>
          )}
          {storageUnavailable && (
            <p className="mt-3 text-xs text-muted-foreground">
              이 브라우저에서는 임시 보관을 사용할 수 없습니다. 이동하기 전에 초안을 저장해 주세요.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm leading-6 text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="mt-4 text-sm leading-6">
              {notice}
            </p>
          )}
        </aside>
      </form>
      <Dialog.Root open={preview} onOpenChange={setPreview}>
        {preview && (
          <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto p-4 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <Dialog.Title className="font-semibold">서비스 화면 미리보기</Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                  편집 중인 내용을 보여줍니다. 공개된 화면이 아닙니다.
                </Dialog.Description>
              </div>
              <div className="flex gap-2">
                <Button variant={mobile ? "default" : "outline"} onClick={() => setMobile(true)}>
                  모바일
                </Button>
                <Button variant={!mobile ? "default" : "outline"} onClick={() => setMobile(false)}>
                  PC
                </Button>
                <Dialog.Close render={<Button variant="ghost" />}>닫기</Dialog.Close>
              </div>
            </div>
            <article className="summary-preview" data-mobile={mobile}>
              <div className="summary-preview-content">
                <p className="mb-4 text-xs text-muted-foreground">
                  {[selectedRight?.work_title ?? "말씀", values.group_title].filter(Boolean).join(" / ")}
                </p>
                <h2 className="mb-7 text-3xl leading-snug font-semibold">{values.title || "요약 제목"}</h2>
                <p className="mb-6 text-xl leading-8 font-medium">{values.lead}</p>
                {values.key_points?.some(Boolean) && (
                  <ul className="mb-7 list-disc space-y-2 pl-5 text-sm leading-7">
                    {values.key_points.filter(Boolean).map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                )}
                <div className="mb-3 flex gap-2">
                  {(["concept", "scene"] as const).map((kind) => (
                    <Button
                      key={kind}
                      variant={previewKind === kind ? "default" : "outline"}
                      aria-pressed={previewKind === kind}
                      onClick={() => setPreviewKind(kind)}
                    >
                      {KIND_LABEL[kind]}
                    </Button>
                  ))}
                </div>
                {previewUrl ? (
                  <Image
                    unoptimized
                    width={800}
                    height={533}
                    src={previewUrl}
                    loading="eager"
                    alt={previewImage?.alt ?? ""}
                    className="aspect-[3/2] w-full rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex aspect-[3/2] items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
                    {KIND_LABEL[previewKind]}을 올려 주세요
                  </div>
                )}
                <p className="mt-2 mb-7 text-sm text-muted-foreground">{previewImage?.caption}</p>
                <div className="summary-prose">
                  {renderToReactElement({
                    extensions: summaryExtensions((assetId) => assets.find((a) => a.id === assetId)?.url),
                    content: body,
                  })}
                </div>
                {evidence.length > 0 && (
                  <section className="mt-8 border-t pt-5">
                    <h3 className="font-semibold">근거 확인하기</h3>
                    <ul className="mt-3 space-y-2 text-sm leading-7">
                      {evidence.map((item, i) => (
                        <li key={i}>
                          {item.claim} — 말씀 {item.from}
                          {item.to !== item.from ? `–${item.to}` : ""}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {values.reflection_questions?.some(Boolean) && (
                  <section className="mt-8 border-t pt-5">
                    <h3 className="font-semibold">되새길 물음</h3>
                    <ul className="mt-3 space-y-2 leading-8">
                      {values.reflection_questions.filter(Boolean).map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            </article>
          </DialogContent>
        )}
      </Dialog.Root>
    </div>
  );
}
