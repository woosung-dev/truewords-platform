"use client";

import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@truewords/ui-web/components/ui/tooltip";

interface Props {
  text: string;
  className?: string;
  maxWidth?: string;
}

export function TruncateTooltip({
  text,
  className = "",
  maxWidth = "max-w-md",
}: Props) {
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 전환 중 hydration 이후 기기 판별 동작을 보존한다.
    setIsTouchDevice(window.matchMedia("(hover: none)").matches);
  }, []);

  return (
    <TooltipProvider delay={200}>
      <Tooltip
        open={isTouchDevice ? open : undefined}
        onOpenChange={(nextOpen) => setOpen(nextOpen)}
      >
        <TooltipTrigger
          render={
            <span
              className={`block truncate cursor-help text-left ${className}`}
              onClick={(e) => {
                if (isTouchDevice) {
                  e.stopPropagation();
                  setOpen((prev) => !prev);
                }
              }}
            />
          }
        >
          {text}
        </TooltipTrigger>
        <TooltipContent
          className={`${maxWidth} whitespace-pre-wrap break-words text-xs leading-relaxed`}
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
