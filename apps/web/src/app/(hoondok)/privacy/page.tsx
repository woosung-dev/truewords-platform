// /privacy — 개인정보 처리방침. 비로그인으로도 읽히는 정적 화면이며 구글 OAuth 동의 화면의 처리방침 링크가 여기를 가리킨다.
// 개인정보보호위원회 작성지침의 조문 형식(제1조~제13조)을 따르고, 훈독이 실제로 저장·처리하는 것만 쓴다.
// 꾸밈(요약 카드·아이콘·목차) 없이 제목·문장·표만 둔다. 바뀌는 값(문의처·위탁처·시행일)은 features/hoondok/privacy/policy.ts 한 곳에 둔다.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  PRIVACY_CONTACT,
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_HELP_CENTERS,
  PRIVACY_HISTORY,
  PRIVACY_PROCESSORS,
  PRIVACY_VERSION,
} from "@/features/hoondok/privacy/policy";

export const metadata: Metadata = {
  title: "개인정보 처리방침 · 훈독",
  description: "훈독 운영팀이 처리하는 개인정보의 항목·목적·보유 기간과 정보주체의 권리를 안내합니다.",
};

const ARTICLES = [
  { id: "purpose", title: "개인정보의 처리 목적" },
  { id: "items", title: "처리하는 개인정보 항목 및 수집 방법" },
  { id: "period", title: "개인정보의 보유 기간" },
  { id: "destroy", title: "개인정보의 파기 절차 및 방법" },
  { id: "provide", title: "개인정보의 제3자 제공" },
  { id: "processors", title: "개인정보 처리 위탁 및 국외 이전" },
  { id: "rights", title: "정보주체의 권리와 행사 방법" },
  { id: "children", title: "만 14세 미만 아동의 개인정보" },
  { id: "security", title: "개인정보의 안전성 확보조치" },
  { id: "cookies", title: "쿠키 등 자동 수집 장치" },
  { id: "officer", title: "개인정보 보호책임자" },
  { id: "help", title: "권익침해 구제 방법" },
  { id: "changes", title: "개인정보 처리방침의 변경" },
] as const;

type ArticleId = (typeof ARTICLES)[number]["id"];

function Article({ id, children }: { id: ArticleId; children: ReactNode }) {
  const index = ARTICLES.findIndex((a) => a.id === id);
  return (
    <section className="pv-sect" id={id} aria-labelledby={`${id}-title`}>
      <h2 className="pv-sect__title" id={`${id}-title`}>
        제{index + 1}조 {ARTICLES[index].title}
      </h2>
      {children}
    </section>
  );
}

/** 2열 표 (구분 | 내용). 좁은 화면에서도 넘치지 않는다 */
function KeyTable({ head, rows }: { head: [string, string]; rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <table className="pv-table pv-table--kv">
      <thead>
        <tr>
          <th scope="col">{head[0]}</th>
          <th scope="col">{head[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function HoondokPrivacyPage() {
  return (
    <article className="col col--read pv">
      <header className="pv-head">
        <p className="pv-head__lede">
          훈독 운영팀(이하 &quot;운영팀&quot;)은 「개인정보 보호법」 제30조에 따라 정보주체의 개인정보를 보호하고 관련
          고충을 신속하게 처리하기 위하여 다음과 같이 개인정보 처리방침을 수립·공개합니다.
        </p>
        <p className="pv-head__date">
          시행일 {PRIVACY_EFFECTIVE_DATE} · 버전 {PRIVACY_VERSION}
        </p>
      </header>

      <Article id="purpose">
        <p>운영팀은 다음 목적을 위하여 개인정보를 처리하며, 목적이 바뀌면 미리 알리고 필요한 절차를 거칩니다.</p>
        <ol className="pv-list pv-list--num">
          <li>회원 가입 및 관리: 본인 식별·인증, 회원자격 유지·관리</li>
          <li>서비스 제공: 훈독 기록 저장, 다른 기기에서 이어 읽기</li>
          <li>알림 발송: 이용자가 켠 훈독 알림 전달</li>
          <li>AI 질문 답변 제공 및 하루 질문 횟수 관리</li>
          <li>오류 확인 및 서비스의 안정적 운영</li>
        </ol>
        <p>광고나 마케팅에는 이용하지 않습니다.</p>
        <p>
          위 처리는 모두 서비스 제공에 꼭 필요하여 「개인정보 보호법」 제15조 제1항 제4호(계약의 이행)에 따라 별도 동의
          없이 처리합니다.
        </p>
      </Article>

      <Article id="items">
        <KeyTable
          head={["구분", "항목"]}
          rows={[
            ["필수", "이름, 이메일 주소, 구글 계정 식별번호"],
            [
              "선택",
              "알림 받을 주소(브라우저가 생성한 값, 알림을 켠 경우), 비밀번호(기존 이메일 가입자, 일방향 암호화, 구글 연결 시 삭제)",
            ],
            ["서비스 이용 중 생성", "훈독 완료·연속일, 정성 기록, 읽던 위치, 책갈피·형광펜·노트, AI 질문과 답"],
            ["자동 수집", "로그인 쿠키, 앱 오류 기록(오류 종류와 화면 주소만, 질문·검색어 내용 제외)"],
          ]}
        />
        <p>수집 방법: 구글 로그인 또는 회원가입 화면, 서비스 이용 과정에서 자동 생성</p>
        <p>주민등록번호·전화번호·주소·위치정보는 수집하지 않습니다.</p>
      </Article>

      <Article id="period">
        <KeyTable
          head={["항목", "보유 기간"]}
          rows={[
            ["계정 정보·훈독 기록", "계정을 삭제할 때까지"],
            ["서버 백업(6시간마다 생성)", "생성 후 최대 90일 뒤 자동 삭제"],
            ["공개를 선택한 AI 질문(이름 없이 공개)", "본인이 공개를 내릴 때까지"],
          ]}
        />
      </Article>

      <Article id="destroy">
        <ol className="pv-list pv-list--num">
          <li>보유 기간이 끝나거나 처리 목적을 달성한 개인정보는 지체 없이 파기합니다.</li>
          <li>전자 파일은 복구할 수 없는 방법으로 삭제합니다. 종이로 출력한 개인정보는 두지 않습니다.</li>
          <li>
            이용자가 설정 → 내 데이터 삭제를 실행하면 훈독 기록·AI 질문·로그인 수단을 즉시 삭제하고, 계정은 누구의
            것인지 알 수 없게 처리합니다.
          </li>
        </ol>
      </Article>

      <Article id="provide">
        <p>
          운영팀은 개인정보를 제3자에게 제공하지 않습니다. 다만 정보주체가 미리 동의한 경우와 법령에 따라 수사기관이
          정해진 절차로 요구한 경우는 예외로 합니다.
        </p>
      </Article>

      <Article id="processors">
        <p>
          운영팀은 서비스 운영을 위해 아래와 같이 처리를 위탁하며, 이 중 국외에 있는 수탁자에게는 서비스 이용 시
          인터넷(HTTPS 암호화)으로 정보가 전송됩니다. 국외 이전을 원하지 않으면 계정을 삭제하여 전송을 멈출 수 있습니다.
        </p>
        <div className="pv-table-wrap" role="region" aria-label="위탁 및 국외 이전 표" tabIndex={0}>
          <table className="pv-table pv-table--wide">
            <thead>
              <tr>
                <th scope="col">수탁자(이전받는 자)</th>
                <th scope="col">국가</th>
                <th scope="col">위탁 업무</th>
                <th scope="col">이전 항목</th>
                <th scope="col">보유 기간</th>
              </tr>
            </thead>
            <tbody>
              {PRIVACY_PROCESSORS.map((p) => (
                <tr key={p.name}>
                  <th scope="row">{p.name}</th>
                  <td>{p.country}</td>
                  <td>{p.purpose}</td>
                  <td>{p.items}</td>
                  <td>{p.period}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Article>

      <Article id="rights">
        <ol className="pv-list pv-list--num">
          <li>정보주체는 언제든지 개인정보의 열람·정정·삭제·처리정지를 요구할 수 있습니다.</li>
          <li>열람: 나의 정원·나의 기록 화면 / 정정: 설정에서 표시 이름 변경 / 삭제: 설정 → 내 데이터 삭제</li>
          <li>그 밖의 요청은 제11조의 이메일로 보내 주시면 10일 이내에 처리하고 결과를 알려드립니다.</li>
          <li>법정대리인이나 위임받은 사람을 통해서도 요청할 수 있습니다.</li>
        </ol>
      </Article>

      <Article id="children">
        <p>
          훈독은 나이 제한 없이 이용할 수 있습니다. 제1조처럼 서비스 제공에 꼭 필요한 정보만 동의 없이 처리하므로 만
          14세 미만도 법정대리인 동의 절차 없이 가입할 수 있습니다. 동의가 필요한 기능을 추가하면 만 14세 미만은 그
          기능에 한해 법정대리인 동의를 받습니다. 법정대리인은 아동의 개인정보 열람·정정·삭제를 요청할 수 있습니다.
        </p>
      </Article>

      <Article id="security">
        <ol className="pv-list pv-list--num">
          <li>
            관리적 조치: 개인정보 접근권한을 필요한 최소 인원으로 제한하며, 운영자도 관리자 화면에서 이용자 기록을
            기본으로 볼 수 없습니다.
          </li>
          <li>기술적 조치: 모든 통신 암호화(HTTPS), 비밀번호 일방향 암호화, 접속 차단 시스템 운영, 정기 백업과 복구 점검</li>
          <li>물리적 조치: 서버는 출입이 통제되는 클라우드 데이터센터(Oracle Cloud)에 보관합니다.</li>
        </ol>
      </Article>

      <Article id="cookies">
        <ol className="pv-list pv-list--num">
          <li>
            운영팀은 로그인 상태 유지를 위해서만 쿠키를 사용하며, 광고·분석용 쿠키는 사용하지 않습니다.
            <ul className="pv-list pv-list--sub">
              <li>로그인 쿠키: 로그아웃하거나 계정을 삭제할 때까지</li>
              <li>구글 로그인 쿠키: 로그인하는 몇 분 동안</li>
            </ul>
          </li>
          <li>
            읽던 위치, 최근 검색어, 맞춤 첫 말씀 답, 마음 한 장, 화면 설정은 이용자 기기의 브라우저에만 저장하고 서버로
            보내지 않습니다.
          </li>
          <li>
            브라우저 설정에서 쿠키를 거부하거나 사이트 데이터를 지울 수 있습니다. 쿠키를 거부하면 로그인이 필요한 기능은
            이용할 수 없습니다.
            <ul className="pv-list pv-list--sub">
              <li>Chrome: 설정 → 개인정보 보호 및 보안 → 서드파티 쿠키</li>
              <li>Safari(iPhone): 설정 → 앱 → Safari → 방문 기록 및 웹사이트 데이터 지우기</li>
            </ul>
          </li>
        </ol>
      </Article>

      <Article id="officer">
        <p>개인정보 처리에 관한 문의·열람·삭제 요청과 불만은 아래로 보내 주시기 바랍니다.</p>
        <ul className="pv-list">
          <li>담당: {PRIVACY_CONTACT.department}</li>
          <li>
            이메일:{" "}
            <a className="pv-link" href={`mailto:${PRIVACY_CONTACT.email}`}>
              {PRIVACY_CONTACT.email}
            </a>
          </li>
        </ul>
      </Article>

      <Article id="help">
        <p>개인정보 침해에 대한 상담이나 구제가 필요하면 아래 기관에 문의할 수 있습니다.</p>
        <ul className="pv-list">
          {PRIVACY_HELP_CENTERS.map((c) => (
            <li key={c.name}>
              {c.name}: (국번 없이) {c.phone},{" "}
              <a className="pv-link" href={c.url} target="_blank" rel="noreferrer">
                {c.url.replace("https://", "")}
              </a>
            </li>
          ))}
        </ul>
      </Article>

      <Article id="changes">
        <p>
          이 방침은 {PRIVACY_EFFECTIVE_DATE}부터 시행합니다. 내용을 바꾸는 경우 시행 7일 전에 앱 안에서 먼저 알립니다.
        </p>
        {PRIVACY_HISTORY.length > 0 && <p>이전 방침 시행일: {PRIVACY_HISTORY.join(", ")}</p>}
      </Article>

      <p className="notice">훈독은 독립 운영 베타이며 FFWPU 공식 앱이 아닙니다.</p>
    </article>
  );
}
