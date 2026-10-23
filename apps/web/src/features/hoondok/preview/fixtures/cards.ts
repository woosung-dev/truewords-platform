// 맞춤 첫 말씀 프리뷰 fixture. 프리뷰 셸(NEXT_PUBLIC_HOONDOK_PREVIEW=1)이 카드 목록(API-HD-054)·오늘 카드(API-HD-047) 대신
// 이 값을 써서 네트워크 요청 0으로 화면을 검토한다. 서버로 가지 않는다.
// 본문은 레포에 이미 있는 fixture 문장(library.ts 천성경 제1편 3장 단락, hoondok-cards.test.tsx 카드)을 그대로 쓰고
// 새 문장을 지어내지 않는다. topic 은 운영 seed 형식(쉼표 구분 기존 태그)을 흉내 낸 화면 검토용 값이다.
// 원리강론 카드는 레포에 원문 fixture 가 없어 두지 않았다 — "원리 공부"만 고르면 0점 폴백 화면을 볼 수 있다.
import type { CardPublic } from "@truewords/api-client-ts/types";

const VOLUME = "천성경 제1편";

export const PREVIEW_CARDS: readonly CardPublic[] = [
  {
    id: "00000000-0000-4000-8000-0000000c0001",
    text: "참사랑은 직단거리를 갑니다. 종적인 사랑은 90각도 한 점밖에 없습니다.",
    volume: VOLUME,
    chunk_id: "preview-chunk-11",
    chunk_index: 10,
    work_title: "천성경",
    source_label: "천성경 제1편 3장 11",
    topic: "사랑, 하나님(하늘부모님)",
  },
  {
    id: "00000000-0000-4000-8000-0000000c0002",
    text: "역사는 남성과 여성을 접촉시켜 나왔습니다. 남자와 여자는 하나의 기점에서 연결되어야 합니다.",
    volume: VOLUME,
    chunk_id: "preview-chunk-10",
    chunk_index: 9,
    work_title: "천성경",
    source_label: "천성경 제1편 3장 10",
    topic: "부부, 가정",
  },
  {
    id: "00000000-0000-4000-8000-0000000c0003",
    text: "그 연결은 참부모라는 내용을 중심삼고 되어야 합니다.",
    volume: VOLUME,
    chunk_id: "preview-chunk-10",
    chunk_index: 9,
    work_title: "천성경",
    source_label: "천성경 제1편 3장 10",
    topic: "참부모님, 가정",
  },
  {
    id: "00000000-0000-4000-8000-0000000c0004",
    text: "아들 낳기를 고대하던 부부는 아들을 낳았다고 하더라도 그 아들 낳은 것만 좋아해서는 안 됩니다. 어떻게 가치 있는 아들로 키우느냐 하는 문제를 놓고 걱정을 해야 합니다.",
    volume: VOLUME,
    chunk_id: "preview-chunk-12",
    chunk_index: 11,
    work_title: "천성경",
    source_label: "천성경 제1편 3장 12",
    topic: "자녀·부모, 효정, 가정",
  },
  {
    id: "00000000-0000-4000-8000-0000000c0005",
    text: "우리가 원수를 대하여 분하고 절통한 마음이 우러날 때마다 하나님은 용서의 눈물을 흘리신다는 것을 알아야 합니다.",
    volume: VOLUME,
    chunk_id: "chunk-42",
    chunk_index: 41,
    work_title: "천성경",
    source_label: "천성경 제1편 하나님 p.42",
    topic: "용서, 위로, 하나님(하늘부모님)",
  },
  {
    id: "00000000-0000-4000-8000-0000000c0006",
    text: "91도도 89도도 직단이 아닙니다. 오로지 최단거리는 90각도밖에 없습니다.",
    volume: VOLUME,
    chunk_id: "preview-chunk-11",
    chunk_index: 10,
    work_title: "천성경",
    source_label: "천성경 제1편 3장 11",
    topic: "믿음, 양심",
  },
];

/** 프리뷰의 오늘 편성 카드(0점 폴백 자리). */
export const PREVIEW_TODAY_CARD: CardPublic = PREVIEW_CARDS[0];
