// ui/uiSkin.ts — UI 컴포넌트 스킨: uiskins.json 슬롯에 이미지가 있으면 Sprite/NineSlice로 교체 (ui.html 에디터로 업로드).
import { Assets, ColorMatrixFilter, Container, Graphics, NineSliceSprite, Rectangle, Sprite, Texture } from "pixi.js";
import uiskinsJson from "../data/uiskins.json";
import { assetUrl, type HotAssetUpdate } from "./hotAssets";
import { isVideoUrl, loadVideoTexture } from "./videoLoad";

export interface UiSkinSlot { id: string; label: string; file: string; size: [number, number]; mode: "stretch" | "9slice" | "3slice"; slice?: number; small?: boolean; scale?: number; opacity?: number; natural?: boolean; vid?: boolean; dom?: boolean }
export interface UiSkinScreen { id: string; label: string; slots: UiSkinSlot[] }
export const uiSkinScreens = (uiskinsJson as unknown as { screens: UiSkinScreen[] }).screens;
export const allUiSkinSlots = (): UiSkinSlot[] => uiSkinScreens.flatMap((s) => s.slots);

const loaded = new Map<string, { tex: Texture; raw: Texture; slot: UiSkinSlot }>();

/** 투명 여백 트리밍 — AI 생성 아트처럼 캔버스 대부분이 여백인 업로드도 실제 아트 영역만 사용.
 *  9slice/stretch가 여백을 늘려 빈 박스로 보이는 문제 방지. 여백이 15% 미만이면 원본 유지. */
function trimAlpha(tex: Texture): Texture {
  try {
    const res = (tex.source as unknown as { resource?: CanvasImageSource }).resource;
    if (!res || typeof document === "undefined") return tex;
    const w = tex.width;
    const h = tex.height;
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return tex;
    ctx.drawImage(res, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    const step = 2;
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step)
        if (d[(y * w + x) * 4 + 3]! > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return tex; // 전부 투명(또는 알파 없음 포맷) — 원본 유지
    const cw = Math.min(w - x0, x1 - x0 + step);
    const ch = Math.min(h - y0, y1 - y0 + step);
    if (cw * ch > w * h * 0.85) return tex;
    return new Texture({ source: tex.source, frame: new Rectangle(x0, y0, cw, ch) });
  } catch {
    return tex;
  }
}

/** 슬롯 파일 → 텍스처 (영상 슬롯은 루프 비디오 텍스처 — 트리밍·밉맵 없음) */
async function loadSlotTexture(slot: UiSkinSlot): Promise<{ tex: Texture; raw: Texture }> {
  const url = assetUrl(slot.file) ?? slot.file;
  if (isVideoUrl(url)) {
    const raw = await loadVideoTexture(url);
    return { tex: raw, raw };
  }
  const raw = await Assets.load<Texture>(url);
  raw.source.autoGenerateMipmaps = true; // 고해상도 아트 축소 시 계단 현상(깨짐) 방지
  return { tex: trimAlpha(raw), raw };
}

/** 로딩 게이트에서 뺄 슬롯 — 관문·연습·오디션 아트는 첫 화면(타이틀·로비·스토리)에서 안 쓰여
 *  백그라운드 로드로 충분 (플레이어가 해당 화면에 도달하기 한참 전에 도착) */
const DEFER_SLOT = /^(gate-|train-|audition-|member-|board-|grade-)/;

/** 게임 에셋 로딩 시 1회 — 스킨 파일 시도 로드 (미업로드는 스킵 → 벡터 폴백).
 *  첫 화면용 이미지만 병렬로 대기하고, 영상(수 MB·canplay 대기)과 후반 화면 아트는
 *  로딩 게이트를 막지 않고 백그라운드 로드 — 도착 전 진입 시엔 해당 슬롯만 폴백 */
export async function loadUiSkins(onTick?: () => void): Promise<void> {
  await Promise.all(allUiSkinSlots().map(async (slot) => {
    if (!slot.file) { onTick?.(); return; } // 삭제된(빈) 슬롯 — 로드 시도 없음
    if (slot.dom) { onTick?.(); return; }   // DOM 팝업이 CSS로 직접 참조 — Pixi 텍스처로 올릴 필요 없음
    if (isVideoUrl(assetUrl(slot.file) ?? slot.file)) {
      onTick?.();
      void loadSlotTexture(slot).then((r) => {
        loaded.set(slot.id, { ...r, slot });
        void import("./editor").then((e) => e.triggerRedraw()); // 영상 도착 → 현재 화면 갱신 (타이틀 등 폴백으로 먼저 뜬 화면 교체)
      }).catch(() => {});
      return;
    }
    if (DEFER_SLOT.test(slot.id)) {
      onTick?.();
      void loadSlotTexture(slot).then((r) => loaded.set(slot.id, { ...r, slot })).catch(() => {});
      return;
    }
    try {
      loaded.set(slot.id, { ...await loadSlotTexture(slot), slot });
    } catch { /* 미업로드 슬롯 */ }
    onTick?.();
  }));
}

export async function reloadUiSkin(update: HotAssetUpdate): Promise<boolean> {
  if (update.route !== "/__skinupload") return false;
  const slot = allUiSkinSlots().find((s) => s.id === update.id);
  if (!slot) return false;
  slot.file = update.file;
  if (!slot.file) {
    loaded.delete(slot.id);
    return true;
  }
  try {
    loaded.set(slot.id, { ...await loadSlotTexture(slot), slot });
  } catch {
    loaded.delete(slot.id);
  }
  return true;
}

/** 농도 적용 — opacity>0(연하게)=알파 감소, opacity<0(진하게)=채도 증가(색이 더 쨍하게). 0 또는 미설정=원본 */
function applyDensity(node: Container, slot: UiSkinSlot): void {
  const op = slot.opacity ?? 0;
  if (op > 0) {
    node.alpha = 1 - op;
  } else if (op < 0) {
    const f = new ColorMatrixFilter();
    f.saturate(-op * 2, false); // −50% → 채도 +100%
    node.filters = [f];
  }
}

/** 슬롯의 이미지 URL — Pixi가 아니라 **DOM/CSS**에서 쓰는 슬롯용 (메타 메뉴 팝업 등).
 *  업로드 전이면 null이라 호출측이 기존 벡터·이모지 모양을 유지한다.
 *  파일 존재 여부는 알 수 없으므로(매니페스트는 플레이스홀더 경로를 들고 있다) `dom` 슬롯은
 *  CSS background-image로 쓰고, 없으면 브라우저가 조용히 무시하도록 배경색을 함께 지정할 것. */
export function skinUrl(id: string): string | null {
  const slot = allUiSkinSlots().find((s) => s.id === id);
  if (!slot?.file) return null;
  return assetUrl(slot.file) ?? slot.file;
}

/** 업로드된 스킨의 원본 텍스처 (트리밍 없음) — 아트 좌표에 직접 그려야 하는 특수 레이아웃(게이지 프레임 등)용 */
export function skinTex(id: string): Texture | null {
  return loaded.get(id)?.raw ?? null;
}

/** 업로드된 스킨의 트리밍 텍스처 (투명 여백 제거본) — 비율 기반 배치 계산용 */
export function skinTexTrim(id: string): Texture | null {
  return loaded.get(id)?.tex ?? null;
}

/** 슬롯 배율 (ui.html 드롭다운, 미설정=1) — 호출측이 직접 치수를 계산하는 요소(말풍선 등)용 */
export function skinScale(id: string): number {
  return loaded.get(id)?.slot.scale ?? 1;
}

/** 원본 크기 스킨: 텍스처 원본 픽셀 크기 × 배율(1.0=원본 그대로, 리샘플 없음) — 박스 중심 정렬.
 *  UI 공통 버튼 4종처럼 "절대 늘리지 않는" 슬롯용. 크기 조절은 에디터 배율로만 */
export function skinNatural(id: string, w: number, h: number): Container | null {
  const hit = loaded.get(id);
  if (!hit) return null;
  const us = hit.slot.scale ?? 1;
  const sp = new Sprite(hit.tex);
  sp.scale.set(us);
  sp.x = (w - hit.tex.width * us) / 2;
  sp.y = (h - hit.tex.height * us) / 2;
  applyDensity(sp, hit.slot);
  const wrap = new Container();
  wrap.addChild(sp);
  return wrap;
}

/** 비율 유지 스킨: 박스(w×h) 안에 원본 비율 그대로 contain-fit (중앙 정렬) — 없으면 null.
 *  stretch/9slice와 달리 이미지가 절대 늘어나지 않음 (포토카드 심볼·버튼 등) */
export function skinFit(id: string, w: number, h: number): Container | null {
  const hit = loaded.get(id);
  if (!hit) return null;
  const s = Math.min(w / hit.tex.width, h / hit.tex.height) * (hit.slot.scale ?? 1);
  const sp = new Sprite(hit.tex);
  sp.scale.set(s);
  sp.x = (w - hit.tex.width * s) / 2;
  sp.y = (h - hit.tex.height * s) / 2;
  applyDensity(sp, hit.slot); // 농도 (ui.html 드롭다운)
  const wrap = new Container();
  wrap.addChild(sp);
  return wrap;
}

/** 커버 스킨: 박스(w×h)를 비율 유지로 가득 채움, 넘치는 부분은 마스크로 크롭 — 전체 배경판용.
 *  stretch와 달리 비율이 다른 아트/영상이 눌리지 않는다 (배율은 줌으로 동작) */
export function skinCover(id: string, w: number, h: number): Container | null {
  const hit = loaded.get(id);
  if (!hit) return null;
  const s = Math.max(w / hit.tex.width, h / hit.tex.height) * (hit.slot.scale ?? 1);
  const sp = new Sprite(hit.tex);
  sp.scale.set(s);
  sp.x = (w - hit.tex.width * s) / 2;
  sp.y = (h - hit.tex.height * s) / 2;
  applyDensity(sp, hit.slot);
  const wrap = new Container();
  const mask = new Graphics().roundRect(0, 0, w, h, 16).fill(0xffffff);
  sp.mask = mask;
  wrap.addChild(sp, mask);
  return wrap;
}

/** 스킨 노드: 업로드된 스킨이 있으면 노드 반환, 없으면 null(호출측이 기존 Graphics 유지).
 *  기본 = 박스 채움(stretch/9slice/3slice). slot.natural(신규 제작분) = 1배율=원본 픽셀 크기, 리샘플 없음 */
export function skinNode(id: string, w: number, h: number): Container | null {
  const hit = loaded.get(id);
  if (!hit) return null;
  if (hit.slot.natural) return skinNatural(id, w, h); // 원본 크기 규칙 — 표시 크기 기준으로 제작하는 슬롯
  const us = hit.slot.scale ?? 1;
  const sw = w * us, sh = h * us;
  let node: Container;
  if (hit.slot.mode === "3slice") {
    // 가로 3분할 커스텀 — 세로는 균일 스케일, 좌/우 캡은 같은 스케일로 원형 유지(무왜곡), 가운데만 가로로 늘림.
    // Pixi NineSlice는 세로 축소 시 캡 폭을 보정하지 않아 캡이 퍼짐 → 직접 프레임 분할.
    const tex = hit.tex;
    const s = sh / tex.height; // 세로 균일 스케일
    // slice = 표시 기준 캡 폭(px, slot.size[1] 높이 기준) → 텍스처 px 환산
    const capT = Math.min(tex.width * 0.45, (hit.slot.slice ?? 16) * (tex.height / hit.slot.size[1]));
    const capW = capT * s;
    const midT = tex.width - capT * 2;
    const midW = Math.max(1, sw - capW * 2);
    const fx = tex.frame.x, fy = tex.frame.y;
    const sub = (x0: number, w0: number): Texture =>
      new Texture({ source: tex.source, frame: new Rectangle(fx + x0, fy, w0, tex.height) });
    const c = new Container();
    const L = new Sprite(sub(0, capT));
    L.scale.set(s);
    const M = new Sprite(sub(capT, midT));
    M.scale.set(midW / midT, s);
    M.x = capW;
    const R = new Sprite(sub(tex.width - capT, capT));
    R.scale.set(s);
    R.x = capW + midW;
    c.addChild(L, M, R);
    node = c;
  } else if (hit.slot.mode === "9slice") {
    // slice는 실치수 기준 — 2배 등 고해상도 제작 에셋은 텍스처 배율만큼 보정
    const scale = hit.tex.width / hit.slot.size[0];
    const b = (hit.slot.slice ?? 16) * (Number.isFinite(scale) && scale > 0 ? scale : 1);
    node = new NineSliceSprite({ texture: hit.tex, leftWidth: b, rightWidth: b, topHeight: b, bottomHeight: b, width: sw, height: sh });
  } else {
    const s = new Sprite(hit.tex);
    s.width = sw;
    s.height = sh;
    node = s;
  }
  applyDensity(node, hit.slot); // 농도 (ui.html 드롭다운, −0.5 진하게 ~ +0.5 연하게)
  if (us === 1) return node;
  const wrap = new Container();
  node.x = (w - sw) / 2;
  node.y = (h - sh) / 2;
  wrap.addChild(node);
  return wrap;
}

// 개발용 핫스왑: ui.html 배율 조정을 리로드 없이 반영 — 현재 화면 재렌더 (터널 너머 다른 기기 포함)
if (import.meta.hot) {
  import.meta.hot.on("ui-scale-updated", (d: { slot: string; scale: number }) => {
    const s = allUiSkinSlots().find((x) => x.id === d.slot);
    if (s) s.scale = d.scale;
    void import("./editor").then((e) => e.triggerRedraw());
  });
  import.meta.hot.on("ui-opacity-updated", (d: { slot: string; opacity: number }) => {
    const s = allUiSkinSlots().find((x) => x.id === d.slot);
    if (s) s.opacity = d.opacity;
    void import("./editor").then((e) => e.triggerRedraw());
  });
}
