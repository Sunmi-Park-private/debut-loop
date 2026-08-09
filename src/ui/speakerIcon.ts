// ui/speakerIcon.ts — 스토리 카드 상단의 화자 프로필(원형 30px).
// 비트마다 다른 파일을 쓰므로 UI 스킨 슬롯(고정 id 매니페스트)과 달리 요청 시 로드하고 캐시한다.
// 도착하면 현재 화면을 다시 그려, 로딩을 기다리지 않고 카드가 먼저 뜬다.
import { Assets, Container, Sprite, Texture } from "pixi.js";
import { assetUrl } from "./hotAssets";

/** 화면 표시 지름 — 카드 상단 가운데의 작은 원 */
export const SPEAKER_D = 30;

const cache = new Map<string, Texture>();
const failed = new Set<string>();
const pending = new Set<string>();

/** 로드된 텍스처. 아직이면 null을 주고 백그라운드로 받아온다(도착 시 화면 재렌더) */
function speakerTex(file: string): Texture | null {
  const hit = cache.get(file);
  if (hit) return hit;
  if (failed.has(file) || pending.has(file)) return null;
  pending.add(file);
  void Assets.load<Texture>(assetUrl(file) ?? file)
    .then((tex) => {
      cache.set(file, tex);
      pending.delete(file);
      void import("./editor").then((e) => e.triggerRedraw());
    })
    .catch(() => { pending.delete(file); failed.add(file); });
  return null;
}

/** 화자 프로필 노드 — 올린 이미지를 그대로, 지름 SPEAKER_D 안에 원본 비율로.
 *  테두리·원형 마스크를 씌우지 않는다 — 아트에 이미 테두리가 그려져 올라오므로
 *  덧그리면 테두리가 겹치고, 마스크는 그 바깥선을 깎는다.
 *  파일이 없거나 아직 도착하지 않았으면 null. */
export function speakerNode(file: string | undefined): Container | null {
  if (!file) return null;
  const tex = speakerTex(file);
  if (!tex) return null;
  const wrap = new Container();
  const s = SPEAKER_D / Math.max(tex.width, tex.height); // contain — 잘리는 곳 없이 전부 보인다
  const spr = new Sprite(tex);
  spr.scale.set(s);
  spr.x = (SPEAKER_D - tex.width * s) / 2;
  spr.y = (SPEAKER_D - tex.height * s) / 2;
  wrap.addChild(spr);
  return wrap;
}

/** 캐시 비우기 — 같은 경로에 새 파일을 올렸을 때 (에디터 업로드 후) */
export function clearSpeakerCache(): void {
  cache.clear();
  failed.clear();
}
