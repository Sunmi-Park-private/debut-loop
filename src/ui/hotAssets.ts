// ui/hotAssets.ts — dev 서버 에디터 업로드 이벤트를 런타임 에셋 버전으로 반영.
// 같은 파일명으로 덮어쓴 리소스도 Pixi/브라우저 캐시를 우회해 다시 읽게 한다.
export interface HotAssetUpdate {
  route: string;
  id: string;
  file: string;
  frames?: string[];
}

const versions = new Map<string, number>();

const clean = (file: string): string => file.split("?")[0] ?? file;

function mark(file: string | undefined): void {
  if (!file) return;
  versions.set(clean(file), Date.now());
}

export function assetUrl(file: string | undefined): string | undefined {
  if (!file) return file;
  const key = clean(file);
  const v = versions.get(key);
  return v ? `${key}?v=${v}` : file;
}

export function assetVersion(files: Array<string | undefined>): number {
  return files.reduce((max, file) => Math.max(max, file ? versions.get(clean(file)) ?? 0 : 0), 0);
}

export function applyHotAssetUpdate(update: HotAssetUpdate): void {
  mark(update.file);
  for (const frame of update.frames ?? []) mark(frame);
}

export function onHotAssetUpdate(handler: (update: HotAssetUpdate) => void): () => void {
  if (!import.meta.hot) return () => {};
  const wrapped = (update: HotAssetUpdate): void => {
    applyHotAssetUpdate(update);
    handler(update);
  };
  import.meta.hot.on("asset-updated", wrapped);
  return () => import.meta.hot?.off("asset-updated", wrapped);
}
