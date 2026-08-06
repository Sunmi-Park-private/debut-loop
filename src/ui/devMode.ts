// ui/devMode.ts — 개발 도구 게이트.
// dev 서버에선 항상 켜짐, 프로덕션 빌드(제출본)에선 URL에 ?dev=1 붙일 때만.
// APK 테스트 빌드: VITE_CHEATS=1로 빌드하면 켜짐 (apk:sync 스크립트가 사용).
export const isDevMode = (): boolean =>
  import.meta.env.DEV ||
  import.meta.env.VITE_CHEATS === "1" ||
  new URLSearchParams(location.search).has("dev");
