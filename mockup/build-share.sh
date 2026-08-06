#!/usr/bin/env bash
# build-share.sh — 공유용 단일 파일(mockup-share.html) 생성기
# mockup.html의 assets/ 이미지 참조를 base64 data URI로 임베드해 완전 독립 HTML로 만든다.
# 사용법:  ./build-share.sh   (mockup/ 폴더 안에서 실행)
# 요구:    python3 + Pillow(PIL)   설치:  python3 -m pip install Pillow
set -euo pipefail
cd "$(dirname "$0")"

python3 - <<'PY'
import base64, io, os
from PIL import Image

# (원본경로, 리사이즈 폭, JPEG 품질) — 화면 최대폭 430px라 800px면 2x로 충분
TARGETS = {
    "assets/bg_practice.png": (800, 82),
    "assets/char1_bust.png":  (800, 82),
}

def embed(path, w, q):
    im = Image.open(path).convert("RGB")
    h = int(im.height * w / im.width)
    im = im.resize((w, h), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=q)
    data = buf.getvalue()
    return "data:image/jpeg;base64," + base64.b64encode(data).decode(), len(data)

html = open("mockup.html", encoding="utf-8").read()
for path, (w, q) in TARGETS.items():
    if not os.path.exists(path):
        print(f"⚠️  건너뜀(없음): {path}"); continue
    uri, size = embed(path, w, q)
    html = html.replace(f'url("{path}")', f'url("{uri}")')
    print(f"임베드 {path}: {round(size/1024)} KB")

open("mockup-share.html", "w", encoding="utf-8").write(html)
left = html.count("assets/")
print(f"→ mockup-share.html: {round(os.path.getsize('mockup-share.html')/1024)} KB "
      f"(남은 assets 참조 {left}개, 0이면 완전 독립)")
PY
