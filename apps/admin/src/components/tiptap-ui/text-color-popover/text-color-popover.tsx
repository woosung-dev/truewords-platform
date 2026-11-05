// 소식 에디터 툴바의 글자색 팝오버 — 팔레트 빠른선택 + 자유 색(네이티브 컬러피커). TextStyleKit setColor/unsetColor 사용.
// 고정 8색에 묶이지 않고 docx 처럼 임의 색 지정 가능. 저장 후 공개 렌더는 sanitize 의 normalizeColor(hex 검증)가 통과.
import * as React from "react"
import type { Editor } from "@tiptap/react"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button"
import { Button, ButtonGroup } from "@/components/tiptap-ui-primitive/button"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/tiptap-ui-primitive/popover"
import { Separator } from "@/components/tiptap-ui-primitive/separator"
import { Card, CardBody } from "@/components/tiptap-ui-primitive/card"
import { BanIcon } from "@/components/tiptap-icons/ban-icon"

// --- Lib ---
import { ALLOWED_COLORS } from "@/features/hoondok/summaries/editor-policy"

export interface TextColorPopoverProps extends Omit<ButtonProps, "type"> {
  editor?: Editor | null
}

export const TextColorPopover = React.forwardRef<
  HTMLButtonElement,
  TextColorPopoverProps
>(({ editor: providedEditor, ...buttonProps }, ref) => {
  const { editor } = useTiptapEditor(providedEditor)
  const [isOpen, setIsOpen] = React.useState(false)

  const currentColor =
    (editor?.getAttributes("textStyle")?.color as string | undefined) ?? null

  const applyColor = React.useCallback(
    (color: string | null) => {
      if (!editor) return
      const chain = editor.chain().focus()
      if (color) chain.setColor(color).run()
      else chain.unsetColor().run()
    },
    [editor],
  )

  if (!editor) return null

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          data-style="ghost"
          role="button"
          tabIndex={-1}
          aria-label="Text color"
          tooltip="글자 색"
          data-active-state={currentColor ? "on" : "off"}
          {...buttonProps}
          ref={ref}
        >
          <span
            className="tiptap-button-text"
            style={{
              borderBottom: `3px solid ${currentColor ?? "#242424"}`,
              lineHeight: 1.1,
            }}
          >
            A
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="글자 색">
        <Card>
          <CardBody>
            <ButtonGroup orientation="horizontal">
              {ALLOWED_COLORS.map((color) => (
                <Button
                  key={color}
                  type="button"
                  data-style="ghost"
                  role="menuitem"
                  aria-label={`글자 색 ${color}`}
                  tooltip={color}
                  onClick={() => {
                    applyColor(color)
                    setIsOpen(false)
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      backgroundColor: color,
                      border: "1px solid rgba(0,0,0,0.15)",
                    }}
                  />
                </Button>
              ))}
            </ButtonGroup>
            <Separator />
            <ButtonGroup orientation="horizontal">
              {/* 자유 색 — 네이티브 컬러피커 */}
              <label
                className="tiptap-button"
                data-style="ghost"
                style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
                title="직접 선택"
              >
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background:
                      "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
                    border: "1px solid rgba(0,0,0,0.15)",
                  }}
                />
                <span className="tiptap-button-text">직접</span>
                <input
                  type="color"
                  aria-label="직접 색 선택"
                  value={currentColor ?? "#242424"}
                  onChange={(e) => applyColor(e.target.value)}
                  style={{
                    width: 0,
                    height: 0,
                    padding: 0,
                    border: 0,
                    opacity: 0,
                    position: "absolute",
                  }}
                />
              </label>
              <Button
                type="button"
                data-style="ghost"
                role="menuitem"
                aria-label="글자 색 제거"
                tooltip="색 제거"
                onClick={() => {
                  applyColor(null)
                  setIsOpen(false)
                }}
              >
                <BanIcon className="tiptap-button-icon" />
              </Button>
            </ButtonGroup>
          </CardBody>
        </Card>
      </PopoverContent>
    </Popover>
  )
})

TextColorPopover.displayName = "TextColorPopover"

export default TextColorPopover
