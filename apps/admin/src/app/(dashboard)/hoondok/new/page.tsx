"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { hoondokAPI, saveErrorMessage } from "@/features/hoondok/api";
import { DailyReadingForm } from "@/features/hoondok/components/daily-reading-form";
import { isIsoDate } from "@/features/hoondok/dates";
import { type DailyReadingFormValues, emptyValues, type FormErrors, toPayload } from "@/features/hoondok/form";
import { ApiError } from "@/lib/api";

// useSearchParams 는 프리렌더 시 Suspense 경계가 필요하다 (next docs use-search-params).
export default function NewDailyReadingPage() {
  return (
    <Suspense fallback={<Skeleton className="h-9 w-56" />}>
      <NewDailyReading />
    </Suspense>
  );
}

function NewDailyReading() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // 목록의 "편성하기" 가 ?date= 로 빈 날을 넘긴다. 형식이 틀리면 무시한다.
  const requestedDate = useSearchParams().get("date") ?? "";
  const [serverErrors, setServerErrors] = useState<FormErrors>();

  const mutation = useMutation({
    mutationFn: (values: DailyReadingFormValues) => hoondokAPI.create(toPayload(values)),
    onMutate: () => setServerErrors(undefined),
    onSuccess: () => {
      toast.success("편성이 등록되었습니다");
      queryClient.invalidateQueries({ queryKey: ["hoondok"] });
      router.push("/hoondok");
    },
    onError: (err: Error) => {
      toast.error(saveErrorMessage(err, "등록에 실패했습니다"));
      if (err instanceof ApiError && err.status === 409) setServerErrors({ reading_date: err.message });
    },
  });

  return (
    <div className="max-w-2xl space-y-1">
      <button
        type="button"
        onClick={() => router.push("/hoondok")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        훈독 편성
      </button>

      <h1 className="text-2xl font-bold tracking-tight">새 편성</h1>
      <p className="text-sm text-muted-foreground pb-4">하루 한 건이에요. 같은 날짜에 편성이 있으면 저장되지 않아요.</p>

      <DailyReadingForm
        mode="create"
        initialValues={emptyValues(isIsoDate(requestedDate) ? requestedDate : "")}
        serverErrors={serverErrors}
        isSubmitting={mutation.isPending}
        submitLabel="등록"
        submitPendingLabel="등록 중..."
        onCancel={() => router.push("/hoondok")}
        cancelLabel="취소"
        onSubmit={(values) => mutation.mutate(values)}
      />
    </div>
  );
}
