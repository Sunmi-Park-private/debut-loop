// ui/levelUpFx.ts — 카드 소모 → 게이지 적용 레벨업 연출 (마법소녀 변신 스타일).
// idle 캐릭터 → 카드 흡수 → 화이트 플래시·링·별 파티클 → 레벨업 포즈 + 상승치 팝업.
// 캐릭터: char.html 하루 '표정 · 기쁨' — idle 시퀀스 우선, 없으면 org 단일.
// 그것도 없으면 레거시(char_gate_idle → haru_bust → 이모지) 폴백. 탭·Space로 스킵.
import { AnimatedSprite, Assets, Container, Graphics, Sprite, Text, Texture, type Ticker } from "pixi.js";
import { pairSpace } from "./keys";
import { fullRect } from "./stage";
import { charSkinChars, charSkinFile } from "./charSkins";
import { assetUrl } from "./hotAssets";

const IDLE_URL = "assets/char/char_gate_idle.png";
const LEVELUP_URL = "assets/char/char_gate_levelup.png";
const FALLBACK_URL = "assets/char/haru_bust.webp";

const tex = async (url: string): Promise<Texture | null> => {
  if (!url) return null;
  try { return await Assets.load<Texture>(assetUrl(url) ?? url); } catch { return null; }
};

/** 레벨업 연출 재생 후 onEnd. deltaText = "실력 +6 · 멘탈 +2" 형태 */
export async function playLevelUpFx(parent: Container, ticker: Ticker, deltaText: string, onEnd: () => void): Promise<void> {
  // 하루 '표정 · 기쁨' — idle 시퀀스 프레임 → org 단일 순 (Assets.load 캐시라 반복 재생 비용 없음)
  const joyFrameFiles = charSkinChars.find((c) => c.id === "haru")?.slots.find((s) => s.kind === "exp-joy-idle")?.frames ?? [];
  const joyFrames = (await Promise.all(joyFrameFiles.map(tex))).filter((t): t is Texture => t !== null);
  const joyOrg = joyFrames.length === 0 ? await tex(charSkinFile("haru", "exp-joy-org") ?? "") : null;
  const [idleT, levelT, fbT] = await Promise.all([tex(IDLE_URL), tex(LEVELUP_URL), tex(FALLBACK_URL)]);
  const baseT = joyFrames[0] ?? joyOrg ?? idleT ?? fbT;
  const usingJoy = joyFrames.length > 0 || !!joyOrg;

  const root = new Container();
  const dim = fullRect(0x1d1030, 0.78);
  root.addChild(dim);

  const CX = 215, CY = 400;
  // 캐릭터 뒤 글로우
  const glow = new Graphics().circle(CX, CY, 150).fill({ color: 0xfff0fb, alpha: 0.22 });
  glow.scale.set(0.001);
  root.addChild(glow);
  glow.pivot.set(0, 0);

  // 캐릭터 (idle → levelup 교체)
  const charC = new Container();
  charC.x = CX;
  charC.y = CY;
  let spr: Sprite | null = null;
  const fitChar = (t: Texture): void => {
    if (!spr) { spr = new Sprite(t); charC.addChild(spr); } else spr.texture = t;
    const s = Math.min(300 / t.width, 380 / t.height);
    spr.scale.set(s);
    spr.x = -t.width * s / 2;
    spr.y = -t.height * s / 2;
  };
  if (joyFrames.length > 1) { // 기쁨 idle 시퀀스 = 애니 재생 (포즈 교체 없이 전 구간)
    const a = new AnimatedSprite(joyFrames);
    a.animationSpeed = 8 / 60;
    a.play();
    const f = joyFrames[0] as Texture;
    const s = Math.min(300 / f.width, 380 / f.height);
    a.scale.set(s);
    a.x = -f.width * s / 2;
    a.y = -f.height * s / 2;
    charC.addChild(a);
  } else if (baseT) fitChar(baseT);
  else {
    const e = new Text({ text: "👧", style: { fontSize: 130 } });
    e.x = -e.width / 2;
    e.y = -e.height / 2;
    charC.addChild(e);
  }
  root.addChild(charC);

  // 흡수될 카드
  const cardG = new Container();
  const cg = new Graphics().roundRect(-26, -34, 52, 68, 8).fill(0xfdf6fa).stroke({ width: 2.5, color: 0xff7fb0 });
  const ci = new Text({ text: "", style: { fontSize: 26 } });
  ci.x = -ci.width / 2;
  ci.y = -ci.height / 2;
  cardG.addChild(cg, ci);
  cardG.x = CX;
  cardG.y = 760;
  root.addChild(cardG);

  // 확산 링 2개 + 플래시
  const rings = [0, 1].map(() => {
    const r = new Graphics().circle(0, 0, 60).stroke({ width: 5, color: 0xffe8f4, alpha: 0.9 });
    r.x = CX; r.y = CY; r.visible = false;
    root.addChild(r);
    return r;
  });
  const flash = fullRect(0xffffff);
  flash.alpha = 0;
  root.addChild(flash);

  // 별 파티클
  interface P { el: Text; vx: number; vy: number; rot: number }
  const parts: P[] = [];
  const spawnParts = (): void => {
    const EMO = ["✨", "⭐", "💫", "🌟"];
    for (let i = 0; i < 26; i++) {
      const a = (Math.PI * 2 * i) / 26 + Math.random() * 0.4;
      const sp = 2.2 + Math.random() * 3.4;
      const el = new Text({ text: EMO[i % 4] ?? "✨", style: { fontSize: 14 + Math.random() * 16 } });
      el.x = CX; el.y = CY;
      root.addChild(el);
      parts.push({ el, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2, rot: (Math.random() - 0.5) * 0.2 });
    }
  };

  // 상승치 팝업
  const delta = new Text({ text: `LEVEL UP! ${deltaText}`, style: { fontSize: 21, fill: 0xffd884, fontWeight: "bold", stroke: { color: 0x5b2a10, width: 4 } } });
  delta.x = CX - delta.width / 2;
  delta.y = 190;
  delta.alpha = 0;
  root.addChild(delta);

  parent.addChild(root);

  // 진행
  let t = 0;
  let posed = false;
  let ended = false;
  const finish = (): void => {
    if (ended) return;
    ended = true;
    ticker.remove(step);
    offSpace();
    root.destroy({ children: true });
    onEnd();
  };
  const step = (): void => {
    t += ticker.deltaMS;
    // 0–350: 등장
    const inT = Math.min(1, t / 350);
    root.alpha = inT;
    glow.scale.set(inT);
    // 350–800: 카드가 캐릭터로 흡수
    if (t > 350 && t <= 800) {
      const k = (t - 350) / 450;
      cardG.y = 760 + (CY - 760) * k;
      cardG.scale.set(1 - k * 0.85);
      cardG.rotation = k * 1.4;
    }
    if (t > 800) cardG.visible = false;
    // 800–1000: 플래시 피크 + 파티클·링 발사 + 포즈 교체
    if (t > 800 && !posed) {
      posed = true;
      spawnParts();
      rings.forEach((r) => { r.visible = true; });
      if (!usingJoy && levelT) fitChar(levelT); // 레거시 에셋일 때만 레벨업 포즈 교체 (기쁨 표정은 그대로 유지)
    }
    if (t > 800) {
      const k = Math.min(1, (t - 800) / 200);
      flash.alpha = k < 0.5 ? k * 1.8 : Math.max(0, 0.9 - (k - 0.5) * 1.8);
      if (t > 1000) flash.alpha = Math.max(0, flash.alpha - ticker.deltaMS / 400);
      // 레벨업 바운스
      const b = Math.min(1, (t - 800) / 380);
      charC.scale.set(1 + Math.sin(b * Math.PI) * 0.14);
      rings.forEach((r, i) => {
        const rk = Math.min(1, (t - 800 - i * 140) / 620);
        if (rk <= 0) return;
        r.scale.set(0.3 + rk * 3.2);
        r.alpha = 0.9 * (1 - rk);
      });
      for (const pp of parts) {
        pp.el.x += pp.vx * (ticker.deltaMS / 16.7);
        pp.el.y += pp.vy * (ticker.deltaMS / 16.7);
        pp.vy += 0.02;
        pp.el.rotation += pp.rot;
        pp.el.alpha = Math.max(0, pp.el.alpha - ticker.deltaMS / 1400);
      }
    }
    // 1000–: 팝업 상승
    if (t > 1000) {
      const k = Math.min(1, (t - 1000) / 350);
      delta.alpha = k;
      delta.y = 190 - k * 26;
    }
    // 2300–2650: 페이드아웃 → 종료
    if (t > 2300) root.alpha = Math.max(0, 1 - (t - 2300) / 350);
    if (t > 2650) finish();
  };
  ticker.add(step);

  // 탭·Space = 스킵
  dim.eventMode = "static";
  dim.cursor = "pointer";
  dim.on("pointerdown", finish);
  const offSpace = pairSpace(() => { finish(); }, () => !ended);
}
