// ui/charSkins.ts — 캐릭터 스킨 슬롯 SSOT 접근. 원본은 src/data/charskins.json (char.html 에디터로 업로드).
import charskinsJson from "../data/charskins.json";

export interface CharSkinSlot {
  id: string;    // "<charId>-<kind>"
  kind: string;  // daily | practice | stage | bust | exp-<표정>-org | exp-<표정>-idle
  label: string;
  shape: "full" | "bust" | "exp";
  file: string;
  seq?: boolean;      // idle 표정 = 시퀀스 슬롯 (여러 프레임)
  vid?: boolean;      // 알파 영상 허용 슬롯 — mov(자동 webm 변환)/webm 단일 업로드로 시퀀스 대체
  frames?: string[];  // 시퀀스 프레임 파일들
  scale?: number;     // 게임 배치 배율 (1~2 · 0.2 단위, char.html 스테퍼 — 미설정=1)
}
export interface CharSkinChar {
  id: string;
  name: string;
  color: string;
  temp?: boolean;
  slots: CharSkinSlot[];
}
export const charSkinChars = (charskinsJson as unknown as { chars: CharSkinChar[] }).chars;

/** 디스크의 최신 charskins.json으로 맞춘다 (dev 전용).
 *  이 파일은 dev 서버 감시 대상에서 빠져 있어(업로드마다 게임이 리로드되면 작업이 끊긴다)
 *  Vite가 옛 모듈을 물고 있는 구간이 생긴다 — 새로 추가한 슬롯이 에디터에 안 보이는 원인.
 *  배열을 제자리에서 갈아끼워, 이미 이 배열을 들고 있는 쪽도 새 값을 본다. */
export async function refreshCharSkins(): Promise<boolean> {
  if (!import.meta.hot) return false;
  try {
    const r = await fetch("/__charskins");
    if (!r.ok) return false;
    const fresh = (await r.json()) as { chars?: CharSkinChar[] };
    if (!Array.isArray(fresh.chars)) return false;
    charSkinChars.splice(0, charSkinChars.length, ...fresh.chars);
    return true;
  } catch { return false; }
}
export const allCharSkinSlots = (): CharSkinSlot[] => charSkinChars.flatMap((c) => c.slots);

/** 캐릭터·종류별 스킨 파일 경로 (슬롯 정의가 없으면 null — 존재 여부는 로드 시 판정) */
export function charSkinFile(charId: string, kind: string): string | null {
  return charSkinChars.find((c) => c.id === charId)?.slots.find((s) => s.kind === kind)?.file ?? null;
}

/** 캐릭터·종류별 게임 배치 배율 (미설정=1) — 렌더 시점 조회라 핫스왑 즉시 반영 */
export function charSkinScale(charId: string, kind: string): number {
  return charSkinChars.find((c) => c.id === charId)?.slots.find((s) => s.kind === kind)?.scale ?? 1;
}

// 개발용 핫스왑: char.html 배율 조정을 리로드 없이 반영 — 현재 화면 재렌더 (터널 너머 다른 기기 포함)
if (import.meta.hot) {
  import.meta.hot.on("char-scale-updated", (d: { slot: string; scale: number }) => {
    const s = allCharSkinSlots().find((x) => x.id === d.slot);
    if (s) s.scale = d.scale;
    void import("./editor").then((e) => e.triggerRedraw()); // 동적 import — 에디터 페이지(char.html)에선 미로드로 무해
  });
}
