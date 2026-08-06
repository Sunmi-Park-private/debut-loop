// ui/metaMenu.ts — 유저용 메타 메뉴 (FE 셸 · 배경음악 볼륨만 실동작, 나머지는 확장성 어필용).
// 로비 사이드 아이콘(설정·상점·데일리·앨범) → 각 탭. 상태는 메모리에만(새로고침 시 초기화).
// 본선: docs/META_UI.md 원설계(메타 저장·정산·오디오·다국어)로 확장.
import { bgmVolume, setBgmVolume, bgmMuted, setBgmMuted } from "./audio";
import { pairSpace } from "./keys";

const INK = "#5b4a70";
const SUB = "#a99bc0";
const LINE = "#ece4f4";
const PINK = "#ff7fb0";

type Tab = "settings" | "shop" | "daily" | "album";

// FE 셸 상태 (메모리 전용)
const mock = {
  sns: { google: false, apple: false },
  lang: "ko",
  bgm: 30,
  sfx: 30,
  sfxMuted: false,
  dailyClaimed: false,
};

export function toast(msg: string): void {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText =
    "position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:1200;" +
    `background:${INK};color:#fff;font:13px -apple-system,sans-serif;font-weight:700;` +
    "padding:10px 18px;border-radius:20px;box-shadow:0 8px 22px rgba(0,0,0,.3);opacity:0;transition:opacity .2s";
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = "1"; });
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 250); }, 1500);
}

// 모달 코어는 1회만 생성 — 로비 레일 버튼이 공유
let openTab: ((tab: Tab) => void) | null = null;

/** 특정 탭으로 메타 메뉴 열기 (로비 레일 버튼용) */
export function openMetaMenu(tab: Tab): void {
  ensureCore();
  openTab?.(tab);
}

function ensureCore(): void {
  if (openTab) return;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:1100;background:rgba(91,74,112,.4);display:none;" +
    "align-items:center;justify-content:center";
  const modal = document.createElement("div");
  modal.style.cssText =
    "background:#fff;border-radius:20px;width:360px;max-width:92vw;max-height:82vh;overflow:auto;" +
    `font:14px -apple-system,'Apple SD Gothic Neo',sans-serif;color:${INK};` +
    "box-shadow:0 18px 50px rgba(0,0,0,.3);padding:16px 18px 20px";
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = "none"; };
  pairSpace(() => { // Space = 바깥 탭과 동일 (닫기) — 닫혀 있으면 게임으로 통과
    if (overlay.style.display === "none") return false;
    overlay.style.display = "none";
    return true;
  }, () => true);
  openTab = (tab: Tab) => { render(tab); overlay.style.display = "flex"; };

  const section = (html: string): HTMLDivElement => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d;
  };

  // 탭바 제거 — 상점·데일리·앨범은 로비 플로팅 버튼에서 각자 진입 (단일 뷰 + 제목/닫기 헤더)
  const TITLES: Record<Tab, string> = { settings: "⚙️ 설정", shop: "🛍 상점", daily: "🎁 데일리 보상", album: "📔 포토 앨범" };
  function header(current: Tab): void {
    modal.innerHTML = "";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:12px";
    const title = document.createElement("b");
    title.textContent = TITLES[current];
    title.style.fontSize = "15px";
    const x = document.createElement("button");
    x.textContent = "✕";
    x.title = "닫기";
    x.style.cssText =
      "width:26px;height:26px;border:1px solid #ece4f4;border-radius:50%;background:#f8f4fc;" +
      `color:${SUB};font-weight:700;cursor:pointer;line-height:1`;
    x.onclick = () => { overlay.style.display = "none"; };
    row.append(title, x);
    modal.appendChild(row);
  }

  // ── ⚙️ 설정 ──
  function renderSettings(): void {
    header("settings");
    const snsRow = (id: "google" | "apple", label: string): HTMLDivElement => {
      const d = document.createElement("div");
      d.style.cssText = "display:flex;align-items:center;gap:10px;margin:8px 0";
      const name = document.createElement("span");
      name.textContent = label;
      name.style.flex = "1";
      const b = document.createElement("button");
      const paint = (): void => {
        b.textContent = mock.sns[id] ? "연동됨 ✓" : "연동하기";
        b.style.cssText =
          "padding:7px 14px;border-radius:10px;font-weight:700;font-size:12px;cursor:pointer;" +
          (mock.sns[id] ? `border:1.5px solid #6fd8c4;background:#f2fbf8;color:#2e9a80` : `border:1.5px solid ${LINE};background:#fff;color:${INK}`);
      };
      paint();
      b.onclick = () => { mock.sns[id] = !mock.sns[id]; paint(); if (mock.sns[id]) toast(`${label} 계정과 연동되었어요 ✓`); };
      d.append(name, b);
      return d;
    };

    const slider = (label: string, key: "bgm" | "sfx"): HTMLDivElement => {
      const d = document.createElement("div");
      d.style.cssText = "margin:10px 0";
      const top = document.createElement("div");
      top.style.cssText = "display:flex;justify-content:space-between;font-size:12.5px;font-weight:700";
      const val = document.createElement("span");
      const initial = key === "bgm" ? bgmVolume() : mock[key]; // 배경음악은 실제 볼륨과 동기
      val.textContent = String(initial);
      val.style.color = SUB;
      top.append(Object.assign(document.createElement("span"), { textContent: label }), val);

      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px";
      const input = document.createElement("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.value = String(initial);
      input.style.cssText = `flex:1;accent-color:${PINK}`;

      // 🔇 음소거 토글 — 볼륨값은 보존, BGM은 실동작(저장), 효과음은 목업 상태
      const isMuted = (): boolean => (key === "bgm" ? bgmMuted() : mock.sfxMuted);
      const muteBtn = document.createElement("button");
      muteBtn.style.cssText = "flex:none;width:34px;height:30px;border-radius:9px;border:1.5px solid " + LINE + ";background:#fff;cursor:pointer;font-size:15px;padding:0";
      const paintMute = (): void => {
        muteBtn.textContent = isMuted() ? "🔇" : "🔊";
        input.disabled = isMuted();
        input.style.opacity = isMuted() ? "0.4" : "1";
        val.style.textDecoration = isMuted() ? "line-through" : "none";
      };
      muteBtn.onclick = () => {
        const m = !isMuted();
        if (key === "bgm") setBgmMuted(m);
        else mock.sfxMuted = m;
        paintMute();
      };
      input.oninput = () => {
        mock[key] = Number(input.value);
        val.textContent = input.value;
        if (key === "bgm") setBgmVolume(Number(input.value)); // 실제 BGM 볼륨 반영 (저장됨)
      };
      paintMute();
      row.append(input, muteBtn);
      d.append(top, row);
      return d;
    };

    modal.appendChild(section(`<b style='font-size:13px'>계정 연동</b>`));
    modal.appendChild(snsRow("google", "Google"));
    modal.appendChild(snsRow("apple", "Apple"));
    modal.appendChild(section(`<hr style='border:none;border-top:1px solid ${LINE};margin:12px 0'><b style='font-size:13px'>언어</b>`));
    const langSel = document.createElement("select");
    langSel.style.cssText = `width:100%;padding:8px;border:1.5px solid ${LINE};border-radius:10px;margin-top:6px;color:${INK};background:#fff`;
    for (const [v, l] of [["ko", "한국어"], ["en", "English"], ["ja", "日本語"]] as const) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = l;
      if (mock.lang === v) o.selected = true;
      langSel.appendChild(o);
    }
    langSel.onchange = () => { mock.lang = langSel.value; toast(langSel.value === "ko" ? "한국어로 설정되었어요" : "곧 지원될 예정이에요 🌐"); };
    modal.appendChild(langSel);
    modal.appendChild(section(`<hr style='border:none;border-top:1px solid ${LINE};margin:12px 0'><b style='font-size:13px'>사운드</b>`));
    modal.appendChild(slider("배경음악", "bgm"));
    modal.appendChild(slider("효과음", "sfx"));
    modal.appendChild(section(`<div style='font-size:11px;color:${SUB}'>📱 기기 볼륨 버튼으로도 조절돼요</div>`));
    modal.appendChild(section(`<div style='margin-top:14px;font-size:11px;color:${SUB};text-align:center'>Debut Loop! · v0.1 데모<br>NAN 2026 · Team ZERO:C</div>`));
  }

  // ── 🛍 상점 ──
  function renderShop(): void {
    header("shop");
    modal.appendChild(section(`<div style='display:flex;justify-content:space-between;font-size:13px;font-weight:800'><span>상점</span><span style='color:#c9527f'>⭐ 32</span></div>`));
    const items: Array<[string, string, string, string]> = [
      ["🎴", "카드팩", "랜덤 카드 3장", "⭐ 15"],
      ["🎟", "패자부활권", "탈락 위기에서 한 번 부활", "⭐ 20"],
      ["✨", "스타터 부스트", "다음 런 시작 게이지 +5", "⭐ 10"],
      ["💎", "스페셜 팩", "에픽 확정 + 포토 1장", "₩3,300"],
    ];
    for (const [ic, name, desc, price] of items) {
      const d = document.createElement("div");
      d.style.cssText = `display:flex;align-items:center;gap:12px;border:2px solid ${LINE};border-radius:14px;padding:10px 12px;margin:9px 0`;
      d.innerHTML =
        `<span style='font-size:24px'>${ic}</span>` +
        `<span style='flex:1'><b style='font-size:13px'>${name}</b><br><small style='color:${SUB}'>${desc}</small></span>`;
      const buy = document.createElement("button");
      buy.textContent = price;
      buy.style.cssText = `padding:8px 13px;border:0;border-radius:10px;background:${PINK};color:#fff;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap`;
      buy.onclick = () => toast("데모 버전에서는 준비 중이에요 🛍");
      d.appendChild(buy);
      modal.appendChild(d);
    }
  }

  // ── 🎁 데일리 보상 ──
  function renderDaily(): void {
    header("daily");
    modal.appendChild(section(`<b style='font-size:13px'>출석 보상</b> <small style='color:${SUB}'>· 매일 접속하고 보상을 받아요</small>`));
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px";
    const rewards = ["⭐5", "⭐10", "🎴×1", "⭐15", "🎴×2", "⭐20", "🎴★★★"];
    rewards.forEach((r, i) => {
      const day = i + 1;
      const done = day <= 3 || (day === 4 && mock.dailyClaimed);
      const today = day === 4 && !mock.dailyClaimed;
      const d = document.createElement("div");
      d.style.cssText =
        "border-radius:12px;padding:10px 4px;text-align:center;font-size:11px;font-weight:700;" +
        (done ? `background:#f2fbf8;border:2px solid #6fd8c4;color:#2e9a80` :
          today ? `background:#fff2f9;border:2.5px solid ${PINK};color:#c9527f;cursor:pointer;box-shadow:0 4px 12px rgba(255,127,176,.35)` :
            `background:#f8f4fc;border:2px solid ${LINE};color:${SUB}`);
      d.innerHTML = `D${day}<br><span style='font-size:15px'>${done ? "✓" : r}</span>${today ? "<br><b style='font-size:9px'>오늘!</b>" : ""}`;
      if (today) d.onclick = () => { mock.dailyClaimed = true; toast("⭐15 획득! 내일 또 만나요 🎁"); renderDaily(); };
      grid.appendChild(d);
    });
    modal.appendChild(grid);
    modal.appendChild(section(`<div style='margin-top:12px;font-size:11px;color:${SUB};text-align:center'>7일 연속 출석하면 ★★★ 에픽 카드!</div>`));
  }

  // ── 📔 포토앨범 ──
  function renderAlbum(): void {
    header("album");
    modal.appendChild(section(`<b style='font-size:13px'>포토앨범</b> <small style='color:${SUB}'>· 3/12 수집 — 회귀를 반복하며 모아보세요</small>`));
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:10px";
    const items: Array<[string, string, boolean]> = [
      ["🌑", "0시의 사고", true],
      ["🖐", "다섯 손가락", true],
      ["🎤", "지하 첫 무대", true],
      ["💿", "첫 미니앨범", false],
      ["💜", "보라, 각성", false],
      ["🔍", "진실의 조각", false],
      ["🎊", "데뷔 성공", false],
      ["🌙", "또 다른 0시", false],
      ["📸", "비하인드 컷", false],
      ["🏆", "퍼펙트 무대", false],
      ["💌", "루나의 편지", false],
      ["❓", "???", false],
    ];
    for (const [ic, cap, open] of items) {
      const d = document.createElement("div");
      d.style.cssText =
        "aspect-ratio:3/4;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;" +
        "font-size:10px;font-weight:700;text-align:center;cursor:pointer;" +
        (open ? `background:linear-gradient(180deg,#fdf3f8,#f3e8fa);border:2px solid ${PINK}` :
          `background:#f3eef9;border:2px solid ${LINE};color:${SUB}`);
      d.innerHTML = open ? `<span style='font-size:26px'>${ic}</span>${cap}` : `<span style='font-size:22px'>🔒</span>???`;
      d.onclick = () => toast(open ? `"${cap}" — 데모에서 해금된 장면이에요 📔` : "아직 만나지 못한 장면이에요 🔒");
      grid.appendChild(d);
    }
    modal.appendChild(grid);
  }

  function render(tab: Tab): void {
    if (tab === "settings") renderSettings();
    else if (tab === "shop") renderShop();
    else if (tab === "daily") renderDaily();
    else renderAlbum();
  }
}
