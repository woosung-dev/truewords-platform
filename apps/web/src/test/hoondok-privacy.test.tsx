import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HoondokPrivacyPage from "@/app/(hoondok)/privacy/page";
import { PRIVACY_CONTACT, PRIVACY_PROCESSORS } from "@/features/hoondok/privacy/policy";

// 개인정보 처리방침 (/privacy). 구글 OAuth 동의 화면이 링크하는 공개 화면이다.
describe("개인정보 처리방침", () => {
  it("제1조부터 제13조까지 조문 순서대로 보여주고, 요약 카드·목차 같은 꾸밈은 두지 않는다", () => {
    render(<HoondokPrivacyPage />);
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
    expect(titles).toHaveLength(13);
    titles.forEach((t, i) => expect(t.startsWith(`제${i + 1}조 `)).toBe(true));
    expect(screen.queryByRole("navigation", { name: "목차" })).toBeNull();
    expect(screen.queryByText("한눈에 보기")).toBeNull();
  });

  it("처리 근거·기기에만 두는 정보·문의처를 알리고, 개인 이름은 싣지 않는다", () => {
    render(<HoondokPrivacyPage />);
    expect(screen.getByText(/제15조 제1항 제4호\(계약의 이행\)/)).toBeInTheDocument();
    expect(screen.getByText(/이용자 기기의 브라우저에만 저장하고 서버로 보내지 않습니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: PRIVACY_CONTACT.email })).toHaveAttribute(
      "href",
      `mailto:${PRIVACY_CONTACT.email}`,
    );
    expect(screen.getByText(`담당: ${PRIVACY_CONTACT.department}`)).toBeInTheDocument();
    expect(screen.queryByText(/장우성/)).toBeNull();
  });

  it("처리를 맡기는 곳마다 나라·업무·항목·기간을 표 한 줄에 적는다 (국외 이전 고지)", () => {
    render(<HoondokPrivacyPage />);
    const table = screen.getByRole("region", { name: "위탁 및 국외 이전 표" });
    for (const p of PRIVACY_PROCESSORS) {
      const row = within(table).getByRole("rowheader", { name: p.name }).closest("tr");
      expect(row).not.toBeNull();
      for (const v of [p.country, p.purpose, p.items, p.period]) {
        expect(within(row as HTMLElement).getByText(v)).toBeInTheDocument();
      }
    }
  });
});
