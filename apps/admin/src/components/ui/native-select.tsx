import { ChevronDownIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

// 브라우저 기본 <select> 를 Input 과 같은 높이·테두리·포커스 링으로 맞춘 래퍼.
// 네이티브 요소를 그대로 써서 키보드·모바일 선택 UI 와 getByLabelText 테스트가 바뀌지 않는다.
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <div data-slot="native-select-wrapper" className="relative w-full">
      <select
        data-slot="native-select"
        className={cn(
          "h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        {...props}
      />
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { NativeSelect };
