// 단일 HTML 파일 생성 — dist-single의 JS 번들을 인라인하고, 이미지·오디오를 data URI로 임베드.
// 산출물: dist-single/debut-loop-preview.html (파일 하나로 전달, 로컬 브라우저에서 실행 가능)
import fs from "node:fs";
import path from "node:path";

const dist = "dist-single";
const html0 = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const m = html0.match(/src="\.\/(assets\/index-[^"]+\.js)"/);
if (!m) throw new Error("index.html에서 번들 스크립트를 찾지 못함");
let js = fs.readFileSync(path.join(dist, m[1]), "utf8");

const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};
const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

let embedded = 0;
for (const f of walk(path.join(dist, "assets"))) {
  const ext = path.extname(f).toLowerCase();
  if (!MIME[ext]) continue;
  const rel = path.relative(dist, f).split(path.sep).join("/"); // e.g. assets/char/haru_bust.png
  const uri = `data:${MIME[ext]};base64,${fs.readFileSync(f).toString("base64")}`;
  const before = js.length;
  js = js.split("./" + rel).join(uri).split(rel).join(uri); // 번들 내 경로 리터럴 → data URI
  if (js.length !== before) embedded++;
}

js = js.replace(/<\/script/gi, "<\\/script"); // 인라인 스크립트 조기 종료 방지 (문자열 의미 동일)
let html = html0.replace(/<script type="module"[^>]*><\/script>\n?/, "");
html = html.replace("</body>", () => `<script type="module">\n${js}\n</script>\n</body>`); // 함수형 — 번들 내 $ 시퀀스의 특수 치환 방지

const out = path.join(dist, "debut-loop-preview.html");
fs.writeFileSync(out, html);
console.log(`✅ ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)}MB, 에셋 ${embedded}건 임베드)`);
