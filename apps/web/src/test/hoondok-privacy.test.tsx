import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HoondokPrivacyPage from "@/app/(hoondok)/privacy/page";
import { PRIVACY_OFFICER, PRIVACY_PROCESSORS } from "@/features/hoondok/privacy/policy";

// 개인정보 처리방침 (/privacy). 구글 OAuth 동의 화면이 링크하는 공개 화면이다.
describe("개인정보 처리방침", () => {
  it("결론(한눈에 보기)을 목차·항목보다 먼저 보여주고, 목차는 각 항목으로 이어진다", () => {
    const { container } = render(<HoondokPrivacyPage />);
    const summary = screen.getByRole("heading", { name: "한눈에 보기" });
    const toc = screen.getByRole("navigation", { name: "목차" });
    expect(summary.compareDocumentPosition(toc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const links = within(toc).getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(10);
    for (const link of links) {
      const id = link.getAttribute("href")?.slice(1) ?? "";
      expect(container.querySelector(`section#${id}`)).not.toBeNull();
    }
  });

  it("기기에만 두는 정보·삭제 경로·보호책임자 연락처를 알린다", () => {
    render(<HoondokPrivacyPage />);
    expect(screen.getByText("마음에 관한 답은 이 기기에만 둬요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /설정에서 내 데이터 관리하기/ })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: PRIVACY_OFFICER.email })).toHaveAttribute(
      "href",
      `mailto:${PRIVACY_OFFICER.email}`,
    );
  });

  it("처리를 맡기는 곳마다 나라와 하는 일을 적는다 (국외 이전 고지)", () => {
    render(<HoondokPrivacyPage />);
    for (const p of PRIVACY_PROCESSORS) {
      const card = screen.getByText(p.name).closest("dl");
      expect(card).not.toBeNull();
      expect(within(card as HTMLElement).getByText(p.country)).toBeInTheDocument();
      expect(within(card as HTMLElement).getByText(p.purpose)).toBeInTheDocument();
    }
  });
});
