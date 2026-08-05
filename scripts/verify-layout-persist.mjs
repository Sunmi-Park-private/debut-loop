// 레이아웃 에디터 회귀 검증 — backBtn을 드래그로 옮기고 layout.json 저장 후
// 새로고침해도 좌표가 유지되는지 확인한다.
// 사용: npm run dev (5173)로 dev 서버를 띄운 뒤 node scripts/verify-layout-persist.mjs
import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel:'chrome', headless:true, args:['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.setViewportSize({ width: 470, height: 860 });
async function boot(){
  await p.goto('http://localhost:5173/?dev=1');
  await p.waitForTimeout(1200);
  for(let i=0;i<8;i++){ await p.keyboard.press('Space'); await p.waitForTimeout(280); }
  await p.waitForTimeout(2400);
  await p.keyboard.press('Space'); await p.waitForTimeout(800);
  await p.keyboard.press('Space'); await p.waitForTimeout(900);
  const cv = await p.$eval('canvas', e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,s:r.width/430};});
  await p.mouse.click(cv.x+215*cv.s, cv.y+400*cv.s); await p.waitForTimeout(200);
  return cv;
}
const readBack = () => p.evaluate(()=>{
  const rows=[...document.querySelectorAll('div')].filter(d=>d.firstChild?.textContent==='backBtn');
  const row=rows[rows.length-1]; if(!row) return null;
  const [x,y]=[...row.querySelectorAll('input')].map(i=>Number(i.value)); return {x,y};
});
let cv = await boot();
await p.click('text=⚙️'); await p.waitForTimeout(300);
await p.click('text=레이아웃 에디터'); await p.waitForTimeout(400);
const p0 = await readBack();
// 드래그 이동
const s0={x:cv.x+(p0.x+33)*cv.s, y:cv.y+(p0.y+13)*cv.s};
await p.mouse.move(s0.x,s0.y); await p.mouse.down();
for(let i=1;i<=6;i++){ await p.mouse.move(s0.x+i*8, s0.y+i*10); await p.waitForTimeout(30); }
await p.mouse.up(); await p.waitForTimeout(300);
const p1 = await readBack();
// 💾 저장
await p.click('text=💾 layout.json 저장'); await p.waitForTimeout(600);
// 새로고침 후 다시 확인
cv = await boot();
await p.click('text=⚙️'); await p.waitForTimeout(300);
await p.click('text=레이아웃 에디터'); await p.waitForTimeout(400);
const p2 = await readBack();
console.log(`원위치 ${JSON.stringify(p0)} → 드래그 ${JSON.stringify(p1)} → 저장·새로고침 후 ${JSON.stringify(p2)}`);
console.log('영구 적용:', p2.x===p1.x && p2.y===p1.y);
await b.close();
