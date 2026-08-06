// ui/loopVideo.ts — 이음새 없는 비디오 루프.
// 브라우저 기본 loop는 끝에서 0초로 시크한 뒤 첫 프레임을 다시 디코드하는 동안 한두 프레임이 멎어
// 짧은 루프 영상(로비 캐릭터 등)에서 "덜컹"이 보인다. 같은 영상을 두 번째 <video>로 예열해 두고
// 끝나기 직전에 텍스처를 즉시 스왑하는 핑퐁 방식으로 시퀀스처럼 연속 재생시킨다.
import { Sprite, Texture, VideoSource } from "pixi.js";

const LEAD_S = 0.3; // 끝나기 몇 초 전에 다음 비디오를 기동할지 (디코더 예열 여유)

// 원본 비디오별 최신 장착 토큰 — 로비 재렌더(엔딩 복귀 등)로 재장착된 뒤,
// 이전 장착의 늦은 정리가 공유 원본을 pause시켜 새 화면 영상이 멈추는 것 방지
const owners = new WeakMap<HTMLVideoElement, object>();

/** 비디오 텍스처 스프라이트에 이음새 없는 루프 장착 — 비디오가 아니면 no-op */
export function attachSeamlessLoop(spr: Sprite): void {
  const src = spr.texture.source;
  if (!(src instanceof VideoSource)) return;
  const a = src.resource;
  if (!a || typeof a.cloneNode !== "function") return;
  a.loop = false;
  // 에셋 로딩 시점부터 autoPlay로 돌고 있어 화면에 붙는 순간엔 이미 영상 중간 —
  // 항상 첫 프레임부터 보이도록 되감고 재생을 보장한다
  a.currentTime = 0;
  void a.play().catch(() => {});

  const b = a.cloneNode(true) as HTMLVideoElement; // 같은 src의 두 번째 디코더
  b.loop = false;
  b.muted = true;
  b.playsInline = true;
  b.preload = "auto";
  const texB = new Texture({ source: new VideoSource({ resource: b, autoPlay: false, alphaMode: src.alphaMode }) });
  const texA = spr.texture;

  let cur = a;
  let nxt = b;
  let curTex: Texture = texA;
  let nxtTex: Texture = texB;
  let swapping = false;

  const token = {};
  owners.set(a, token);
  const stop = (): void => {
    b.pause(); // 이 장착의 클론은 항상 정리
    a.removeEventListener("ended", onEnded);
    b.removeEventListener("ended", onEnded);
    if (owners.get(a) === token) a.pause(); // 원본은 최신 소유자일 때만 정지 (재장착 후엔 건드리지 않음)
  };

  const watch = (): void => {
    if (spr.destroyed) { stop(); return; }
    // 끝이 가까워지면 다음 비디오를 0초부터 기동 → 첫 프레임이 실제로 준비된 순간 텍스처 스왑
    if (!swapping && cur.duration > 0 && cur.duration - cur.currentTime < LEAD_S) {
      swapping = true;
      nxt.currentTime = 0;
      void nxt.play().then(() => {
        nxt.requestVideoFrameCallback(() => {
          if (spr.destroyed) { stop(); return; }
          spr.texture = nxtTex;
          cur.pause();
          [cur, nxt] = [nxt, cur];
          [curTex, nxtTex] = [nxtTex, curTex];
          swapping = false;
        });
      }).catch(() => { swapping = false; });
    }
    cur.requestVideoFrameCallback(watch);
  };
  cur.requestVideoFrameCallback(watch);

  // 탭 백그라운드 전환 등으로 스왑 타이밍을 놓쳐 끝나버린 경우의 안전망 — 즉시 처음부터 재생
  const onEnded = (): void => {
    if (spr.destroyed || swapping) return;
    cur.currentTime = 0;
    void cur.play().catch(() => {});
  };
  a.addEventListener("ended", onEnded);
  b.addEventListener("ended", onEnded);
  spr.on("destroyed", stop);
}
