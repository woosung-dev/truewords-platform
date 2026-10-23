// 위기 안내 (DESIGN-PLAN §7 CrisisNotice). "많이 힘들어요"를 고르면 질문 2 의 그 행 바로 아래, 첫 말씀 화면 맨 위에 같은 블록을 둔다.
// 말씀 인용·위로 수사를 섞지 않고 전화번호를 먼저 내민다. 연락처 문구는 options.ts CRISIS_CONTACTS 한 곳이다.
import { Phone } from "lucide-react";
import { CRISIS_CONTACTS } from "../options";

export function CrisisNotice({ id }: { id: string }) {
  const titleId = `${id}-title`;
  return (
    <section className="crisis" id={id} aria-labelledby={titleId}>
      <h3 className="crisis__title" id={titleId}>
        혼자 견디지 않으셔도 돼요
      </h3>
      <p className="crisis__body">
        지금 많이 힘드시면 상담 선생님과 먼저 이야기해 보세요. 두 곳 모두 24시간 전화를 받아요.
      </p>
      <div className="crisis__calls">
        {CRISIS_CONTACTS.map((contact) => (
          <a
            key={contact.id}
            className="call"
            href={contact.tel}
            aria-label={`${contact.label} ${contact.number}에 전화하기, 24시간`}
          >
            <span className="call__tx">
              <b>{contact.label}</b>
              <span>{contact.number} · 24시간</span>
            </span>
            <Phone size={22} aria-hidden="true" />
          </a>
        ))}
      </div>
      <p className="crisis__after">말씀은 그다음에 천천히 읽으셔도 괜찮아요.</p>
    </section>
  );
}
