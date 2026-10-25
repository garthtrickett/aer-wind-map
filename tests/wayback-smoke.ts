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
const pixel=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQiI8CAAGUAOIqyt2+AAAAAElFTkSuQmCC","base64");
const config=Object.fromEntries([3,2,1].map(id=>[id,{
  itemID:`item${id}`,layerIdentifier:`WB_TEST_${id}`,itemTitle:`World Imagery (Wayback ${id===3?"2026-09-24":id===2?"2026-05-28":"2024-06-06"})`,
  itemURL:`https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${id}/{level}/{row}/{col}`,
  metadataLayerUrl:`https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_${id}/MapServer`,metadataLayerItemID:`metadata${id}`,
}]));
try{
 for(const raster of [false,true])for(const viewport of [{width:1440,height:1000},{width:390,height:844},{width:320,height:740}]){
  const context=await browser.newContext({viewport});
  await context.addInitScript(({raster,criteria})=>{
   if(raster){const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==="webgl2"?null:get.call(this,kind,...args)} as typeof get}
   localStorage.setItem("aer.saved-spots.v1",JSON.stringify({version:1,spots:[{id:"test",name:"Sanur test",point:{latitude:-8.7,longitude:115.267},startYear:2025,endYear:2025,criteria,alertEnabled:false,alertMinDays:2}]}));
  },{raster,criteria:defaultHistoryCriteria});
  let requests=0,failTiles=false,failChanges=false,holdMetadata=false;
  const releases:(()=>void)[]=[];
  const tileReleases=new Set<number>();
  await context.route("**/*",async route=>{
   const url=new URL(route.request().url());
   const json=async(body:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(body)});
   if(url.hostname==="tiles.openfreemap.org"){await json({version:8,sources:{},layers:[{id:"base",type:"background",paint:{"background-color":"#bad5d2"}}]});return}
   if(url.pathname.endsWith("waybackconfig.json")){requests++;
    const failedImage={...config[3],itemTitle:"World Imagery (Wayback 2026-10-24)",
      itemURL:config[3].itemURL.replace("/tile/3/","/tile/999/"),metadataLayerUrl:config[3].metadataLayerUrl.replace("Metadata_3/","Metadata_999/")};
    await json(failTiles?{...config,999:failedImage}:config);return}
   if(url.pathname.includes("/tilemap/")){
    if(failChanges){await json({error:{message:"Unavailable"}});return}
    const id=Number(url.pathname.split("/tilemap/")[1].split("/")[0]);
    await json({data:[1],select:[id],size:[1000+id]});return;
   }
   if(url.hostname==="metadata.maptiles.arcgis.com"){
    if(holdMetadata)await new Promise<void>(resolve=>releases.push(resolve));
    const id=Number(url.pathname.match(/Metadata_(\d+)/)![1]);
    await json({features:[{attributes:{SRC_DATE2:Date.parse(id===1?"2023-03-18":"2025-05-01"),NICE_DESC:"Vantor",SRC_DESC:"WV03",SAMP_RES:.3,SRC_ACC:3}}]});return;
   }
   if(url.hostname.endsWith("maptiles.arcgis.com")){
    const match=url.pathname.match(/\/tile\/(\d+)\//);if(match)tileReleases.add(Number(match[1]));
    await route.fulfill({status:failTiles?403:200,contentType:failTiles?"text/plain":"image/png",body:failTiles?"unavailable":pixel});return;
   }
   if(url.hostname==="tile.openstreetmap.org"){await route.fulfill({contentType:"image/png",body:pixel});return}
   if(url.pathname.startsWith("/api/telegram/")){await json({status:{available:false,connected:false,pending:false,revision:0,spotCount:0,lastCheckedAt:null,lastSentAt:null,issue:null}});return}
   if(url.origin===base)await route.continue();else await route.abort();
  });
  const page=await context.newPage();const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(base);
  await expect(page.getByRole("button",{name:"Imagery history",exact:true})).toBeVisible();
  assert.equal(requests,0,"Archive does not load before opt-in");
  await page.getByRole("button",{name:/^Saved spots /}).click();
  await page.locator(".saved-spot-open").click();
  await page.getByRole("button",{name:"Close history"}).click();
  await page.getByRole("button",{name:"Imagery history",exact:true}).click();
  await expect(page.getByRole("region",{name:"Imagery history",exact:true})).toContainText("Zoom into a coast");
  const forecastTime=await page.locator(".forecast-time").innerText();
  await page.getByRole("button",{name:"View selected spot"}).click();
  const picker=page.getByLabel("Imagery capture date",{exact:true});
  await expect(picker).toBeVisible({timeout:15000});
  await expect(picker.locator("option")).toHaveCount(2);
  await expect(picker).toHaveValue("3");
  await expect(page.locator("#map")).toHaveAttribute("data-basemap","wayback");
  await page.locator(".imagery-details summary").click();
  await expect(page.locator(".imagery-metadata")).toBeVisible();
  await expect(page.locator(".imagery-metadata")).toContainText("2025-05-01");
  await expect(page.locator(".imagery-metadata")).toContainText("2026-09-24");
  await expect(page.locator(".leaflet-control-attribution")).toContainText("Powered by Esri");
  await expect(page.locator(".leaflet-control-attribution")).toContainText("Vantor");
  await expect(page.locator(".satellite-logo")).toBeHidden();
  const position=await page.locator("#selected-flag").evaluate(el=>[el.style.left,el.style.top]);
  await page.getByRole("button",{name:"← Older",exact:true}).click();
  await expect(picker).toHaveValue("1");
  await expect(page.locator(".imagery-metadata")).toContainText("2023-03-18");
  await expect.poll(()=>tileReleases.has(1)).toBe(true);
  assert.deepEqual(await page.locator("#selected-flag").evaluate(el=>[el.style.left,el.style.top]),position);
  assert.equal(await page.locator(".forecast-time").innerText(),forecastTime);
  await page.getByRole("button",{name:"Newer →",exact:true}).click();
  await expect(picker).toHaveValue("3");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const panel=await page.locator(".imagery-history-panel").boundingBox();assert.ok(panel&&panel.x>=0&&panel.x+panel.width<=viewport.width+1);
  await page.locator(".imagery-details summary").click();
  await page.screenshot({path:`/tmp/aer-wayback-${raster?"raster":"webgl"}-${viewport.width}.png`,fullPage:true});
  await page.getByLabel("Weather overlay").check();await expect(page.locator("#wind-arrows")).toBeVisible();
  await page.getByRole("button",{name:"Map",exact:true}).click();
  await expect(page.locator("#map")).toHaveAttribute("data-basemap","map");
  await expect(page.locator(".leaflet-control-attribution")).not.toContainText("Powered by Esri");
  await page.getByRole("button",{name:"Imagery history",exact:true}).click();
  await page.locator(".imagery-details summary").click();
  holdMetadata=true;await page.getByRole("button",{name:"Refresh dates",exact:true}).click();
  await expect.poll(()=>releases.length).toBeGreaterThan(0);
  await page.getByRole("button",{name:"Map",exact:true}).click();holdMetadata=false;for(const release of releases.splice(0))release();
  await page.waitForTimeout(150);
  await expect(page.locator("#map")).toHaveAttribute("data-basemap","map");
  failChanges=true;await page.getByRole("button",{name:"Imagery history",exact:true}).click();
  await expect(page.locator(".imagery-history-panel")).toContainText("could not load",{timeout:15000});
  failChanges=false;await page.getByRole("button",{name:"Refresh dates",exact:true}).click();
  await expect(picker).toBeVisible();
  // Use a never-viewed release in a fresh document, so the browser's decoded
  // image cache cannot mask the simulated provider outage.
  failTiles=true;await page.reload();
  await page.getByRole("button",{name:/^Saved spots /}).click();
  await page.locator(".saved-spot-open").click();
  await page.getByRole("button",{name:"Close history"}).click();
  await page.getByRole("button",{name:"Imagery history",exact:true}).click();
  await page.getByRole("button",{name:"View selected spot"}).click();
  await expect(page.locator(".imagery-history-panel")).toContainText("archive image could not load",{timeout:15000});
  await expect(page.locator("#map")).toHaveAttribute("data-basemap","map");
  failTiles=false;await page.getByRole("button",{name:"← Older",exact:true}).click();
  await expect(page.locator("#map")).toHaveAttribute("data-basemap","wayback");
  assert.deepEqual(errors,[]);
  console.log(`Imagery history passed: ${raster?"fallback":"WebGL"}, ${viewport.width}px; real SDK with simulated services, captures/releases, zoom prompt, date navigation, preserved marker/time, credits, late replies and recovery.`);
  await context.close();
 }
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
