// ui/bgSlots.ts — 배경 슬롯 SSOT 접근 + 선택 규칙. 원본은 src/data/backgrounds.json (bg.html 에디터로 편집).
import backgroundsJson from "../data/backgrounds.json";

export interface BgSlot {
  id: string;
  label: string;
  file: string;
  beatIds?: string[]; // 스토리: 이 비트 도달 시 교체 (act보다 우선)
  act?: number;       // 스토리: 막 진입 시 교체
  gateId?: string;    // 관문 배경
  seq?: boolean;      // 시퀀스 허용 슬롯 — 여러 프레임 업로드 가능
  frames?: string[];  // 시퀀스 프레임 파일들 (있으면 게임이 영상처럼 순환 재생)
  frameMs?: number;   // 프레임 간격 ms (기본 1200)
  vid?: boolean;      // mp4 비디오 허용 슬롯 (프롤로그·로딩·리듬게임 배경) — 업로드 시 무한 루프 재생
  dim?: boolean;      // 게임 내 디밍 (블러 2×3 + 노출 −1 상당) — 기본 off=원본 그대로
}
interface BgManifest { story: BgSlot[]; gates: BgSlot[]; system: BgSlot[] }
export const bgManifest = backgroundsJson as unknown as BgManifest;

// dev 서버는 backgrounds.json을 감시 대상에서 빼두었다(업로드마다 게임이 리로드되면 런이 날아가므로).
// 그 탓에 Vite가 옛 모듈을 물고 있어, 슬롯을 새로 추가해도 배경 에디터·게임에 나타나지 않는다.
// 부팅 때 디스크를 직접 읽어(/__backgrounds GET) 제자리 교체한다 — layout·uiskins와 같은 규약.
if (import.meta.hot) {
  void fetch("/__backgrounds")
    .then((r) => (r.ok ? (r.json() as Promise<BgManifest>) : null))
    .then((disk) => {
      if (!disk) return;
      let changed = false;
      for (const k of ["story", "gates", "system"] as const) {
        const next = disk[k];
        if (!Array.isArray(next) || JSON.stringify(next) === JSON.stringify(bgManifest[k])) continue;
        bgManifest[k].splice(0, bgManifest[k].length, ...next); // 참조를 쓰는 쪽(에디터·게임)이 그대로 보게 제자리 교체
        changed = true;
      }
      if (changed) void import("./editor").then((e) => e.triggerRedraw());
    })
    .catch(() => {});
}

/** 스토리 배경 선택: beatId 일치 우선 → act 이하 최대 → null(기본 배경 폴백).
 *  빈(미업로드) 비트 슬롯은 건너뜀 — 막 슬롯(act0 프롤로그 공통 등)이 가려지지 않게 */
export function pickBgSlot(beat: { id: string; act: number }, slots: BgSlot[] = bgManifest.story): BgSlot | null {
  const byBeat = slots.find((s) => s.beatIds?.includes(beat.id) && (s.file !== "" || (s.frames?.length ?? 0) > 0));
  if (byBeat) return byBeat;
  let best: BgSlot | null = null;
  for (const s of slots) {
    if (s.act === undefined || s.act > beat.act) continue;
    if (!best || (best.act ?? -1) < s.act) best = s;
  }
  return best;
}

/** 시스템 슬롯 파일 (title/loading — 없으면 null → assets.json 폴백) */
export function systemBgFile(id: string): string | null {
  return bgManifest.system.find((s) => s.id === id)?.file ?? null;
}
