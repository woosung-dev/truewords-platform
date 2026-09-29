"use client";

// 원문 뷰 하단 독 (폰·태블릿). 형광펜·노트·목차 세 도구가 가운데 떠 있는 캡슐에 모이고,
// 듣는 중이면 오른쪽에 미니 플레이어가 붙는다. 스크롤로 크롬이 접히면(use-reading-chrome) 도구는 접히고
// 미니 플레이어만 "단락 k / n" 알약으로 남는다 — 위 듣기 바가 앱바 뒤로 숨어도 재생을 멈출 수 있게.
// ≥1024px 에서는 숨고 본문 위 가로 툴바(ReaderBar)가 대신한다.
import { Pause, Play } from "lucide-react";
import type { CSSProperties } from "react";
import { playbackLabel, togglePlayback } from "../tts/tts-bar";
import type { ReadAloud } from "../tts/use-read-aloud";
import { READER_TOOLS, type ReaderAction } from "./reader-tools";

function MiniPlayer({ reader, total }: { reader: ReadAloud; total: number }) {
  const position = reader.currentIndex + 1;
  const percent = total > 0 ? Math.round((position / total) * 100) : 0;
  return (
    <button
      type="button"
      className="wd-mini"
      aria-label={`${playbackLabel(reader)} · 단락 ${position} / ${total}`}
      aria-busy={reader.isLoading || undefined}
      disabled={reader.isResolving}
      onClick={() => togglePlayback(reader)}
      style={{ "--wd-p": percent } as CSSProperties}
    >
      <span className="wd-mini__pp" aria-hidden="true">
        {reader.isLoading ? (
          <span className="btn__spinner" />
        ) : reader.status === "playing" ? (
          <Pause size={16} />
        ) : (
          <Play size={16} />
        )}
      </span>
      <span className="wd-mini__t" aria-hidden="true">
        단락 {position} / {total}
      </span>
    </button>
  );
}

export function ReaderDock({
  reader,
  total,
  onAction,
}: {
  reader: ReadAloud;
  total: number;
  onAction: (action: ReaderAction) => void;
}) {
  const isListening = reader.isSupported && (reader.status === "playing" || reader.status === "paused");
  return (
    <div className="wd-dock" data-listening={isListening || undefined}>
      <div className="wd-dock__tools" aria-label="읽기 도구">
        {READER_TOOLS.map(({ action, label, Icon }) => (
          <button key={action} type="button" onClick={() => onAction(action)}>
            <Icon size={18} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      {isListening && (
        <>
          <span className="wd-dock__div" aria-hidden="true" />
          <MiniPlayer reader={reader} total={total} />
        </>
      )}
    </div>
  );
}
