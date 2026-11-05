// 공식 simple-editor 툴바에 글자 크기 선택을 추가하는 드롭다운 — TextStyleKit.fontSize 사용
import * as React from "react"
import type { Editor } from "@tiptap/react"

// --- Icons ---
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button"
import { Button, ButtonGroup } from "@/components/tiptap-ui-primitive/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/tiptap-ui-primitive/dropdown-menu"
import { Card, CardBody } from "@/components/tiptap-ui-primitive/card"
import { Separator } from "@/components/tiptap-ui-primitive/separator"

// --- Lib ---
import {
  ALLOWED_FONT_SIZES,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  normalizeFontSize,
} from "@/features/hoondok/summaries/editor-policy"

// 프리셋은 sanitize 와 공유하는 SSOT(ALLOWED_FONT_SIZES). 직접 입력은 normalizeFontSize 로 clamp.
export const FONT_SIZES = ALLOWED_FONT_SIZES

export interface FontSizeDropdownMenuProps extends Omit<ButtonProps, "type"> {
  /** 공유 컨텍스트 대신 명시적으로 editor 를 주입할 때 사용 */
  editor?: Editor | null
  /** 표시할 글자 크기 목록 */
  sizes?: readonly string[]
  /** 드롭다운을 portal 로 렌더할지 여부 */
  portal?: boolean
}

/**
 * Tiptap 에디터에서 글자 크기를 선택하는 드롭다운.
 * 공식 simple-editor 의 HeadingDropdownMenu 와 동일한 primitive 구성.
 */
export const FontSizeDropdownMenu = React.forwardRef<
  HTMLButtonElement,
  FontSizeDropdownMenuProps
>(
  (
    { editor: providedEditor, sizes = FONT_SIZES, portal = false, ...buttonProps },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const [isOpen, setIsOpen] = React.useState(false)
    const [customValue, setCustomValue] = React.useState("")

    const applySize = React.useCallback(
      (size: string | null) => {
        if (!editor) return
        const chain = editor.chain().focus()
        if (size) chain.setFontSize(size).run()
        else chain.unsetFontSize().run()
        setIsOpen(false)
      },
      [editor]
    )

    // 직접 입력 — 숫자(px)를 normalizeFontSize 로 clamp 후 적용
    const applyCustom = React.useCallback(() => {
      const normalized = normalizeFontSize(`${customValue.trim()}px`)
      if (normalized) {
        applySize(normalized)
        setCustomValue("")
      }
    }, [customValue, applySize])

    if (!editor) {
      return null
    }

    // 커서 위치의 글자 크기 — 트리거 라벨·목록 선택 표시에 쓴다(글꼴 드롭다운과 동일 원칙).
    // 영문 "Size" 고정 라벨은 운영자가 기능을 못 찾는 원인이었다(사회공헌국 "글씨 크기 기능 추가" 요청).
    const active = normalizeFontSize(editor.getAttributes("textStyle").fontSize)

    return (
      <DropdownMenu modal open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            data-style="ghost"
            role="button"
            tabIndex={-1}
            aria-label="글자 크기"
            tooltip="글자 크기"
            {...buttonProps}
            ref={ref}
          >
            <span className="tiptap-button-text">{active ?? "글자 크기"}</span>
            <ChevronDownIcon className="tiptap-button-dropdown-small" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" portal={portal}>
          <Card>
            <CardBody>
              <ButtonGroup>
                <DropdownMenuItem asChild>
                  <Button
                    type="button"
                    data-style="ghost"
                    data-active-state={active ? "off" : "on"}
                    onClick={() => applySize(null)}
                  >
                    <span className="tiptap-button-text">기본 크기</span>
                  </Button>
                </DropdownMenuItem>
              </ButtonGroup>
              <Separator orientation="horizontal" />
              {/* 프리셋 — 같은 크기의 숫자 3열 격자. 항목을 실제 크기로 그리면 40px↑ 글자가 줄높이(24px)를 넘어 서로 겹치고
                  메뉴가 500px 넘게 길어진다. 선택된 크기는 active 상태로 표시 */}
              <div
                role="group"
                aria-label="크기 선택"
                style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 2 }}
              >
                {sizes.map((size) => (
                  <DropdownMenuItem key={size} asChild>
                    <Button
                      type="button"
                      data-style="ghost"
                      data-active-state={size === active ? "on" : "off"}
                      aria-label={size}
                      onClick={() => applySize(size)}
                    >
                      <span className="tiptap-button-text" style={{ textAlign: "center" }}>
                        {size.replace("px", "")}
                      </span>
                    </Button>
                  </DropdownMenuItem>
                ))}
              </div>
              <Separator orientation="horizontal" />
              {/* 직접 입력 — 12~64px clamp */}
              <div
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 4px", fontSize: 12 }}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <label style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                  직접 입력
                  <input
                    type="number"
                    min={FONT_SIZE_MIN}
                    max={FONT_SIZE_MAX}
                    inputMode="numeric"
                    aria-label={`직접 입력 (${FONT_SIZE_MIN}~${FONT_SIZE_MAX}px)`}
                    placeholder={`${FONT_SIZE_MIN}~${FONT_SIZE_MAX}`}
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        applyCustom()
                      }
                    }}
                    style={{ width: 56, padding: "2px 6px", border: "1px solid var(--tt-gray-light-a-400, #ccc)", borderRadius: 4 }}
                  />
                  px
                </label>
                <Button type="button" data-style="ghost" onClick={applyCustom}>
                  <span className="tiptap-button-text">적용</span>
                </Button>
              </div>
            </CardBody>
          </Card>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
)

FontSizeDropdownMenu.displayName = "FontSizeDropdownMenu"

export default FontSizeDropdownMenu
