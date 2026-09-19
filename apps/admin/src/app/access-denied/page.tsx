import { WEB_ORIGIN } from "@/lib/origins";

export default function AccessDeniedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">관리자 권한이 필요합니다</h1>
      <p className="text-muted-foreground">현재 계정은 사용자 웹에서 이용할 수 있습니다.</p>
      <a href={WEB_ORIGIN} className="text-primary underline">
        사용자 웹으로 이동
      </a>
      <a href="/login" className="text-primary underline">
        다른 계정으로 로그인
      </a>
    </main>
  );
}
