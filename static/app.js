"use strict";
const $ = id => document.getElementById(id);
const drawing = $("drawing"), ctx = drawing.getContext("2d");
const COLORS = ["#db850d", "#2592d2", "#249663", "#ba5061"];
let pixels = [], exact = null, profile = null, result = null, cards = [], bounds = null;
let dragging = false, startAt = 0, playing = false, playStarted = 0, playOffset = 0;
let initialXY = [0,0];
let cameraMode = "overview", zoom = 1, focusedDraw = null, expanded = false;
let expandReturn = null;
const viewResize = new ResizeObserver(() => { if (result) paint(+$("scrub").value); });

function message(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}
function labels() {
  for (const [id, suffix] of [["update"," ms"],["chunk"," ms"],["speed","×"],["scale"," counts/px"],["radius"," counts"]])
    $(id + "-value").textContent = $(id).value + suffix;
  $("hold-value").textContent = (+$("hold").value / 1000) + " s";
}
function options() {
  return {update_ms:+$("update").value, output_ms:+$("chunk").value,
    speed:+$("speed").value, cycles:+$("cycles").value, hold_ms:+$("hold").value,
    seed:+$("seed").value, draws:+$("draws").value, radius:+$("radius").value,
    only_changed:$("changed").checked, render:$("render").checked,
    radians_per_count:+$("gain").value, y_down:$("y-down").checked};
}
function applyOptions(data) {
  const fields = {update_ms:"update",output_ms:"chunk",speed:"speed",cycles:"cycles",
    hold_ms:"hold",seed:"seed",draws:"draws",radius:"radius",radians_per_count:"gain"};
  for (const [key,id] of Object.entries(fields)) if (data[key] !== undefined) $(id).value = data[key];
  if (typeof data.only_changed === "boolean") $("changed").checked = data.only_changed;
  if (typeof data.y_down === "boolean") $("y-down").checked = data.y_down;
  labels();
}
function commonPath() {
  const scale = +$("scale").value;
  return pixels.map(([t,x,y]) => [t,(x-450)*scale,(180-y)*scale]);
}
function scenario() {
  const data = exact ? {...exact} : {schema:"abcurves.demo.v1", path:commonPath(),initial_xy:initialXY};
  data.options = options();
  if (data.options.render) {
    if (!profile) throw new Error("Load your own 256-report profile first.");
    data.profile = profile;
  }
  return data;
}
function modeControls() {
  document.querySelectorAll(".path-only input, .path-only button, .path-input").forEach(x => x.disabled = !!exact);
  $("changed").disabled = !!exact;
}
function point(e) {
  const r = drawing.getBoundingClientRect();
  return [Math.max(0,Math.min(900,(e.clientX-r.left)*900/r.width)),
          Math.max(0,Math.min(360,(e.clientY-r.top)*360/r.height))];
}
function drawInput() {
  ctx.clearRect(0,0,900,360);
  ctx.strokeStyle = "#e7edf0"; ctx.lineWidth = 1;
  for (let x=0;x<=900;x+=50) {ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,360);ctx.stroke();}
  for (let y=0;y<=360;y+=50) {ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(900,y);ctx.stroke();}
  let shown = pixels.map(p => p.slice(1));
  if (exact) {
    const scale = +$("scale").value;
    shown = exact.receipts.map(p => [450+p[1]/scale,180-p[2]/scale]);
  }
  if (shown.length) {
    ctx.beginPath();ctx.moveTo(...shown[0]);shown.slice(1).forEach(p=>ctx.lineTo(...p));
    ctx.lineWidth = 2.5;ctx.strokeStyle = "#228465";ctx.stroke();
    for (const [p,color] of [[shown[0],"#176b54"],[shown[shown.length-1],"#e3a12c"]]) {
      ctx.beginPath();ctx.arc(...p,5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
    }
  }
  const anchor=exact?exact.initial_xy:initialXY, s=+$("scale").value, ax=450+anchor[0]/s, ay=180-anchor[1]/s;
  ctx.strokeStyle="#758999";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(ax-7,ay);ctx.lineTo(ax+7,ay);ctx.moveTo(ax,ay-7);ctx.lineTo(ax,ay+7);ctx.stroke();
  $("path-info").textContent = exact ? `${exact.receipts.length} receipts · original timing`
    : pixels.length ? `${(pixels[pixels.length-1][0]/1000).toFixed(2)} s · drag to redraw`
    : "Drag to draw a timed path.";
}
function preset(name) {
  exact=null; initialXY=[0,0]; pixels=[]; modeControls();
  if (name === "static") pixels=[[0,630,130],[3000,630,130]];
  else if (name === "corners") pixels=[[0,300,210],[600,600,210],[1400,600,90],[2200,350,90],[3000,350,250],[3800,560,250]];
  else for(let i=0;i<=240;i++) {
    const a=i/240*Math.PI*2;
    pixels.push([i/240*6000,450+220*Math.cos(a),180+(name==="circle"?105*Math.sin(a):85*Math.sin(2*a))]);
  }
  drawInput();
}
drawing.addEventListener("pointerdown",e=>{
  exact=null;initialXY=[0,0];modeControls();pixels=[[0,...point(e)]];dragging=true;startAt=performance.now();drawing.setPointerCapture(e.pointerId);drawInput();
});
drawing.addEventListener("pointermove",e=>{
  if(!dragging) return;
  const t=Math.min(30000,performance.now()-startAt), p=point(e), last=pixels[pixels.length-1];
  if(t>last[0] && pixels.length<30000) pixels.push([t,...p]);
  drawInput();
});
function finishDraw(e) {
  if(!dragging) return;dragging=false;
  const last=pixels[pixels.length-1], t=Math.min(30000,Math.max(last[0]+0.01,performance.now()-startAt));
  if(t>last[0]) pixels.push([Math.max(1,t),...point(e)]);
  drawInput();
}
drawing.addEventListener("pointerup",finishDraw);
drawing.addEventListener("pointercancel",finishDraw);
$("use-preset").onclick=()=>preset($("preset").value);
$("clear").onclick=()=>{exact=null;initialXY=[0,0];pixels=[];modeControls();drawInput();};
document.querySelectorAll("[data-cadence]").forEach(b=>b.onclick=()=>{$("update").value=b.dataset.cadence;labels();});
for(const id of ["update","chunk","speed","scale","hold","radius"]) $(id).oninput=()=>{labels();if(id==="scale")drawInput();};

function download(name, value) {
  // A real HTTP attachment also works in embedded browsers that block blob downloads.
  // No file is saved on the server: this request just returns the supplied JSON.
  const form=document.createElement("form");form.method="POST";form.action="/api/export";form.hidden=true;
  for(const [key,text] of [["filename",name],["data",JSON.stringify(value)]]) {
    const input=document.createElement("textarea");input.name=key;input.value=text;form.append(input);
  }
  document.body.append(form);form.submit();setTimeout(()=>form.remove(),1000);
}
$("export-path").onclick=()=>{
  try {const data=scenario();if(data.path?.length<2)throw new Error("Draw a path first.");delete data.profile;download("abcurves_targets.json",data);}
  catch(e){message(e.message,true);}
};
$("import").onclick=()=>$("target-file").click();
$("target-file").onchange=async e=>{
  try {
    const file=e.target.files[0];if(!file)return;
    if(file.size>8000000)throw new Error("Use a JSON target file smaller than 8 MB.");
    const data=JSON.parse(await file.text());
    if(!data || typeof data!=="object" || (Array.isArray(data.path)===Array.isArray(data.receipts)))throw new Error("Supply a path or exact receipts; see example_receipts.json.");
    if(data.options)applyOptions(data.options);
    if(data.receipts) {
      if(!data.receipts.length || !data.receipts.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))throw new Error("Invalid receipt rows.");
      exact={schema:"abcurves.receipts.v1",receipts:data.receipts,initial_xy:data.initial_xy||[0,0]};
      if(data.duration_us!==undefined)exact.duration_us=data.duration_us;
    } else {
      if(data.path.length<2 || !data.path.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))throw new Error("Invalid path rows.");
      exact=null;initialXY=data.initial_xy||[0,0];
      const s=+$("scale").value;pixels=data.path.map(([t,x,y])=>[t,450+x/s,180-y/s]);
    }
    modeControls();drawInput();message("Targets loaded.");
  } catch(err){message(err.message,true);}
  finally{e.target.value="";}
};
$("profile-button").onclick=()=>$("profile-file").click();
$("profile-file").onchange=async e=>{
  try{
    const file=e.target.files[0];if(!file)return;
    if(file.size>100000)throw new Error("A 256-report profile should be a small JSON array.");
    const data=JSON.parse(await file.text());
    if(!Array.isArray(data)||data.length!==256||!data.every(p=>Array.isArray(p)&&p.length===2&&p.every(x=>Number.isInteger(x)&&x>=-32768&&x<=32767)))throw new Error("Profile must contain exactly 256 integer [dx, dy] pairs.");
    profile=data;$("render").disabled=false;$("profile-status").textContent="256 reports loaded";message("Profile ready. Enable the Renderer if you want integer reports.");
  }catch(err){message(err.message,true);}finally{e.target.value="";}
};

function plotBounds() {
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  for(const array of [result.target_xy,...result.draws.flatMap(d=>[d.xy,...(d.rendered_xy?[d.rendered_xy]:[])])])
    for(const [x,y] of array){xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
  const margin=Math.max(30,result.options.radius*1.5);
  return {cx:(xmin+xmax)/2,cy:(ymin+ymax)/2,w:Math.max(150,xmax-xmin+margin*2),h:Math.max(120,ymax-ymin+margin*2)};
}
function makeCards() {
  viewResize.disconnect();
  $("target-view").replaceChildren();$("draw-grid").replaceChildren();$("focus-draw").replaceChildren();
  cards=[];bounds=plotBounds();cameraMode="overview";zoom=1;focusedDraw=null;
  $("viewer").classList.toggle("one-draw",result.draws.length===1);
  const items=[{label:"Target",color:"#176b54",draw:null,index:null},...result.draws.map((d,i)=>({label:`Draw ${i+1}`,color:COLORS[i],draw:d,index:i}))];
  for(const item of items) {
    const box=document.createElement("div");box.className="draw-card"+(item.draw?" is-draw":"");
    const heading=document.createElement("div");heading.className="draw-heading";
    const title=document.createElement("h3");title.textContent=item.label;title.style.color=item.color;
    heading.append(title);
    const canvas=document.createElement("canvas");canvas.width=640;canvas.height=480;
    canvas.setAttribute("aria-label",item.label+" trajectory");
    if(item.draw) {
      const button=document.createElement("button");button.textContent=item.label;button.setAttribute("aria-label","Focus "+item.label);
      button.title=`Seed ${item.draw.seed} · click to compare beside the target`;
      button.onclick=()=>focusDraw(item.index);title.replaceChildren(button);
      const stats=document.createElement("span");stats.className="draw-stats";
      stats.textContent=`Mean ${item.draw.mean_error.toFixed(1)} · End ${item.draw.final_error.toFixed(1)}`;
      stats.title="Whole-run mean and endpoint error, in counts";heading.append(stats);
      canvas.tabIndex=0;canvas.setAttribute("role","button");canvas.setAttribute("aria-label",item.label+" trajectory; focus beside target");
      canvas.title="Click to focus beside the target";
      canvas.onclick=()=>focusDraw(item.index);
      canvas.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();focusDraw(item.index);}};
      canvas.addEventListener("wheel",zoomWheel,{passive:false});
      const choice=document.createElement("option");choice.value=item.index;choice.textContent=`${item.label} · seed ${item.draw.seed}`;$("focus-draw").append(choice);
    } else {
      canvas.setAttribute("role","img");canvas.addEventListener("wheel",zoomWheel,{passive:false});
    }
    box.append(heading,canvas);$(item.draw?"draw-grid":"target-view").append(box);
    cards.push({...item,box,canvas});viewResize.observe(canvas);
  }
  setFocus(null);updateViewControls();
}
function updateViewControls() {
  $("overview").setAttribute("aria-pressed",cameraMode==="overview");
  $("follow").setAttribute("aria-pressed",cameraMode==="follow");
  $("zoom-fit").textContent=Math.round(zoom*100)+"%";
  $("zoom-out").disabled=zoom<=0.5;$("zoom-in").disabled=zoom>=16;
  $("viewer").dataset.camera=cameraMode;$("viewer").dataset.zoom=zoom;
}
function setZoom(value) {
  zoom=Math.max(0.5,Math.min(16,value));updateViewControls();paint(+$("scrub").value);
}
function zoomWheel(e) {
  if(!e.ctrlKey&&!e.metaKey)return;
  e.preventDefault();setZoom(zoom*(e.deltaY<0?1.15:1/1.15));
}
function setFocus(index) {
  focusedDraw=index;$("viewer").classList.toggle("is-focused",index!==null);
  $("results").classList.toggle("has-focus",index!==null);
  $("show-all").hidden=index===null;$("focus-draw").hidden=index===null;
  if(index!==null)$("focus-draw").value=index;
  for(const card of cards) {
    card.box.hidden=card.draw&&index!==null&&card.index!==index;
    if(card.draw) {
      card.canvas.setAttribute("aria-pressed",card.index===index);
      card.canvas.title=card.index===index?"Click to see all draws":"Click to focus beside the target";
    }
  }
  paint(+$("scrub").value);
}
function focusDraw(index) {
  if(focusedDraw===index){setFocus(null);$("overview").focus();return;}
  setFocus(index);setExpanded(true);
}
function setExpanded(value) {
  if(value===expanded)return;
  const section=$("results");
  if(value)expandReturn=document.activeElement;
  expanded=value;section.classList.toggle("is-expanded",value);document.body.classList.toggle("viewer-open",value);
  for(const child of document.querySelector("main").children)if(child!==section)child.inert=value;
  $("expand").textContent=value?"Close ×":"Expand ↗";
  $("expand").setAttribute("aria-expanded",value);
  $("expand").setAttribute("aria-label",value?"Close expanded playback":"Expand playback");
  $("expand").title=value?"Close (Esc)":"Expand playback";
  if(value) {
    section.setAttribute("role","dialog");section.setAttribute("aria-modal","true");section.setAttribute("aria-labelledby","playback-title");
    section.scrollTop=0;$("expand").focus({preventScroll:true});
  } else {
    section.removeAttribute("role");section.removeAttribute("aria-modal");section.removeAttribute("aria-labelledby");
    setFocus(null);if(expandReturn?.isConnected)expandReturn.focus({preventScroll:true});
  }
  paint(+$("scrub").value);
}
function paint(ms) {
  if(!result)return;
  const index=Math.min(result.time_us.length-1,Math.max(0,Math.floor(ms))), target=result.target_xy[index];
  const visible=cards.filter(card=>!card.box.hidden).map(card=>({card,rect:card.canvas.getBoundingClientRect()}));
  if(!visible.length||visible.some(({rect})=>rect.width<1||rect.height<1))return;
  // A single world scale and camera center make every view directly comparable.
  const s=zoom*Math.min(...visible.map(({rect})=>Math.min((rect.width-32)/bounds.w,(rect.height-32)/bounds.h)));
  const center=cameraMode==="follow"?target:[bounds.cx,bounds.cy];
  for(const {card,rect} of visible) {
    const c=card.canvas.getContext("2d"),w=rect.width,h=rect.height,dpr=Math.min(2,window.devicePixelRatio||1);
    const width=Math.round(w*dpr),height=Math.round(h*dpr);
    if(card.canvas.width!==width||card.canvas.height!==height){card.canvas.width=width;card.canvas.height=height;}
    c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);c.lineCap="round";c.lineJoin="round";
    const p=([x,y])=>[w/2+(x-center[0])*s,h/2-(y-center[1])*s];
    card.canvas.dataset.scale=s;card.canvas.dataset.centerX=center[0];card.canvas.dataset.centerY=center[1];
    function trace(path,last,color,width) {
      if(last<1)return;const stride=Math.max(1,Math.ceil(last/(2500*Math.min(zoom,4))));
      c.beginPath();c.moveTo(...p(path[0]));for(let i=1;i<last;i+=stride)c.lineTo(...p(path[i]));c.lineTo(...p(path[last]));c.strokeStyle=color;c.lineWidth=width;c.stroke();
    }
    trace(result.target_xy,result.target_xy.length-1,"#e1ece6",1.4);
    trace(result.target_xy,index,"#95beaa",1.6);
    const [tx,ty]=p(target);
    c.beginPath();c.arc(tx,ty,result.options.radius*s,0,Math.PI*2);c.strokeStyle="#2a9d70";c.lineWidth=1.6;c.stroke();
    c.beginPath();c.arc(tx,ty,3,0,Math.PI*2);c.fillStyle="#2a9d70";c.fill();
    if(card.draw) {
      trace(card.draw.xy,index,card.color,1.8);
      const display=card.draw.rendered_xy||card.draw.xy;
      if(card.draw.rendered_xy)trace(display,index,"#425565",1.2);
      const [x,y]=p(display[index]);c.beginPath();c.arc(x,y,4,0,Math.PI*2);c.fillStyle=card.color;c.fill();
    }
  }
  $("scrub").value=index;$("clock").textContent=(index/1000).toFixed(3)+" s";
}
function pause() {playing=false;$("play").textContent="Play";}
function startPlayback() {
  if(!result)return;if(playing){pause();return;}
  if(+$("scrub").value>=result.time_us.length-1)$("scrub").value=0;
  playOffset=+$("scrub").value;playStarted=performance.now();playing=true;$("play").textContent="Pause";requestAnimationFrame(frame);
}
function frame(now) {
  if(!playing)return;
  const ms=playOffset+(now-playStarted)*+$("play-speed").value;paint(ms);
  if(ms>=result.time_us.length-1)pause();else requestAnimationFrame(frame);
}
$("play").onclick=startPlayback;
$("rewind").onclick=()=>{pause();paint(0);};
$("scrub").oninput=()=>{pause();paint(+$("scrub").value);};
$("play-speed").onchange=()=>{if(playing){pause();startPlayback();}};
$("overview").onclick=()=>{cameraMode="overview";updateViewControls();paint(+$("scrub").value);};
$("follow").onclick=()=>{cameraMode="follow";updateViewControls();paint(+$("scrub").value);};
$("zoom-in").onclick=()=>setZoom(zoom*1.25);
$("zoom-out").onclick=()=>setZoom(zoom/1.25);
$("zoom-fit").onclick=()=>setZoom(1);
$("show-all").onclick=()=>{setFocus(null);$("overview").focus();};
$("focus-draw").onchange=()=>setFocus(+$("focus-draw").value);
$("expand").onclick=()=>setExpanded(!expanded);
document.addEventListener("keydown",e=>{
  if(e.key==="Escape") {
    if(expanded){e.preventDefault();setExpanded(false);}
    else if(focusedDraw!==null){setFocus(null);$("overview").focus();}
  }
  if(expanded&&e.key==="Tab") {
    const controls=[...$("results").querySelectorAll("a,button,input,select,summary,[tabindex]")].filter(x=>!x.disabled&&x.getClientRects().length);
    const first=controls[0],last=controls[controls.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
});
$("export-result").onclick=()=>{if(result)download("abcurves_continuous_result.json",result);};
$("run").onclick=async()=>{
  try{
    const body=scenario();if(body.path?.length<2)throw new Error("Draw a timed path or choose an example first.");
    pause();if(expanded)setExpanded(false);$("run").disabled=true;$("run").textContent="Running…";
    $("results").hidden=false;$("busy").hidden=false;$("output").hidden=true;
    $("playback-error").hidden=true;$("export-result").disabled=true;$("expand").hidden=true;
    $("results").scrollIntoView({behavior:"smooth",block:"start"});
    message("");
    const response=await fetch("/api/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||"Run failed.");
    result=data;makeCards();$("busy").hidden=true;$("output").hidden=false;
    $("export-result").disabled=false;$("expand").hidden=false;$("scrub").max=result.time_us.length-1;paint(0);
    $("run-info").textContent=`${result.mode} · ${result.receipts.length} target receipts · ${result.draws[0].output_samples.toLocaleString()} samples per draw · ${result.options.output_ms} ms output calls · ${result.compute_seconds.toFixed(2)} s computation`+(result.options.render?" · colored = planner, dark = rendered reports":"");
    message("");
    $("results").scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth",block:"start"});
    startPlayback();
  }catch(err){
    message(err.message,true);$("busy").hidden=true;$("output").hidden=!result;
    $("playback-error").textContent=err.message;$("playback-error").hidden=false;
    $("export-result").disabled=!result;$("expand").hidden=!result;
  }finally{$("run").disabled=false;$("run").textContent="Run planner";}
};
labels();preset("eight");
fetch("/api/info").then(r=>{if(!r.ok)throw new Error("Server unavailable");return r.json();}).then(info=>{
  $("connection").textContent="Ready";$("connection").title=info.model;$("run").disabled=false;message("");
}).catch(()=>{$("connection").textContent="Offline";message("Start python demo.py, then reload this page.",true);});
