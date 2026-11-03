"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import type { JSONContent } from "@tiptap/react";
import type { SummaryMediaResponse } from "@truewords/api-client-ts/types";
import { ArrowDown, ArrowUp, ImagePlus, Plus } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { rightsAPI } from "@/features/hoondok/rights-api";
import { ApiError } from "@/lib/api";
import { summariesAPI, type SummaryInput, type SummaryAdminResponse } from "./api";
import { SummaryEditor, summaryExtensions } from "./editor";
import { SourcePicker } from "./source-picker";
import "./summaries.css";

const STATUS = { draft: "초안", in_review: "검수 중", approved: "검수 승인" };
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
  reflection: "",
  source: {
    edition: "",
    locator: "",
    text: "",
    sha256: "",
    chunk_ids: [],
    verified: false,
  },
  slides: [],
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
    reflection: value.reflection ?? "",
    source: value.source ?? EMPTY.source,
    slides: value.slides ?? [],
  };
}
// 이 탭에서 작성한 임시 값만 복구한다. 손상된 저장 값은 무시한다.
function isStoredDraft(value: unknown): value is SummaryInput {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  const source = data.source as Record<string, unknown> | undefined;
  const body = data.body as Record<string, unknown> | undefined;
  return (
    ["content_right_id", "slug", "group_title", "title", "lead", "reflection"].every(
      (key) => typeof data[key] === "string",
    ) &&
    (data.position === undefined || (typeof data.position === "number" && Number.isFinite(data.position))) &&
    Array.isArray(data.key_points) &&
    data.key_points.every((point) => typeof point === "string") &&
    !!body &&
    body.type === "doc" &&
    Array.isArray(body.content) &&
    !!source &&
    ["edition", "locator", "text", "sha256"].every((key) => typeof source[key] === "string") &&
    typeof source.verified === "boolean" &&
    Array.isArray(source.chunk_ids) &&
    source.chunk_ids.every((id) => typeof id === "string") &&
    Array.isArray(data.slides) &&
    data.slides.every(
      (slide) =>
        slide &&
        typeof slide === "object" &&
        typeof slide.asset_id === "string" &&
        typeof slide.alt === "string" &&
        typeof slide.caption === "string",
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
    if (error.status === 422) return `${error.message} 원문 범위·필수 입력값과 이미지 설명을 확인해 주세요.`;
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
export function SummaryList() {
  const query = useQuery({
    queryKey: ["summary-admin"],
    queryFn: summariesAPI.list,
  });
  const rights = useQuery({
    queryKey: ["hoondok", "content-rights"],
    queryFn: rightsAPI.list,
  });
  return (
    <div className="page-wide space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">말씀 AI 요약</h1>
          <p className="mt-2 text-sm text-muted-foreground">원문을 바탕으로 만든 요약을 검수하고 공개합니다.</p>
        </div>
        <Link className={buttonVariants()} href="/hoondok/summaries/new">
          <Plus />새 요약 작성
        </Link>
      </header>
      {query.isPending && <p role="status">요약 목록을 불러오고 있어요.</p>}
      {query.isError && (
        <div role="alert" className="space-y-3">
          <p>{message(query.error)}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            다시 불러오기
          </Button>
        </div>
      )}
      {query.data?.length === 0 && (
        <div className="rounded-xl border bg-card p-10 text-center">
          <h2 className="font-semibold">첫 요약을 작성해 주세요</h2>
          <p className="mt-2 text-sm text-muted-foreground">책과 원문 범위를 정하고, 본문과 이미지를 저장해 보세요.</p>
        </div>
      )}
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {query.data?.map((item) => (
          <Link
            key={item.id}
            href={`/hoondok/summaries/${item.id}/edit`}
            className="flex flex-wrap items-center justify-between gap-4 p-5 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <div>
              <p className="mb-1 text-xs text-muted-foreground">
                {rights.data?.find((right) => right.id === item.content_right_id)?.work_title ?? "말씀"} /{" "}
                {item.group_title} / {item.position}편
              </p>
              <h2 className="font-semibold">{item.title}</h2>
              <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{item.lead}</p>
            </div>
            <div className="flex gap-2 text-xs">
              <span className="rounded-full border px-3 py-1">{STATUS[item.review_status]}</span>
              <span className="rounded-full bg-muted px-3 py-1">{item.published ? "공개 중" : "비공개"}</span>
            </div>
          </Link>
        ))}
      </div>
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
  const [slideIndex, setSlideIndex] = useState(0);
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
  async function action(actionName: "request_review" | "approve" | "publish" | "withdraw") {
    if (!record || dirty) return;
    if (
      actionName === "withdraw" &&
      !window.confirm("이 요약의 공개를 철회할까요? 사용자 화면에서 요약과 이미지를 볼 수 없게 됩니다.")
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
          approve: "검수를 승인했습니다.",
          publish: "요약을 공개했습니다.",
          withdraw: "공개를 철회했습니다.",
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
  async function uploadSlides(files: File[]) {
    setBusy(true);
    setError("");
    try {
      for (const file of files) {
        const asset = await uploadAsset(file);
        setValues((current) => ({
          ...current,
          slides: [
            ...(current.slides ?? []),
            { asset_id: asset.id, alt: file.name.replace(/\.[^.]+$/, ""), caption: "" },
          ],
        }));
      }
      setNotice("요약 카드를 추가했습니다. 요약 문장을 입력한 뒤 초안을 저장해 주세요.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : message(cause));
    } finally {
      setBusy(false);
    }
  }
  function moveSlide(index: number, delta: number) {
    const slides = [...(values.slides ?? [])];
    const target = index + delta;
    if (target < 0 || target >= slides.length) return;
    [slides[index], slides[target]] = [slides[target], slides[index]];
    patch("slides", slides);
  }
  const slides = values.slides ?? [];
  const previewSlide = slides[Math.min(slideIndex, slides.length - 1)];
  const previewAsset = assets.find((asset) => asset.id === previewSlide?.asset_id);
  const body = values.body as JSONContent;
  return (
    <div className="page-wide summary-d-workspace">
      <header className="summary-d-heading">
        <div>
          <Link href="/hoondok/summaries" className="text-sm text-muted-foreground underline underline-offset-4">
            AI 요약 목록
          </Link>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">{record ? "요약 편집" : "새 요약 작성"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">말씀을 연결하고 이미지와 영상이 있는 글을 작성해 보세요.</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setSlideIndex(0);
            setPreview(true);
          }}
        >
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
            한 줄 소개
          </label>
          <textarea
            id="summary-lead"
            className="summary-d-lead"
            value={values.lead ?? ""}
            rows={2}
            placeholder="이 글에서 함께 살펴볼 내용을 소개해 주세요"
            onChange={(e) => patch("lead", e.target.value)}
          />
          <section className="summary-d-carousel" aria-label="한눈에 읽기">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">한눈에 읽기</h2>
              <label className="summary-upload-button">
                <ImagePlus className="size-4" />
                요약 카드 추가
                <input
                  className="sr-only"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  disabled={busy}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    void uploadSlides(files);
                  }}
                  aria-label="캐러셀 이미지 업로드"
                />
              </label>
            </div>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              먼저 보여 줄 이미지와 짧은 요약을 골라 주세요. 본문에도 같은 이미지를 사용할 수 있어요.
            </p>
            <div className="summary-d-cards">
              {slides.map((slide, index) => (
                <div className="summary-d-card" key={`${slide.asset_id}-${index}`}>
                  <Image
                    unoptimized
                    width={600}
                    height={400}
                    loading={index < 3 ? "eager" : "lazy"}
                    src={assets.find((a) => a.id === slide.asset_id)?.url ?? ""}
                    alt={slide.alt || "요약 카드 미리보기"}
                  />
                  <label className="sr-only" htmlFor={`slide-caption-${index}`}>
                    {index + 1}번째 이미지 요약
                  </label>
                  <textarea
                    id={`slide-caption-${index}`}
                    rows={3}
                    value={slide.caption ?? ""}
                    placeholder="이 이미지로 전할 요약"
                    onChange={(e) =>
                      patch(
                        "slides",
                        slides.map((s, i) => (i === index ? { ...s, caption: e.target.value } : s)),
                      )
                    }
                  />
                  <label className="sr-only" htmlFor={`slide-alt-${index}`}>
                    {index + 1}번째 이미지 대체 설명
                  </label>
                  <input
                    id={`slide-alt-${index}`}
                    value={slide.alt ?? ""}
                    placeholder="이미지 대체 설명"
                    onChange={(e) =>
                      patch(
                        "slides",
                        slides.map((s, i) => (i === index ? { ...s, alt: e.target.value } : s)),
                      )
                    }
                  />
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === 0}
                      onClick={() => moveSlide(index, -1)}
                      aria-label={`${index + 1}번째 이미지 앞으로`}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === slides.length - 1}
                      onClick={() => moveSlide(index, 1)}
                      aria-label={`${index + 1}번째 이미지 뒤로`}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        patch(
                          "slides",
                          slides.filter((_, i) => i !== index),
                        )
                      }
                      aria-label={`${index + 1}번째 이미지 삭제`}
                    >
                      삭제
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {slides.length === 0 && (
              <p className="summary-d-empty">요약 카드를 추가하면 글의 첫 화면에 캐러셀로 표시돼요.</p>
            )}
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
            onUseForCarousel={(assetId, alt, caption) => {
              if (slides.some((s) => s.asset_id === assetId)) {
                setNotice("이미 요약 카드에 추가된 이미지입니다.");
                return;
              }
              patch("slides", [...slides, { asset_id: assetId, alt, caption }]);
              setNotice("본문 이미지를 요약 카드에도 추가했습니다.");
            }}
          />
          <details className="summary-d-extra">
            <summary>핵심 정리와 돌아볼 질문</summary>
            <div className="mt-5 space-y-4">
              {(values.key_points ?? []).map((point, index) => (
                <Field label={`핵심 정리 ${index + 1}`} key={index}>
                  <Input
                    value={point}
                    onChange={(e) =>
                      patch(
                        "key_points",
                        (values.key_points ?? []).map((p, i) => (i === index ? e.target.value : p)),
                      )
                    }
                  />
                </Field>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => patch("key_points", [...(values.key_points ?? []), ""])}
              >
                <Plus className="size-4" />
                핵심 정리 추가
              </Button>
              <Field label="돌아볼 질문">
                <textarea
                  className="summary-textarea"
                  value={values.reflection ?? ""}
                  onChange={(e) => patch("reflection", e.target.value)}
                />
              </Field>
            </div>
          </details>
        </div>
        <aside className="summary-d-settings" aria-label="게시글 설정">
          <h2 className="font-semibold">게시글 설정</h2>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-muted px-3 py-1">{record ? STATUS[record.review_status] : "새 초안"}</span>
            {record?.published && <span className="rounded-full border px-3 py-1">공개 중</span>}
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
          <Button
            type="button"
            variant="outline"
            className="mt-2 w-full"
            onClick={() => {
              setSlideIndex(0);
              setPreview(true);
            }}
          >
            사용자 화면 보기
          </Button>
          {record && (
            <div className="mt-5 grid gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || dirty || record.review_status !== "draft"}
                onClick={() => void action("request_review")}
              >
                검수 요청
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || dirty || record.review_status !== "in_review"}
                onClick={() => void action("approve")}
              >
                검수 승인
              </Button>
              <Button
                type="button"
                disabled={busy || dirty || record.review_status !== "approved"}
                onClick={() => void action("publish")}
              >
                공개하기
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy || dirty || !record.published}
                onClick={() => void action("withdraw")}
              >
                공개 철회
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
                <div className="summary-preview-hero">
                  <div>
                    {previewAsset ? (
                      <Image
                        unoptimized
                        width={800}
                        height={600}
                        src={previewAsset.url}
                        loading="eager"
                        alt={previewSlide?.alt ?? ""}
                        className="aspect-[3/2] w-full rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[3/2] items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
                        요약 카드를 추가해 주세요
                      </div>
                    )}
                    <div className="mt-3 flex items-center justify-between">
                      <Button variant="ghost" disabled={slideIndex === 0} onClick={() => setSlideIndex((v) => v - 1)}>
                        이전
                      </Button>
                      <span className="text-xs">
                        {slides.length ? Math.min(slideIndex + 1, slides.length) : 0} / {slides.length}
                      </span>
                      <Button
                        variant="ghost"
                        disabled={slideIndex >= slides.length - 1}
                        onClick={() => setSlideIndex((v) => v + 1)}
                      >
                        다음
                      </Button>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{previewSlide?.caption}</p>
                  </div>
                  <div>
                    <p className="mb-6 text-xl leading-8 font-medium">{values.lead}</p>
                    {values.key_points?.some(Boolean) && (
                      <ul className="mb-7 list-disc space-y-2 pl-5 text-sm leading-7">
                        {values.key_points.filter(Boolean).map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    )}
                    <div className="summary-prose">
                      {renderToReactElement({
                        extensions: summaryExtensions((assetId) => assets.find((a) => a.id === assetId)?.url),
                        content: body,
                      })}
                    </div>
                    {values.reflection && (
                      <section className="mt-8 border-t pt-5">
                        <h3 className="font-semibold">돌아볼 질문</h3>
                        <p className="mt-3 leading-8">{values.reflection}</p>
                      </section>
                    )}
                    <details className="mt-8 border-t pt-5">
                      <summary className="cursor-pointer text-sm font-semibold">함께 읽은 원문</summary>
                      <p className="mt-4 text-xs text-muted-foreground">
                        {values.source?.edition} / {values.source?.locator}
                      </p>
                      <p className="mt-4 whitespace-pre-wrap text-sm leading-8">{values.source?.text}</p>
                    </details>
                  </div>
                </div>
              </div>
            </article>
          </DialogContent>
        )}
      </Dialog.Root>
    </div>
  );
}
