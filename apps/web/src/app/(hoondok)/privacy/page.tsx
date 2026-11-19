// /privacy — 개인정보 처리방침. 비로그인으로도 읽히는 정적 화면이며 구글 OAuth 동의 화면의 처리방침 링크가 여기를 가리킨다.
// 구성은 세계평화통일가정연합 처리방침(ffwp.org/etc/private.php)의 기본 항목 순서를 따르되, 훈독이 실제로 저장하는 것만 쓴다.
// 맨 위 "한눈에 보기"가 결론이고 아래 항목이 근거다. 바뀌는 값(책임자·위탁처·시행일)은 features/hoondok/privacy/policy.ts 한 곳에 둔다.
import { Ban, ChevronRight, Database, Smartphone, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_HELP_CENTERS,
  PRIVACY_HISTORY,
  PRIVACY_OFFICER,
  PRIVACY_PROCESSORS,
} from "@/features/hoondok/privacy/policy";

export const metadata: Metadata = {
  title: "개인정보 처리방침 · 훈독",
  description: "훈독이 어떤 정보를 왜 저장하고, 어떻게 지키고 지우는지 알려드려요.",
};

const SECTIONS = [
  { id: "collect", title: "저장하는 정보와 받는 방법" },
  { id: "purpose", title: "정보를 쓰는 곳" },
  { id: "period", title: "보관 기간" },
  { id: "destroy", title: "지우는 방법" },
  { id: "provide", title: "다른 곳에 주는 경우" },
  { id: "processors", title: "맡기는 곳과 해외 보관" },
  { id: "rights", title: "내 권리와 요청 방법" },
  { id: "cookies", title: "쿠키와 기기 저장소" },
  { id: "security", title: "안전하게 지키는 방법" },
  { id: "children", title: "만 14세 미만" },
  { id: "officer", title: "개인정보 보호책임자" },
  { id: "help", title: "도움받을 수 있는 곳" },
  { id: "changes", title: "방침이 바뀔 때" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const index = SECTIONS.findIndex((s) => s.id === id);
  return (
    <section className="pv-sect" id={id} aria-labelledby={`${id}-title`}>
      <h2 className="pv-sect__title" id={`${id}-title`}>
        <span className="pv-sect__no">{index + 1}</span>
        {SECTIONS[index].title}
      </h2>
      {children}
    </section>
  );
}

/** 이름표 + 내용 한 줄. 표 대신 써서 좁은 화면에서도 가로로 넘치지 않는다 */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pv-row">
      <dt className="pv-row__k">{label}</dt>
      <dd className="pv-row__v">{children}</dd>
    </div>
  );
}

const SUMMARY = [
  {
    icon: Database,
    title: "꼭 필요한 것만 저장해요",
    body: "구글 계정의 이름·이메일·식별번호와, 내가 남긴 훈독 기록이에요.",
  },
  {
    icon: Smartphone,
    title: "마음에 관한 답은 이 기기에만 둬요",
    body: "맞춤 첫 말씀 질문의 답과 마음 한 장은 서버로 보내지 않아요.",
  },
  {
    icon: Ban,
    title: "팔거나 광고에 쓰지 않아요",
    body: "법이 정한 경우가 아니면 다른 곳에 주지 않아요.",
  },
  {
    icon: Trash2,
    title: "언제든 직접 지울 수 있어요",
    body: "설정 → 내 데이터 삭제에서 바로 지워요.",
  },
] as const;

export default function HoondokPrivacyPage() {
  return (
    <article className="col col--read pv">
      <header className="pv-head">
        <p className="pv-head__lede">
          훈독(독립 운영 베타)이 어떤 정보를 왜 저장하고, 어떻게 지키고 지우는지 알려드려요.
        </p>
        <p className="pv-head__date">시행일 {PRIVACY_EFFECTIVE_DATE}</p>
      </header>

      <section className="card pv-sum" aria-labelledby="pv-sum-title">
        <h2 className="pv-sum__title" id="pv-sum-title">
          한눈에 보기
        </h2>
        <ul className="pv-sum__list">
          {SUMMARY.map(({ icon: Icon, title, body }) => (
            <li key={title} className="pv-sum__item">
              <span className="pv-sum__ic" aria-hidden="true">
                <Icon size={20} />
              </span>
              <span className="pv-sum__bd">
                <b className="pv-sum__t">{title}</b>
                <span className="pv-sum__d">{body}</span>
              </span>
            </li>
          ))}
        </ul>
        <Link className="pv-sum__cta" href="/settings">
          <span>설정에서 내 데이터 관리하기</span>
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
      </section>

      <nav className="pv-toc" aria-label="목차">
        <ol className="pv-toc__list">
          {SECTIONS.map((s, i) => (
            <li key={s.id}>
              <a className="pv-toc__link" href={`#${s.id}`}>
                <span className="pv-toc__no">{i + 1}</span>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="collect">
        <p>서비스에 꼭 필요한 정보만 받아요. 주민등록번호·전화번호·주소·위치 정보는 받지 않아요.</p>
        <dl className="pv-dl">
          <Row label="구글로 시작할 때">
            이름, 이메일 주소, 구글 계정 식별번호. 구글 로그인으로 받고, 구글 비밀번호는 받지 않아요.
          </Row>
          <Row label="예전 이메일 가입자">
            이메일 주소, 이름, 비밀번호(되돌릴 수 없게 바꾼 값). 구글을 연결하면 비밀번호 값은 지워요.
          </Row>
          <Row label="쓰면서 생기는 기록">
            훈독 완료와 연속일, 정성 기록, 읽던 위치, 책갈피·형광펜·노트, AI 질문과 답, 받은 오늘의 책갈피, 알림 설정과
            알림 받을 주소(브라우저가 만든 값)
          </Row>
          <Row label="자동으로 생기는 정보">
            로그인을 유지하는 쿠키, 앱 오류 기록(오류 종류와 화면 주소만 담고 질문·검색어 같은 내용은 담지 않아요)
          </Row>
        </dl>
      </Section>

      <Section id="purpose">
        <ul className="pv-list">
          <li>로그인과 본인 확인</li>
          <li>훈독 기록 저장, 다른 기기에서 이어 읽기</li>
          <li>내가 켠 훈독 알림 보내기</li>
          <li>AI 질문에 답하기 (하루 질문 횟수 세기 포함)</li>
          <li>오류를 고치고 서비스를 안정적으로 운영하기</li>
        </ul>
        <p>광고나 마케팅에는 쓰지 않아요.</p>
      </Section>

      <Section id="period">
        <dl className="pv-dl">
          <Row label="계정 정보·훈독 기록">계정을 지울 때까지</Row>
          <Row label="서버 백업">6시간마다 만드는 백업에 남았다가 최대 90일 뒤 자동으로 지워져요</Row>
          <Row label="공개한 AI 질문">
            내가 공개를 고른 질문의 첫 답만 검수 뒤 이름 없이 공개돼요. 내가 공개를 내리면 지워요
          </Row>
        </dl>
      </Section>

      <Section id="destroy">
        <p>
          보관할 이유가 없어지면 바로 지워요. 전자 파일은 다시 살릴 수 없는 방법으로 지우고, 종이로 출력한 정보는 두지
          않아요.
        </p>
        <p>
          설정에서 내 데이터를 삭제하면 훈독 기록·AI 질문·로그인 수단을 곧바로 지우고, 계정은 누구의 것인지 알 수 없게
          바꿔 둬요. 되돌릴 수 없어요.
        </p>
      </Section>

      <Section id="provide">
        <p>내 정보를 다른 곳에 주지 않아요. 다만 아래 경우는 예외예요.</p>
        <ul className="pv-list">
          <li>내가 미리 동의한 경우</li>
          <li>법에 따라 수사기관이 정해진 절차로 요구한 경우</li>
        </ul>
      </Section>

      <Section id="processors">
        <p>
          서비스를 운영하려고 아래 회사에 일부 처리를 맡겨요. 이 가운데에는 해외에 있는 곳도 있어서, 서비스를 쓸 때
          인터넷으로 정보가 전달돼요. 원하지 않으면 계정을 지워 전달을 멈출 수 있어요.
        </p>
        <div className="pv-procs">
          {PRIVACY_PROCESSORS.map((p) => (
            <dl key={p.name} className="pv-dl pv-proc">
              <dt className="pv-proc__name">{p.name}</dt>
              <dd className="pv-proc__body">
                <dl className="pv-dl pv-dl--inner">
                  <Row label="나라">{p.country}</Row>
                  <Row label="하는 일">{p.purpose}</Row>
                  <Row label="정보">{p.items}</Row>
                  <Row label="기간">{p.period}</Row>
                </dl>
              </dd>
            </dl>
          ))}
        </div>
      </Section>

      <Section id="rights">
        <p>
          내 정보는 언제든 보고, 고치고, 지우고, 처리를 멈춰 달라고 할 수 있어요. 보호자(법정대리인)도 대신 요청할 수
          있어요.
        </p>
        <dl className="pv-dl">
          <Row label="보기">나의 정원과 나의 기록에서 내 기록을 볼 수 있어요</Row>
          <Row label="고치기">설정에서 표시 이름을 바꿀 수 있어요</Row>
          <Row label="지우기">설정 → 내 데이터 삭제</Row>
          <Row label="그 밖의 요청">아래 보호책임자에게 메일을 주시면 늦어도 10일 안에 처리하고 알려드려요</Row>
        </dl>
      </Section>

      <Section id="cookies">
        <p>광고나 분석용 쿠키는 쓰지 않아요. 로그인에 필요한 쿠키만 써요.</p>
        <dl className="pv-dl">
          <Row label="로그인 쿠키">로그인 상태를 유지해요. 로그아웃하거나 계정을 지우면 사라져요</Row>
          <Row label="구글 로그인 쿠키">구글로 로그인하는 몇 분 동안만 쓰고 끝나면 사라져요</Row>
          <Row label="기기 저장소">
            읽던 위치, 최근 검색어, 맞춤 첫 말씀 답, 마음 한 장, 화면 설정은 이 기기 브라우저에만 저장하고 서버로 보내지
            않아요
          </Row>
        </dl>
        <p>
          브라우저 설정에서 쿠키를 막거나 사이트 데이터를 지울 수 있어요. 쿠키를 막으면 로그인이 필요한 기능은 쓸 수
          없어요.
        </p>
        <ul className="pv-list pv-list--sub">
          <li>Chrome: 설정 → 개인 정보 보호 및 보안 → 서드 파티 쿠키</li>
          <li>Safari(iPhone): 설정 → 앱 → Safari → 방문 기록 및 웹사이트 데이터 지우기</li>
        </ul>
      </Section>

      <Section id="security">
        <ul className="pv-list">
          <li>모든 통신은 암호화(HTTPS)해서 주고받아요</li>
          <li>비밀번호는 되돌릴 수 없는 방식으로 바꿔 저장해요</li>
          <li>운영자도 관리자 화면에서 내 기록을 기본으로 볼 수 없어요</li>
          <li>서버에 들어가는 열쇠와 비밀 값은 따로 잠가 두고, 접근할 수 있는 사람을 최소로 줄여요</li>
          <li>정기적으로 백업하고 복구를 점검해요</li>
        </ul>
      </Section>

      <Section id="children">
        <p>만 14세 미만은 보호자 동의 없이 가입할 수 없어요. 동의 없이 가입한 사실을 알게 되면 계정을 지워요.</p>
      </Section>

      <Section id="officer">
        <p>개인정보에 관한 문의·요청·불만은 아래로 보내 주세요.</p>
        <dl className="pv-dl">
          <Row label="보호책임자">
            {PRIVACY_OFFICER.name} ({PRIVACY_OFFICER.role})
          </Row>
          <Row label="이메일">
            <a className="pv-link" href={`mailto:${PRIVACY_OFFICER.email}`}>
              {PRIVACY_OFFICER.email}
            </a>
          </Row>
        </dl>
      </Section>

      <Section id="help">
        <p>개인정보 침해로 상담이나 도움이 필요하면 아래 기관에도 문의할 수 있어요.</p>
        <dl className="pv-dl">
          {PRIVACY_HELP_CENTERS.map((c) => (
            <Row key={c.name} label={c.name}>
              국번 없이 {c.phone} ·{" "}
              <a className="pv-link" href={c.url} target="_blank" rel="noreferrer">
                {c.url.replace("https://", "")}
              </a>
            </Row>
          ))}
        </dl>
      </Section>

      <Section id="changes">
        <p>이 방침을 바꾸면 시행 7일 전에 앱 안에서 먼저 알려드려요.</p>
        <dl className="pv-dl">
          <Row label="시행일">{PRIVACY_EFFECTIVE_DATE}</Row>
          {PRIVACY_HISTORY.length > 0 && <Row label="이전 방침">{PRIVACY_HISTORY.join(", ")}</Row>}
        </dl>
      </Section>

      <p className="notice">독립 운영 베타 · FFWPU 공식 앱이 아니에요</p>
    </article>
  );
}
