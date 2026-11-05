"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { EditorContent, EditorContext, useEditor, useEditorState, type JSONContent } from "@tiptap/react";
import Image from "next/image";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import { Dialog } from "@base-ui/react/dialog";
import type { SummaryMediaResponse } from "@truewords/api-client-ts/types";
import { Button as AppButton } from "@/components/ui/button";
import { DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { canonicalDocument, youtubeVideo } from "./rich-document";
import { ManagedImage, ImageRow, ManagedYoutube } from "./media-extensions";
import { Button } from "@/components/tiptap-ui-primitive/button";
import { Toolbar, ToolbarGroup, ToolbarSeparator } from "@/components/tiptap-ui-primitive/toolbar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/tiptap-ui-primitive/popover";
import { Card, CardBody } from "@/components/tiptap-ui-primitive/card";
import { HeadingDropdownMenu } from "@/components/tiptap-ui/heading-dropdown-menu";
import { ListDropdownMenu } from "@/components/tiptap-ui/list-dropdown-menu";
import { BlockquoteButton } from "@/components/tiptap-ui/blockquote-button";
import { MarkButton } from "@/components/tiptap-ui/mark-button";
import { TextAlignButton } from "@/components/tiptap-ui/text-align-button";
import { UndoRedoButton } from "@/components/tiptap-ui/undo-redo-button";
import { ColorHighlightPopover, ColorHighlightPopoverButton, ColorHighlightPopoverContent } from "@/components/tiptap-ui/color-highlight-popover";
import { LinkPopover, LinkButton, LinkContent } from "@/components/tiptap-ui/link-popover";
import { FontSizeDropdownMenu } from "@/components/tiptap-ui/font-size-dropdown-menu";
import { TextColorPopover } from "@/components/tiptap-ui/text-color-popover";
import { ImageUploadButton } from "@/components/tiptap-ui/image-upload-button";
import { ImageUploadNode } from "@/components/tiptap-node/image-upload-node/image-upload-node-extension";
import { ArrowLeftIcon } from "@/components/tiptap-icons/arrow-left-icon";
import { HighlighterIcon } from "@/components/tiptap-icons/highlighter-icon";
import { LinkIcon } from "@/components/tiptap-icons/link-icon";
import { Images, Library, Settings2, Table2, Trash2, Video, GalleryHorizontalEnd } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import "@/styles/tiptap-editor-globals.scss";
import "@/components/tiptap-node/blockquote-node/blockquote-node.scss";
import "@/components/tiptap-node/list-node/list-node.scss";
import "@/components/tiptap-node/image-node/image-node.scss";
import "@/components/tiptap-node/heading-node/heading-node.scss";
import "@/components/tiptap-node/paragraph-node/paragraph-node.scss";
import "./editor.scss";

const HIGHLIGHT_COLORS = [
  { label: "초록", value: "#c8f2d0", border: "#79c88a" },
  { label: "파랑", value: "#c6e7fa", border: "#75b6db" },
  { label: "빨강", value: "#fdd8d5", border: "#e29c96" },
  { label: "보라", value: "#e8d5fa", border: "#bd98dc" },
  { label: "노랑", value: "#fff3a3", border: "#d8c966" },
];

// 업로드 폼은 편집 화면의 임시 노드이며 서버 문서에는 포함하지 않는다.
export function persistableDocument(document: JSONContent): JSONContent {
  const strip = (node: JSONContent): JSONContent => ({
    ...node,
    ...(node.content ? { content: node.content.filter((child) => child.type !== "imageUpload").map(strip) } : {}),
  });
  return canonicalDocument(strip(document));
}

export const summaryExtensions = (resolveAsset: (id: string) => string | undefined = () => undefined) => [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    code: false,
    codeBlock: false,
    strike: false,
    horizontalRule: false,
    link: {
      openOnClick: false,
      isAllowedUri: (url) => {
        try {
          return ["https:", "http:"].includes(new URL(url).protocol);
        } catch {
          return false;
        }
      },
    },
  }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  TextStyleKit.configure({ backgroundColor: false, fontFamily: false, lineHeight: false }),
  Highlight.configure({ multicolor: true }),
  TableKit.configure({ table: { resizable: true } }),
  ManagedImage.configure({ resolveAsset }),
  ImageRow,
  ManagedYoutube,
];

export function SummaryEditor({
  content,
  onChange,
  assets = [],
  onUpload,
  onUseForCarousel,
}: {
  content: JSONContent;
  onChange: (content: JSONContent) => void;
  assets?: SummaryMediaResponse[];
  onUpload?: (file: File) => Promise<SummaryMediaResponse>;
  onUseForCarousel?: (assetId: string, alt: string, caption: string) => void;
}) {
  const uploadRef = useRef(onUpload);
  const [assetURLs] = useState(() => new Map(assets.map((asset) => [asset.id, asset.url])));
  useEffect(() => {
    for (const asset of assets) assetURLs.set(asset.id, asset.url);
    uploadRef.current = onUpload;
  }, [assets, onUpload, assetURLs]);
  const fileRef = useRef<HTMLInputElement>(null);
  const pairRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isMobile = useIsMobile(480);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [mobileView, setMobileView] = useState<"main" | "highlighter" | "link">("main");
  useEffect(() => {
    if (toolbarRef.current) toolbarRef.current.scrollLeft = 0;
  }, [mobileView]);
  const [dialog, setDialog] = useState<"video" | "image" | "library" | null>(null);
  const [url, setURL] = useState("");
  const [caption, setCaption] = useState("");
  const [alt, setAlt] = useState("");
  const [width, setWidth] = useState(100);
  const [align, setAlign] = useState("center");
  const editor = useEditor({
    extensions: [
      ...summaryExtensions((id) => assetURLs.get(id)),
      ImageUploadNode.configure({
        accept: "image/png,image/jpeg,image/webp", limit: 5, maxSize: 10 * 1024 * 1024,
        upload: async (file, onProgress, signal) => {
          if (!uploadRef.current) throw new Error("책과 제목을 먼저 입력해 주세요.");
          if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("PNG·JPEG·WebP 이미지를 선택해 주세요.");
          setBusy(true);
          setError("");
          try {
            if (signal?.aborted) throw new Error("업로드를 취소했습니다.");
            const asset = await uploadRef.current(file);
            assetURLs.set(asset.id, asset.url);
            onProgress?.({ progress: 100 });
            return asset.id;
          } finally { setBusy(false); }
        },
        resolveImage: (id, filename) => ({ asset_id: id, alt: filename, caption: "", width_percent: 100, align: "center" }),
        onError: (cause) => setError(cause.message),
      }),
    ],
    content,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        "aria-label": "상세 해설",
        role: "textbox",
        "aria-multiline": "true",
        class: "simple-editor",
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        void uploadFiles(files, false);
        return true;
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        void uploadFiles(files, false);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => onChange(persistableDocument(current.getJSON())),
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      table: e?.isActive("table"),
      image: e?.isActive("image"),
    }),
  });
  async function uploadFiles(files: File[], pair: boolean) {
    if (!editor || !uploadRef.current) {
      setError("먼저 책과 제목을 선택하고 초안을 저장해 주세요.");
      return;
    }
    if (pair && files.length !== 2) {
      setError("나란히 배치할 이미지 두 장을 선택해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    const nodes: JSONContent[] = [];
    try {
      for (const file of files) {
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
          throw new Error("PNG·JPEG·WebP 이미지를 선택해 주세요.");
        const asset = await uploadRef.current(file);
        assetURLs.set(asset.id, asset.url);
        nodes.push({
          type: "image",
          attrs: {
            asset_id: asset.id,
            alt: file.name.replace(/\.[^.]+$/, ""),
            caption: "",
            width_percent: 100,
            align: "center",
          },
        });
      }
      editor
        .chain()
        .focus()
        .insertContent(pair ? { type: "imageRow", content: nodes } : nodes)
        .run();
    } catch (cause) {
      // 성공한 업로드도 보관함에 남으므로 다시 올릴 필요가 없다.
      setError(cause instanceof Error ? cause.message : "이미지를 올리지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  function chooseFiles(pair: boolean) {
    pairRef.current = pair;
    fileRef.current?.click();
  }
  function changeFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) void uploadFiles(files, pairRef.current);
  }
  function open(kind: "video" | "image" | "library") {
    if (!editor) return;
    setError("");
    setURL("");
    if (kind === "image") {
      const a = editor.getAttributes("image");
      setAlt(a.alt ?? "");
      setCaption(a.caption ?? "");
      setWidth(a.width_percent ?? 100);
      setAlign(a.align ?? "center");
    }
    setDialog(kind);
  }
  function applyDialog() {
    if (!editor) return;
    if (dialog === "video") {
      const video = youtubeVideo(url);
      if (!video) {
        setError("YouTube 영상 주소를 확인해 주세요.");
        return;
      }
      editor.chain().focus().insertContent({ type: "youtube", attrs: video }).run();
    } else if (dialog === "image")
      editor.chain().focus().updateAttributes("image", { alt, caption, width_percent: width, align }).run();
    setDialog(null);
    setError("");
  }
  if (!editor)
    return <div className="min-h-[420px] rounded-lg border bg-muted animate-pulse" aria-label="편집기 불러오는 중" />;
  return (
    <EditorContext.Provider value={{ editor }}>
    <div className="summary-rich-editor admin-editor-embed simple-editor-wrapper">
      <Toolbar ref={toolbarRef} aria-label="본문 서식" data-mobile-view={isMobile ? mobileView : "main"}>
        {mobileView === "main" || !isMobile ? <>
          <ToolbarGroup><UndoRedoButton action="undo" /><UndoRedoButton action="redo" /></ToolbarGroup>
          <ToolbarSeparator />
          <ToolbarGroup>
            <HeadingDropdownMenu levels={[2, 3]} portal />
            <FontSizeDropdownMenu portal />
            <ListDropdownMenu types={["bulletList", "orderedList"]} portal />
            <BlockquoteButton />
          </ToolbarGroup>
          <ToolbarSeparator />
          <ToolbarGroup>
            <MarkButton type="bold" /><MarkButton type="italic" /><MarkButton type="underline" />
            <TextColorPopover />
            {!isMobile ? <ColorHighlightPopover colors={HIGHLIGHT_COLORS} /> : <ColorHighlightPopoverButton onClick={() => setMobileView("highlighter")} />}
            {!isMobile ? <LinkPopover /> : <LinkButton onClick={() => setMobileView("link")} />}
          </ToolbarGroup>
          <ToolbarSeparator />
          <ToolbarGroup>
            <TextAlignButton align="left" /><TextAlignButton align="center" /><TextAlignButton align="right" /><TextAlignButton align="justify" />
          </ToolbarGroup>
          <ToolbarSeparator />
          <ToolbarGroup>
            <ImageUploadButton tooltip="이미지 추가" />
            <Button type="button" data-style="ghost" aria-label="이미지 2장" tooltip="이미지 두 장 나란히" disabled={busy || !onUpload} onClick={() => chooseFiles(true)}><Images className="tiptap-button-icon" /></Button>
            <Button type="button" data-style="ghost" aria-label="이미지 보관함" tooltip="이미지 보관함" onClick={() => open("library")}><Library className="tiptap-button-icon" /></Button>
            <Button type="button" data-style="ghost" aria-label="영상 넣기" tooltip="YouTube 영상" onClick={() => open("video")}><Video className="tiptap-button-icon" /></Button>
            <Popover>
              <PopoverTrigger asChild><Button type="button" data-style="ghost" aria-label="표" tooltip="표"><Table2 className="tiptap-button-icon" /></Button></PopoverTrigger>
              <PopoverContent aria-label="표 편집"><Card><CardBody className="summary-table-actions">
                <Button type="button" data-style="ghost" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()}>표 삽입 (3×2)</Button>
                {state?.table && <>
                  <Button type="button" data-style="ghost" onClick={() => editor.chain().focus().addRowAfter().run()}>아래에 행 추가</Button>
                  <Button type="button" data-style="ghost" onClick={() => editor.chain().focus().deleteRow().run()}>행 삭제</Button>
                  <Button type="button" data-style="ghost" onClick={() => editor.chain().focus().addColumnAfter().run()}>오른쪽에 열 추가</Button>
                  <Button type="button" data-style="ghost" onClick={() => editor.chain().focus().deleteColumn().run()}>열 삭제</Button>
                  <Button type="button" data-style="ghost" onClick={() => editor.chain().focus().deleteTable().run()}>표 삭제</Button>
                </>}
              </CardBody></Card></PopoverContent>
            </Popover>
          </ToolbarGroup>
        </> : <>
          <ToolbarGroup><Button type="button" data-style="ghost" aria-label="서식 도구로 돌아가기" onClick={() => setMobileView("main")}>
            <ArrowLeftIcon className="tiptap-button-icon" />
            {mobileView === "highlighter" ? <HighlighterIcon className="tiptap-button-icon" /> : <LinkIcon className="tiptap-button-icon" />}
          </Button></ToolbarGroup>
          <ToolbarSeparator />
          {mobileView === "highlighter" ? <ColorHighlightPopoverContent colors={HIGHLIGHT_COLORS} /> : <LinkContent />}
        </>}
      </Toolbar>
      {state?.image && <Toolbar variant="floating" aria-label="이미지 편집" className="summary-image-context">
        <ToolbarGroup>
          <Button type="button" data-style="ghost" aria-label="이미지 설명·크기" tooltip="이미지 설명·크기" onClick={() => open("image")}><Settings2 className="tiptap-button-icon" /></Button>
          {onUseForCarousel && <Button type="button" data-style="ghost" aria-label="요약 카드에도 사용" tooltip="요약 카드에도 사용" onClick={() => {const a = editor.getAttributes("image"); onUseForCarousel(a.asset_id, a.alt, a.caption);}}><GalleryHorizontalEnd className="tiptap-button-icon" /></Button>}
          <Button type="button" data-style="ghost" aria-label="이미지 삭제" tooltip="이미지 삭제" onClick={() => editor.chain().focus().deleteSelection().run()}><Trash2 className="tiptap-button-icon" /></Button>
        </ToolbarGroup>
      </Toolbar>}
      {error && !dialog && (
        <p role="alert" className="summary-editor-error">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="summary-editor-hint">
          이미지를 안전하게 올리고 있습니다. 글은 그대로 유지됩니다.
        </p>
      )}
      <EditorContent editor={editor} className="simple-editor-content" />
      <input
        className="sr-only"
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={changeFiles}
        aria-label="본문 이미지 업로드"
      />
      <Dialog.Root
        open={dialog !== null}
        onOpenChange={(value) => {
          if (!value) setDialog(null);
        }}
      >
        {dialog && (
          <DialogContent className="max-w-xl max-h-[90dvh] overflow-auto p-6">
            <Dialog.Title className="text-lg font-semibold">
              {dialog === "video" ? "영상 넣기" : dialog === "image" ? "이미지 설명·크기" : "이미지 보관함"}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              {dialog === "video"
                ? "YouTube 주소를 넣으면 게시글 안에서 재생됩니다."
                : dialog === "image"
                  ? "이미지를 설명하고 본문에 표시할 크기를 정해 주세요."
                  : dialog === "library"
                    ? "이 글에 올린 이미지를 본문에 다시 사용할 수 있습니다."
                    : ""}
            </Dialog.Description>
            {dialog === "video" ? (
              <label className="summary-field mt-5">
                YouTube 영상 주소
                <Input value={url} onChange={(e) => setURL(e.target.value)} placeholder="https://" />
              </label>
            ) : dialog === "image" ? (
              <div className="mt-5 space-y-4">
                <label className="summary-field">
                  이미지 설명
                  <Input value={caption} onChange={(e) => setCaption(e.target.value)} />
                </label>
                <label className="summary-field">
                  대체 설명
                  <Input value={alt} onChange={(e) => setAlt(e.target.value)} />
                </label>
                <label className="summary-field">
                  표시 폭
                  <select aria-label="표시 폭" value={width} onChange={(e) => setWidth(Number(e.target.value))}>
                    {[25, 50, 75, 100].map((n) => (
                      <option key={n} value={n}>
                        {n}%
                      </option>
                    ))}
                  </select>
                </label>
                <label className="summary-field">
                  이미지 정렬
                  <select aria-label="이미지 정렬" value={align} onChange={(e) => setAlign(e.target.value)}>
                    <option value="left">왼쪽</option>
                    <option value="center">가운데</option>
                    <option value="right">오른쪽</option>
                  </select>
                </label>
              </div>
            ) : (
              <div className="summary-media-library mt-5">
                {assets.length === 0 && <p>본문이나 요약 카드에 사용할 이미지를 먼저 올려 주세요.</p>}
                {assets.map((asset) => (
                  <button
                    type="button"
                    key={asset.id}
                    onClick={() => {
                      editor
                        .chain()
                        .focus()
                        .insertContent({
                          type: "image",
                          attrs: { asset_id: asset.id, alt: "", caption: "", width_percent: 100, align: "center" },
                        })
                        .run();
                      setDialog(null);
                    }}
                  >
                    <Image unoptimized width={360} height={240} src={asset.url} alt="보관함 이미지" />
                    본문에 넣기
                  </button>
                ))}
              </div>
            )}
            {error && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <Dialog.Close render={<AppButton variant="outline" type="button" />}>닫기</Dialog.Close>
              {dialog !== "library" && (
                <AppButton type="button" onClick={applyDialog}>
                  적용
                </AppButton>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog.Root>
    </div>
    </EditorContext.Provider>
  );
}
