// ui/swipeCard.ts — 카드(대사) + 드래그 스와이프 + 좌/우 버튼 렌더 (Pixi v8).
import { AnimatedSprite, BlurFilter, Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from "pixi.js";
import type { Beat } from "../engine/types";
import { pos } from "./layout";
import { easeOut, easeInOut, lerp } from "./ease";
import { pressable } from "./press";
import { buzz } from "./haptics";
import { pairSpace } from "./keys";
import { skinNode, skinTexTrim } from "./uiSkin";
import { editable, editorEnabled } from "./editor";

const sub = (t: string, casting: Record<string, string>): string =>
  t.replace(/\{(\w+)\}/g, (_, k: string) => casting[k] ?? k);

const CARD_W = 394;
const DRAG_TH = 140; // 커밋 임계 — 100에서 상향: 실수로 놓쳐도 덜 민감, 커밋 기울기 5.2°→7.2° (회전 강도 0.0009는 유지)
const TILT_SCRUB_SPEED = 0.8; // 갸웃 시퀀스 진행 속도 — 드래그 거리당 프레임 진행 배율 (1=임계에서 마지막 프레임)
const ROT_PER_PX = 0.0009; // 드래그 1px당 기울기 (rad) — 임계 140px에서 7.2°
// 임계 미달 복귀 — 남은 거리에 비례한 시간을 상·하한으로 묶는다 (카드덱 시트 스냅과 같은 규칙)
const SETTLE_MS_PER_PX = 1.1;
const SETTLE_MIN_MS = 140;
const SETTLE_MAX_MS = 260;
// 기울기의 회전축 = 카드 가로 중앙. 카드 원점(좌상단)을 축으로 쓰면 축에서 가로로 떨어진 만큼
// 회전이 세로 이동으로 새어 나온다(Δy = 축거리·sin θ). 캐릭터는 축에서 195px 떨어져 있어
// 임계에서 약 25px씩 — 왼쪽으로 끌면 정수리가 올라가고 오른쪽으로 끌면 내려가, 좌우 차가 50px에 달했다.
const PIVOT_X = CARD_W / 2;

export interface CardOpts {
  seen?: boolean; // 회귀 가속: 축약 카드로 표시
  replay?: "left" | "right"; // 빠른 모드: 탭 1회 = 기록된 선택 재적용 (seen 카드에서만 유효)
  portrait?: Texture | null; // 카드 상단 초상 (없으면 텍스트만)
  idleFrames?: Texture[]; // 상반신 숨쉬기 idle 시퀀스 — 있으면 정지 초상 대신 재생 (8fps)
  tiltLeft?: Texture[];  // 드래그 방향 갸웃 시퀀스 — 좌측 (드래그 거리로 스크럽)
  tiltRight?: Texture[]; // 우측
  /** char.html 배율 스테퍼 값 (idle=exp-base-idle · tiltLeft/Right=tilt-*-idle, 미설정=1) */
  portraitScale?: { idle?: number; tiltLeft?: number; tiltRight?: number };
  onPreview?: (dir: "left" | "right", t: number) => void; // 드래그 중 (t=강도 0~1)
  onPreviewClear?: () => void;                             // 드래그 해제/원위치
}

export function renderCard(
  parent: Container,
  beat: Beat,
  casting: Record<string, string>,
  onChoose: (dir: "left" | "right") => void,
  opts: CardOpts = {},
): void {
  const seen = opts.seen === true;
  const replay = seen ? opts.replay : undefined;
  const idleFrames = opts.idleFrames ?? [];
  const hasPortrait = !!opts.portrait || idleFrames.length > 1;
  // 프레임 아트 업로드 시 카드 높이가 아트 비율을 따름 (D안 — 원본 무왜곡, stretch가 균일 스케일이 됨).
  // 미업로드 시 기존 가변 높이 유지 (초상 카드는 패널을 낮게 — 캐릭터는 패널 위로 뜸)
  const frameTex = skinTexTrim("game-card-frame");
  const H = frameTex ? Math.round(CARD_W * (frameTex.height / frameTex.width))
    : seen ? 200 : hasPortrait ? 230 : 420;
  const card = new Container();
  const base = pos("card");
  card.x = base.x;
  card.y = base.y;

  const bg = skinNode("game-card-frame", CARD_W, H)
    ?? new Graphics().roundRect(0, 0, CARD_W, H, 24).fill(0xffffff).stroke({ width: 2, color: 0xece4f4 });
  card.addChild(bg);

  let textY = 20;
  // 초상 (seen 축약 카드엔 생략) — 패널에 종속되지 않고 패널 위로 떠서 뒤 배경이 보임.
  // 기본은 숨쉬기 idle 재생, 드래그 시 갸웃 시퀀스로 스크럽
  const P_W = 300; // 캐릭터 표시 폭 — 카드보다 좁게 해 배경이 좌우로 드러남
  let portraitSpr: Sprite | null = null;
  let portraitAnim: AnimatedSprite | null = null; // idle 시퀀스 업로드 시 (스크럽 중엔 정지)
  let portraitBase: Texture | null = null;
  const sc = opts.portraitScale ?? {};
  const scIdle = sc.idle ?? 1;
  const setPortraitTex = (tex: Texture, mult = scIdle): void => {
    if (!portraitSpr || portraitSpr.texture === tex) return;
    portraitSpr.texture = tex;
    portraitSpr.scale.set((P_W / tex.width) * mult);
  };
  const scrubPortrait = (tex: Texture, mult: number): void => {
    portraitAnim?.stop();
    setPortraitTex(tex, mult);
  };
  const resetPortrait = (): void => {
    if (portraitAnim) {
      if (!portraitAnim.playing) {
        // idle(512 축소본)과 갸웃(1024 원본)은 해상도가 달라 텍스처·배율을 반드시 "동기로 한 쌍" 적용해야 한다.
        // gotoAndPlay의 텍스처 교체는 다음 틱이라, 그 전후 어느 쪽 기준으로 배율을 잡아도 한 프레임이 튄다
        // (갸웃 기준 배율+idle 텍스처 = 절반 크기 / idle 기준 배율+갸웃 텍스처 = 2배 크기).
        const first = portraitAnim.textures[0] as Texture;
        portraitAnim.texture = first; // 동기 교체
        portraitAnim.scale.set((P_W / first.width) * scIdle);
        portraitAnim.gotoAndPlay(0);
      }
    } else if (portraitBase) setPortraitTex(portraitBase);
  };
  // 캐릭터는 카드와 별개의 최상위 오브젝트 — 레이아웃 에디터에서 대화창(card)과 독립 조정.
  // 스와이프 드래그 때만 카드를 따라 이동 (apply/reset에서 동기화)
  let portraitHome: { x: number; y: number } | null = null;
  if (!seen && hasPortrait) {
    let spr: Sprite;
    if (idleFrames.length > 1) {
      const anim = new AnimatedSprite(idleFrames);
      anim.animationSpeed = 8 / 60; // 8fps — 로비 센터와 동일한 숨쉬기 속도
      anim.play();
      portraitAnim = anim;
      spr = anim;
    } else {
      spr = new Sprite(opts.portrait!);
    }
    const s = (P_W / spr.texture.width) * scIdle;
    spr.scale.set(s);
    // 기본값: 패널 상단에 하단이 살짝 겹치는 위치 (미조정 시 카드 위치를 따라감)
    portraitHome = pos("card_portrait", { x: base.x + (CARD_W - P_W) / 2, y: base.y - spr.texture.height * s + 26 });
    spr.x = portraitHome.x;
    spr.y = portraitHome.y;
    parent.addChild(spr);
    editable("card_portrait", spr);
    portraitSpr = spr;
    portraitBase = idleFrames[0] ?? opts.portrait ?? null;
  }
  if (seen) {
    const ff = new Text({ text: replay ? "▶▶ 기억 속 장면" : "▶▶ 기억 속 장면 — 빠르게 넘기기", style: { fontSize: 12, fill: 0xa78be6, fontWeight: "bold" } });
    ff.x = 18;
    ff.y = 16;
    card.addChild(ff);
    textY = 44;
  }

  const btnY = H - 80;
  const raw = sub(beat.textKey, casting);
  const line = new Text({
    text: seen && raw.length > 40 ? raw.slice(0, 40) + "…" : raw,
    style: { fontSize: seen ? 14 : 17, fill: seen ? 0xa99bc0 : 0x5b4a70, wordWrap: true, wordWrapWidth: 360, lineHeight: seen ? 21 : 26 },
  });
  line.x = 18;
  // 초상 카드: 대사를 버튼 바로 위(하단)에 배치 — 낮아진 패널에서 빈 공간 제거
  line.y = !seen && hasPortrait ? btnY - line.height - 16 : textY;
  card.addChild(line);

  // 확정 시 라이트 블룸 대상 — 버튼 컨테이너와 블룸 색 (스킨 아트 색상: 좌=핑크, 우=블루 / 벡터 폴백=버튼 채색)
  const btnRefs: Partial<Record<"left" | "right", { b: Container; color: number }>> = {};
  const mkBtn = (label: string, x: number, color: number, dir: "left" | "right"): void => {
    const name = dir === "left" ? "card_btn_left" : "card_btn_right";
    const b = new Container();
    const pB = pos(name, { x, y: btnY }); // 레이아웃 에디터 조정 가능 (카드 내부 좌표)
    b.x = pB.x;
    b.y = pB.y;
    const btnSkin = skinNode(dir === "left" ? "game-btn-left" : "game-btn-right", 178, 60);
    if (btnSkin && seen) btnSkin.alpha = 0.6; // 축약 카드의 흐림 처리 유지
    const g = btnSkin ?? new Graphics().roundRect(0, 0, 178, 60, 16).fill(color, seen ? 0.6 : 1);
    const t = new Text({
      text: label,
      // 대사와 동일한 폰트 스타일·크기 (스킨 버튼 위 색상도 대사와 동일, 벡터 폴백은 흰색 유지)
      // align:center — 두 줄로 접히는 긴 라벨("그래도 지금은 / 동료야")의 둘째 줄이
      // 왼쪽에 붙지 않게. 블록만 가운데 두면 줄끼리 어긋나 보인다.
      style: { fontSize: 17, fill: btnSkin ? 0x5b4a70 : 0xffffff, wordWrap: true, wordWrapWidth: 154, lineHeight: 26, align: "center" },
    });
    // 버튼(178×60) 안 정중앙 — 항상 계산으로 정한다.
    // 문구 길이가 비트마다 달라(6~12자, 두 줄도 있음) 고정 오프셋은 어느 한 비트에 맞추면
    // 나머지가 전부 틀어진다. 그래서 이 텍스트는 레이아웃 에디터 대상에서 제외한다
    // (위치를 옮겨야 하면 버튼 자체 = card_btn_left/right 를 옮긴다).
    t.x = Math.round((178 - t.width) / 2);
    t.y = Math.round((60 - t.height) / 2);
    b.addChild(g, t);
    editable(name, b);
    btnRefs[dir] = { b, color: btnSkin ? (dir === "left" ? 0xff6f91 : 0x6ec8ff) : color };
    // 눌림 → 복귀 후 블룸·확정. 안쪽 컨테이너로 감싸도 t의 로컬 좌표는 그대로라 에디터 조정과 충돌하지 않는다
    pressable(b, () => flashChoice(dir, () => onChoose(dir)));
    card.addChild(b);
  };
  // 답변 확정 순간 선택된 버튼 라이트 블룸 — 블러 처리된 버튼 모양 발광체가 뒤에서 은은하게 넓게 번지며 소멸
  const BLOOM_DUR = 380;     // 지속시간 (ms)
  const BLOOM_SPREAD = 21;   // 최대 퍼짐 폭 (px, 버튼 가장자리 기준) — 26의 80%
  const BLOOM_ALPHA = 1.0;   // 시작 발광 강도 (0.85→1.0 + 색 레이어 이중 — 색감 ~30% 상향)
  const BLOOM_BLUR = 14;     // 블러 강도 (부드러움)
  const flashChoice = (dir: "left" | "right", done: () => void): void => {
    buzz("medium"); // 선택 확정 진동 (탭·스와이프 공통 경로)
    const ref = btnRefs[dir];
    if (!ref || card.destroyed) { done(); return; }
    const g = new Graphics();
    g.filters = [new BlurFilter({ strength: BLOOM_BLUR })];
    ref.b.addChildAt(g, 0); // 버튼 뒤 레이어 — 아트를 가리지 않는 후광
    const BW = 178, BH = 60, R = 30;
    const t0 = performance.now();
    let fired = false;
    const fin = (): void => { if (!fired) { fired = true; done(); } };
    const step = (now: number): void => {
      if (card.destroyed) { fin(); return; }
      const t = Math.min(1, (now - t0) / BLOOM_DUR);
      const ease = 1 - (1 - t) * (1 - t); // 퍼짐: 초반에 빠르게 확장
      const glow = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6; // 밝기: 초반 40%는 최대 유지 후 페이드
      const pad = 4 + ease * BLOOM_SPREAD;
      g.clear();
      g.roundRect(-pad, -pad, BW + pad * 2, BH + pad * 2, R + pad).fill({ color: ref.color, alpha: glow * BLOOM_ALPHA });
      g.roundRect(-pad * 0.75, -pad * 0.75, BW + pad * 1.5, BH + pad * 1.5, R + pad * 0.75).fill({ color: ref.color, alpha: glow * 0.55 }); // 색 밀도 보강
      g.roundRect(-pad * 0.55, -pad * 0.55, BW + pad * 1.1, BH + pad * 1.1, R + pad * 0.55).fill({ color: 0xffffff, alpha: glow * 0.3 });
      if (t < 1) { requestAnimationFrame(step); return; }
      fin();
    };
    requestAnimationFrame(step);
  };
  if (replay) {
    // 그때의 선택 + 탭 안내 (버튼 없음 — 카드 전체가 탭 타깃)
    const chose = new Text({ text: `그때의 선택 — ${beat[replay].label}`, style: { fontSize: 13, fill: 0x8a76a8, fontWeight: "bold" } });
    chose.x = 18;
    chose.y = btnY + 4;
    const tap = new Text({ text: "탭하여 넘기기 ▸", style: { fontSize: 12, fill: 0xc9b8e0 } });
    tap.x = CARD_W - tap.width - 18;
    tap.y = btnY + 28;
    card.addChild(chose, tap);
    // 적용될 게이지 변화량 칩 — 탭 전에 미리 표시 (증가=초록, 감소=핑크: gaugeBar UP/DOWN과 동일)
    const GL: Record<string, string> = { skill: "실력", mental: "멘탈", reputation: "평판", bond: "유대", capital: "자본" };
    let cx = 18;
    for (const [k, v] of Object.entries(beat[replay].effects.gauges ?? {})) {
      if (!v) continue;
      const chip = new Text({ text: `${GL[k] ?? k} ${v > 0 ? "+" : ""}${v}`, style: { fontSize: 12, fill: v > 0 ? 0x3fb98a : 0xff6f91, fontWeight: "bold" } });
      chip.x = cx;
      chip.y = btnY + 28;
      card.addChild(chip);
      cx += chip.width + 10;
    }
  } else {
    // 방향은 버튼 아트가 표시한다 — 문구에 ←/→를 덧붙이지 않는다
    mkBtn(beat.left.label, 18, 0x9a7fe0, "left");
    mkBtn(beat.right.label, 198, 0xff7fb0, "right");
  }

  // ── replay(빠른 모드): 탭·Space·→ 1회로 기록된 선택 재적용 — 드래그/버튼/방향키 없음 ──
  if (!editorEnabled() && replay) {
    card.eventMode = "static";
    card.cursor = "pointer";
    // 탭·Space·→ 공용 1회 실행 — 어느 쪽으로 진행해도 리스너 해제 (중복 발화 방지)
    let done = false;
    const finish = (): void => {
      if (done || card.destroyed || !card.parent) return;
      done = true;
      offSpace();
      window.removeEventListener("keydown", onKey);
      onChoose(replay);
    };
    card.on("pointertap", finish);
    const offSpace = pairSpace(finish, () => !done && !card.destroyed && !!card.parent);
    const onKey = (e: KeyboardEvent): void => {
      if (card.destroyed || !card.parent) { window.removeEventListener("keydown", onKey); return; }
      if (e.repeat) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "ArrowRight") { e.preventDefault(); finish(); }
    };
    window.addEventListener("keydown", onKey);
    card.on("destroyed", () => window.removeEventListener("keydown", onKey));
  }

  // ── 드래그 스와이프 (목업 bindDrag 이식) ── 에디터 모드에선 비활성(위치 조정 드래그와 충돌)
  // 캐릭터는 카드와 분리된 오브젝트라 카드 히트영역 밖 — 캐릭터 위에서도 스와이프되도록 양쪽에 배선
  if (!editorEnabled() && !replay) {
    const dragTargets: Container[] = portraitSpr ? [card, portraitSpr] : [card];
    for (const t of dragTargets) {
      t.eventMode = "static";
      t.cursor = "grab";
    }
    let dragging = false;
    let startX = 0;
    let dx = 0;

    const apply = (): void => {
      const rot = dx * ROT_PER_PX;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      // 회전축의 현재 위치 (드래그 이동분 포함)
      const ax = base.x + PIVOT_X + dx;
      const ay = base.y;
      // 카드 원점(좌상단)은 축에서 왼쪽으로 PIVOT_X 떨어진 점 — 그 점을 축 둘레로 돌린 자리
      card.x = ax - PIVOT_X * cos;
      card.y = ay - PIVOT_X * sin;
      card.rotation = rot;
      // 임계 접근 피드백: 카드 살짝 기울고 투명도 변화
      card.alpha = 1 - Math.min(0.25, (Math.abs(dx) / DRAG_TH) * 0.15);
      // 캐릭터를 카드에 강체로 부착 — 카드와 같은 축을 공유해 좌우가 대칭으로 기운다
      if (portraitSpr && portraitHome) {
        const offX = portraitHome.x - ax + dx; // 축 기준 가로 오프셋 (드래그와 무관한 고정값)
        const offY = portraitHome.y - ay;
        portraitSpr.x = ax + offX * cos - offY * sin;
        portraitSpr.y = ay + offX * sin + offY * cos;
        portraitSpr.rotation = rot;
        portraitSpr.alpha = card.alpha;
      }
      // 갸웃 시퀀스 스크럽: 드래그 방향·거리 → 프레임 (char.html 하루 tilt-left/right)
      if (portraitSpr && portraitBase) {
        const seq = dx < -8 ? opts.tiltLeft : dx > 8 ? opts.tiltRight : null;
        if (seq && seq.length > 0) {
          const prog = Math.min(1, (Math.abs(dx) / DRAG_TH) * TILT_SCRUB_SPEED);
          const tex = seq[Math.min(seq.length - 1, Math.floor(prog * seq.length))];
          if (tex) scrubPortrait(tex, (dx < 0 ? sc.tiltLeft : sc.tiltRight) ?? 1);
        } else {
          resetPortrait();
        }
      }
      // 게이지 증감 미리보기 (목업 showPreview 이식)
      if (Math.abs(dx) > 8) opts.onPreview?.(dx < 0 ? "left" : "right", Math.min(1, Math.abs(dx) / DRAG_TH));
      else opts.onPreviewClear?.();
    };
    const reset = (): void => {
      dragging = false;
      dx = 0;
      card.x = base.x;
      card.y = base.y; // apply()가 회전축 보정으로 y도 건드리므로 함께 원위치
      card.rotation = 0;
      card.alpha = 1;
      if (portraitSpr && portraitHome) {
        portraitSpr.x = portraitHome.x;
        portraitSpr.y = portraitHome.y;
        portraitSpr.rotation = 0;
        portraitSpr.alpha = 1;
      }
      resetPortrait(); // 갸웃 원위치 (idle이면 재생 재개)
      opts.onPreviewClear?.();
    };

    const move = (e: FederatedPointerEvent): void => {
      if (!dragging) return;
      dx = e.globalX - startX;
      apply();
    };
    // 임계에 못 미치고 놓았을 때 — 뚝 끊기지 않게 제자리로 밀어 되돌린다 (끄는 동안은 손가락을 1:1로 따라감)
    const settleBack = (): void => {
      const from = dx;
      if (Math.abs(from) < 0.5) { reset(); return; }
      const dur = Math.max(SETTLE_MIN_MS, Math.min(SETTLE_MAX_MS, Math.abs(from) * SETTLE_MS_PER_PX));
      const t0 = performance.now();
      const step = (now: number): void => {
        if (card.destroyed || !card.parent) return;
        const t = Math.min(1, (now - t0) / dur);
        dx = lerp(from, 0, easeOut(t));
        apply();
        if (t < 1) { requestAnimationFrame(step); return; }
        reset();
      };
      requestAnimationFrame(step);
    };
    const finish = (): void => {
      if (!dragging) return;
      dragging = false; // 되돌아가는 동안 move가 끼어들지 않게 먼저 끊는다
      const commit = Math.abs(dx) >= DRAG_TH ? (dx < 0 ? "left" : "right") : null;
      if (commit) {
        reset();
        flashChoice(commit, () => onChoose(commit));
      } else {
        settleBack();
      }
    };
    card.on("globalpointermove", move); // global은 한 곳만 배선 (양쪽에 걸면 이벤트당 2회 호출)
    for (const t of dragTargets) {
      t.on("pointerdown", (e: FederatedPointerEvent) => {
        dragging = true;
        startX = e.globalX;
      });
      t.on("pointermove", move); // 이중 배선(환경별 global 이벤트 미발화 대비, apply는 멱등)
      t.on("pointerup", finish);
      t.on("pointerupoutside", finish);
    }

    // ── 키보드 ←/→ = 스와이프 (드래그와 동일 애니메이션 경로로 임계까지 이동 후 커밋) ──
    let animating = false;
    const keySwipe = (dir: "left" | "right"): void => {
      if (animating || dragging) return;
      animating = true;
      const target = (dir === "left" ? -1 : 1) * DRAG_TH;
      const t0 = performance.now();
      const DUR = 160;
      const step = (now: number): void => {
        if (card.destroyed || !card.parent) return;
        const t = Math.min(1, (now - t0) / DUR);
        dx = target * easeInOut(t); // 키보드 스와이프도 드래그와 같은 감각으로
        apply();
        if (t < 1) { requestAnimationFrame(step); return; }
        animating = false;
        reset();
        flashChoice(dir, () => onChoose(dir));
      };
      requestAnimationFrame(step);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (card.destroyed || !card.parent) { window.removeEventListener("keydown", onKey); return; }
      if (e.repeat) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "ArrowLeft") { e.preventDefault(); keySwipe("left"); }
      else if (e.code === "ArrowRight") { e.preventDefault(); keySwipe("right"); }
    };
    window.addEventListener("keydown", onKey);
    card.on("destroyed", () => window.removeEventListener("keydown", onKey));
  }

  parent.addChild(card); // 캐릭터(portraitSpr)는 앞서 addChild돼 카드 프레임 뒤 레이어 — 대화창이 캐릭터 하반신을 덮음
  editable("card", card);
}
