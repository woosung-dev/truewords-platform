import { beforeEach, describe, expect, it } from "vitest";

import { claimDeviceForUser } from "@/features/identity/device-owner";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function seedDeviceRecords(): void {
  localStorage.setItem("hoondok:ask:items", JSON.stringify([{ id: "x", question: "앞사람의 질문" }]));
  localStorage.setItem("hoondok:read:last", JSON.stringify({ volume: "말씀선집 355권", page: 2 }));
  localStorage.setItem("hoondok:search:recent", JSON.stringify(["앞사람 검색어"]));
}

describe("기기 기록 소유자", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("다른 계정이 로그인하면 앞 계정의 질문·이어 읽기·최근 검색을 지운다", () => {
    seedDeviceRecords();
    claimDeviceForUser(USER_A, false);
    seedDeviceRecords();

    claimDeviceForUser(USER_B, false);

    expect(localStorage.getItem("hoondok:ask:items")).toBeNull();
    expect(localStorage.getItem("hoondok:read:last")).toBeNull();
    expect(localStorage.getItem("hoondok:search:recent")).toBeNull();
    expect(localStorage.getItem("hoondok:device-owner")).toBe(USER_B);
  });

  it("같은 계정이 다시 로그인하면 본인 기록을 남긴다", () => {
    claimDeviceForUser(USER_A, false);
    seedDeviceRecords();

    claimDeviceForUser(USER_A, false);

    expect(localStorage.getItem("hoondok:ask:items")).toContain("앞사람의 질문");
    expect(localStorage.getItem("hoondok:read:last")).not.toBeNull();
  });

  it("둘러보다 가입하면 익명으로 남긴 본인 기록을 남긴다", () => {
    seedDeviceRecords();

    claimDeviceForUser(USER_A, true);

    expect(localStorage.getItem("hoondok:ask:items")).toContain("앞사람의 질문");
    expect(localStorage.getItem("hoondok:device-owner")).toBe(USER_A);
  });

  it("앞 계정이 쓰던 기기에서 가입하면 앞 계정 기록을 지운다", () => {
    claimDeviceForUser(USER_A, false);
    seedDeviceRecords();

    claimDeviceForUser(USER_B, true);

    expect(localStorage.getItem("hoondok:ask:items")).toBeNull();
    expect(localStorage.getItem("hoondok:device-owner")).toBe(USER_B);
  });
});
