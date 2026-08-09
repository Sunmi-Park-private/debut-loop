// ui/cardDeckSheet.ts — 하단 카드덱 시트. 배너를 잡고 상하로 끌거나 탭하면 열리고 닫힌다.
// 로비와 스토리가 같은 컴포넌트를 쓴다 — 좌표(layout.json `card_deck*`)와 아트도 공유해 두 화면이 항상 같은 모습.
// 카드를 눌렀을 때의 반응만 화면별로 다르다 (tapMode 참고).
import { Container, Graphics, Text } from "pixi.js";
import type { Card, CardGrade } from "../engine/types";
import { starNode, gaugeSymbol } from "./cardArt";
import { easeIn, easeOut, easeInOut, lerp } from "./ease";
import { pos } from "./layout";
import { editable, editableClone } from "./editor";
import { BASE_W, BASE_H, stageHeight } from "./stage";
import { skinNode, skinFit, skinTexTrim } from "./uiSkin";
import { cardTemplates } from "../data";

const W = BASE_W;
const GRADE_COLOR: Record<CardGrade, number> = { epic: 0xf0c05a, rare: 0xa78be6, common: 0xc4b8d6 };
const STAR_W = 52; // 별 표시 박스 (카드 폭 82 안쪽)
const STAR_H = 15;
const SYM = 24;    // 게이지 심볼 한 변
const COLS = 4;
const CW = 82;
const CH = CW * 1.3;
const GAP = 10;
// 표시 상한 = 4열 × 3줄. 칸을 나누는 기준이 「종류 + 등급 + 게이지」라, 게이지가 둘인 원형
// (유대=멘탈+유대, 안무=실력+멘탈, 오디션=평판+실력)은 한 번에 두 칸을 먹는다.
// 8칸이던 시절엔 휴식 한 번에 상한을 넘겨, 덱에는 들어갔는데 화면엔 안 나오는 일이 생겼다.
const MAX_TILES = 12;
const ROWS = Math.ceil(MAX_TILES / 4);
const TAP_SLOP = 8;    // 이 거리 안에서 뗐으면 드래그가 아니라 탭
const HANDLE_H = 98;   // 개폐 핸들 띠 높이 — content 오프셋과 같은 값(제목 아래·첫 카드 줄 위)
const FLIP_HALF = 130; // 뒤집기 반바퀴 (ms) — 폭이 0이 되는 시점에 앞뒤 면 교체
const LIFT_DY = 14;    // 살짝 떠오르는 높이 (px)
const LIFT_DUR = 150;
// 시트 개폐 스냅 — 남은 거리에 비례한 시간(짧게 끌면 짧게, 멀면 길게)을 상·하한으로 묶는다
const SNAP_MS_PER_PX = 1.1;
const SNAP_MIN_MS = 150;
const SNAP_MAX_MS = 320;

/** 로비 카드 뒤집힘 상태 — 모듈 스코프라 화면을 오가도 유지되고, 앱을 새로 켜면(=모듈 재평가) 초기화된다 */
const revealed = new Set<string>();

/** 카드를 눌렀을 때의 반응 — flip=뒷면에서 앞면으로 뒤집기(로비) · lift=살짝 떠올랐다 제자리(스토리) */
export type DeckTapMode = "flip" | "lift";

const mkText = (s: string, size: number, fill: number, bold = false): Text =>
  new Text({
    text: s,
    style: { fontSize: size, fill, fontWeight: bold ? "bold" : "normal", wordWrap: true, wordWrapWidth: W - 80, lineHeight: size * 1.7, align: "center" },
  });

export interface CardDeckSheetOpts {
  /** 표시할 카드 — 재빌드 때마다 다시 읽으므로 항상 최신 상태를 반영한다 */
  cards: () => Card[];
  open: boolean;
  /** 스냅 결과 통지 — 호출부가 다음 draw까지 개폐 상태를 유지한다 */
  onToggle: (open: boolean) => void;
  /** 카드 탭 반응 (기본 lift) */
  tapMode?: DeckTapMode;
}

export interface CardDeckSheet {
  /** 카드 목록이 바뀌었을 때 시트 내용만 다시 그린다 (개폐 상태·위치는 유지) */
  rebuild: () => void;
  /** 시트 최상위 컨테이너 — 나중에 다시 addChild 하면 레이어 순서를 올릴 수 있다 */
  view: Container;
}

export function renderCardDeckSheet(parent: Container, opts: CardDeckSheetOpts): CardDeckSheet {
  const tapMode: DeckTapMode = opts.tapMode ?? "lift";
  // 콘텐츠 박스(430×800) 하단에 앵커 — 캔버스 실제 바닥이 아니다.
  // 캔버스는 20:9 최소 956이고 긴 기기에선 더 길어지므로, 실제 바닥을 기준으로 잡으면
  // 덱만 기기마다 다른 자리에 서고 에디터로 맞춘 좌표가 기기별로 어긋난다.
  // 다른 로비 요소와 같은 800 박스를 써야 좌표가 결정적이다 (남는 아래쪽은 배경 블리드).
  const H = BASE_H;

  const sheet = new Container(); // y offset 0=닫힘, -OPEN_DY=열림

  // 진행 중인 카드 애니메이션 — 재빌드 때 전부 취소해 사라진 컨테이너를 건드리지 않게 한다
  let anims: number[] = [];
  const cancelAnims = (): void => {
    for (const id of anims) cancelAnimationFrame(id);
    anims = [];
  };
  const tween = (dur: number, step: (t: number) => void, done?: () => void): void => {
    const t0 = performance.now();
    const frame = (now: number): void => {
      const t = Math.min(1, (now - t0) / dur);
      step(t);
      if (t < 1) anims.push(requestAnimationFrame(frame));
      else done?.();
    };
    anims.push(requestAnimationFrame(frame));
  };

  // 배너 아트 — 스킨 전용 (빈 슬롯은 곡선 장식 없이 몸통만)
  // 폭은 화면 전체 고정, 높이는 업로드 아트 비율에서 도출 → 눌리지 않음 (배율은 에디터에서)
  const bannerTex = skinTexTrim("lobby-deck-banner");
  const bannerH = bannerTex ? Math.round(W * (bannerTex.height / bannerTex.width)) : 230;
  // 개폐 스트로크는 배너 높이 비율로 — 닫힘=상단 30%만 노출, 열림=상단 70%까지(하단 30%는 화면 밑)
  const BANNER_TOP = H - Math.round(bannerH * 0.3); // 배너 상단 = 덱 조각들의 기준선
  // 여는 폭 — 기본은 배너 높이의 40%. 마지막 줄이 화면 바닥에 걸리면 그만큼 더 연다.
  // 상한 60%는 배너 아래쪽이 화면 바닥을 계속 덮는 선 (더 열면 배너 밑에 빈 틈이 보인다).
  const contentH = 52 + ROWS * (CH + GAP);
  const needDy = Math.round(BANNER_TOP + HANDLE_H + contentH + 24 - stageHeight());
  const OPEN_DY = bannerTex
    ? Math.min(Math.round(bannerH * 0.6), Math.max(Math.round(bannerH * 0.4), needDy))
    : 240; // 아트 미업로드(벡터 폴백)만 고정값
  const bannerSkin = skinNode("lobby-deck-banner", W, bannerH);
  if (bannerSkin) bannerSkin.y = BANNER_TOP;
  // 개폐 핸들 = 배너 상단 제목 띠(첫 카드 줄이 시작되기 전까지). 배너 전체를 판정 영역으로 두면
  // 카드 위를 눌러도 시트가 끌려와, 카드를 눌러 뒤집는 동작과 충돌한다.
  //
  // sheet.hitArea로 막지 않는 이유: Pixi는 hitArea가 걸린 컨테이너의 하위 트리를 통째로
  // 히트 테스트에서 잘라내서, 시트 안에 있는 카드가 탭을 못 받는다. 대신 이 띠에만 드래그를 걸고
  // 시트 자신은 passive로 두어 자식(카드)이 각자 이벤트를 받게 한다.
  const handle = new Graphics().rect(0, BANNER_TOP, W, HANDLE_H).fill({ color: 0xffffff, alpha: 0 });
  sheet.addChild(handle);

  // 시트 내부 조각별 오프셋 그룹 — 시트 개폐(sheet.y)와 분리돼 열린 상태에서 위치 미세조정 가능
  const dgrp = (name: string, child: Container): void => {
    const g = new Container();
    const q = pos(name, { x: 0, y: 0 });
    g.x = q.x;
    g.y = q.y;
    g.addChild(child);
    sheet.addChild(g);
    editable(name, g);
  };
  if (bannerSkin) dgrp("card_deck_banner", bannerSkin);

  // 덱 제목 — 시트 직속(내용물 밖)이라 닫혀 있어도 보이고, 개폐하면 시트와 함께 움직인다
  const cTitle = mkText("CARD DECK", 30, 0x5b4a70, true);
  cTitle.x = (W - cTitle.width) / 2;
  cTitle.y = BANNER_TOP + 6; // 배너 안쪽 상단
  dgrp("card_deck_title", cTitle);

  const content = new Container();
  content.y = BANNER_TOP + HANDLE_H; // 핸들 띠 바로 아래 — 닫힘 상태에선 화면 밖
  dgrp("card_deck_content", content);

  const gx = (W - COLS * CW - (COLS - 1) * GAP) / 2;
  // content 내부 조각 그룹 — 재빌드마다 다시 등록되지만 좌표는 layout.json에서 승계된다
  const cgrp = (name: string, child: Container): void => {
    const g = new Container();
    const q = pos(name, { x: 0, y: 0 });
    g.x = q.x;
    g.y = q.y;
    g.addChild(child);
    content.addChild(g);
    editable(name, g);
  };
  const rowY = (i: number): number => 52 + Math.floor(i / COLS) * (CH + GAP);
  const colX = (i: number): number => gx + (i % COLS) * (CW + GAP);

  // ── 카드 앞뒤 면 ──
  // 앞면 — 업로드된 결과 카드 프레임 아트를 원본 비율로, 빈 슬롯이면 벡터 폴백.
  //
  // 카드 안쪽 조각(심볼·별·이름·개수)의 좌표는 **카드 한 장 기준**이다. 조각을 감싸는 그룹이
  // 카드 컨테이너의 자식이라 에디터가 저장하는 값도 카드 내부 오프셋(0,0=기본 위치)이 된다.
  // 키 이름을 로비·스토리가 공유하므로 어느 화면에서 옮기든 layout.json 한 곳이 바뀌어 양쪽이 같이 따라온다.
  // 8칸이 같은 오프셋을 쓰므로 저장되는 좌표는 조각당 한 벌이다. 다만 등록은 칸마다 해 둔다 —
  // 첫 칸만 걸어두면 두 번째 칸의 심볼을 눌렀을 때 그 조각이 아니라 바깥 컨테이너(=n칸 전체)가 잡힌다.
  // 첫 칸이 대표(editable), 나머지는 복제(editableClone)로 같은 이름에 묶인다.
  const registered = new Set<string>(); // 이번 빌드에서 이미 대표를 세운 조각 이름
  const reg = (name: string, g: Container): void => {
    if (registered.has(name)) editableClone(name, g);
    else { registered.add(name); editable(name, g); }
  };
  const frontFace = (card: Card, count: number): Container => {
    const f = new Container();
    const t = cardTemplates.find((x) => x.id === card.templateId);
    // 조각의 기본 위치는 child가 갖고, 그룹은 에디터 오프셋만 갖는다.
    // (그룹에 둘을 합쳐 넣으면 에디터가 합계를 저장해 리빌드마다 기본 위치가 누적된다)
    const igrp = (name: string, child: Container, x: number, y: number): void => {
      child.x = x;
      child.y = y;
      const g = new Container();
      const q = pos(name, { x: 0, y: 0 });
      g.x = q.x;
      g.y = q.y;
      g.addChild(child);
      f.addChild(g);
      reg(name, g);
    };

    // 카드 프레임 — 조각들의 바탕. 위에 얹히는 심볼·별·이름보다 먼저 넣어 뒤로 깔린다.
    igrp("card_deck_item_card",
      skinFit("train-result-card", CW, CH) ?? new Graphics().roundRect(0, 0, CW, CH, 12)
        .fill(0xf6f0fc).stroke({ width: 2.5, color: GRADE_COLOR[card.grade] }),
      0, 0);

    // 게이지 심볼 — 카드가 올려주는 게이지 아트, 하나도 없으면 카드 이모지로 폴백
    const symRow = gaugeSymbol(card, CW, SYM);
    if (symRow) igrp("card_deck_item_sym", symRow, 0, 8);
    else {
      const ic = mkText(t?.icon ?? "", 22, 0x5b4a70);
      igrp("card_deck_item_sym", ic, (CW - ic.width) / 2, 12);
    }

    // 판정등급 — 등급별 별 아트, 없으면 ★ 텍스트 (같은 박스에 중앙 정렬)
    igrp("card_deck_item_star", starNode(card.grade, STAR_W, STAR_H), (CW - STAR_W) / 2, 42);

    const nm = mkText(t?.name?.replace(" 카드", "") ?? "", 10, 0x5b4a70, true);
    igrp("card_deck_item_name", nm, (CW - nm.width) / 2, 66);
    // 카드명 텍스트를 그룹과 별개로 등록 — 그룹은 카드 안에서의 위치, 텍스트는 크기·색·미세 위치.
    // 기본값은 igrp가 잡아준 가운데 정렬이라 지금 배치는 그대로다.
    const qn = pos("card_deck_item_name_text", { x: nm.x, y: nm.y });
    nm.x = qn.x;
    nm.y = qn.y;
    reg("card_deck_item_name_text", nm);

    if (count > 1) {
      const bd = mkText(`×${count}`, 10, 0xc9527f, true);
      igrp("card_deck_item_count", bd, CW - bd.width - 6, 5);
    }
    return f;
  };
  // 뒷면 — 앞면(train-result-card)과 짝을 이루는 train-result-card-back 슬롯, 미업로드면 벡터 폴백
  // 뒷면 — 앞면(train-result-card)과 짝을 이루는 슬롯. 아트가 없으면 아무것도 그리지 않는다
  // (임시 벡터를 깔면 아트가 올라온 줄 알기 쉬워서, 빈 슬롯은 비워 두는 편이 상태가 분명하다)
  const backFace = (): Container | null => skinFit("train-result-card-back", CW, CH);

  // 빈 슬롯 자리표시 — 그 화면의 기본 면을 따라간다.
  // 로비는 뒷면으로 깔리므로 빈 칸도 뒷면, 스토리는 앞면이므로 앞면 프레임 + "?".
  // 해당 면의 아트가 없으면 그 칸은 비워 둔다.
  const emptySlot = (i: number): void => {
    const x0 = colX(i);
    const y0 = rowY(i);
    if (tapMode === "flip") {
      const b = backFace();
      if (!b) return; // 뒷면 아트 미업로드 — 빈 칸
      b.x = x0;
      b.y = y0;
      b.alpha = 0.5; // 카드가 있는 자리와 구분 — 같은 뒷면이되 흐리게
      content.addChild(b);
      return;
    }
    const art = skinFit("train-result-card", CW, CH);
    if (!art) return; // 앞면 아트 미업로드 — 빈 칸
    art.x = x0;
    art.y = y0;
    content.addChild(art);
    const q = mkText("?", 20, 0xd9cdeb, true);
    q.x = x0 + CW / 2 - q.width / 2;
    q.y = y0 + CW * 0.5;
    content.addChild(q);
  };

  // 카드 한 장 — 중심을 원점으로 잡아야 뒤집기가 좌우 대칭이 된다
  const cardTile = (i: number, key: string, card: Card, count: number): void => {
    const tile = new Container();
    tile.pivot.set(CW / 2, CH / 2);
    const homeX = colX(i) + CW / 2;
    const homeY = rowY(i) + CH / 2;
    tile.x = homeX;
    tile.y = homeY;

    const front = frontFace(card, count);
    // 뒷면 아트가 없으면 뒤집을 면이 없으므로 앞면 고정으로 둔다 (빈 카드가 보이지 않게)
    const back = tapMode === "flip" ? backFace() : null;
    if (back) tile.addChild(back);
    tile.addChild(front);

    let faceUp = back ? revealed.has(key) : true;
    let lifted = false;
    let busy = false;
    front.visible = faceUp;
    if (back) back.visible = !faceUp;

    const flip = (): void => {
      busy = true;
      // 폭을 0까지 좁혔다가 그 순간 면을 바꾸고 다시 편다 — 스케일이 음수로 가지 않아 글자가 뒤집히지 않는다.
      // 앞 반바퀴는 가속(easeIn), 뒤 반바퀴는 감속(easeOut) — 이어 붙이면 한 번의 ease-in-out으로 읽힌다.
      tween(FLIP_HALF, (p) => { tile.scale.x = 1 - easeIn(p); }, () => {
        faceUp = !faceUp;
        front.visible = faceUp;
        if (back) back.visible = !faceUp;
        if (faceUp) revealed.add(key);
        else revealed.delete(key);
        tween(FLIP_HALF, (p) => { tile.scale.x = easeOut(p); }, () => {
          tile.scale.x = 1;
          busy = false;
        });
      });
    };
    const lift = (): void => {
      busy = true;
      const from = tile.y;
      const to = lifted ? homeY : homeY - LIFT_DY;
      lifted = !lifted;
      tween(LIFT_DUR, (p) => { tile.y = lerp(from, to, easeInOut(p)); }, () => {
        tile.y = to;
        busy = false;
      });
    };

    // 카드 영역은 뒤집기 전용 — 시트 개폐는 상단 핸들 띠에서만 받는다
    tile.eventMode = "static";
    tile.cursor = "pointer";
    tile.on("pointertap", () => {
      if (busy) return;
      if (back) flip();  // 뒷면 아트가 있을 때만 뒤집기
      else lift();       // 스토리(앞면 고정)와 뒷면 아트 미업로드 상태는 떠오르기
    });

    content.addChild(tile);
  };

  const buildContent = (): void => {
    cancelAnims();
    registered.clear(); // 새 빌드의 첫 카드가 다시 에디터 핸들을 갖는다
    content.removeChildren();
    const cSub = mkText("연습으로 카드를 모아서, 관문에서 레벨업", 11, 0xa99bc0);
    cSub.x = (W - cSub.width) / 2;
    cSub.y = 26;
    cgrp("card_deck_sub", cSub);

    // 같은 종류·등급·게이지 = ×N 스택 (게이지가 다르면 심볼도 달라 별도 칸)
    const groups = new Map<string, { card: Card; count: number }>();
    for (const card of opts.cards()) {
      const key = `${card.templateId}:${card.grade}:${card.gauge ?? ""}`;
      const g = groups.get(key);
      if (g) g.count++;
      else groups.set(key, { card, count: 1 });
    }

    if (groups.size === 0) {
      for (let i = 0; i < MAX_TILES; i++) emptySlot(i);
      return;
    }

    let i = 0;
    for (const [key, { card, count }] of groups) {
      if (i >= MAX_TILES) break;
      cardTile(i, key, card, count);
      i++;
    }
    if (groups.size > MAX_TILES) { // 표시 상한 초과분 — 안내가 아니라 현황 표기라 남긴다
      const more = mkText(`외 ${groups.size - MAX_TILES}종…`, 10.5, 0xc4b8d6);
      more.x = (W - more.width) / 2;
      more.y = rowY(MAX_TILES) + 6;
      content.addChild(more);
    }
  };
  buildContent();

  // 레이아웃 에디터 오프셋 래퍼 — 개폐(sheet.y 스냅)와 분리, 위치 미세조정은 래퍼가 담당
  const deckWrap = new Container();
  const dOff = pos("card_deck", { x: 0, y: 0 });
  deckWrap.x = dOff.x;
  deckWrap.y = dOff.y;
  deckWrap.addChild(sheet);
  parent.addChild(deckWrap);
  editable("card_deck", deckWrap);

  // ── 상하 스와이프/탭 개폐 — 핸들 띠에서만 (카드 영역은 뒤집기 전용) ──
  let sheetOpen = opts.open;
  if (sheetOpen) sheet.y = -OPEN_DY; // 리드로우 전 열려 있었으면 열린 채로 복원
  let dragging = false;
  let startY = 0;
  let baseY = 0;
  let moved = 0;
  sheet.eventMode = "passive"; // 시트 자신은 안 받고 자식(핸들·카드)이 각자 받는다
  handle.eventMode = "static";
  handle.cursor = "grab";
  // 손을 뗀 뒤의 스냅은 뚝 끊기지 않게 ease-in-out으로 민다. 끄는 동안(smove)은 손가락을 1:1로 따라간다.
  // 카드 애니메이션(anims)과 분리해 둔다 — 시트 스냅만 따로 취소해야 드래그를 다시 잡을 때 튀지 않는다.
  let snapRaf = 0;
  const cancelSnap = (): void => {
    if (snapRaf) cancelAnimationFrame(snapRaf);
    snapRaf = 0;
  };
  const snapTo = (to: number): void => {
    cancelSnap();
    const from = sheet.y;
    const dist = Math.abs(to - from);
    if (dist < 0.5) { sheet.y = to; return; }
    const dur = Math.max(SNAP_MIN_MS, Math.min(SNAP_MAX_MS, dist * SNAP_MS_PER_PX));
    const t0 = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / dur);
      sheet.y = lerp(from, to, easeInOut(t));
      if (t < 1) snapRaf = requestAnimationFrame(step);
      else { sheet.y = to; snapRaf = 0; }
    };
    snapRaf = requestAnimationFrame(step);
  };

  handle.on("pointerdown", (e) => {
    cancelSnap(); // 스냅 도중 다시 잡으면 그 자리에서 이어서 끈다
    dragging = true;
    startY = e.globalY;
    baseY = sheet.y;
    moved = 0;
  });
  const smove = (e: { globalY: number }): void => {
    if (!dragging) return;
    const dy = e.globalY - startY;
    moved = Math.max(moved, Math.abs(dy));
    sheet.y = Math.max(-OPEN_DY, Math.min(0, baseY + dy));
  };
  handle.on("globalpointermove", smove);
  handle.on("pointermove", smove);
  const sfinish = (): void => {
    if (!dragging) return;
    dragging = false;
    if (moved < TAP_SLOP) sheetOpen = !sheetOpen;  // 탭 = 토글
    else sheetOpen = sheet.y < -OPEN_DY / 2;       // 스와이프 = 가까운 쪽 스냅
    snapTo(sheetOpen ? -OPEN_DY : 0);
    opts.onToggle(sheetOpen);
  };
  handle.on("pointerup", sfinish);
  handle.on("pointerupoutside", sfinish);

  return { rebuild: buildContent, view: deckWrap };
}
