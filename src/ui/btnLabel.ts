// ui/btnLabel.ts — 버튼 안 문구를 레이아웃 에디터에 등록하는 공용 경로.
// 문구는 버튼 이미지 기준 가운데 정렬로 놓인다: Text의 가로 앵커를 0.5로 두어
// 저장 좌표 x가 "글자 왼쪽 끝"이 아니라 "글자 중심"을 뜻하게 한다.
// 그래야 게임마다 라벨 길이가 달라도(관문용 vs 오디션용) 같은 저장값으로 같은 자리에 놓인다.
import { Container, Text } from "pixi.js";
import { pos } from "./layout";
import { editable } from "./editor";

/** 버튼 컨테이너 안의 문구 Text — pressable()이 자식을 inner Container로 감싸므로 깊이 우선으로 찾는다 */
export const btnText = (b: Container): Text | null => {
  for (const c of b.children) {
    if (c instanceof Text) return c;
    const r = btnText(c);
    if (r) return r;
  }
  return null;
};

/** 버튼 안 문구를 중앙 앵커로 등록 — 아트를 바꿔 폭이 달라져도 문구만 따로 미세조정할 수 있다.
 *  기본값은 btn()이 잡아준 가운데 위치라, 저장값이 없으면 지금 배치 그대로다. */
export function centerBtnLabel(key: string, b: Container): void {
  const t = btnText(b);
  if (!t) return;
  // 앵커를 바꾸기 전 위치가 btn()의 가운데 정렬 결과 = 버튼 중심
  const cx = Math.round(t.x + t.width / 2);
  t.anchor.x = 0.5;
  const q = pos(key, { x: cx, y: Math.round(t.y) });
  t.x = q.x;
  t.y = q.y;
  editable(key, t);
}

/** 관문 id → 레이아웃 키 접두사. 관문마다 배경판 아트 비율이 달라 패널 크기가 다르므로
 *  키를 공유하면 한쪽을 맞출 때 다른 쪽이 틀어진다.
 *  포토카드(act4)는 이미 gate_photo_* 로 저장된 값이 많아 그 접두사를 유지한다. */
export function gateKeyPrefix(gateId: string): string {
  const MAP: Record<string, string> = {
    act2: "gate_act2", act3: "gate_act3", act4: "gate_photo",
    clue4: "gate_clue", block: "gate_block",
  };
  return MAP[gateId] ?? `gate_${gateId}`;
}
