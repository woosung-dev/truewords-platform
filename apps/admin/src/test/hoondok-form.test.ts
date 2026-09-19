import { describe, expect, it } from "vitest";
import { emptyValues, fromReading, toPayload, validate } from "@/features/hoondok/form";
import type { DailyReading } from "@/features/hoondok/types";

function filled() {
  return {
    ...emptyValues("2026-09-19"),
    title: " 참사랑은 직단거리를 갑니다 ",
    body: "본문",
    speaker: "참어머님",
    work_title: "참어머님 말씀 모음",
  };
}

describe("validate", () => {
  it("빈 폼은 필수 5개(날짜·제목·본문·화자·저작물)를 잡는다", () => {
    const errors = validate(emptyValues());
    expect(Object.keys(errors).sort()).toEqual(["body", "reading_date", "speaker", "title", "work_title"]);
    expect(errors.title).toBe("필수 항목이에요");
  });

  it("정상 값은 오류 0", () => {
    expect(validate(filled())).toEqual({});
  });

  it("날짜는 YYYY-MM-DD 이면서 존재하는 날짜여야 한다", () => {
    for (const bad of ["2026/09/19", "2026-13-45", "2026-02-30", "19-09-2026"]) {
      expect(validate({ ...filled(), reading_date: bad }).reading_date).toMatch(/YYYY-MM-DD/);
    }
    expect(validate({ ...filled(), reading_date: "2026-09-19" }).reading_date).toBeUndefined();
  });

  it("예상 분은 1~60 정수", () => {
    for (const bad of ["2.5", "0", "61", "", "abc", "-3"]) {
      expect(validate({ ...filled(), estimated_minutes: bad }).estimated_minutes).toBe("1~60 사이 정수여야 해요");
    }
    for (const ok of ["1", "3", "60", " 10 "]) {
      expect(validate({ ...filled(), estimated_minutes: ok }).estimated_minutes).toBeUndefined();
    }
  });

  it("varchar 길이를 넘으면 서버 422 전에 잡는다", () => {
    expect(validate({ ...filled(), speaker: "가".repeat(65) }).speaker).toBe("64자 이내로 입력해 주세요");
    expect(validate({ ...filled(), title: "가".repeat(200) }).title).toBeUndefined();
    expect(validate({ ...filled(), source_note: "가".repeat(501) }).source_note).toBe("500자 이내로 입력해 주세요");
  });
});

describe("toPayload", () => {
  it("공백을 다듬고 선택 필드의 빈 값은 null, 분은 숫자", () => {
    const payload = toPayload(filled());
    expect(payload).toEqual({
      reading_date: "2026-09-19",
      title: "참사랑은 직단거리를 갑니다",
      body: "본문",
      speaker: "참어머님",
      spoken_on: null,
      work_title: "참어머님 말씀 모음",
      edition: null,
      authority_grade: "R",
      review_status: "unverified",
      source_note: null,
      chunk_id: null,
      estimated_minutes: 3,
    });
    expect(typeof payload.estimated_minutes).toBe("number");
  });

  it("선택 필드에 값이 있으면 다듬어 보낸다", () => {
    const payload = toPayload({ ...filled(), spoken_on: " 2012.9.17 ", edition: "최종본", estimated_minutes: " 5 " });
    expect(payload.spoken_on).toBe("2012.9.17");
    expect(payload.edition).toBe("최종본");
    expect(payload.estimated_minutes).toBe(5);
  });
});

describe("fromReading", () => {
  it("null 은 빈 문자열, 숫자는 문자열로 폼에 올린다", () => {
    const reading: DailyReading = {
      id: "11111111-1111-1111-1111-111111111111",
      reading_date: "2026-09-19",
      title: "제목",
      body: "본문",
      speaker: "참아버님",
      spoken_on: null,
      work_title: "저작물",
      edition: null,
      authority_grade: "O1",
      review_status: "reviewed",
      source_note: null,
      chunk_id: null,
      estimated_minutes: 4,
      created_at: "2026-09-19T00:00:00",
      updated_at: "2026-09-19T00:00:00",
    };
    const values = fromReading(reading);
    expect(values.spoken_on).toBe("");
    expect(values.estimated_minutes).toBe("4");
    expect(values.authority_grade).toBe("O1");
    // 라운드트립: 그대로 저장하면 같은 내용이 된다
    expect(toPayload(values)).toMatchObject({
      title: "제목",
      edition: null,
      estimated_minutes: 4,
      review_status: "reviewed",
    });
  });
});
