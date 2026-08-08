// ui/ease.ts — UI 모션 이징 SSOT. 카드덱·스와이프 카드·패널 등 모든 화면 전환이 같은 곡선을 쓴다.
// 화면마다 다른 곡선을 쓰면 같은 게임인데 조작감이 제각각으로 느껴져서, 곡선과 강도를 한 곳에 모았다.

/** 이징 강도. 0=등속(선형), 1=완전 cubic. 등속과 cubic을 이 비율로 섞는다.
 *  0.5 = 시작 속도가 등속의 0.5배, 중앙 최고 속도가 2.0배 (1.0이면 0배·3.0배로 과장된다) */
export const EASE = 0.5;

const mix = (t: number, eased: number): number => t + (eased - t) * EASE;

/** 시작이 느리고 끝이 빠르다 — 화면 밖으로 빠져나가는 모션 */
export const easeIn = (t: number): number => mix(t, t * t * t);
/** 시작이 빠르고 끝이 느리다 — 들어오는·제자리로 돌아오는 모션 */
export const easeOut = (t: number): number => mix(t, 1 - Math.pow(1 - t, 3));
/** 양끝이 느리고 가운데가 빠르다 — 열고 닫기처럼 양방향인 모션 */
export const easeInOut = (t: number): number => mix(t, t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** from→to 보간 (진행률 t는 이미 이징이 적용된 값) */
export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;
