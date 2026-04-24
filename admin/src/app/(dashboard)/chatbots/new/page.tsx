"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { chatbotAPI } from "@/features/chatbot/api";
import {
  ChatbotForm,
  type ChatbotFormValues,
} from "@/features/chatbot/components/chatbot-form";
import { ChevronLeft } from "lucide-react";

export default function NewChatbotPage() {
  const router = useRouter();

  const mutation = useMutation({
    mutationFn: (values: ChatbotFormValues) => chatbotAPI.create(values),
    onSuccess: (data) => {
      toast.success("챗봇이 생성되었습니다");
      router.push(`/chatbots/${data.id}/edit`);
    },
    onError: (err: Error) => {
      const msg = err.message.includes("409")
        ? "이미 존재하는 chatbot_id입니다"
        : err.message.includes("연결")
          ? "서버에 연결할 수 없습니다"
          : "챗봇 생성에 실패했습니다";
      toast.error(msg);
    },
  });

  return (
    <div className="max-w-2xl space-y-1">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        챗봇 목록
      </button>

      <h1 className="text-2xl font-bold tracking-tight">새 챗봇 만들기</h1>
      <p className="text-sm text-muted-foreground pb-4">
        새로운 AI 챗봇의 기본 설정을 구성합니다
      </p>

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
