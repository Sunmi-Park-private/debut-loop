// tools/editorHub.ts — 에디터 통합 허브 (dev 전용, editor.html).
// 새 에디터를 만들면 EDITORS 배열에 한 줄 추가하면 된다.
import qrcode from "qrcode-generator";
import { bgManifest } from "../ui/bgSlots";
import { allUiSkinSlots } from "../ui/uiSkin";
import { bgmTracks } from "../ui/audio";
import { allCharSkinSlots } from "../ui/charSkins";

interface EditorEntry {
  href: string;
  icon: string;
  name: string;
  desc: string;
  /** 슬롯 현황 배지 — [총 슬롯 수] 또는 [업로드 수, 총 수] */
  status?: () => Promise<string> | string;
}

const bgSlots = [...bgManifest.story, ...bgManifest.gates, ...bgManifest.system];
/** 파일 존재 여부로 업로드 수 집계 — vite SPA 폴백(없는 경로도 200 HTML)은 content-type으로 걸러냄 */
const countUploaded = async (files: string[]): Promise<number> => {
  const r = await Promise.all(files.map((f) =>
    f ? fetch(`/${f}`, { method: "HEAD" })
      .then((x) => x.ok && !(x.headers.get("content-type") ?? "").includes("text/html"))
      .catch(() => false) : false));
  return r.filter(Boolean).length;
};

const EDITORS: EditorEntry[] = [
  { href: "flow.html", icon: "🗺", name: "스토리 플로우", desc: "비트(카드) 흐름·대사·효과 편집 — 저장 시 게임 반영" },
  { href: "bg.html", icon: "🖼", name: "배경 이미지", desc: "장면별 배경 업로드 (프롤로그·막·관문·타이틀)",
    status: async () => `${await countUploaded(bgSlots.map((s) => s.file))}/${bgSlots.length} 업로드` },
  { href: "ui.html", icon: "🎛", name: "UI 스킨", desc: "버튼·배너·게이지 등 22개 컴포넌트 이미지",
    status: async () => { const s = allUiSkinSlots(); return `${await countUploaded(s.map((x) => x.file))}/${s.length} 업로드`; } },
  { href: "bgm.html", icon: "🎵", name: "배경음악", desc: "장면별 BGM 업로드·미리듣기·삭제 (8개 장면)",
    status: () => `${bgmTracks.filter((t) => t.file).length}/${bgmTracks.length} 업로드` },
  { href: "char.html", icon: "👤", name: "캐릭터", desc: "캐릭터별 전신 3종·반신·표정 5종 (반신·연습복은 게임 즉시 반영)",
    status: async () => { const s = allCharSkinSlots(); return `${await countUploaded(s.map((x) => x.file))}/${s.length} 업로드`; } },
  { href: "beat.html", icon: "🥁", name: "박자 (리듬게임)", desc: "곡×모드(이지 2열/하드 3열)별 노트 배치 — 파형·탭 녹음·BPM 스냅" },
  { href: "./", icon: "🎮", name: "게임 (인게임 에디터)", desc: "레이아웃·타이밍 튜닝·카드 구성은 게임 내 ⚙ 치트 메뉴에서" },
];

const root = document.getElementById("editor-hub")!;
root.innerHTML = `
  <div style="font:14px -apple-system,sans-serif;color:#e8def4;max-width:960px;margin:0 auto;padding:40px 26px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">
      <div>
        <h1 style="margin:0 0 6px;font-size:24px">🌟 Debut Loop! 에디터 허브</h1>
        <p style="margin:0 0 26px;font-size:13px;color:#a08cc0">모든 에셋·리소스 편집 도구의 입구 — 카드를 누르면 각 에디터로 이동합니다 (dev 서버 전용)</p>
      </div>
      <div style="display:flex;gap:10px;flex-shrink:0">
        <a id="apk-dl" href="/__apk" style="display:none;text-align:center;background:#241539;border:2px solid #3a2555;border-radius:14px;padding:12px 18px;text-decoration:none;color:#8fe3b0;font-weight:800;font-size:13px"
          title="치트 메뉴(⚙) 포함 — 팀 테스트용"
          onmouseenter="this.style.borderColor='#8fe3b0'" onmouseleave="this.style.borderColor='#3a2555'">🤖 APK · 디버그<br/>
          <small id="apk-info" style="color:#8a76a8;font-weight:400;font-size:11px"></small></a>
        <div id="apk-qr" style="display:none;text-align:center;background:#241539;border:2px solid #3a2555;border-radius:14px;padding:10px 12px">
          <div id="apk-qr-img" style="line-height:0"></div>
          <small style="color:#8a76a8;font-size:10px">폰 카메라로 스캔<br/>디버그 APK 받기</small>
        </div>
        <a id="apkr-dl" href="/__apkrelease" style="display:none;text-align:center;background:#241539;border:2px solid #3a2555;border-radius:14px;padding:12px 18px;text-decoration:none;color:#ffd98a;font-weight:800;font-size:13px"
          title="치트 메뉴 제외 — 제출·외부 공유용 (디버그 키 서명이라 사이드로드 설치 가능)"
          onmouseenter="this.style.borderColor='#ffd98a'" onmouseleave="this.style.borderColor='#3a2555'">📦 APK · 릴리즈<br/>
          <small id="apkr-info" style="color:#8a76a8;font-weight:400;font-size:11px"></small></a>
        <a id="ios-dl" href="/__ioszip" style="display:none;text-align:center;background:#241539;border:2px solid #3a2555;border-radius:14px;padding:12px 18px;text-decoration:none;color:#8fd8ff;font-weight:800;font-size:13px"
          title="디자이너 맥북에서 압축 풀고 Xcode로 열어 아이폰에 설치 — 가이드 md 포함"
          onmouseenter="this.style.borderColor='#8fd8ff'" onmouseleave="this.style.borderColor='#3a2555'">🍎 아이폰 프로젝트 zip<br/>
          <small id="ios-info" style="color:#8a76a8;font-weight:400;font-size:11px"></small></a>
      </div>
    </div>
    <div id="cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px"></div>
  </div>`;
const cards = document.getElementById("cards")!;

// 최신 빌드 정보 — 있으면 다운로드 버튼 노출 (APK · 아이폰 프로젝트 zip)
const fmtTime = (mtime: number): string => {
  const d = new Date(mtime);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const showApk = (route: string, infoId: string, dlId: string, suffix: string, after?: () => void): void => {
  void fetch(`${route}?info`).then(async (r) => {
    if (!r.ok) return; // 빌드 없음 → 버튼 숨김 유지
    const { size, mtime } = (await r.json()) as { size: number; mtime: number };
    (document.getElementById(infoId) as HTMLElement).textContent =
      `${fmtTime(mtime)} · ${Math.round(size / 1024 / 1024)}MB${suffix}`;
    (document.getElementById(dlId) as HTMLElement).style.display = "block";
    after?.();
  }).catch(() => {});
};
// 디버그 APK QR — 폰에서 케이블 없이 바로 받기. 주소는 지금 접속한 origin 기준이라
// 로컬(localhost)이든 터널(trycloudflare)이든 그 자리에서 맞는 링크가 나온다.
// localhost는 폰에서 열리지 않으므로 QR을 띄우지 않는다 (터널 주소로 접속해야 의미가 있다)
const showApkQr = (): void => {
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return;
  const qr = qrcode(0, "M"); // 0=버전 자동 · M=중간 오류정정 (인쇄 아닌 화면 스캔에 충분)
  qr.addData(`${location.origin}/__apk`);
  qr.make();
  (document.getElementById("apk-qr-img") as HTMLElement).innerHTML = qr.createImgTag(4, 0);
  (document.getElementById("apk-qr") as HTMLElement).style.display = "block";
};

showApk("/__apk", "apk-info", "apk-dl", " · 치트 포함", showApkQr);
showApk("/__apkrelease", "apkr-info", "apkr-dl", " · 치트 제외");
void fetch("/__ioszip?info").then(async (r) => {
  if (!r.ok) return;
  const { mtime } = (await r.json()) as { mtime: number };
  (document.getElementById("ios-info") as HTMLElement).textContent = `${fmtTime(mtime)} 동기화 · Xcode용`;
  (document.getElementById("ios-dl") as HTMLElement).style.display = "block";
}).catch(() => {});

for (const e of EDITORS) {
  const a = document.createElement("a");
  a.href = e.href;
  a.style.cssText = "display:block;background:#241539;border:2px solid #3a2555;border-radius:16px;padding:20px;text-decoration:none;color:#e8def4;transition:border-color .15s";
  a.onmouseenter = () => { a.style.borderColor = "#ff7fb0"; };
  a.onmouseleave = () => { a.style.borderColor = "#3a2555"; };
  a.innerHTML = `
    <div style="font-size:34px">${e.icon}</div>
    <div style="font-weight:800;font-size:16px;margin-top:10px">${e.name}</div>
    <div style="font-size:12px;color:#8a76a8;margin-top:6px;line-height:1.5">${e.desc}</div>
    <div data-st style="font-size:11px;color:#8fe3b0;margin-top:10px;min-height:14px"></div>`;
  cards.appendChild(a);
  if (e.status) {
    const st = a.querySelector("[data-st]") as HTMLElement;
    void Promise.resolve(e.status()).then((s) => { st.textContent = `📦 ${s}`; });
  }
}
