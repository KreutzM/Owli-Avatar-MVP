import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { mountVisual26 } from './render';
const out='/tmp/owli-visual26';
test('Vuena baseline and two reversible visibility variants',async({page},info)=>{
  // Global route blocks all network and returns inert mock status for every API call.
  await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:false,status:'ok',mode:'mock'})});if(u.hostname==='127.0.0.1'&&u.port==='15326')return route.continue();return route.abort();});
  await page.setViewportSize({width:1365,height:900});await page.goto('/');
  await page.evaluate(async()=>{const m=await import('/tests/visual26/render.ts');await m.mountVisual26();});
  await expect.poll(()=>page.evaluate(()=>Boolean(window.visual26))).toBe(true);
  await mkdir(out,{recursive:true});
  const scenarios=[{name:'baseline',factor:1,view:'baseline'},{name:'camera-close-lower',factor:1,view:'close-low'},{name:'jaw-gain-1_25-close',factor:1.25,view:'close'}];
  for(const s of scenarios){
    await page.evaluate(({factor,view})=>window.visual26!.setPose(0,factor,view),s);await page.waitForTimeout(800);await page.screenshot({path:`${out}/${s.name}-closed.png`});
    await page.evaluate(({factor,view})=>window.visual26!.setPose(.5,factor,view),s);await page.waitForTimeout(1200);await page.screenshot({path:`${out}/${s.name}-speaking.png`});
    await page.evaluate(({factor,view})=>window.visual26!.setPose(1,factor,view),s);await page.waitForTimeout(1200);await page.screenshot({path:`${out}/${s.name}-open.png`});
    await page.evaluate(({factor,view})=>window.visual26!.setPose(0,factor,view),s);await page.waitForTimeout(800);
  }
  const results=[];
  for(const s of scenarios){const poses=[];for(const mouth of [0,.5,1]){await page.evaluate(({mouth,factor,view})=>window.visual26!.setPose(mouth,factor,view),{mouth,...s});await page.waitForTimeout(150);poses.push(await page.evaluate(()=>window.visual26!.metrics()));}results.push({name:s.name,poses});}
  const host=await page.locator('#avatar').evaluate(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height};});
  const data=JSON.stringify({viewport:{width:1365,height:900},host,results},null,2);await writeFile(`${out}/conditions.json`,data);
  await expect(page.locator('#avatar canvas')).toBeVisible();await info.attach('visual-conditions.json',{body:Buffer.from(data),contentType:'application/json'});
});
