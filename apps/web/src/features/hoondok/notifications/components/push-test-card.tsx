"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiClient } from "@truewords/api-client-ts";
import type { PushTestResult, PushTestState } from "@truewords/api-client-ts/types";
import { useState } from "react";
import { isStandalone } from "../../install/platform";
import { hoondokFetch } from "../../observability/report";

const { request } = createApiClient({ baseUrl: "/api/backend", fetch: hoondokFetch });
const labels: Record<string, string> = {
  queued: "예약됨",
  processing: "전송 중",
  accepted: "푸시 서비스 접수",
  failed: "전송 실패",
  cancelled: "취소됨",
  expired: "기한 만료",
  unknown: "결과 불명",
};

export function PushTestCard({ userId }: { userId: string }) {
  const client = useQueryClient();
  const key = ["hoondok-push-tests", userId];
  const state = useQuery({
    queryKey: key,
    queryFn: () => request<PushTestState>("/hoondok/me/push-tests"),
    retry: false,
    refetchInterval: (query) => (query.state.data?.enabled ? 5000 : false),
  });
  const device = useQuery({
    queryKey: ["hoondok-push-test-device", userId],
    enabled: state.data?.enabled === true,
    queryFn: async () => {
      const registration = await navigator.serviceWorker?.getRegistration("/hoondok");
      const subscription = await registration?.pushManager.getSubscription();
      return { ready: Boolean(registration?.active), subscribed: Boolean(subscription) };
    },
    retry: false,
    refetchInterval: 5000,
  });
  const [minutes, setMinutes] = useState(5);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!state.data?.enabled) return null;

  async function schedule(delay: number) {
    setBusy(true);
    setMessage(null);
    try {
      if (
        !window.isSecureContext ||
        !("Notification" in window) ||
        Notification.permission !== "granted" ||
        !navigator.serviceWorker?.controller
      ) {
        setMessage("홈 화면에서 앱을 열고 이 기기의 알림을 먼저 켜 주세요");
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration("/hoondok");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) {
        setMessage("이 기기의 알림을 먼저 켜 주세요");
        return;
      }
      await request<PushTestResult>("/hoondok/me/push-tests", {
        method: "POST",
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          delay_minutes: delay,
          request_id: crypto.randomUUID(),
        }),
      });
      await client.invalidateQueries({ queryKey: key });
    } catch {
      setMessage("예약하지 못했어요. 대기 예약과 시간당 6회 제한을 확인해 주세요");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      await request(`/hoondok/me/push-tests/${id}`, { method: "DELETE" });
      await client.invalidateQueries({ queryKey: key });
    } catch {
      setMessage("취소하지 못했어요. 이미 전송이 시작되었을 수 있어요");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card col" aria-label="테스트 알림">
      <h2>테스트 알림</h2>
      <p>이 기기에만 보내요. 실제 도착은 휴대폰에서 확인해 주세요.</p>
      <p>
        {window.isSecureContext ? "HTTPS 연결" : "보안 연결 필요"} · {isStandalone() ? "설치 앱" : "브라우저"} · 알림
        권한: {"Notification" in window ? Notification.permission : "미지원"}
      </p>
      <p>
        서비스워커: {device.data?.ready ? "준비됨" : "확인 중 또는 등록 없음"} · 이 기기 구독:{" "}
        {device.data?.subscribed ? "있음" : "없음"}
      </p>
      <div className="st-stack">
        {[0, 5, 10].map((delay) => (
          <button className="btn" type="button" disabled={busy} key={delay} onClick={() => void schedule(delay)}>
            {delay ? `${delay}분 뒤` : "지금 (1분 이내)"}
          </button>
        ))}
        <label>
          직접 정하기 (분)
          <input
            type="number"
            min={1}
            max={60}
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
          />
        </label>
        <button
          className="btn"
          type="button"
          disabled={busy || !Number.isInteger(minutes) || minutes < 1 || minutes > 60}
          onClick={() => void schedule(minutes)}
        >
          예약하기
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
      <ul>
        {state.data.jobs.map((job) => (
          <li key={job.id}>
            {new Date(job.scheduled_at).toLocaleString("ko-KR")} · {labels[job.status] ?? job.status}
            {job.status === "queued" && (
              <button type="button" disabled={busy} onClick={() => void cancel(job.id)}>
                예약 취소
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
