// capacitor.config.ts — APK(안드로이드 웹뷰) 패키징 설정
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.debutloop.game",
  appName: "Debut Loop!",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: "https", // localStorage 등 웹 스토리지 안정 동작
  },
};

export default config;
