"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { chatbotAPI } from "@/features/chatbot/api";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChatbotForm,
  type ChatbotFormValues,
} from "@/features/chatbot/components/chatbot-form";
import { ChevronRight } from "lucide-react";

export default function EditChatbotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    data: config,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["chatbot", id],
    queryFn: () => chatbotAPI.get(id),
  });

  const mutation = useMutation({
    mutationFn: (values: ChatbotFormValues) =>
      chatbotAPI.update(id, {
        display_name: values.display_name,
        description: values.description,
        persona_name: values.persona_name,
        system_prompt: values.system_prompt,
        search_tiers: values.search_tiers,
        collection_main: values.collection_main,
        is_active: values.is_active,
      }),
    onSuccess: () => {
      toast.success("저장되었습니다");
      queryClient.invalidateQueries({ queryKey: ["chatbot", id] });
      queryClient.invalidateQueries({ queryKey: ["chatbots"] });
    },
    onError: (err: Error) => {
      toast.error(
        err.message.includes("연결")
          ? "서버에 연결할 수 없습니다"
          : "저장에 실패했습니다",
      );
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
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="rounded-xl border p-5 space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !config) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
        <p className="text-muted-foreground text-sm">
          설정을 불러올 수 없습니다.
        </p>
        <Link
          href="/chatbots"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-1">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
        <Link
          href="/chatbots"
          className="hover:text-foreground transition-colors"
        >
          챗봇
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-foreground font-medium">
          {config.display_name}
        </span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {config.display_name}
        </h1>
        <p className="text-sm text-muted-foreground font-mono mt-0.5">
          {config.chatbot_id}
        </p>
      </div>

      <div className="pt-4">
        <ChatbotForm
          mode="edit"
          initialValues={{
            display_name: config.display_name,
            description: config.description,
            persona_name: config.persona_name ?? "",
            system_prompt: config.system_prompt ?? "",
            is_active: config.is_active,
            collection_main: config.collection_main ?? "malssum_poc",
            search_tiers: {
              search_mode: config.search_tiers?.search_mode ?? "cascading",
              tiers: config.search_tiers?.tiers ?? [],
              weighted_sources: config.search_tiers?.weighted_sources ?? [],
              dictionary_enabled:
                config.search_tiers?.dictionary_enabled ?? false,
              query_rewrite_enabled:
                config.search_tiers?.query_rewrite_enabled ?? false,
            },
          }}
          isSubmitting={mutation.isPending}
          submitLabel="저장"
          submitPendingLabel="저장 중..."
          onCancel={() => router.push("/chatbots")}
          cancelLabel="목록으로"
          onSubmit={(values) => mutation.mutateAsync(values)}
        />
      </div>
    </div>
  );
}
