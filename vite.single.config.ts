// 단일 HTML 전달용 빌드 (아이폰 등 로컬 파일 실행) — 동적 청크를 한 파일로 합침.
// 사용: npm run build:single (scripts/singlefile.mjs가 에셋 data URI 인라인까지 수행)
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

export default mergeConfig(
  base,
  defineConfig({
    build: {
      outDir: 'dist-single',
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  }),
)
