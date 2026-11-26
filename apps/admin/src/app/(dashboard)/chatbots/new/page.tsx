"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { chatbotAPI } from "@/features/chatbot/api";
import { ApiError } from "@/lib/api";
import { ChatbotForm, type ChatbotFormValues } from "@/features/chatbot/components/chatbot-form";

export default function NewChatbotPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (values: ChatbotFormValues) => chatbotAPI.create(values),
    onSuccess: (data) => {
      toast.success("챗봇이 생성되었습니다");
      // 목록·대시보드 캐시에 새 챗봇이 빠지지 않도록 접두 ["chatbots"] 전체를 무효화한다.
      queryClient.invalidateQueries({ queryKey: ["chatbots"] });
      router.push(`/chatbots/${data.id}/edit`);
    },
    onError: (err: Error) => {
      // 오류 메시지 문자열에는 HTTP 상태가 들어 있지 않으므로 status 로 분기한다.
      // fetch 자체가 실패하면(네트워크) ApiError 가 아니라 TypeError 가 온다.
      const msg =
        err instanceof ApiError && err.status === 409
          ? "이미 존재하는 chatbot_id입니다"
          : err instanceof TypeError
            ? "서버에 연결할 수 없습니다"
            : "챗봇 생성에 실패했습니다";
      toast.error(msg);
    },
  });

  return (
    <div className="page-form space-y-1">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        챗봇 목록
      </button>

      <h1 className="text-2xl font-bold tracking-tight">새 챗봇 만들기</h1>
      <p className="text-sm text-muted-foreground pb-4">새로운 AI 챗봇의 기본 설정을 구성합니다</p>

      <ChatbotForm
        mode="create"
        isSubmitting={mutation.isPending}
        submitLabel="생성"
        submitPendingLabel="생성 중..."
        onCancel={() => router.back()}
        cancelLabel="취소"
        onSubmit={(values) => mutation.mutateAsync(values)}
      />
    </div>
  );
}
