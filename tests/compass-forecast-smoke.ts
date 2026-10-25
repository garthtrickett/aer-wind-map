import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, expect } from "@playwright/test";
import { defaultHistoryCriteria } from "../src/history.ts";

const root=resolve("dist");
const server=createServer(async(request,response)=>{
  const pathname=new URL(request.url??"/","http://localhost").pathname;
  const file=resolve(root,`.${pathname==="/"?"/index.html":pathname}`);
  if(!file.startsWith(`${root}/`)){response.writeHead(403).end();return}
  try{response.setHeader("Content-Type",({".html":"text/html",".js":"text/javascript",".css":"text/css",".wasm":"application/wasm"} as Record<string,string>)[extname(file)]??"application/octet-stream");response.end(await readFile(file))}
  catch{response.writeHead(404).end()}
});
await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
const address=server.address();assert.ok(address&&typeof address!=="string");
const base=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({headless:true});
const current=Math.floor(Date.now()/3600000)*3600;
const time=Array.from({length:96},(_,i)=>current+(i-12)*3600);
const criteria={...defaultHistoryCriteria,windFromStart:315,windFromEnd:45,swellFromStart:180,swellFromEnd:270};
try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844},{width:320,height:740}]){
  const context=await browser.newContext({viewport});
  await context.addInitScript(criteria=>localStorage.setItem("aer.saved-spots.v1",JSON.stringify({version:1,spots:[{
   id:"test",name:"Sanur conditions",point:{latitude:-8.7,longitude:115.267},startYear:2025,endYear:2025,criteria,alertEnabled:false,alertMinDays:2,
  }]})),criteria);
  let failSwell=false,failAll=false,missing=false,calm=false,mapRun=false,windCalls=0,swellCalls=0;
  await context.route("**/*",async route=>{
   const url=new URL(route.request().url());
   const json=async(body:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(body)});
   if(url.pathname.startsWith("/api/telegram/")){await json({status:{available:false,connected:false,pending:false,revision:0,spotCount:0,lastCheckedAt:null,lastSentAt:null,issue:null}});return}
   if(mapRun&&url.hostname==="storage.googleapis.com"&&url.pathname.includes("/storage/v1/")){
    await json({items:[{name:url.searchParams.get("prefix")}]});return;
   }
   if(url.hostname.endsWith("open-meteo.com")){
    const forecast=url.searchParams.has("forecast_days"),marine=url.hostname.startsWith("marine-");
    if(forecast){if(marine)swellCalls++;else windCalls++}
    if(forecast&&(failAll||marine&&failSwell)){await route.fulfill({status:503,body:"Unavailable"});return}
    const times=forecast?time:Array.from({length:24},(_,i)=>Date.parse("2025-01-01T00:00:00Z")/1000+i*3600);
    await json({timezone:"Asia/Makassar",latitude:-8.75,longitude:115.25,hourly:{time:times,...(marine?{
      swell_wave_height:times.map(()=>1.8),swell_wave_period:times.map(()=>14),swell_wave_direction:times.map(t=>forecast&&missing?null:forecast&&t>current+6*3600?135:225),
    }:{wind_speed_10m:times.map(()=>forecast && calm ? .5 : 3),wind_direction_10m:times.map(t=>forecast&&missing?null:forecast&&calm?180:forecast&&t>current+6*3600?90:355)})}});return;
   }
   if(url.origin===base)await route.continue();else await route.abort();
  });
  const page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(base);
  await page.getByRole("button",{name:/^Saved spots /}).click();await page.locator(".saved-spot-open").click();
  const wind=page.locator(".compass-current.wind"),swell=page.locator(".compass-current.swell");
  await expect(wind).toHaveAttribute("data-direction","355");await expect(swell).toHaveAttribute("data-direction","225");
  await expect(page.locator(".compass-reading.wind")).toContainText("10.8 km/h");
  await expect(page.locator(".compass-reading.swell")).toContainText("1.8 m · 14.0 s");
  await expect(page.locator(".compass-reading.wind")).toContainText("inside range");
  await expect(page.locator(".compass-forecast-time")).toContainText("model forecast");
  await expect(page.locator(".compass-forecast-time")).toContainText(/\d{2}\/\d{2}\/\d{4}/);
  await expect(page.getByLabel("Compass forecast time")).toHaveValue("now");
  assert.ok(windCalls>0&&swellCalls>0,"Compass loads without enabling alerts");
  const end=await wind.locator(".compass-current-ray").evaluate(el=>({x:Number(el.getAttribute("x2")),y:Number(el.getAttribute("y2"))}));
  assert.ok(end.x<140&&end.y<140,"355 degrees is just west of north");
  await page.locator(".history-compass-column").screenshot({path:`/tmp/aer-compass-forecast-${viewport.width}.png`});
  const calls=windCalls+swellCalls;
  await page.getByLabel(/^Wind from/).fill("100");await page.getByLabel(/^Wind from/).press("Tab");
  await page.getByLabel(/^Wind to/).fill("200");await page.getByLabel(/^Wind to/).press("Tab");
  await expect(page.locator(".compass-reading.wind")).toContainText("outside range");
  assert.equal(windCalls+swellCalls,calls,"Range edits reuse downloaded forecast");
  await expect(wind).toHaveAttribute("data-direction","355");
  await page.getByLabel("Compass forecast time").selectOption("map");
  await expect(page.locator(".compass-forecast")).toContainText("Map forecast time is not available yet");
  await expect(page.locator(".compass-current")).toHaveCount(0);
  await page.getByLabel("Compass forecast time").selectOption("now");
  await expect(wind).toHaveAttribute("data-direction","355");assert.equal(windCalls+swellCalls,calls);
  failSwell=true;await page.getByRole("button",{name:"Refresh compass forecast"}).click();
  await expect(wind).toHaveAttribute("data-direction","355");await expect(swell).toHaveCount(0);
  await expect(page.locator(".compass-reading.swell")).toContainText("No swell forecast");
  const marineBefore=swellCalls;await page.getByLabel("Marker type").selectOption("wind");
  await expect(wind).toHaveAttribute("data-direction","355");assert.equal(swellCalls,marineBefore);
  calm=true;await page.getByRole("button",{name:"Refresh compass forecast"}).click();
  await expect(wind).toHaveAttribute("data-direction","180");await expect(page.locator(".compass-reading.wind")).toContainText("Calm: direction ignored");
  failSwell=false;calm=false;missing=true;await page.getByLabel("Marker type").selectOption("both");
  await expect(page.locator(".compass-reading.wind")).toContainText("Direction unavailable");
  await expect(page.locator(".compass-reading.swell")).toContainText("Direction unavailable");
  await expect(page.locator(".compass-current")).toHaveCount(0);
  missing=false;failAll=true;await page.getByRole("button",{name:"Refresh compass forecast"}).click();
  await expect(page.locator(".compass-forecast")).toContainText("Direction forecasts unavailable");
  failAll=false;await page.getByRole("button",{name:"Refresh compass forecast"}).click();
  await expect(wind).toHaveAttribute("data-direction","355");await expect(swell).toHaveAttribute("data-direction","225");
  // A discoverable map run supplies a real timeline instant even if the raster download fails.
  mapRun=true;await page.reload();await expect(page.getByLabel("Forecast hour")).toBeEnabled();
  await page.getByRole("button",{name:/^Saved spots /}).click();await page.locator(".saved-spot-open").click();
  await expect(wind).toHaveAttribute("data-direction","355");
  await page.getByLabel("Compass forecast time").selectOption("map");
  const initialTime=await page.locator(".compass-forecast-time").innerText();
  const downloaded=windCalls+swellCalls;
  await page.getByLabel("Forecast hour").evaluate(el=>{(el as HTMLInputElement).value="48";el.dispatchEvent(new Event("change",{bubbles:true}))});
  await expect(wind).toHaveAttribute("data-direction","90");await expect(swell).toHaveAttribute("data-direction","135");
  await expect(page.locator(".compass-forecast-time")).not.toHaveText(initialTime);
  assert.equal(windCalls+swellCalls,downloaded,"Map timeline changes reuse hourly forecast");
  await page.getByLabel("Compass forecast time").selectOption("now");await expect(wind).toHaveAttribute("data-direction","355");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
  console.log(`Compass direction overlay passed at ${viewport.width}px: from-bearings, editable ranges, time mode, partial failures, marker type, calm override, unknowns and retry.`);
  await context.close();
 }
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
