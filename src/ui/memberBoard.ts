// ui/memberBoard.ts — 멤버 점검 보드 (📷 이벤트 직후 윈도우 · W18 락인 연출).
// training.ts 패턴(딤+패널). 판정·상태 변형은 컨트롤러, 여긴 렌더+입력만.
import { Container, Graphics, Rectangle, Sprite, Text, Texture, type Ticker } from "pixi.js";
import type { CharacterDef, MiniGameGrade, RoleId } from "../engine/types";
import { candidatePool, FIXED_MEMBERS } from "../engine/members";
import { characters } from "../data";
import type { RunController } from "./runController";
import { mountEngine, txt, btn, MG_W, MG_H, INK, SUB, PINK, LAV } from "./minigames";
import { registerBtnLabel } from "./btnLabel";
import { skinFit, skinNatural, skinNode, skinTex, skinTexTrim } from "./uiSkin";
import { pos } from "./layout";
import { editable, editableClone, setRedrawHook } from "./editor";
import { fullRect } from "./stage";
import { toast } from "./metaMenu";
import { playBgm } from "./audio";
import { pressable } from "./press";

const W = MG_W;
const H = 660; // 보류 후보 섹션 수용 (y=120 앵커 기준 화면 내)
/** 보드 전용 버튼 — audition-btn 스킨 우선 (없으면 gate-btn → 벡터 폴백) */
// 보드 버튼 — 개별 슬롯(audition-btn-<kind>) 업로드 시 그걸, 없으면 공용(audition-btn) → 관문 버튼 폴백
const abtn = (label: string, w: number, color: number, onTap: () => void, kind?: string): Container =>
  btn(label, w, color, onTap, kind && skinTex(`audition-btn-${kind}`) ? `audition-btn-${kind}` : "audition-btn");
const GOLD = 0xf0c05a;
const ROLE_LABEL: Partial<Record<RoleId, string>> = {
  protagonist: "리더", helper: "멤버", helper2: "온라인 담당", mentor: "멘토",
};

export interface MemberBoardOpts {
  ctrl: RunController;
  ticker: Ticker;
  onClose: () => void;    // 닫기 (컨트롤러 closeMemberWindow는 호출측)
  onChanged: () => void;  // 상태 변형 후 HUD 갱신용
  startAudition?: boolean; // true면 곧장 오디션 씬으로 (치트 "오디션 보기")
  previewResult?: MiniGameGrade; // 치트: 리듬 없이 곧장 판정결과 화면 (레이아웃 확인용)
  bustOf?: (characterId: string) => Texture | null; // 대형 프로필용 상반신 (캐릭터 에디터 bust 재활용)
}

export function renderMemberBoard(parent: Container, opts: MemberBoardOpts): void {
  const { ctrl } = opts;
  const closeBoard = (): void => { setRedrawHook(null); opts.onClose(); }; // 보드를 벗어나면 리드로우 소유권 반납
  const dim = fullRect(0x5b4a70, 0.35);
  dim.eventMode = "static";
  parent.addChild(dim);

  const panel = new Container();
  // 보드 전체를 board_bg 한 키로 등록 — 배경판을 끌면 제목·버튼·격자가 통째로 따라온다.
  // (개별 조각은 각자의 키로 계속 따로 움직인다 — 조각을 누르면 조각이, 빈 배경을 누르면 전체가 잡힘)
  const p = pos("board_bg", pos("board", pos("training")));
  panel.x = p.x;
  panel.y = p.y;
  parent.addChild(panel);
  editable("board_bg", panel);

  // 우상단 X — 다른 팝업(연습 등)과 동일한 닫기 관례 (ui-close-x 공용 스킨, 없으면 벡터)
  const xBtn = new Container();
  const xSkin = skinNatural("ui-close-x", 36, 36);
  if (xSkin) xBtn.addChild(xSkin);
  else {
    xBtn.addChild(new Graphics().circle(18, 18, 15).fill(0xf3ecfa).stroke({ width: 1.5, color: 0xe4d8f0 }));
    const xt = txt("✕", 14, 0x8a76a8, true);
    xt.x = 18 - xt.width / 2;
    xt.y = 18 - xt.height / 2;
    xBtn.addChild(xt);
  }
  const xp = pos("board_close_x", { x: W - 46, y: -44 });
  xBtn.x = xp.x;
  xBtn.y = xp.y;
  xBtn.eventMode = "static";
  xBtn.cursor = "pointer";
  xBtn.on("pointertap", closeBoard);
  panel.addChild(xBtn);
  editable("board_close_x", xBtn);

  // 패널 프레임 = 점검 화면 배경판(board-bg). 다른 화면의 아트(train-panel)로 폴백하지 않는다.
  // 자기 배경판을 따로 까는 화면(audition-recruit-bg·recheck-bg)은 이 프레임을 감춘다 —
  // 안 감추면 배경판 뒤에서 프레임이 비쳐 남는다.
  const boardArt = skinFit("board-bg", W, H); // 이름판·게이지 트랙이 그려진 점검 화면 아트
  const bg = boardArt ?? skinNode("audition-panel", W, H) ?? skinNode("ui-frame", W, H)
    ?? new Graphics().roundRect(0, 0, W, H, 24).fill({ color: 0xffffff, alpha: 0.94 }).stroke({ width: 2, color: 0xece4f4 });
  panel.addChild(bg);
  /** 자체 배경판을 깐 화면에서 프레임을 감춘다 — clear()가 매번 다시 켜므로 화면마다 선언적으로 부른다 */
  const setFrame = (v: boolean): void => { bg.visible = v; };

  // 헤더 바 · 제목 · 회차 — 각각 독립 그룹으로 등록해 레이아웃 에디터에서 따로 움직인다
  const hgrp = (name: string, ...items: Container[]): Container => {
    const g = new Container();
    const gp = pos(name, { x: 0, y: 0 }); // 오프셋(기본 0,0) — 자식은 기존 좌표 그대로
    g.x = gp.x;
    g.y = gp.y;
    g.addChild(...items);
    panel.addChild(g);
    editable(name, g);
    return g;
  };
  // 헤더 띠(board_head)는 걷어냈다 — 패널 프레임 아트가 이미 상단을 갖고 있어 겹쳐 보였다.
  // 다른 화면에서 쓰지 않는 조각이라 숨기지 않고 지운다 (제목·회차는 그대로).
  const title = txt(ctrl.state.membersLocked ? "🎉 데뷔조 확정" : "멤버 점검", 17, INK, true);
  title.x = 18;
  title.y = 15;
  const wk = txt(`W${ctrl.state.week} · ${ctrl.state.loopCount}회차`, 12, 0xc9527f, true);
  wk.x = W - wk.width - 18;
  wk.y = 18;
  hgrp("board_title", title);
  hgrp("board_week", wk);
  panel.addChild(xBtn); // 헤더보다 위로 — 에디터로 X를 패널 안쪽에 옮겨도 프레임에 가리지 않는다

  const body = new Container();
  body.y = 52;
  panel.addChild(body);
  let selIdx = 0; // 센터 스테이지 선택 멤버(0~4) — 보드 리렌더 간 유지
  let viewSeq = 0; // 뷰 전환 가드 — 비동기 배경 로드가 이전 화면에 늦게 꽂히는 것 방지
  // 오디션 무대 — parent 직속이라 body.removeChildren()으로 정리되지 않는다.
  // 남겨두면 리듬 엔진의 keydown 리스너가 살아 있어 다음 무대의 Space(이지 시작)를 가로챈다.
  let audStage: Container | null = null;
  const killStage = (): void => {
    if (audStage && !audStage.destroyed) audStage.destroy({ children: true }); // destroy → 엔진 cleanup 실행
    audStage = null;
  };
  const clear = (): void => {
    viewSeq++;
    killStage();
    body.removeChildren();
    panel.visible = true; // 오디션 무대에서 숨긴 멤버 점검 패널 복원 (안전망 — 정상 경로는 restore)
    bg.visible = true;    // 화면마다 자기 배경판 유무에 따라 다시 끈다
  };
  const charOf = (id: string): CharacterDef | undefined => characters.find((c) => c.id === id);

  /** 프로필 스킨 — 캐릭터별 슬롯(member-icon-<id>). 없으면 null → 호출측이 색 원 폴백 */
  const profile = (characterId: string | undefined, size: number): Container | null =>
    characterId ? skinFit(`member-icon-${characterId}`, size, size) : null;

  /** 레이아웃 그룹 — 저장 좌표(기본값=기존 위치)로 배치 + 에디터 등록. 자식은 로컬(0,0) 기준 */
  const bgrp = (name: string, x: number, y: number, ...items: Container[]): Container => {
    const g = new Container();
    const gp = pos(name, { x, y });
    g.x = gp.x;
    g.y = gp.y;
    if (items.length > 0) g.addChild(...items);
    body.addChild(g);
    editable(name, g);
    return g;
  };

  /** 버튼 안 문구를 따로 등록 — 버튼 아트를 바꾸면 폭이 달라져 문구만 미세조정해야 한다.
   *  기본값은 btn()이 잡아준 가운데 정렬이라 저장된 값이 없으면 지금 배치 그대로다. */
  const btnLabel = (name: string, b: Container): void => {
    registerBtnLabel(`${name}_text`, b);
  };

  /** 대형 프로필용 텍스처 — 전신 아트(bust 미제작 캐릭터)는 상반신만 크롭해 bust처럼 보이게 */
  const bustTex = (characterId: string): Texture | null => {
    const t = opts.bustOf?.(characterId) ?? null;
    if (!t || t.height / t.width <= 1.2) return t; // 이미 상반신 비율
    const h = Math.min(t.height, Math.round(t.width * 0.95));
    return new Texture({ source: t.source, frame: new Rectangle(t.frame.x, t.frame.y, t.width, h) });
  };

  // ── 멤버 슬롯 1행 (이름·role·기량 막대) — charId 지정 시 캐릭터 프로필 스킨 사용 ──
  const memberRow = (y: number, name: string, color: number, role: string, stat: number, badge?: string, faded = false, charId?: string): Container => {
    const row = new Container();
    row.y = y;
    row.x = 14;
    const rw = W - 28;
    const rowSkin = skinNode("member-row", rw, 56); // 행 배경 — 스킨 전용 (빈 슬롯은 텍스트만)
    if (rowSkin) {
      if (faded) rowSkin.alpha = 0.45; // 빈 멤버 자리는 흐리게
      row.addChild(rowSkin);
    }
    // 프로필: 캐릭터별 member-icon-<id> 업로드 시 이미지 · 없으면 색 점
    const icSkin = profile(charId, 34);
    if (icSkin) {
      icSkin.x = 5;
      icSkin.y = 11;
      if (faded) icSkin.alpha = 0.45; // 빈 슬롯은 흐리게
      row.addChild(icSkin);
    } else {
      row.addChild(new Graphics().circle(22, 28, 13).fill(faded ? 0xd9cdeb : color));
    }
    const nm = txt(name, 13, faded ? 0x9a88b8 : INK, true);
    nm.x = 44;
    nm.y = 8;
    const rl = txt(role, 10, SUB);
    rl.x = 44;
    rl.y = 30;
    row.addChild(nm, rl);
    if (stat >= 0) { // 기량 막대 (후보 실루엣 행은 -1로 숨김)
      const barW = 110;
      const bx = rw - barW - 52;
      // 트랙만 스킨, 채움(3색)·숫자는 수치 표현이라 코드 유지
      const track = skinNode("member-stat-bar", barW, 8);
      if (track) { track.x = bx; track.y = 24; row.addChild(track); }
      else row.addChild(new Graphics().roundRect(bx, 24, barW, 8, 4).fill(0xefe9f6));
      row.addChild(new Graphics().roundRect(bx, 24, Math.max(4, barW * stat / 100), 8, 4).fill(stat >= 70 ? 0x3fb98a : stat >= 50 ? GOLD : 0xff6f91));
      const sv = txt(`${stat}`, 12, INK, true);
      sv.x = rw - 40;
      sv.y = 20;
      row.addChild(sv);
    }
    if (badge) {
      const bt = txt(badge, 9, 0xc9527f, true);
      bt.x = rw - bt.width - 8;
      bt.y = 42;
      row.addChild(bt);
    }
    return row;
  };

  // ── ① 점검 화면 ──
  const showBoard = (): void => {
    setRedrawHook(showBoard); // 배율·농도 변경 시 보드 밖으로 튕기지 않고 이 화면만 다시 그림
    clear();
    // 배경판(board-bg)은 패널 프레임이 담당한다 — 보드 전체(board_bg 키)와 함께 움직인다
    const s = ctrl.state;
    const cost = ctrl.auditionExchangeCost;
    const audCards = s.cards.filter((c) => c.templateId === "audition").length;
    const ticketN = s.deck.filter((t) => t === "audition").length;
    const pool = candidatePool(characters, s);
    const full = s.members.length >= 5;

    // ── 센터 스테이지 (Director 확정 B안): 상단 대형 프로필 + 하단 썸네일 5개 — 탭 선택으로 상단 교체 ──
    const held = pool.filter((c) => s.candidateStats[c.id] !== undefined);
    const mSel = s.members[selIdx];
    const cSel = mSel ? charOf(mSel.characterId) : undefined;
    const selFixed = mSel ? FIXED_MEMBERS.has(mSel.characterId) : false;

    // 대형 프로필 (중앙 140×140): bust(캐릭터 에디터·전신은 상반신 크롭) → 캐릭터 프로필 스킨 → 색 원 / 빈 슬롯 물음표
    const P = 140;
    const pw = new Container();
    const bust = mSel ? bustTex(mSel.characterId) : null;
    if (bust) {
      // 아트 비율이 제각각이라 cover(박스를 가득 채우고 넘치는 부분은 마스크로 크롭) — 모든 멤버가 같은 크기로 보인다
      const sp = new Sprite(bust);
      const sc = Math.max(P / bust.width, P / bust.height);
      sp.scale.set(sc);
      sp.x = (P - bust.width * sc) / 2;
      sp.y = (P - bust.height * sc) / 2;
      const mask = new Graphics().roundRect(0, 0, P, P, 16).fill(0xffffff);
      sp.mask = mask;
      pw.addChild(sp, mask);
    } else {
      const sk = profile(mSel?.characterId, P);
      if (sk) pw.addChild(sk);
      else {
        pw.addChild(new Graphics().circle(P / 2, P / 2, 62).fill(mSel ? parseInt((cSel?.color ?? "#d9cdeb").slice(1), 16) : 0xece4f4).stroke({ width: 3, color: 0xffffff }));
        if (!mSel) {
          const q = txt("?", 44, 0xffffff, true);
          q.x = P / 2 - q.width / 2;
          q.y = P / 2 - q.height / 2;
          pw.addChild(q);
        }
      }
    }
    pw.eventMode = "static";
    pw.cursor = "pointer";
    pw.on("pointertap", () => toast(mSel
      ? (selFixed
        ? `${cSel?.name} · 기량 ${mSel.stat} · 스토리 고정 멤버라 교체할 수 없어요`
        : `${cSel?.name} · 기량 ${mSel.stat} · 오디션 슬롯이라 새 후보 영입 시 교체 대상이에요`)
      : "오디션에서 이기면 이 자리에 새 멤버가 들어와요"));
    bgrp("board_profile", (W - P) / 2, 4, pw);

    // 이름 · 역할/배지 · 기량 바 (모두 중앙 정렬) — 각각 독립 레이아웃 키
    const nameT = txt(mSel ? `${cSel?.name ?? mSel.characterId}${cSel?.temp ? " (가칭)" : ""}` : "빈 슬롯", 17, 0xffffff, true); // 패널 배경이 어두워 흰색
    nameT.x = (W - nameT.width) / 2; // 그룹 내부에서 중앙 정렬 — 이름 길이와 무관하게 항상 가운데
    bgrp("board_name", 0, 148, nameT);
    const roleT = txt(mSel
      ? `${ROLE_LABEL[mSel.role] ?? mSel.role} · ${selFixed ? "데뷔조 핵심 멤버" : "오디션 슬롯"}`
      : "오디션으로 영입", 10.5, 0xffffff);
    roleT.x = (W - roleT.width) / 2;
    bgrp("board_role", 0, 172, roleT);
    if (mSel) {
      // board-bg 아트의 이름판에 트랙이 그려져 있다 — 코드 채움 바를 그 위에 정확히 겹친다 (실측: body 기준 x112~234, y155)
      const barW = 120;
      const statG = new Container();
      const track = skinNode("member-stat-bar", barW, 8);
      if (track) statG.addChild(track);
      else if (!boardArt) statG.addChild(new Graphics().roundRect(0, 0, barW, 8, 4).fill(0xefe9f6)); // 아트가 있으면 그림의 트랙이 곧 트랙
      statG.addChild(new Graphics().roundRect(0, 0, Math.max(4, barW * mSel.stat / 100), 8, 4)
        .fill(mSel.stat >= 70 ? 0x3fb98a : mSel.stat >= 50 ? GOLD : 0xff6f91));
      const sv = txt(`${mSel.stat}`, 12, 0xffffff, true);
      const svp = pos("board_stat_text", { x: barW + 8, y: -5 }); // 숫자만 따로 조정 (board_stat 그룹 내부 좌표)
      sv.x = svp.x;
      sv.y = svp.y;
      statG.addChild(sv);
      editable("board_stat_text", sv);
      bgrp("board_stat", 113, 155, statG);
    }

    // 썸네일 5개 — 탭하면 상단 대형 프로필 교체. 선택 링 강조, 빈 슬롯은 물음표
    const THUMB = 46, TGAP = 13;
    const tx0 = (W - (THUMB * 5 + TGAP * 4)) / 2;
    const thumbs = new Container();
    const thumbStats = new Container(); // 썸네일 아래 기량 숫자 묶음 — 썸네일과 별도 키로 조정
    for (let i = 0; i < 5; i++) {
      const m = s.members[i];
      const c = m ? charOf(m.characterId) : undefined;
      const cell = new Container();
      cell.x = i * (THUMB + TGAP); // 그룹(board_thumbs) 내부 로컬 좌표
      if (i === selIdx) cell.addChild(new Graphics().circle(THUMB / 2, THUMB / 2, THUMB / 2 + 4).stroke({ width: 2.5, color: 0xe0568f }));
      const ic = profile(m?.characterId, THUMB);
      if (ic) cell.addChild(ic);
      else {
        cell.addChild(new Graphics().circle(THUMB / 2, THUMB / 2, THUMB / 2 - 1)
          .fill(m ? parseInt((c?.color ?? "#d9cdeb").slice(1), 16) : 0xefe7f8).stroke({ width: 2, color: 0xffffff }));
        if (!m) {
          const q = txt("?", 18, 0xab97c8, true);
          q.x = THUMB / 2 - q.width / 2;
          q.y = THUMB / 2 - q.height / 2;
          cell.addChild(q);
        }
      }
      if (m?.stat !== undefined) {
        const sp2 = txt(`${m.stat}`, 9, 0xffffff, true);
        sp2.x = cell.x + THUMB / 2 - sp2.width / 2; // 묶음 그룹 내부 좌표 (셀과 같은 열)
        sp2.y = THUMB + 2;
        thumbStats.addChild(sp2);
      }
      cell.eventMode = "static";
      cell.cursor = "pointer";
      cell.on("pointertap", () => { selIdx = i; showBoard(); });
      thumbs.addChild(cell);
    }
    bgrp("board_thumbs", tx0, 214, thumbs);
    bgrp("board_thumbs_stats", tx0, 214, thumbStats);
    let y = 282;

    // 기량 설명 캡션
    // 오디션의 실제 가치(자동충원 50 초과 확보)와 마지막 기회(W17 📷)를 전달
    const statCap = txt("기량은 무대 성적으로 오르내려요\nW18 자동충원 기준은 50\n오디션으로 더 나은 멤버를 확보하세요 (마지막 기회 W17)", 10, 0xffffff);
    statCap.style.wordWrapWidth = W - 60; // 에디터로 긴 한 줄 문구를 넣어도 패널 안에서 줄바꿈
    statCap.style.breakWords = true;
    // 텍스트 자신을 등록 — 그룹 등록이면 문구 덮어쓰기 때 중심 보정이 걸려 좌표가 밀린다
    const cp = pos("board_caption", { x: 20, y: y + 2 });
    statCap.x = cp.x;
    statCap.y = cp.y;
    body.addChild(statCap);
    editable("board_caption", statCap);
    y += 46; // 3줄

    if (s.membersLocked) {
      const note = txt("다섯 자리가 모두 정해졌다. 이제 무대만 남았다.", 12, 0xffffff);
      bgrp("board_locked_note", 20, y + 8, note);
      const ok = abtn("확인 →", 180, PINK, closeBoard, "ok");
      bgrp("board_btn_ok", (W - 180) / 2, y + 44, ok);
      return;
    }

    // 보류 후보 — 오디션에서 기량이 측정된 풀 후보. 이 자리에서 바로 영입/버리기 (목록 전체가 하나의 레이아웃 그룹)
    const heldG = new Container();
    const heldY0 = y + 4;
    // 행 조각(배경·프로필·이름·버튼·문구)을 각각 반복 키로 등록 — 첫 행이 대표, 나머지는 복제.
    // 저장 좌표는 오프셋으로 모든 행에 공통 적용 (카드덱 8칸과 같은 규약)
    const heldRegd = new Set<string>();
    const hreg = (name: string, g: Container): void => {
      if (heldRegd.has(name)) editableClone(name, g);
      else { heldRegd.add(name); editable(name, g); }
    };
    for (const c of held) {
      const stat = s.candidateStats[c.id] ?? 0;
      const row = new Container();
      row.y = y + 4 - heldY0; // 그룹 내부 로컬 좌표
      const rw = W - 28;
      const hpiece = (name: string, child: Container, px: number, py: number): void => {
        child.x = px;
        child.y = py;
        const g = new Container();
        const q = pos(name, { x: 0, y: 0 }); // 저장값 = 오프셋
        g.x = q.x;
        g.y = q.y;
        g.addChild(child);
        row.addChild(g);
        hreg(name, g);
      };
      hpiece("board_held_row", skinNode("audition-held-row", rw, 30)
        ?? new Graphics().roundRect(0, 0, rw, 30, 10).fill(0xfdf8ff).stroke({ width: 1.5, color: 0xe0d2f0 }), 0, 0);
      const hf = profile(c.id, 24); // 보류 후보 행 프로필 (캐릭터별 슬롯 · 없으면 색 점)
      if (hf) hpiece("board_held_icon", hf, 4, 3);
      else hpiece("board_held_icon", new Graphics().circle(12, 12, 8).fill(c.temp ? 0xd9cdeb : parseInt(c.color.slice(1), 16)), 4, 3);
      const nm = txt(`${c.name}${c.temp ? " (가칭)" : ""} · 기량 ${stat}`, 11.5, INK, true);
      hpiece("board_held_name", nm, 32, 7);
      const mkMini = (key: string, label: string, x: number, color: number, fill: number, onTap: () => void): Container => {
        const b = new Container();
        // 스킨 1종 공용, 색 구분은 텍스트 색으로 유지
        b.addChild(skinNode("audition-btn-mini", 58, 22) ?? new Graphics().roundRect(0, 0, 58, 22, 8).fill(fill));
        const t2 = txt(label, 10.5, color, true);
        const tq = pos(`${key}_text`, { x: Math.round((58 - t2.width) / 2), y: 4 });
        t2.x = tq.x;
        t2.y = tq.y;
        b.addChild(t2);
        pressable(b, onTap);
        hreg(`${key}_text`, t2);
        hpiece(key, b, x, 4);
        return b;
      };
      mkMini("board_held_btn_recruit", "영입", rw - 128, 0xffffff, PINK, () => {
        if (ctrl.state.members.length >= 5) { showReplacePick(c.id); return; }
        ctrl.recruitCandidate(c.id);
        opts.onChanged();
        showBoard();
      });
      // 회차 내 복구 불가 행동이라 2-tap 확인 (기존 토스트 패턴 재사용, 행마다 독립)
      let dropArmed = false;
      mkMini("board_held_btn_drop", "버리기", rw - 64, 0x8a76a8, 0xefe9f6, () => {
        if (!dropArmed) {
          dropArmed = true;
          toast(`한 번 더 누르면 ${c.name}를 내보내요. 이번 회차엔 다시 만날 수 없어요`);
          return;
        }
        ctrl.dropCandidate(c.id);
        toast(`${c.name} · 후보에서 내보냈어요`);
        showBoard();
      });
      heldG.addChild(row);
      y += 36;
    }
    if (held.length > 0) { bgrp("board_held", 14, heldY0, heldG); y += 2; }

    // 다음 할 일 안내 — 상황별 한 줄 (보류 영입 > 진행권 > 교환 가능 > 카드 모으기)
    const task = held.length > 0
      ? "💡 보류 후보는 위에서 바로 [영입]하거나 [버리기]할 수 있어요"
      : ticketN > 0 && pool.length > 0
        ? (full ? "🎤 오디션 우승자로 오디션 슬롯을 교체할 수 있어요" : "🎤 진행권이 있어요! 오디션을 열어 새 멤버를 뽑아요")
        : audCards >= cost
          ? `✨ 오디션 카드 ${cost}장이 모였어요! 진행권으로 바꿔요`
          : `🎯 오디션 카드 ${audCards}/${cost} · 주간 연습 '오디션 대비'에서 모아요`;
    // 배너 배경은 투명 — 슬롯 아트 업로드 시에만 그린다 (분홍 폴백 박스는 배경판 아트와 겹쳐 보여 제거)
    const taskBg = skinNode("audition-banner", W - 28, 28);
    const taskT = txt(task, 11, 0xc9527f, true);
    taskT.x = 10;
    taskT.y = 7;
    bgrp("board_banner", 14, y + 4, ...(taskBg ? [taskBg, taskT] : [taskT]));
    y += 38;

    // 미측정 후보 + 보유 현황
    const fresh = pool.filter((c) => s.candidateStats[c.id] === undefined);
    // 전원 측정 후의 재오디션 = 기량 '갱신'(하락 가능)임을 알린다
    const poolT = txt(fresh.length > 0
      ? `아직 못 만난 후보  ${fresh.map((c) => c.temp ? `${c.name}?` : c.name).join(" · ")}   ·   🎯 카드 ${audCards} · 🎫 진행권 ${ticketN}`
      : `모든 후보를 만났어요 (재오디션은 재심사)   ·   🎯 카드 ${audCards} · 🎫 진행권 ${ticketN}`, 11, 0xffffff);
    bgrp("board_pool", 20, y + 4, poolT);
    y += 26;

    const canEx = audCards >= cost && pool.length > 0; // 후보가 없으면 진행권이 죽은 자원이 되므로 교환도 막는다
    const exBtn = abtn(canEx ? `카드 ${cost}장 → 진행권` : `카드 ${audCards}/${cost} 필요`, 186, canEx ? LAV : 0xc4b8d6, () => {
      if (!canEx) {
        toast(pool.length === 0
          ? "영입할 후보가 없어요. 진행권으로 바꿔도 쓸 곳이 없어요"
          : `오디션 카드가 ${cost - audCards}장 더 필요해요. 연습 '오디션 대비'에서 획득`);
        return;
      }
      // 오디션 카드는 관문에서 평판+5·실력+1로도 쓰이는 실전 카드 (cards.json audition 템플릿)
      if (ctrl.exchangeAudition()) {
        toast("진행권 +1 · 카드 3장 소모 (관문에서도 쓸 수 있던 카드예요)");
        opts.onChanged();
        showBoard();
      }
    }, "exchange");
    bgrp("board_btn_exchange", 14, y, exBtn);
    btnLabel("board_btn_exchange", exBtn);
    const canHold = ticketN > 0 && pool.length > 0;
    const holdBtn = abtn("🎤 오디션 개최", 186, canHold ? PINK : 0xc4b8d6, () => {
      // 새로 만날 후보가 없으면(전원 심사 완료) 재심사임을 먼저 확인 — 취소 시 진행권을 쓰지 않는다
      if (canHold && fresh.length === 0) { showRecheckConfirm(); return; }
      if (canHold) { showAudition(); return; }
      toast(pool.length === 0 ? "영입할 후보가 없어요" : `진행권이 없어요. 오디션 카드 ${cost}장으로 교환하세요`);
    }, "hold");
    bgrp("board_btn_hold", W - 186 - 14, y, holdBtn);
    btnLabel("board_btn_hold", holdBtn);
    if (canHold) pulse(holdBtn); // 지금 누를 버튼 강조 (그룹 내부 로컬 좌표 기준)

    const close = txt("← 이번엔 넘어가기", 12, 0xffffff);
    close.eventMode = "static";
    close.cursor = "pointer";
    close.on("pointertap", closeBoard);
    bgrp("board_skip", 20, y + 62, close);
  };

  /** 핵심 CTA 펄스 — 은은한 스케일 숨쉬기 (파괴되면 자동 해제). 레이아웃 그룹 내부 로컬 좌표 기준 */
  const pulse = (target: Container): void => {
    const cx = target.x + 93; // 버튼(186) 중심 기준 스케일
    let t = 0;
    const step = (): void => {
      if (target.destroyed) { opts.ticker.remove(step); return; }
      t += opts.ticker.deltaMS;
      const s2 = 1 + Math.sin(t / 280) * 0.025;
      target.scale.set(s2);
      target.x = cx - 93 * s2;
    };
    opts.ticker.add(step);
  };

  // ── 재심사 확인 — 새 후보가 없을 때 개최 전 1회 확인 (여기서 취소하면 진행권 보존) ──
  const showRecheckConfirm = (): void => {
    setRedrawHook(showRecheckConfirm);
    clear();
    // 배경판 — 맨 뒤 레이어. 아트 미업로드면 아무것도 깔지 않는다(패널 프레임이 그대로 보인다)
    const rbg = skinFit("recheck-bg", W, H - 52);
    if (rbg) { bgrp("recheck_bg", 0, 0, rbg); setFrame(false); }

    const t = txt("새로 만날 후보가 없어요", 17, 0xffffff, true);
    t.x = (W - t.width) / 2;
    t.y = 120;
    const l1 = txt("오디션을 열면 이미 만난 후보를 다시 심사해요", 12, 0xffffff);
    l1.x = (W - l1.width) / 2;
    l1.y = 158;
    const l2 = txt("기량이 오르내릴 수 있고, 진행권 1장을 씁니다", 12, 0xffffff);
    l2.x = (W - l2.width) / 2;
    l2.y = 180;
    // 문구는 각각 따로 등록 — 크기·색·위치를 줄 단위로 조정한다 (자식 좌표는 그대로, 그룹이 오프셋)
    bgrp("recheck_title", 0, 0, t);
    bgrp("recheck_line1", 0, 0, l1);
    bgrp("recheck_line2", 0, 0, l2);

    const go = btn("재심사 진행", 200, PINK, showAudition, "recheck-btn-go");
    go.x = (W - 200) / 2;
    go.y = 230;
    const back = btn("돌아가기 (진행권 유지)", 200, 0xc4b8d6, showBoard, "recheck-btn-back");
    back.x = (W - 200) / 2;
    back.y = 294;
    bgrp("recheck_btn_go", 0, 0, go);
    btnLabel("recheck_btn_go", go);
    bgrp("recheck_btn_back", 0, 0, back);
    btnLabel("recheck_btn_back", back);
  };

  // ── ② 오디션 무대 (리듬게임 · 전용 문구) ──
  const showAudition = (): void => {
    setRedrawHook(showAudition);
    clear();
    // 관문 리듬게임과 완전히 동일한 지오메트리로 표시 — 멤버 점검 패널(프레임·헤더 포함)은 통째로
    // 숨겼다가 리듬 종료 시 복원. 무대는 parent 직속 컨테이너(관문 패널과 같은 앵커·크기)
    panel.visible = false;
    const stage = new Container();
    // 패널 크기 — 관문(renderGate)과 동일 규칙: 배경판 아트/영상 비율로 확장 (상하 잘림 없음)
    let aw = MG_W;
    let ah = MG_H;
    const btex = skinTexTrim("audition-board");
    if (btex) {
      ah = Math.round(aw * (btex.height / btex.width));
      const maxH = 932 - 145 - 5; // 화면 높이 - 기본 패널 y - 여유 (관문과 동일)
      if (ah > maxH) {
        ah = maxH;
        aw = Math.round(ah * (btex.width / btex.height));
      }
    }
    const gp = pos("gate", { x: Math.round((430 - aw) / 2), y: 145 }); // 관문과 같은 앵커 — rhythm_* 레이아웃 키 공유
    stage.x = gp.x;
    stage.y = gp.y;
    parent.addChild(stage);
    audStage = stage; // 중복 마운트 방지용 참조 (리드로우로 showAudition이 다시 불릴 때 이전 무대 정리)
    editable("gate", stage); // 무대 전체 — 관문 패널과 같은 키 (두 게임 위치 동기 유지)
    const t = txt("신인 오디션 · 심사석에 앉다", 19, INK, true); // 관문 제목과 같은 위치·크기
    const tp = pos("audition_title", { x: 20, y: 18 });
    t.x = tp.x;
    t.y = tp.y;
    stage.addChild(t);
    editable("audition_title", t); // 오디션 전용 문구 — 개별 조정 키
    const restore = (): void => {
      killStage();
      panel.visible = true; // 멤버 점검 프레임 복원
    };
    // 우상단 X — 관문과 동일한 형태·위치. gate_exit 키는 관문과 같은 "오프셋 그룹" 방식
    // (버튼 기본 위치는 우상단 고정, 레이아웃 저장값은 오프셋으로 가산 — 관문 chromeGrp와 동일 규약)
    const xb = new Container();
    const exitSkin = skinNatural("ui-close-x", 36, 36);
    if (exitSkin) {
      xb.addChild(exitSkin);
    } else {
      const g = new Graphics().roundRect(0, 0, 36, 36, 11).fill(0xf3ecfa).stroke({ width: 1.5, color: 0xdccdec });
      const xt = txt("✕", 16, SUB, true);
      xt.x = (36 - xt.width) / 2;
      xt.y = (36 - xt.height) / 2;
      xb.addChild(g, xt);
    }
    xb.x = aw - 48;
    xb.y = 12;
    xb.eventMode = "static";
    xb.cursor = "pointer";
    xb.on("pointertap", () => { // 오디션 중단 = 개최 무산(진행권 유지) → 보드 복귀
      restore();
      playBgm("main"); // 리듬 곡 진행 중이었으면 정지·메인 복귀
      showBoard();
    });
    const exitBtn = new Container();
    const ep = pos("gate_exit", { x: 0, y: 0 });
    exitBtn.x = ep.x;
    exitBtn.y = ep.y;
    exitBtn.addChild(xb);
    let hardCleared = false;
    mountEngine(stage, {
      engine: "rhythm", // 오디션 = 무대 리듬게임 (연습 '오디션 대비'의 rps와 차별화)
      audition: true,   // 심사석 컨셉 (B-1) — 리듬 문구를 심사 테마로
      act: ctrl.state.act,
      ticker: opts.ticker,
      width: aw,
      panelH: ah,
      boardSkin: "audition-board", // 오디션 전용 배경판 — 관문과 같은 방식으로 runRhythm이 그림
      hardBonus: () => { hardCleared = true; }, // 하드(3열) 클리어 → 후보 기량 +3
      onFinish: (grade) => {
        restore();
        playBgm("main"); // 오디션 종료 → 아케이드 트랙 정지·메인 복귀 (보드는 draw를 안 타므로 여기서)
        if (!grade) { showBoard(); return; } // 실패 = 이번 개최 무산 (진행권 유지)
        const r = ctrl.holdAudition(grade);
        if (r && hardCleared) {
          r.stat = Math.min(100, r.stat + 3);
          ctrl.state.candidateStats[r.char.id] = r.stat;
        }
        opts.onChanged();
        if (r) showResult(r, grade);
        else showBoard();
      },
    });
    stage.addChild(exitBtn); // 엔진 마운트 뒤에 올려 배경판·노트 위 레이어 확보
    editable("gate_exit", exitBtn);
  };

  // ── ③ 결과: 후보 카드 + 영입/보류 (만석이면 방출 선택) ──
  const showResult = (r: { char: CharacterDef; stat: number }, grade: MiniGameGrade): void => {
    setRedrawHook(() => showResult(r, grade));
    clear();
    // 영입(후보 결과) 화면 전체 배경판 — 맨 뒤 레이어
    const rbg = skinFit("audition-recruit-bg", W, H - 52);
    if (rbg) { body.setChildIndex(bgrp("board_recruit_bg", 0, 0, rbg), 0); setFrame(false); }
    const GN: Record<MiniGameGrade, string> = { perfect: "PERFECT ✨", good: "GOOD 👍", clear: "CLEAR ✔" };
    // 관문과 같은 grade-* 슬롯 공용 (심사표 스탬프)
    const stamp = skinFit(`grade-${grade}`, 180, 64);
    if (stamp) {
      stamp.x = (W - 180) / 2;
      stamp.y = 8;
      bgrp("board_res_grade", 0, 0, stamp); // 레이아웃 에디터 등록
    } else {
      const g1 = txt(GN[grade], 22, INK, true);
      g1.x = (W - g1.width) / 2;
      g1.y = 20;
      bgrp("board_res_grade", 0, 0, g1); // 스탬프 미업로드 시에도 같은 키로 조정
    }

    const card = new Container();
    const cbg = skinFit("audition-card", 180, 200); // 후보 카드 배경 — 원본 비율 유지 (빈 슬롯은 내용만)
    // 심사 결과 후보 프로필 — 캐릭터별 슬롯(member-icon-<id>), 미업로드 시 기존 색 원
    const face = profile(r.char.id, 68);
    let dot: Container;
    if (face) {
      face.x = 90 - 34;
      face.y = 66 - 34;
      dot = face;
    } else {
      dot = new Graphics().circle(90, 66, 34).fill(r.char.temp ? 0xd9cdeb : parseInt(r.char.color.slice(1), 16));
    }
    const nm = txt(`${r.char.name}${r.char.temp ? " (가칭)" : ""}`, 15, INK, true);
    nm.x = (180 - nm.width) / 2;
    nm.y = 116;
    // 스펙 §7: "심사 결과: 기량 N — 포착률이 높을수록 진짜 실력이 보여요"를 st+cap 두 요소로 분배
    const st = txt(`심사 결과: 기량 ${r.stat}`, 13, 0xc9527f, true);
    st.x = (180 - st.width) / 2;
    st.y = 146;
    const rl = txt(ROLE_LABEL[r.char.eligibleRoles[0] ?? "helper2"] ?? "", 10, SUB);
    rl.x = (180 - rl.width) / 2;
    rl.y = 172;
    if (cbg) card.addChild(cbg);
    card.addChild(dot, nm, st, rl);
    // 카드 프레임 + 내부 텍스트 각각 레이아웃 에디터 등록 (내부 좌표는 카드(180폭) 기준)
    bgrp("board_res_card", (W - 180) / 2, 70, card);
    const regIn = (suffix: string, t2: Text): void => {
      const q = pos(`board_res_${suffix}`, { x: Math.round(t2.x), y: Math.round(t2.y) });
      t2.x = q.x;
      t2.y = q.y;
      editable(`board_res_${suffix}`, t2);
    };
    regIn("card_name", nm);
    regIn("card_stat", st);
    regIn("card_role", rl);

    const full = ctrl.state.members.length >= 5;
    const cap = txt(full
      ? "슬롯이 가득 찼어요. 영입하려면 오디션 슬롯 멤버와 교체해요"
      : "포착률이 높을수록 진짜 실력이 보여요 · 영입하면 빈 슬롯에 합류", 10.5, SUB);
    const capX = Math.round((W - cap.width) / 2);
    bgrp("board_res_caption", capX, 278, cap);
    const rec = abtn(full ? "영입 (교체 대상 선택)" : "영입한다", 220, PINK, () => {
      if (full) { showReplacePick(r.char.id); return; }
      ctrl.recruitCandidate(r.char.id);
      opts.onChanged();
      showBoard();
    }, "recruit");
    bgrp("board_res_btn_recruit", (W - 220) / 2, 300, rec);
    btnLabel("board_res_btn_recruit", rec);
    const hold = abtn("보류 (보드에서 다시 영입 가능)", 220, 0xc4b8d6, showBoard, "sub");
    bgrp("board_res_btn_hold", (W - 220) / 2, 364, hold);
    btnLabel("board_res_btn_hold", hold);
  };

  // ── 만석 교체: 방출할 오디션 슬롯 멤버 선택 ──
  const showReplacePick = (recruitId: string): void => {
    setRedrawHook(() => showReplacePick(recruitId));
    clear();
    const t = txt("누구와 교체할까? (오디션 슬롯만)", 14, INK, true);
    t.x = 20;
    t.y = 8;
    body.addChild(t);
    let y = 44;
    for (const m of ctrl.state.members) {
      const c = charOf(m.characterId);
      const fixed = FIXED_MEMBERS.has(m.characterId);
      const row = memberRow(y, c?.name ?? m.characterId, parseInt((c?.color ?? "#d9cdeb").slice(1), 16),
        ROLE_LABEL[m.role] ?? m.role, m.stat, fixed ? "데뷔조 핵심 멤버" : "탭하여 방출·교체", fixed, m.characterId);
      if (!fixed) {
        row.eventMode = "static";
        row.cursor = "pointer";
        row.on("pointertap", () => {
          ctrl.recruitCandidate(recruitId, m.characterId); // 방출자는 풀 복귀
          opts.onChanged();
          showBoard();
        });
      }
      body.addChild(row);
      y += 62;
    }
    const back = abtn("← 돌아가기", 180, 0xc4b8d6, showBoard, "sub");
    back.x = (W - 180) / 2;
    back.y = y + 16;
    body.addChild(back);
  };

  const canAudition = ctrl.state.deck.includes("audition") && !ctrl.state.membersLocked
    && candidatePool(characters, ctrl.state).length > 0;
  const previewChar = opts.previewResult ? candidatePool(characters, ctrl.state)[0] ?? characters[0] : undefined;
  if (opts.previewResult && previewChar) showResult({ char: previewChar, stat: 82 }, opts.previewResult); // 치트 미리보기
  else if (opts.startAudition && canAudition) showAudition();
  else showBoard();
}
