// ui/assets.ts — 에셋 로더: 매니페스트(src/data/assets.json)의 슬롯을 시도 로드,
// 없는 파일은 null(→호출측 플레이스홀더). 디자이너가 파일만 드롭하면 자동 반영.
import { Assets, RenderTexture, Sprite, Texture, type Renderer } from "pixi.js";
import manifestJson from "../data/assets.json";
import { bgManifest, systemBgFile } from "./bgSlots";
import { loadUiSkins, allUiSkinSlots, reloadUiSkin } from "./uiSkin";
import { charSkinChars, charSkinFile, charSkinScale } from "./charSkins";
import { assetUrl, type HotAssetUpdate } from "./hotAssets";
import { isVideoUrl, loadVideoTexture } from "./videoLoad";

interface IdleDef { base: string; frames: number; fps: number; }
interface CharSlots { bust?: string; stand?: string; idle?: IdleDef; }
interface Manifest {
  background?: string;
  title?: string;
  loading?: string;
  characters?: Record<string, CharSlots>;
  gates?: Record<string, string>; // 관문(스테이지 게임) 배경 — 엔진 id별
}
const manifest = manifestJson as unknown as Manifest;

/** 로딩 화면 배경 — 로딩 화면 자체가 쓰므로 본 로딩과 별도로 선로드. backgrounds.json 슬롯 우선.
 *  시퀀스 업로드(bg.html) 시 여러 프레임, 단일 이미지는 1장짜리 배열 */
export async function loadLoadingBg(): Promise<Texture[]> {
  const slot = bgManifest.system.find((s) => s.id === "loading");
  if (slot?.frames && slot.frames.length > 0) {
    const texs = (await Promise.all(slot.frames.map(tryLoad))).filter((t): t is Texture => t !== null);
    if (texs.length > 0) return texs;
  }
  const single = (await tryLoad(systemBgFile("loading") ?? undefined)) ?? (await tryLoad(manifest.loading));
  return single ? [single] : [];
}

/** 앱 시작 프롤로그 영상 — 부트 첫 화면이라 본 로딩과 별도로 선로드.
 *  system 슬롯 prologue-01. 스토리 W0 배경(act0)과는 별개 슬롯이다 —
 *  story에 두면 W0 비트에서 pickBgSlot이 이 영상을 골라 act0을 덮는다.
 *  미업로드면 null → 슬라이드 단색 폴백 유지 */
export async function loadPrologueBg(): Promise<Texture | null> {
  const slot = bgManifest.system.find((s) => s.id === "prologue-01");
  return tryLoad(slot?.file || undefined);
}

export interface CharAssets {
  bust: Texture | null;
  daily: Texture | null; // 전신 일상복 (char.html daily) — 로비 센터
  dailyFrames: Texture[]; // 일상복 시퀀스 (여러 장 업로드 시) — 로비 센터 애니 재생
  stage: Texture | null; // 전신 무대의상 (char.html stage) — 안무 연습 거울 포즈 매칭 (stage-idle 알파 영상 업로드 시 비디오 텍스처)
  stageFrames: Texture[]; // 무대의상 시퀀스 (stage-idle) — 있으면 거울 매칭 애니 재생
  practiceFrames: Texture[]; // 연습복 시퀀스 (practice-idle) — 있으면 연습 보드 스탠딩 애니 재생
  /** 연습 보드 주차 영상 5종 (practice-vid-1..5). 미업로드 칸은 null — 주차로 골라 쓴다 */
  practiceVids: Array<Texture | null>;
  stand: Texture | null;
  idleFrames: Texture[]; // 비어있으면 idle 없음
  idleFps: number;
  bustIdleFrames: Texture[]; // 반신 기본표정 idle 시퀀스 (char.html exp-base-idle) — 로비 센터용
  profileFace: Texture | null; // 프로필용 밝은 표정 (exp-joy/bright/smile) — 멤버 점검 대형 프로필. 없으면 bust 폴백
  tiltLeft: Texture[];  // 스와이프 갸웃 좌측 시퀀스 (드래그 거리로 스크럽)
  tiltRight: Texture[]; // 스와이프 갸웃 우측 시퀀스
  scaleOf: (kind: string) => number; // 슬롯별 게임 배치 배율 (char.html 스테퍼) — 렌더 시점 조회
}
export interface GameAssets {
  background: Texture | null;
  title: Texture | null;
  char: (id: string) => CharAssets;
  gateBg: (engine: string, gateId?: string) => Texture | null; // 관문 배경: 관문 id 슬롯 우선 → 엔진 기본 (없으면 null → 흰 패널)
  reloadFromHotUpdate: (update: HotAssetUpdate) => Promise<boolean>;
}

/** 로딩 화면용 진행률 콜백 (done/total은 슬롯 단위) */
export type AssetProgress = (done: number, total: number) => void;

const EMPTY: CharAssets = { bust: null, daily: null, dailyFrames: [], stage: null, stageFrames: [], practiceFrames: [], practiceVids: [], stand: null, idleFrames: [], idleFps: 10, bustIdleFrames: [], profileFace: null, tiltLeft: [], tiltRight: [], scaleOf: () => 1 };

/** 개별 파일 시도 로드 — 404 등 실패는 null (플레이스홀더 폴백) */
async function tryLoad(url: string | undefined): Promise<Texture | null> {
  if (!url) return null;
  try {
    const resolved = assetUrl(url) ?? url;
    // 비디오는 Pixi 기본 로더가 WebKit에서 영원히 pending — Safari-safe 커스텀 로더 사용
    if (isVideoUrl(url)) return await loadVideoTexture(resolved);
    return await Assets.load<Texture>(resolved);
  } catch {
    return null;
  }
}

/** idle PNG 시퀀스: base_0001.png … 연번 시도, 첫 프레임 없으면 스킵.
 *  16장 배치 병렬 로드 — 프레임당 순차 왕복(93프레임 ≈ 1초+)을 제거, 첫 공백에서 중단(납품된 만큼만) */
async function tryLoadIdle(def: IdleDef | undefined): Promise<Texture[]> {
  if (!def) return [];
  const pad = (n: number): string => String(n).padStart(4, "0");
  const frames: Texture[] = [];
  const BATCH = 16;
  for (let start = 1; start <= def.frames; start += BATCH) {
    const n = Math.min(BATCH, def.frames - start + 1);
    const batch = await Promise.all(Array.from({ length: n }, (_, k) => tryLoad(`${def.base}${pad(start + k)}.png`)));
    for (const t of batch) {
      if (!t) return frames;
      frames.push(t);
    }
  }
  return frames;
}

export async function loadGameAssets(onProgress?: AssetProgress, renderer?: Renderer): Promise<GameAssets> {
  // 대형 시퀀스(93프레임 idle 등)는 표시 크기로 축소해 GPU 탑재 — VRAM 1/4 이하 + 첫 루프 업로드 히칭 제거
  const SEQ_SHRINK_MIN = 24; // 이 프레임 수 이상만 축소 (짧은 시퀀스는 원본 유지)
  const SEQ_MAX_W = 512;     // 카드 초상 폭(394)×1.3 — 시각 손실 거의 없음
  const shrinkSeq = (texs: Texture[], files: string[]): Texture[] => {
    const first = texs[0];
    if (!renderer || texs.length < SEQ_SHRINK_MIN || !first) return texs;
    if (first.width <= SEQ_MAX_W) {
      // 축소 불필요 크기 — GPU 선업로드만 (재생 첫 루프에서 프레임마다 업로드 히칭 나는 것 방지)
      const warm = RenderTexture.create({ width: 8, height: 8 });
      for (const tex of texs) {
        const spr = new Sprite(tex);
        spr.scale.set(8 / tex.width);
        renderer.render({ container: spr, target: warm });
        spr.destroy();
      }
      warm.destroy(true);
      return texs;
    }
    const out = texs.map((tex) => {
      const sc = SEQ_MAX_W / tex.width;
      const rt = RenderTexture.create({ width: Math.round(tex.width * sc), height: Math.round(tex.height * sc) });
      const spr = new Sprite(tex);
      spr.scale.set(sc);
      // clearColor 투명 지정 필수 — 기본값이 렌더러 배경색(#f8f5fd)이라 알파 PNG 뒤에 흰 박스가 깔림
      renderer.render({ container: spr, target: rt, clearColor: [0, 0, 0, 0] });
      spr.destroy();
      return rt;
    });
    void Assets.unload(files.map((f) => assetUrl(f) ?? f)).catch(() => {}); // 원본 해제 (CPU/GPU 메모리 회수)
    return out;
  };
  const legacyChars = manifest.characters ?? {};
  // 캐릭터 = 레거시 매니페스트 ∪ 스킨 슬롯 캐릭터 (스킨만 올린 캐릭터도 로드)
  const charIds = [...new Set([...Object.keys(legacyChars), ...charSkinChars.map((c) => c.id)])];
  const gateEntries = Object.entries(manifest.gates ?? {});
  const total = 2 + charIds.length * 3 + gateEntries.length + bgManifest.gates.length + allUiSkinSlots().length; // background + title + (bust·stand·idle)×캐릭터 + 관문 배경(엔진 기본 + id 슬롯) + UI 스킨
  let done = 0;
  const tick = (): void => { done++; onProgress?.(done, total); };

  // 전부 병렬 로드 — 기존의 항목별 순차 await 체인(캐릭터×시퀀스×관문 수백 왕복)이 로딩 시간의 주범이었음.
  // 브라우저가 동시 요청을 큐잉하므로 안전하고, tick 순서만 뒤섞일 뿐 진행률 총계는 동일
  let background: Texture | null = null;
  let title: Texture | null = null;
  const chars = new Map<string, CharAssets>();
  const gateBgs = new Map<string, Texture | null>();
  const gateSlotTex = new Map<string, Texture | null>(); // 관문 id별 슬롯 배경 (bg.html 에디터 업로드분)
  const loadChar = async (id: string): Promise<void> => {
    const slots = legacyChars[id] ?? {};
    // char.html 시퀀스 슬롯들 (업로드된 프레임만 로드)
    const skinSlots = charSkinChars.find((c) => c.id === id)?.slots;
    const loadSeq = async (kind: string): Promise<Texture[]> => {
      const files = skinSlots?.find((s) => s.kind === kind)?.frames ?? [];
      const texs = (await Promise.all(files.map(tryLoad))).filter((t): t is Texture => t !== null);
      return shrinkSeq(texs, files);
    };
    // 카드 스와이프 고개짓: idle 시퀀스 우선, 없으면 org 단일 이미지를 1프레임 시퀀스로
    const loadTilt = async (side: string): Promise<Texture[]> => {
      const idle = await loadSeq(`tilt-${side}-idle`);
      if (idle.length > 0) return idle;
      const org = await tryLoad(skinSlots?.find((s) => s.kind === `tilt-${side}-org`)?.file);
      return org ? [org] : [];
    };
    // 스킨(char.html 에디터) 우선 → 레거시 매니페스트 폴백: 반신=카드 초상, 연습복 전신=연습 스탠딩
    // 프로필용 밝은 표정 — 캐릭터마다 보유 종류가 달라 우선순위대로 첫 번째 존재분 사용 (미등록 kind는 요청 없이 null)
    const JOY_KINDS = ["exp-joy-org", "exp-bright-org", "exp-smile-org", "exp-awaken-org"];
    const loadJoy = async (): Promise<Texture | null> => {
      for (const k of JOY_KINDS) {
        const t = await tryLoad(charSkinFile(id, k) ?? undefined);
        if (t) return t;
      }
      return null;
    };
    const [bust, daily0, stage0, stand0, idleFrames, bustIdleFrames, dailyFrames, stageFrames, practiceFrames, tiltLeft, tiltRight, profileFace] = await Promise.all([
      (async () => { const t = (await tryLoad(charSkinFile(id, "bust") ?? undefined)) ?? (await tryLoad(slots.bust)); tick(); return t; })(),
      tryLoad(charSkinFile(id, "daily") ?? undefined), // 스킨 전용 (레거시 폴백 없음)
      tryLoad(charSkinFile(id, "stage") ?? undefined), // 무대의상 — 안무 연습 거울 매칭
      (async () => { const t = (await tryLoad(charSkinFile(id, "practice") ?? undefined)) ?? (await tryLoad(slots.stand)); tick(); return t; })(),
      (async () => { const f = await tryLoadIdle(slots.idle); tick(); return f; })(),
      loadSeq("exp-base-idle"), // 스토리 카드 숨쉬기
      loadSeq("daily-idle"),    // 일상복 시퀀스 (별도 슬롯) — 있으면 로비 센터 애니
      loadSeq("stage-idle"),    // 무대의상 시퀀스 — 있으면 안무 연습 거울 매칭 애니
      loadSeq("practice-idle"), // 연습복 시퀀스 — 있으면 연습 보드 스탠딩 애니
      loadTilt("left"),
      loadTilt("right"),
      loadJoy(),
    ]);
    // 시퀀스 슬롯에 알파 영상(webm) 단일 업로드 시 — 해당 단일 텍스처를 비디오로 대체 (자동 루프 재생)
    const videoIfWebm = async (kind: string, frames: Texture[]): Promise<Texture | null> => {
      const file = skinSlots?.find((s) => s.kind === kind)?.file ?? "";
      if (frames.length > 0 || !file.endsWith(".webm")) return null;
      return tryLoad(file);
    };
    const [dailyV, stageV, standV] = await Promise.all([
      videoIfWebm("daily-idle", dailyFrames), videoIfWebm("stage-idle", stageFrames), videoIfWebm("practice-idle", practiceFrames),
    ]);
    // 연습 보드 주차 영상 — 로딩 게이트를 막지 않도록 다른 에셋과 함께 병렬로만 받는다
    const practiceVids = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => tryLoad(charSkinFile(id, `practice-vid-${n}`) ?? undefined)),
    );
    const daily = dailyV ?? daily0;
    const stage = stageV ?? stage0;
    const stand = standV ?? stand0;
    chars.set(id, { bust, daily, dailyFrames, stage, stageFrames, practiceFrames, practiceVids, stand, idleFrames, idleFps: slots.idle?.fps ?? 10, bustIdleFrames, profileFace, tiltLeft, tiltRight, scaleOf: (kind) => charSkinScale(id, kind) });
  };
  await Promise.all([
    (async () => { background = await tryLoad(manifest.background); tick(); })(),
    (async () => { title = (await tryLoad(systemBgFile("title") ?? undefined)) ?? (await tryLoad(manifest.title)); tick(); })(),
    ...charIds.map(loadChar),
    ...gateEntries.map(async ([id, url]) => { gateBgs.set(id, await tryLoad(url)); tick(); }),
    ...bgManifest.gates.map(async (s) => { if (s.gateId) gateSlotTex.set(s.gateId, await tryLoad(s.file)); tick(); }),
    loadUiSkins(tick), // UI 컴포넌트 스킨 (ui.html 에디터 업로드분 — 미업로드는 벡터 폴백)
  ]);
  const gameAssets: GameAssets = {
    background,
    title,
    char: (id) => chars.get(id) ?? EMPTY,
    gateBg: (engine, gateId) => (gateId ? gateSlotTex.get(gateId) : null) ?? gateBgs.get(engine) ?? null,
    reloadFromHotUpdate: async (update) => {
      if (await reloadUiSkin(update)) return true;

      if (update.route === "/__bgupload" || update.route === "/__bgseq") {
        const allBgSlots = [...bgManifest.story, ...bgManifest.gates, ...bgManifest.system];
        const slot = allBgSlots.find((s) => s.id === update.id);
        if (!slot) return false;
        slot.file = update.file;
        if (update.frames) slot.frames = update.frames.length > 0 ? update.frames : undefined;
        else delete slot.frames;
        if (slot.id === "title") {
          title = await tryLoad(slot.file);
          gameAssets.title = title;
        }
        if (slot.gateId) gateSlotTex.set(slot.gateId, await tryLoad(slot.file));
        return true;
      }

      if (update.route === "/__charupload" || update.route === "/__charseq") {
        const char = charSkinChars.find((c) => c.slots.some((s) => s.id === update.id));
        const slot = char?.slots.find((s) => s.id === update.id);
        if (!char || !slot) return false;
        slot.file = update.file;
        if (update.frames) slot.frames = update.frames.length > 0 ? update.frames : undefined;
        else delete slot.frames;

        const current = chars.get(char.id) ?? { ...EMPTY };
        const skinSlots = char.slots;
        const loadSeq = async (kind: string): Promise<Texture[]> => {
          const files = skinSlots.find((s) => s.kind === kind)?.frames ?? [];
          const texs = (await Promise.all(files.map(tryLoad))).filter((t): t is Texture => t !== null);
          return shrinkSeq(texs, files);
        };
        const loadTilt = async (side: string): Promise<Texture[]> => {
          const idle = await loadSeq(`tilt-${side}-idle`);
          if (idle.length > 0) return idle;
          const org = await tryLoad(skinSlots.find((s) => s.kind === `tilt-${side}-org`)?.file);
          return org ? [org] : [];
        };

        if (slot.kind === "bust") current.bust = await tryLoad(slot.file);
        if (slot.kind === "daily") current.daily = await tryLoad(slot.file);
        if (slot.kind === "stage") current.stage = await tryLoad(slot.file);
        if (slot.kind === "stage-idle") {
          current.stageFrames = await loadSeq("stage-idle");
          if (current.stageFrames.length === 0 && slot.file.endsWith(".webm")) {
            current.stage = (await tryLoad(slot.file)) ?? current.stage; // 알파 영상 핫스왑
          }
        }
        if (slot.kind === "practice-idle") {
          current.practiceFrames = await loadSeq("practice-idle");
          if (current.practiceFrames.length === 0 && slot.file.endsWith(".webm")) {
            current.stand = (await tryLoad(slot.file)) ?? current.stand; // 알파 영상 핫스왑
          }
        }
        if (slot.kind === "daily-idle") {
          current.dailyFrames = await loadSeq("daily-idle");
          if (current.dailyFrames.length === 0 && slot.file.endsWith(".webm")) {
            current.daily = (await tryLoad(slot.file)) ?? current.daily; // 알파 영상 핫스왑
          }
        }
        if (slot.kind === "practice") current.stand = await tryLoad(slot.file);
        if (slot.kind === "exp-base-idle") current.bustIdleFrames = await loadSeq("exp-base-idle");
        if (slot.kind === "tilt-left-idle" || slot.kind === "tilt-left-org") current.tiltLeft = await loadTilt("left");
        if (slot.kind === "tilt-right-idle" || slot.kind === "tilt-right-org") current.tiltRight = await loadTilt("right");
        chars.set(char.id, current);
        return true;
      }

      return false;
    },
  };
  return gameAssets;
}
