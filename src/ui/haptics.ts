// ui/haptics.ts — 진동(햅틱) 피드백.
// Capacitor Haptics 플러그인이 설치돼 있으면 그걸 쓰고(안드로이드·iOS 공통),
// 없으면 웹 Vibration API로 폴백한다(안드로이드 WebView·크롬만 동작, iOS는 미지원).
// 데스크톱 브라우저는 둘 다 없으므로 조용히 무시된다.

export type Buzz = "light" | "medium" | "heavy";

const MS: Record<Buzz, number> = { light: 12, medium: 22, heavy: 38 };
const STYLE: Record<Buzz, string> = { light: "LIGHT", medium: "MEDIUM", heavy: "HEAVY" };

interface HapticsPlugin { impact(o: { style: string }): Promise<void> }

let enabled = true;

/** 설정에서 진동 끄기/켜기 (기본 켜짐) */
export function setHaptics(on: boolean): void {
  enabled = on;
}

export function hapticsEnabled(): boolean {
  return enabled;
}

/** 짧은 진동 한 번 — 판정·선택 확정 등 순간 피드백용 */
export function buzz(kind: Buzz = "light"): void {
  if (!enabled) return;
  const cap = (globalThis as { Capacitor?: { Plugins?: { Haptics?: HapticsPlugin } } }).Capacitor;
  const plugin = cap?.Plugins?.Haptics;
  if (plugin) {
    void plugin.impact({ style: STYLE[kind] }).catch(() => {}); // 플러그인 미지원 기기 무시
    return;
  }
  navigator.vibrate?.(MS[kind]);
}
