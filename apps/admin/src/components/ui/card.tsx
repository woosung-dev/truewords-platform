import type * as React from "react";

import { cn } from "@/lib/utils";

// 관리자 카드 표면 — 화면마다 손으로 쓰던 "rounded-xl border bg-card" 를 한 곳에 둔다.
// 기본 안쪽 여백은 p-5 다. 표를 감싸는 카드는 className="overflow-hidden p-0" 처럼 덮어 쓴다(cn 이 병합).
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("rounded-xl border bg-card p-5", className)} {...props} />;
}

export { Card };
