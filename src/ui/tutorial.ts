// ui/tutorial.ts — 캐릭터 가이드 튜토리얼 (기기당 1회, DOM 오버레이).
// 첫 등장 시점에 캐릭터 말풍선으로 조작 안내. localStorage 가드 → 회귀(2회차)에도 재노출 없음.
// 이미지는 기존 에셋 재활용(public/assets/char/*_bust.png) — 없으면 이모지 폴백, 파일 드롭 시 자동 전환.

import { pairSpace } from "./keys";

const KEY_PREFIX = "debutloop.tut.";

interface Speaker { name: string; img: string; skin?: string; emoji: string; tint: string }
const SPEAKERS: Record<string, Speaker> = {
  haru:  { name: "하루",   img: "assets/char/haru_bust.png",  skin: "assets/char/skin/haru-bust.png",  emoji: "👧", tint: "#8f80ea" },
  yuwol: { name: "유월",   img: "assets/char/yuwol_bust.png", skin: "assets/char/skin/yuwol-bust.png", emoji: "🎤", tint: "#ff7fb0" },
  staff: { name: "스태프", img: "assets/char/staff_bust.png", skin: "assets/char/skin/staff_jung-bust.png", emoji: "🧑‍💼", tint: "#f0c05a" },
};

/** 가이드 표시 (id당 기기 1회). 표시했으면 true */
export function guide(id: string, speakerId: keyof typeof SPEAKERS, text: string): boolean {
  if (localStorage.getItem(KEY_PREFIX + id)) return false;
  localStorage.setItem(KEY_PREFIX + id, "1");
  show(SPEAKERS[speakerId] ?? SPEAKERS["haru"] as Speaker, text);
  return true;
}

/** 순차 가이드 (id당 기기 1회) — 말풍선을 탭할 때마다 다음 단계 표시 */
export function guideSeq(id: string, steps: Array<[keyof typeof SPEAKERS, string]>): boolean {
  if (localStorage.getItem(KEY_PREFIX + id)) return false;
  localStorage.setItem(KEY_PREFIX + id, "1");
  const next = (i: number): void => {
    const s = steps[i];
    if (!s) return;
    show(SPEAKERS[s[0]] ?? SPEAKERS["haru"] as Speaker, s[1], () => next(i + 1));
  };
  next(0);
  return true;
}

function show(sp: Speaker, text: string, onDone?: () => void): void {
  const bg = document.createElement("div");
  bg.style.cssText = "position:fixed;inset:0;z-index:1100;background:#1d103085;backdrop-filter:blur(1.5px)";

  // 캔버스 기준 하단 중앙 배치
  const cv = document.querySelector("canvas");
  const r = cv?.getBoundingClientRect();
  const box = document.createElement("div");
  box.style.cssText = `position:absolute;width:${r ? Math.min(r.width - 28, 360) : 340}px;display:flex;align-items:flex-end;gap:10px;`;
  if (r) {
    box.style.left = `${r.left + r.width / 2}px`;
    box.style.bottom = `${window.innerHeight - r.bottom + 90}px`;
    box.style.transform = "translateX(-50%)";
  } else {
    box.style.left = "50%";
    box.style.bottom = "90px";
    box.style.transform = "translateX(-50%)";
  }

  // 초상: 기존 이미지 재활용, 로드 실패 시 이모지
  const face = document.createElement("div");
  face.style.cssText = `flex:none;width:64px;height:64px;border-radius:50%;overflow:hidden;border:3px solid ${sp.tint};background:#241539;display:flex;align-items:center;justify-content:center;font-size:30px;box-shadow:0 6px 18px #0008`;
  const img = document.createElement("img");
  img.style.cssText = "width:100%;height:100%;object-fit:cover;object-position:top";
  // 스킨(char.html 업로드) → 레거시 파일 → 이모지 순 폴백
  img.onerror = () => {
    if (img.src.includes("/skin/")) { img.src = sp.img; return; }
    img.remove();
    face.textContent = sp.emoji;
  };
  img.src = sp.skin ?? sp.img;
  face.appendChild(img);

  const bubble = document.createElement("div");
  bubble.style.cssText = "flex:1;background:linear-gradient(180deg,#fff,#fdf6fa);border:2px solid " + sp.tint + ";border-radius:16px 16px 16px 4px;padding:12px 14px;box-shadow:0 10px 30px -8px #000a";
  bubble.innerHTML = `<div style="font-size:11.5px;font-weight:900;color:${sp.tint};margin-bottom:4px">${sp.name}</div>
    <div style="font-size:13.5px;color:#3a2a45;line-height:1.65;font-weight:600">${text}</div>
    <div style="font-size:10.5px;color:#b8a8cc;margin-top:8px;text-align:right">탭하여 계속 ▸</div>`;

  box.append(face, bubble);
  bg.appendChild(box);
  document.body.appendChild(bg);

  // 고스트 클릭 차단: 직전 탭의 합성 click이 즉시 닫아버리는 것 방지 (탭·Space 동일)
  const openedAt = performance.now();
  const dismiss = (): boolean => {
    if (performance.now() - openedAt < 350) return true; // 삼키되 닫지는 않음
    bg.remove();
    offSpace();
    onDone?.();
    return true;
  };
  bg.addEventListener("pointerdown", () => { void dismiss(); });
  const offSpace = pairSpace(dismiss, () => bg.isConnected);
}

/** 튜토리얼 진행 기록 초기화 (치트) — 제거한 키 수 반환 */
export function resetTutorial(): number {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith(KEY_PREFIX));
  for (const k of keys) localStorage.removeItem(k);
  return keys.length;
}
