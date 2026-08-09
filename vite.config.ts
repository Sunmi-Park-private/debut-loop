import { defineConfig, type Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'

// 오디오 업로드 후처리: 아티스트(저자) 메타데이터 제거 + 1분 컷 — 무손실(-c copy), ffmpeg 없으면 스킵.
// 리듬 플레이 30초·BGM 루프 기준으로 60초면 충분 (파일 크기·파형 로딩 절감)
// 알파 mov(ProRes 4444 등) → VP9 알파 WebM 변환 — Chrome/안드로이드 WebView는 mov 알파 재생 불가.
// iOS(WebKit)는 반대로 VP9 알파가 안 되므로 HEVC 알파(hvc1) .mov 사이블링을 함께 생성 (런타임 videoLoad.ts가 엔진별 선택)
function movToAlphaWebm(abs: string): string | void {
  if (abs.endsWith('.webm')) { alphaMovSibling(abs, ['-c:v', 'libvpx-vp9']); return } // webm 직접 업로드 → iOS용 mov만 추가 생성
  if (!abs.endsWith('.mov')) return
  const out = abs.slice(0, -4) + '.webm'
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', abs,
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '32',
    '-cpu-used', '4', '-row-mt', '1', '-an', out]) // 인코딩 동안 dev 서버 블로킹 — 에디터가 대기 표시
  if (!alphaMovSibling(abs)) fs.unlinkSync(abs) // HEVC 인코딩 실패 시 원본 mov 정리 (webm만 유지)
  return out
}

// 이미지 업로드 → webp 통일. 에디터로 png를 올려도 배포 최적화(WebP 전환)가 되돌아가지 않게 한다.
// 기존 자산과 같은 무손실(VP8L) + 알파 보존 설정. -exact는 투명 픽셀의 RGB를 유지해 가장자리 얼룩을 막는다.
// 변환본이 더 크면(이미 압축된 사진 계열) 원본을 남긴다 — 최적화가 목적이라 커지면 의미가 없다.
function toWebp(abs: string): string | void {
  const ext = path.extname(abs).slice(1).toLowerCase()
  if (!IMG_EXTS.includes(ext) || ext === 'webp') return
  const out = abs.slice(0, abs.lastIndexOf('.')) + '.webp'
  try {
    execFileSync('cwebp', ['-quiet', '-lossless', '-exact', abs, '-o', out])
    if (fs.statSync(out).size >= fs.statSync(abs).size) { fs.unlinkSync(out); return }
    fs.unlinkSync(abs)
    return out
  } catch {
    if (fs.existsSync(out)) fs.unlinkSync(out)
    return // cwebp 부재·실패 → 원본 유지 (업로드 자체는 성공)
  }
}

// 영상이면 알파 webm 파이프라인, 이미지면 webp 변환 — 업로드 후처리 한 곳에서 분기
function mediaPostProcess(abs: string): string | void {
  const v = movToAlphaWebm(abs)
  return typeof v === 'string' ? v : toWebp(abs)
}

// HEVC 알파(hvc1) .mov 생성/교체 — macOS videotoolbox 사용. 실패해도 webm 파이프라인은 유지
function alphaMovSibling(src: string, decodeArgs: string[] = []): boolean {
  const out = src.slice(0, src.lastIndexOf('.')) + '.mov'
  const tmp = out + '.tmp.mov'
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...decodeArgs, '-i', src,
      // bgra 필수 — yuva420p를 그대로 주면 videotoolbox가 알파를 조용히 버리고 yuv420p로 인코딩함
      '-pix_fmt', 'bgra', '-c:v', 'hevc_videotoolbox', '-allow_sw', '1', '-alpha_quality', '0.75', '-q:v', '65', '-tag:v', 'hvc1', '-an', tmp])
    fs.renameSync(tmp, out)
    return true
  } catch {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    return false
  }
}

// 배경 이미지 업로드 규격화 — 어떤 크기로 올려도 1080×2400(폰 세로 기준)으로 맞춘다.
// cover 방식: 비율 유지로 확대/축소한 뒤 넘치는 부분만 중앙 크롭 → 절대 눌리지 않음.
// 게임이 어차피 cover로 그리므로 크롭 결과가 화면에 나오는 그림과 같다. sips(macOS 기본)를 사용.
const BG_W = 1080, BG_H = 2400
function fitBgSize(abs: string): void {
  if (!IMG_EXTS.some((e) => abs.endsWith('.' + e))) return // 영상(mp4)은 건드리지 않음
  try {
    const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', abs]).toString()
    const w = Number(/pixelWidth: (\d+)/.exec(info)?.[1])
    const h = Number(/pixelHeight: (\d+)/.exec(info)?.[1])
    if (!w || !h || (w === BG_W && h === BG_H)) return
    const s = Math.max(BG_W / w, BG_H / h)
    const rw = Math.max(BG_W, Math.round(w * s)), rh = Math.max(BG_H, Math.round(h * s))
    execFileSync('sips', ['--resampleHeightWidth', String(rh), String(rw), abs], { stdio: 'ignore' })
    execFileSync('sips', ['--cropToHeightWidth', String(BG_H), String(BG_W), abs], { stdio: 'ignore' })
  } catch { /* sips 미설치·실패 → 원본 그대로 유지 */ }
}

/** 업로드된 이미지의 픽셀 크기 (sips 미설치·영상이면 null) */
function imgSize(abs: string): { w: number; h: number } | null {
  if (!IMG_EXTS.some((e) => abs.endsWith('.' + e))) return null
  try {
    const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', abs]).toString()
    const w = Number(/pixelWidth: (\d+)/.exec(info)?.[1])
    const h = Number(/pixelHeight: (\d+)/.exec(info)?.[1])
    return w && h ? { w, h } : null
  } catch { return null }
}

/** 슬롯 표시 박스를 올라온 이미지 비율에 맞춘다 — 가로는 그대로 두고 세로만 다시 잡는다.
 *  목업이 직사각형인 슬롯에 정사각 이미지를 올리면 눌려 보이던 문제를 없앤다.
 *  natural 슬롯(1배율=원본 크기)은 애초에 박스를 안 쓰므로 건드리지 않는다. */
function fitSlotSize(entry: { size?: [number, number]; natural?: boolean }, abs: string): boolean {
  if (entry.natural || !Array.isArray(entry.size)) return false
  const dim = imgSize(abs)
  const w = entry.size[0]
  if (!dim || !w) return false
  const h = Math.max(1, Math.round(w * (dim.h / dim.w)))
  if (entry.size[1] === h) return false
  entry.size = [w, h]
  return true
}

function stripArtistTag(abs: string): void {
  try {
    const tmp = abs + '.strip' + path.extname(abs)
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', abs, '-metadata', 'artist=', '-metadata', 'album_artist=', '-t', '60', '-c', 'copy', tmp])
    fs.renameSync(tmp, abs)
  } catch { /* ffmpeg 부재·포맷 미지원 → 원본 유지 */ }
}

// 빌드 산출물(APK·ios/)은 무겁고 gitignore 대상이라 워크트리마다 새로 생기지 않는다.
// 세션이 워크트리에서 돌 때도 메인 체크아웃의 산출물을 찾도록 폴백 경로를 만든다.
// (.git 이 파일이면 워크트리 → gitdir 의 `.git/worktrees/<name>` 에서 두 단계 위가 메인 저장소)
function mainCheckoutDir(): string | null {
  try {
    const dotGit = path.resolve(process.cwd(), '.git')
    if (!fs.existsSync(dotGit) || fs.statSync(dotGit).isDirectory()) return null // 메인 체크아웃 자신
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'))
    if (!m) return null
    return path.resolve(m[1].trim(), '../../..') // .git/worktrees/<name> → 저장소 루트
  } catch { return null }
}
/** cwd 우선, 없으면 메인 체크아웃에서 찾는다. 둘 다 없으면 null */
function resolveBuildArtifact(rel: string): string | null {
  const here = path.resolve(process.cwd(), rel)
  if (fs.existsSync(here)) return here
  const main = mainCheckoutDir()
  if (!main) return null
  const there = path.resolve(main, rel)
  return fs.existsSync(there) ? there : null
}

// dev 편의: 최신 APK 빌드 다운로드 — 에디터 허브 우측 상단 버튼 (/__apk·/__apkrelease, ?info=메타)
// debug=치트 메뉴 포함(팀 테스트) · release=치트 제외(제출·외부 공유), 둘 다 디버그 키 서명이라 사이드로드 가능
function apkDownloadPlugin(kind: 'debug' | 'release' = 'debug'): Plugin {
  const route = kind === 'debug' ? '/__apk' : '/__apkrelease'
  const apkPath = kind === 'debug'
    ? 'android/app/build/outputs/apk/debug/app-debug.apk'
    : 'android/app/build/outputs/apk/release/app-release.apk'
  return {
    name: `apk-download:${kind}`,
    configureServer(server) {
      server.middlewares.use(route, (req, res) => {
        const p = resolveBuildArtifact(apkPath)
        if (!p) { res.statusCode = 404; res.end('no build'); return }
        const st = fs.statSync(p)
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams
        if (q.has('info')) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ size: st.size, mtime: st.mtimeMs }))
          return
        }
        const d = st.mtime
        const pad = (n: number): string => String(n).padStart(2, '0')
        const name = `debut-loop-${kind}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.apk`
        res.setHeader('Content-Type', 'application/vnd.android.package-archive')
        res.setHeader('Content-Length', String(st.size))
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
        fs.createReadStream(p).pipe(res)
      })
    },
  }
}

// dev 편의: 아이폰용 Xcode 프로젝트 zip 다운로드 — 디자이너 맥북에서 열어 본인 아이폰에 설치 (가이드 md 포함)
function iosZipPlugin(): Plugin {
  return {
    name: 'ios-zip',
    configureServer(server) {
      server.middlewares.use('/__ioszip', (req, res) => {
        const iosDir = resolveBuildArtifact('ios')
        if (!iosDir) { res.statusCode = 404; res.end('no ios project'); return }
        const pubDir = path.join(iosDir, 'App/App/public')
        const mtime = fs.statSync(fs.existsSync(pubDir) ? pubDir : iosDir).mtimeMs // 마지막 cap sync 시각
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams
        if (q.has('info')) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ mtime }))
          return
        }
        const d = new Date(mtime)
        const pad = (n: number): string => String(n).padStart(2, '0')
        res.setHeader('Content-Type', 'application/zip')
        res.setHeader('Content-Disposition',
          `attachment; filename="debut-loop-ios-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip"`)
        const child = spawn('zip', ['-rq', '-', 'ios', '-x', '*.DS_Store'], { cwd: path.dirname(iosDir) }) // 요청 시점 상태를 스트리밍 (임시 파일 없음)
        child.stdout.pipe(res)
        child.on('error', () => { if (!res.writableEnded) { res.statusCode = 500; res.end('zip failed') } })
        req.on('close', () => { child.kill() })
      })
    },
  }
}

// 개발용: 에디터(레이아웃·튜닝)의 💾 저장을 data JSON 파일로 반영 (화이트리스트)
// ※ /__layout은 여기 없다 — 문서 통째 교체가 아니라 키 단위 병합이라 layoutSavePlugin이 따로 처리한다.
const SAVE_TARGETS: Record<string, string> = {
  '/__tuning': 'src/data/tuning.json',
  '/__cards': 'src/data/cards.json',
  '/__beats': 'src/data/beats/demo2_zeroc.json', // 플로우 에디터(flow.html) — 저장 시 게임 탭 자동 리로드로 반영
  '/__backgrounds': 'src/data/backgrounds.json', // 배경 에디터(bg.html)
  '/__uiskins': 'src/data/uiskins.json', // UI 스킨 에디터(ui.html)
  '/__beatmaps': 'src/data/beatmaps.json', // 박자 에디터(beat.html)
}
// 개발용: 레이아웃 저장 — **바뀐 키만** 받아 파일에 병합한다.
// 통째로 덮어쓰면, 페이지를 열 때 뜬 스냅샷이 그 사이 다른 사람이 저장한 좌표를 되돌린다.
// (디자이너 둘이 서로 다른 화면을 만져도 나중에 저장한 쪽이 상대 작업을 지우던 원인)
function layoutSavePlugin(): Plugin {
  const FILE = 'src/data/layout.json'
  return {
    name: 'layout-save',
    configureServer(server) {
      server.middlewares.use('/__layout', (req, res) => {
        const abs = path.resolve(process.cwd(), FILE)
        if (req.method === 'GET') {
          try {
            res.setHeader('Content-Type', 'application/json')
            res.end(fs.readFileSync(abs, 'utf8'))
          } catch { res.statusCode = 404; res.end('not found') }
          return
        }
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        // 청크를 모아 한 번에 디코딩한다 — 청크마다 toString()하면 UTF-8 멀티바이트(한글 3바이트)가
        // 경계에서 잘려 그 글자가 깨진다. 큰 문서(beats)를 저장할 때마다 몇 글자씩 손상되던 원인.
        const chunks: Buffer[] = []
        req.on('data', (d: Buffer) => { chunks.push(d) })
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          try {
            // 속성 단위 패치가 온다. { 컴포넌트: { 바뀐속성: 값 | null } }
            // null = 그 속성 삭제(코드 기본값 복귀). 보내지 않은 속성은 파일 값 그대로 둔다.
            const OK: Record<string, (v: unknown) => boolean> = {
              x: (v) => typeof v === 'number', y: (v) => typeof v === 'number',
              scale: (v) => typeof v === 'number', fontSize: (v) => typeof v === 'number',
              color: (v) => typeof v === 'string',
              texts: (v) => Array.isArray(v) && v.every((t) => t === null || typeof t === 'string'),
              textForce: (v) => typeof v === 'boolean', // 동적 문구 덮어쓰기를 의도적으로 허용한 표시
            }
            const patch = JSON.parse(body) as Record<string, Record<string, unknown>>
            for (const fields of Object.values(patch)) {
              if (!fields || typeof fields !== 'object') { res.statusCode = 400; res.end('bad patch'); return }
              for (const [f, v] of Object.entries(fields)) {
                if (!OK[f]) { res.statusCode = 400; res.end(`unknown field: ${f}`); return }
                if (v !== null && !OK[f]!(v)) { res.statusCode = 400; res.end(`bad value: ${f}`); return }
              }
            }
            const cur = JSON.parse(fs.readFileSync(abs, 'utf8')) as Record<string, Record<string, unknown>>
            const STYLE_FIELDS = ['scale', 'fontSize', 'color', 'texts', 'textForce']
            for (const [name, fields] of Object.entries(patch)) {
              const existed = cur[name] !== undefined
              const isStylePatch = existed && Object.keys(fields).some((f) => STYLE_FIELDS.includes(f))
              const entry = { ...(cur[name] ?? {}) }
              for (const [f, v] of Object.entries(fields)) {
                // 이미 존재하는 항목에 스타일 필드가 함께 오면 x/y는 클라이언트가 ensureCoords()로
                // 채운 "그려진 그대로"의 스냅샷일 뿐이다 — 그 사이 다른 사람이 저장한 좌표를
                // 덮어쓰지 않도록 무시한다. x/y만 오는 패치(진짜 드래그 이동)는 그대로 반영한다.
                if (isStylePatch && (f === 'x' || f === 'y')) continue
                if (v === null) delete entry[f]
                else entry[f] = v
              }
              // x/y는 항상 있어야 한다 — 스타일만 바꾼 신규 키가 좌표 없이 저장되면 읽는 쪽이 NaN이 된다
              if (typeof entry['x'] !== 'number' || typeof entry['y'] !== 'number') {
                res.statusCode = 400; res.end(`missing x/y: ${name}`); return
              }
              cur[name] = entry
            }
            fs.writeFileSync(abs, JSON.stringify(cur, null, 2) + '\n')
            const mods = server.moduleGraph.getModulesByFile(abs)
            if (mods) for (const m of mods) server.moduleGraph.invalidateModule(m)
            res.end('ok')
          } catch { res.statusCode = 400; res.end('invalid json') }
        })
      })
    },
  }
}

// 개발용: 스킨 배율 저장 팩토리 (char.html·ui.html) — 매니페스트 slot.scale 갱신 + 전 클라이언트 푸시 (1~2배 · 0.2 단위)
function scaleSavePlugin(route: string, manifestFile: string,
  collect: (m: unknown) => Array<{ id: string; scale?: number }>, event: string): Plugin {
  return {
    name: `scale-save:${route}`,
    configureServer(server) {
      server.middlewares.use(route, (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        // 청크를 모아 한 번에 디코딩한다 — 청크마다 toString()하면 UTF-8 멀티바이트(한글 3바이트)가
        // 경계에서 잘려 그 글자가 깨진다. 큰 문서(beats)를 저장할 때마다 몇 글자씩 손상되던 원인.
        const chunks: Buffer[] = []
        req.on('data', (d: Buffer) => { chunks.push(d) })
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          try {
            const { slot, scale } = JSON.parse(body) as { slot: string; scale: number }
            // 세밀 배율 슬롯은 0.1배 축소까지 허용 (0.1 단위) — 범위 제한은 에디터 드롭다운이 담당
            if (!/^[a-z0-9-]+$/.test(slot) || typeof scale !== 'number' || scale < 0.1 || scale > 2) {
              res.statusCode = 400; res.end('bad params'); return
            }
            const manifestPath = path.resolve(process.cwd(), manifestFile)
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
            const entry = collect(manifest).find((s) => s.id === slot)
            if (!entry) { res.statusCode = 400; res.end('unknown slot'); return }
            entry.scale = Math.round(scale * 10) / 10
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
            const mods = server.moduleGraph.getModulesByFile(manifestPath)
            if (mods) for (const m of mods) server.moduleGraph.invalidateModule(m)
            server.ws.send({ type: 'custom', event, data: { slot, scale: entry.scale } })
            res.end('ok')
          } catch { res.statusCode = 400; res.end('invalid json') }
        })
      })
    },
  }
}

// 개발용: 슬롯 농도 저장 (ui.html) — −0.5(진하게)~+0.5(연하게), 0=원본. 0.1 단위
function opacitySavePlugin(route: string, manifestFile: string,
  collect: (m: unknown) => Array<{ id: string; opacity?: number }>, event: string): Plugin {
  return {
    name: `opacity-save:${route}`,
    configureServer(server) {
      server.middlewares.use(route, (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        // 청크를 모아 한 번에 디코딩한다 — 청크마다 toString()하면 UTF-8 멀티바이트(한글 3바이트)가
        // 경계에서 잘려 그 글자가 깨진다. 큰 문서(beats)를 저장할 때마다 몇 글자씩 손상되던 원인.
        const chunks: Buffer[] = []
        req.on('data', (d: Buffer) => { chunks.push(d) })
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          try {
            const { slot, opacity } = JSON.parse(body) as { slot: string; opacity: number }
            if (!/^[a-z0-9-]+$/.test(slot) || typeof opacity !== 'number' || opacity < -0.5 || opacity > 0.5) {
              res.statusCode = 400; res.end('bad params'); return
            }
            const manifestPath = path.resolve(process.cwd(), manifestFile)
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
            const entry = collect(manifest).find((s) => s.id === slot)
            if (!entry) { res.statusCode = 400; res.end('unknown slot'); return }
            const v = Math.round(opacity * 10) / 10
            if (v === 0) delete entry.opacity
            else entry.opacity = v
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
            const mods = server.moduleGraph.getModulesByFile(manifestPath)
            if (mods) for (const m of mods) server.moduleGraph.invalidateModule(m)
            server.ws.send({ type: 'custom', event, data: { slot, opacity: v } })
            res.end('ok')
          } catch { res.statusCode = 400; res.end('invalid json') }
        })
      })
    },
  }
}

// dev 편의: 플로우 에디터의 미저장 대사를 게임에 실시간 반영 (문구만).
// 저장 전 임시본이라 파일에 쓰지 않고 서버 메모리에만 둔다 — dev 서버를 재시작하면 사라진다.
// 설계: docs/superpowers/specs/2026-08-08-beats-live-preview-design.md
let beatsOverlay: Record<string, unknown> = {}

/** 화자 프로필 업로드 — 비트마다 다른 파일이라 슬롯 매니페스트가 없다.
 *  파일명은 서버가 비트 id로 조립하므로 클라이언트가 경로를 넣을 수 없다(탈출 차단).
 *  기록은 beats JSON의 speaker 필드가 갖고, 저장은 플로우 에디터의 💾가 담당한다. */
function speakerUploadPlugin(): Plugin {
  const DIR = 'assets/speaker'
  return {
    name: 'speaker-upload',
    configureServer(server) {
      server.middlewares.use('/__speakerupload', (req, res) => {
        if (req.method !== 'POST' && req.method !== 'DELETE') { res.statusCode = 405; res.end(); return }
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams
        const beat = q.get('beat') ?? ''
        const ext = q.get('ext') ?? ''
        if (!/^[A-Za-z0-9_-]+$/.test(beat)) { res.statusCode = 400; res.end('bad beat id'); return }
        const absDir = path.resolve(process.cwd(), `public/${DIR}`)
        fs.mkdirSync(absDir, { recursive: true })
        if (req.method === 'DELETE') {
          for (const e of [...IMG_EXTS]) {
            const f = path.join(absDir, `${beat}.${e}`)
            if (fs.existsSync(f)) fs.unlinkSync(f)
          }
          res.end('ok')
          return
        }
        if (!IMG_EXTS.includes(ext)) { res.statusCode = 400; res.end('bad ext'); return }
        const chunks: Buffer[] = []
        let size = 0
        req.on('data', (d: Buffer) => {
          size += d.length
          if (size > 10 * 1024 * 1024) { res.statusCode = 413; res.end('too large'); req.destroy(); return }
          chunks.push(d)
        })
        req.on('end', () => {
          if (res.writableEnded) return
          const abs = path.join(absDir, `${beat}.${ext}`)
          fs.writeFileSync(abs, Buffer.concat(chunks))
          const converted = toWebp(abs) // 원본은 toWebp가 정리 — 항상 webp 한 벌만 남는다
          const finalExt = typeof converted === 'string' ? path.extname(converted).slice(1) : ext
          for (const e of IMG_EXTS) { // 같은 비트의 다른 확장자 잔재 제거
            if (e === finalExt) continue
            const f = path.join(absDir, `${beat}.${e}`)
            if (fs.existsSync(f)) fs.unlinkSync(f)
          }
          res.end(`${DIR}/${beat}.${finalExt}`) // 최종 경로 — 변환으로 확장자가 바뀌므로 에디터가 추측하면 안 된다
        })
      })
    },
  }
}

function beatsPreviewPlugin(): Plugin {
  return {
    name: 'beats-preview',
    configureServer(server) {
      server.middlewares.use('/__beatspreview', (req, res) => {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ overlay: beatsOverlay }))
          return
        }
        if (req.method === 'DELETE') {
          beatsOverlay = {}
          server.ws.send({ type: 'custom', event: 'beats-preview', data: { overlay: beatsOverlay } })
          res.end('ok')
          return
        }
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        // 청크를 모아 한 번에 디코딩 — 청크마다 toString()하면 한글(3바이트)이 경계에서 깨진다
        const chunks: Buffer[] = []
        req.on('data', (d: Buffer) => { chunks.push(d) })
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          try {
            const patch = JSON.parse(body) as Record<string, unknown>
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
              res.statusCode = 400; res.end('bad overlay'); return
            }
            for (const [id, v] of Object.entries(patch)) {
              if (v === null) delete beatsOverlay[id]   // null = 이 비트 되돌리기
              else beatsOverlay[id] = v
            }
            server.ws.send({ type: 'custom', event: 'beats-preview', data: { overlay: beatsOverlay } })
            res.end('ok')
          } catch { res.statusCode = 400; res.end('invalid json') }
        })
      })
    },
  }
}

function editorSavePlugin(): Plugin {
  return {
    name: 'editor-save',
    configureServer(server) {
      for (const [route, file] of Object.entries(SAVE_TARGETS)) {
        server.middlewares.use(route, (req, res) => {
          // GET = 디스크의 현재 내용. 에디터가 저장 직전에 대조해, 파일에서 이미 지워진 키를
          // 메모리에 남아 있다는 이유로 되살리지 않게 한다 (고아 키 부활 방지)
          if (req.method === 'GET') {
            try {
              res.setHeader('Content-Type', 'application/json')
              res.end(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'))
            } catch { res.statusCode = 404; res.end('not found') }
            return
          }
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
          // 청크를 모아 한 번에 디코딩한다 — 청크마다 toString()하면 UTF-8 멀티바이트(한글 3바이트)가
          // 경계에서 잘려 그 글자가 깨진다. beats처럼 큰 문서를 저장할 때마다 몇 글자씩 손상되던 원인.
          const chunks: Buffer[] = []
          req.on('data', (d: Buffer) => { chunks.push(d) })
          req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8')
            try {
              const parsed: unknown = JSON.parse(body) // 유효성 검증
              const abs = path.resolve(process.cwd(), file)
              if (route === '/__beats') {
                // 통째 덮어쓰기 저장이라, 탭 두 개(또는 오래된 탭 하나)가 번갈아 저장하면
                // 나중 저장이 먼저 저장분을 조용히 지운다. 프로토콜을 고칠 시간은 없으니
                // 최소한 덮어써지기 직전의 상태를 타임스탬프로 남겨 복구는 가능하게 한다.
                const backupDir = path.join(path.dirname(abs), '.backups')
                try {
                  if (fs.existsSync(abs)) {
                    fs.mkdirSync(backupDir, { recursive: true })
                    const d = new Date()
                    const pad = (v: number): string => String(v).padStart(2, '0')
                    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
                    const base = path.basename(abs, '.json')
                    fs.copyFileSync(abs, path.join(backupDir, `${base}-${stamp}.json`))
                  }
                } catch { /* 백업 실패는 저장 자체를 막지 않는다 */ }
              }
              fs.writeFileSync(abs, JSON.stringify(parsed, null, 2) + '\n')
              // watch 제외 파일은 모듈 캐시가 안 갱신됨 → 직접 무효화 (리로드 없이, 다음 새로고침부터 새 값)
              const mods = server.moduleGraph.getModulesByFile(abs)
              if (mods) for (const m of mods) server.moduleGraph.invalidateModule(m)
              if (route === '/__beats') {
                // 파일에 들어갔으니 임시본은 필요 없다. 게임은 이 신호를 받아
                // 지금 화면의 문구를 기준값으로 승격한다 (비우기만 하면 옛 문구로 되돌아간다).
                beatsOverlay = {}
                server.ws.send({ type: 'custom', event: 'beats-committed', data: {} })
              }
              res.end('ok')
            } catch {
              res.statusCode = 400
              res.end('invalid json')
            }
          })
        })
      }
    },
  }
}

// 개발용: 에디터 에셋 업로드 팩토리 — public/<dir>/ 기록 + 매니페스트 file 갱신 (bg.html·ui.html·bgm.html 공용)
const IMG_EXTS = ['png', 'jpg', 'webp']
const VID_EXTS = ['mp4', 'webm', 'mov'] // 영상↔이미지는 폴백 쌍으로 공존 — 업로드·삭제 시 반대 타입 원본 보존
const AUDIO_EXTS = ['mp3', 'ogg', 'wav', 'm4a']
type BgManifest = Record<'story' | 'gates' | 'system', Array<{ id: string; file: string }>>
type UiManifest = { screens: Array<{ slots: Array<{ id: string; file: string }> }> }
type BgmManifest = { tracks: Array<{ id: string; file: string }> }
type CharSkinManifest = { chars: Array<{ slots: Array<{ id: string; file: string }> }> }
function assetUploadPlugin(route: string, manifestFile: string, dir: string,
  collect: (m: unknown) => Array<{ id: string; file: string }>,
  exts: string[] = IMG_EXTS, maxMB = 10,
  postProcess?: (abs: string) => string | void): Plugin { // 문자열 반환 = 변환된 새 파일 경로 (mov→webm 등)
  return {
    name: `asset-upload:${route}`,
    configureServer(server) {
      server.middlewares.use(route, (req, res) => {
        if (req.method !== 'POST' && req.method !== 'DELETE') { res.statusCode = 405; res.end(); return }
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams
        const slot = q.get('slot') ?? ''
        const ext = q.get('ext') ?? ''
        // slot id 형식 + 확장자 화이트리스트 — 경로는 서버가 조립(클라이언트 경로 입력 없음 → 탈출 차단)
        if (!/^[a-z0-9-]+$/.test(slot) || (req.method === 'POST' && !exts.includes(ext))) { res.statusCode = 400; res.end('bad params'); return }
        const manifestPath = path.resolve(process.cwd(), manifestFile)
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
        const entry = collect(manifest).find((s) => s.id === slot)
        if (!entry) { res.statusCode = 400; res.end('unknown slot'); return }
        if (req.method === 'DELETE') { // 슬롯 비우기 — 현재 연결된 타입만 제거 (영상 삭제 시 이미지 폴백 원본 보존, 반대도 동일)
          const curExt = entry.file.split('.').pop() ?? ''
          const curIsVid = VID_EXTS.includes(curExt)
          for (const e of exts) {
            if (entry.file !== '' && curIsVid !== VID_EXTS.includes(e)) continue // 반대 타입(폴백 쌍)은 유지
            const p = path.resolve(process.cwd(), `public/${dir}/${slot}.${e}`)
            if (fs.existsSync(p)) fs.unlinkSync(p)
          }
          if (entry.file !== '') { entry.file = ''; fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n') }
          invalidate(manifestPath)
          notify(slot, '')
          res.end('ok')
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        req.on('data', (d: Buffer) => {
          size += d.length
          if (size > maxMB * 1024 * 1024) { res.statusCode = 413; res.end('too large'); req.destroy(); return }
          chunks.push(d)
        })
        req.on('end', () => {
          if (res.writableEnded) return
          const absTarget = path.resolve(process.cwd(), `public/${dir}/${slot}.${ext}`)
          fs.writeFileSync(absTarget, Buffer.concat(chunks))
          const converted = postProcess?.(absTarget) // 변환 시 새 경로 반환 (원본은 postProcess가 정리)
          const finalExt = typeof converted === 'string' ? path.extname(converted).slice(1) : ext
          const rel = `${dir}/${slot}.${finalExt}`
          for (const e of exts) { // 같은 슬롯의 다른 확장자 잔재 제거 (폴백 오염 방지)
            if (e === finalExt) continue
            if (finalExt === 'webm' && e === 'mov') continue // iOS용 HEVC 알파 사이블링은 유지 (movToAlphaWebm 생성물)
            if (VID_EXTS.includes(finalExt) && IMG_EXTS.includes(e)) continue // 영상 업로드 시 기존 이미지는 폴백 원본으로 보존
            const p = path.resolve(process.cwd(), `public/${dir}/${slot}.${e}`)
            if (fs.existsSync(p)) fs.unlinkSync(p)
          }
          // 단일 파일 업로드 = 시퀀스 대체 — 남은 프레임 파일·frames 필드 제거 (mp4 전환 등)
          const absDir = path.resolve(process.cwd(), `public/${dir}`)
          for (const f of fs.readdirSync(absDir).filter((f) => f.startsWith(`${slot}_f`))) fs.unlinkSync(path.join(absDir, f))
          const seqEntry = entry as { frames?: string[] }
          const hadFrames = seqEntry.frames !== undefined
          if (hadFrames) delete seqEntry.frames
          // 표시 박스를 올라온 이미지 비율로 — 목업 크기에 맞춰 눌리지 않게
          // 변환 후 경로로 잰다 — toWebp가 원본을 지우므로 absTarget은 이미 없을 수 있다
          const finalAbs = typeof converted === 'string' ? converted : absTarget
          const resized = fitSlotSize(entry as { size?: [number, number]; natural?: boolean }, finalAbs)
          if (entry.file !== rel || hadFrames || resized) { entry.file = rel; fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n') }
          invalidate(manifestPath)
          notify(slot, entry.file)
          res.end(rel) // 최종 경로를 돌려준다 — 후처리로 확장자가 바뀔 수 있어 에디터가 추측하면 안 된다
        })
      })
      // watch 제외 매니페스트(bgm.json)의 모듈 캐시 무효화 — 다음 수동 새로고침 때 새 값 로드
      function invalidate(abs: string): void {
        const mods = server.moduleGraph.getModulesByFile(abs)
        if (mods) for (const m of mods) server.moduleGraph.invalidateModule(m)
      }
      // 접속한 모든 클라이언트(다른 기기·터널 포함)에 변경 푸시 — BGM 핫스왑 등
      function notify(slot: string, file: string): void {
        server.ws.send({ type: 'custom', event: 'asset-updated', data: { route, id: slot, file } })
      }
    },
  }
}

// 개발용: 업로드 에셋 직접 서빙 — vite는 서버 시작 시점의 public 파일 목록을 캐시해
// 새로 업로드된 파일이 워처 반영 전까지 SPA 폴백(HTML)으로 새서 미리보기가 깨진다. 디스크에서 즉시 서빙.
const ASSET_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
}
function uploadedAssetServePlugin(): Plugin {
  return {
    name: 'serve-uploaded-assets',
    configureServer(server) {
      const base = path.resolve(process.cwd(), 'public/assets')
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0] ?? '')
        const mime = ASSET_MIME[url.split('.').pop() ?? '']
        if (!url.startsWith('/assets/') || !mime) { next(); return }
        const abs = path.normalize(path.join(process.cwd(), 'public', url))
        if (!abs.startsWith(base + path.sep) || !fs.existsSync(abs)) { next(); return }
        // ETag 재검증(304) — 미변경 에셋은 바디 재전송 생략. 없으면 새로고침마다 전체(수십 MB) 재다운로드돼
        // 터널·실기기에서 로딩이 수십 초로 늘어남. 업로드 교체 시 mtime이 바뀌어 자동 무효화.
        const st = fs.statSync(abs)
        const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`
        res.setHeader('ETag', etag)
        res.setHeader('Cache-Control', 'no-cache')
        if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return }
        res.setHeader('Content-Type', mime)
        res.end(fs.readFileSync(abs))
      })
    },
  }
}

// 개발용: 시퀀스 업로드 (배경 프롤로그·표정 idle 등 seq 슬롯) — 프레임을 <slot>_fNNN.<ext>로 저장, 매니페스트 frames 갱신.
// 클라이언트는 프레임을 순차 POST (i=0이 기존 프레임 초기화). 매니페스트는 마지막 프레임에서 1회 기록.
type SeqSlot = { id: string; file: string; seq?: boolean; frames?: string[] }
function seqUploadPlugin(route: string, manifestFile: string, assetDir: string,
  collect: (m: unknown) => SeqSlot[]): Plugin {
  return {
    name: `seq-upload:${route}`,
    configureServer(server) {
      const manifestPath = path.resolve(process.cwd(), manifestFile)
      const dir = path.resolve(process.cwd(), 'public', assetDir)
      const listFrames = (slot: string): string[] =>
        fs.readdirSync(dir).filter((f) => f.startsWith(`${slot}_f`)).sort()
      // 배치 세션: 이번 업로드(i=0~total-1)의 파일만 프레임으로 확정 — 디렉터리 잔재로 프레임 수가 불어나는 것 방지
      const sessions = new Map<string, string[]>()
      const invalidate = (): void => {
        const mods = server.moduleGraph.getModulesByFile(manifestPath)
        if (mods) for (const m of mods) server.moduleGraph.invalidateModule(m)
      }
      server.middlewares.use(route, (req, res) => {
        if (req.method !== 'POST' && req.method !== 'DELETE') { res.statusCode = 405; res.end(); return }
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams
        const slot = q.get('slot') ?? ''
        if (!/^[a-z0-9-]+$/.test(slot)) { res.statusCode = 400; res.end('bad slot'); return }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
        const entry = collect(manifest).find((s) => s.id === slot && s.seq)
        if (!entry) { res.statusCode = 400; res.end('not a seq slot'); return }
        if (req.method === 'DELETE') { // 시퀀스 해제 → 프레임 파일 제거 + 단일 file 폴백으로 복귀
          for (const f of listFrames(slot)) fs.unlinkSync(path.join(dir, f))
          delete entry.frames
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
          invalidate()
          server.ws.send({ type: 'custom', event: 'asset-updated', data: { route, id: slot, file: '', frames: [] } })
          res.end('[]')
          return
        }
        const ext = q.get('ext') ?? ''
        const i = Number(q.get('i') ?? -1)
        const total = Number(q.get('total') ?? 0)
        if (!IMG_EXTS.includes(ext) || !Number.isInteger(i) || i < 0 || i >= 200 || total < 1 || total > 200) {
          res.statusCode = 400; res.end('bad params'); return
        }
        if (i === 0) { // 새 시퀀스 = 기존 파일·세션 초기화
          for (const f of listFrames(slot)) fs.unlinkSync(path.join(dir, f))
          sessions.set(slot, [])
        }
        const chunks: Buffer[] = []
        let size = 0
        req.on('data', (d: Buffer) => {
          size += d.length
          if (size > 10 * 1024 * 1024) { res.statusCode = 413; res.end('too large'); req.destroy(); return }
          chunks.push(d)
        })
        req.on('end', () => {
          if (res.writableEnded) return
          const fname = `${slot}_f${String(i).padStart(3, '0')}.${ext}`
          fs.writeFileSync(path.join(dir, fname), Buffer.concat(chunks))
          const sess = sessions.get(slot) ?? []
          sess.push(`${assetDir}/${fname}`)
          sessions.set(slot, sess)
          const frames = [...sess]
          if (i === total - 1) { // 마지막 프레임에서만 매니페스트 기록 — 이번 배치 파일만 (재계산 없음)
            entry.frames = frames
            entry.file = frames[0] ?? entry.file
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
            invalidate()
            server.ws.send({ type: 'custom', event: 'asset-updated', data: { route, id: slot, file: entry.file, frames } })
          }
          res.end(JSON.stringify(frames))
        })
      })
    },
  }
}

// 데이터 주도 웹 게임. engine=순수 TS, ui=Pixi.
export default defineConfig({
  base: './',            // 상대경로 — 로컬 파일·WebView에서 그대로 열리도록
  build: { target: 'es2020' },
  plugins: [
    uploadedAssetServePlugin(),
    layoutSavePlugin(), // /__layout — 키 단위 병합 (editorSavePlugin의 통짜 저장과 분리)
    beatsPreviewPlugin(),
    speakerUploadPlugin(),
    editorSavePlugin(),
    scaleSavePlugin('/__charscale', 'src/data/charskins.json',
      (m) => (m as CharSkinManifest).chars.flatMap((c) => c.slots), 'char-scale-updated'),
    scaleSavePlugin('/__uiscale', 'src/data/uiskins.json',
      (m) => (m as UiManifest).screens.flatMap((s) => s.slots), 'ui-scale-updated'),
    opacitySavePlugin('/__uiopacity', 'src/data/uiskins.json',
      (m) => (m as UiManifest).screens.flatMap((s) => s.slots), 'ui-opacity-updated'),
    assetUploadPlugin('/__bgupload', 'src/data/backgrounds.json', 'assets/bg',
      (m) => { const b = m as BgManifest; return [...b.story, ...b.gates, ...b.system] },
      [...IMG_EXTS, 'mp4'], 4096, (abs) => { fitBgSize(abs); return toWebp(abs) }), // vid 슬롯(프롤로그·로딩·리듬 배경) = mp4 무한루프 — 영상 용량 제한 없음(이미지 10MB는 에디터에서 검증)
    assetUploadPlugin('/__skinupload', 'src/data/uiskins.json', 'assets/ui',
      (m) => (m as UiManifest).screens.flatMap((s) => s.slots),
      [...IMG_EXTS, 'mov', 'webm', 'mp4'], 4096, mediaPostProcess), // vid 슬롯 = 영상 (mov는 자동 webm 변환, mp4/webm은 그대로). 이미지는 webp로 변환
    assetUploadPlugin('/__bgmupload', 'src/data/bgm.json', 'assets/audio',
      (m) => (m as BgmManifest).tracks, AUDIO_EXTS, 25, stripArtistTag),
    assetUploadPlugin('/__charupload', 'src/data/charskins.json', 'assets/char/skin',
      (m) => (m as CharSkinManifest).chars.flatMap((c) => c.slots),
      [...IMG_EXTS, 'mov', 'webm'], 4096, mediaPostProcess), // vid 슬롯 = 알파 영상 (mov는 자동 변환). 이미지는 webp로 변환
    seqUploadPlugin('/__bgseq', 'src/data/backgrounds.json', 'assets/bg',
      (m) => { const b = m as { story: SeqSlot[]; system: SeqSlot[] }; return [...b.story, ...b.system] }), // system=로딩 화면 시퀀스
    seqUploadPlugin('/__charseq', 'src/data/charskins.json', 'assets/char/skin',
      (m) => (m as { chars: Array<{ slots: SeqSlot[] }> }).chars.flatMap((c) => c.slots)),
    apkDownloadPlugin('debug'),
    apkDownloadPlugin('release'),
    iosZipPlugin(),
  ],
  server: {
    allowedHosts: ['.trycloudflare.com'], // 재택 디자이너용 Cloudflare quick tunnel 접속 허용
    watch: {
      // 에디터 💾 저장 파일은 감시 제외 — 저장할 때마다 전체 리로드(프롤로그 리셋) 방지.
      // 값은 이미 런타임 메모리에 반영돼 있고, 파일은 다음 수동 새로고침 때 로드됨.
      // bgm/backgrounds/uiskins도 제외 — 에셋 업로드는 ws 푸시·제자리 갱신으로 반영 (게임 리로드·런 초기화·시퀀스 업로드 중단 방지).
      ignored: [
        '**/src/data/layout.json', '**/src/data/tuning.json', '**/src/data/cards.json',
        '**/src/data/bgm.json', '**/src/data/backgrounds.json', '**/src/data/uiskins.json',
        '**/src/data/charskins.json', '**/src/data/beatmaps.json',
        '**/src/data/beats/*.json', // 저장해도 게임을 리로드하지 않는다 — 반영은 프리뷰 채널이 담당
      ],
    },
  },
})
