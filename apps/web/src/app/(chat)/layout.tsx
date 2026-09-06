// 채팅 사용자 페이지 레이아웃 — 시연 기간 로그인 필수 (AuthGuard, 관리자 아님도 허용)
import AuthGuard from "@/features/auth/components/auth-guard";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
