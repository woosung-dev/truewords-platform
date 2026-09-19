"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { hoondokAPI, saveErrorMessage } from "@/features/hoondok/api";
import { DailyReadingForm } from "@/features/hoondok/components/daily-reading-form";
import { formatDayLabel } from "@/features/hoondok/dates";
import { type DailyReadingFormValues, type FormErrors, fromReading, toPayload } from "@/features/hoondok/form";
import { ApiError } from "@/lib/api";

export default function EditDailyReadingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [serverErrors, setServerErrors] = useState<FormErrors>();

  const {
    data: reading,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["hoondok", "daily-reading", id],
    queryFn: () => hoondokAPI.get(id),
  });

  // PUT 은 폼 값 전체를 보낸다(API 는 보낸 필드만 바꾸므로 안전). 철회도 review_status 로 같은 경로.
  const mutation = useMutation({
    mutationFn: (values: DailyReadingFormValues) => hoondokAPI.update(id, toPayload(values)),
    onMutate: () => setServerErrors(undefined),
    onSuccess: () => {
      toast.success("저장되었습니다");
      queryClient.invalidateQueries({ queryKey: ["hoondok"] });
    },
    onError: (err: Error) => {
      toast.error(saveErrorMessage(err, "저장에 실패했습니다"));
      if (err instanceof ApiError && err.status === 409) setServerErrors({ reading_date: err.message });
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-9 w-56" />
        <div className="rounded-xl border p-5 space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !reading) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
        <p className="text-muted-foreground text-sm">편성을 찾을 수 없습니다.</p>
        <Link href="/hoondok" className={buttonVariants({ variant: "outline", size: "sm" })}>
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-1">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
        <Link href="/hoondok" className="hover:text-foreground transition-colors">
          훈독 편성
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-foreground font-medium">{formatDayLabel(reading.reading_date)}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{reading.title}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{reading.reading_date}</p>
      </div>

      <div className="pt-4">
        <DailyReadingForm
          mode="edit"
          initialValues={fromReading(reading)}
          serverErrors={serverErrors}
          isSubmitting={mutation.isPending}
          submitLabel="저장"
          submitPendingLabel="저장 중..."
          onCancel={() => router.push("/hoondok")}
          cancelLabel="목록으로"
          onSubmit={(values) => mutation.mutate(values)}
        />
      </div>
    </div>
  );
}
