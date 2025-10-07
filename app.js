/***** CONSTANTS *****/
const CRETS_DEPT_IDS = new Set(["1299070","1211070"]);
const EXCLUDE_MAID = "27";
const APPROVED = new Set(["APPROVED","ACCEPTED","COMPLETED"]);

const CAP = {
  lines: {
    L1: { PalletBuilder:7, Trickle:1, DockWS:2, DestMarker:1, IDRT:2, LineLoader:3 },
    L2: { PalletBuilder:5, Trickle:1, DockWS:2, DestMarker:1, IDRT:2, LineLoader:2 },
  },
  shared: { InboundWS:3, E2SWS:3, ToteWS:2, SAP:1, AO5S:1, CB:5, TotePalletizer:4 },
  e2sStations: 48
};

const DATE_FMT = (d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

/***** STATE *****/
const STATE = {
  date: DATE_FMT(new Date()),
  shift: "Day",
  quarter: "Q1",
  pendingQuarter: null,     // only used for lock flow
  rosterRows: [],
  swapOutRows: [], swapInRows: [], vetvtoRows: [], laborShareRows: [],
  badges: new Map(),        // eid -> badge data
  placements: new Map(),    // containers for current quarter ONLY
  previewMoves: [],
  lastQuarterAssign: {}     // eid -> last path kind for fairness
};

/***** HELPERS *****/
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const normId = v => String(v ?? "").trim().replace(".0","").replace(/\s+/g,"").replace(/\u200b/g,"");
const pick = (row,keys)=>{ for(const k of keys){ if(k in row && row[k]!==undefined) return row[k]; } return ""; };

function allPaths(){
  const arr=[];
  arr.push({ id:"E2S", name:"E2S Stations", ws:true, stations:Array.from({length:CAP.e2sStations},(_,i)=>`WS${i+1}`) });
  // L1
  arr.push({ id:"PalletBuilder-L1", name:"Pallet Builder (L1)", cap:CAP.lines.L1.PalletBuilder });
  arr.push({ id:"Trickle-L1", name:"Trickle (L1)", cap:CAP.lines.L1.Trickle });
  arr.push({ id:"DockWS-L1", name:"Dock WS (L1)", cap:CAP.lines.L1.DockWS });
  arr.push({ id:"DestMarker-L1", name:"Destination Marker (L1)", cap:CAP.lines.L1.DestMarker });
  arr.push({ id:"IDRT-L1", name:"IDRT (L1)", cap:CAP.lines.L1.IDRT });
  arr.push({ id:"LineLoader-L1", name:"Line Loader (L1)", cap:CAP.lines.L1.LineLoader });
  // L2
  arr.push({ id:"PalletBuilder-L2", name:"Pallet Builder (L2)", cap:CAP.lines.L2.PalletBuilder });
  arr.push({ id:"Trickle-L2", name:"Trickle (L2)", cap:CAP.lines.L2.Trickle });
  arr.push({ id:"DockWS-L2", name:"Dock WS (L2)", cap:CAP.lines.L2.DockWS });
  arr.push({ id:"DestMarker-L2", name:"Destination Marker (L2)", cap:CAP.lines.L2.DestMarker });
  arr.push({ id:"IDRT-L2", name:"IDRT (L2)", cap:CAP.lines.L2.IDRT });
  arr.push({ id:"LineLoader-L2", name:"Line Loader (L2)", cap:CAP.lines.L2.LineLoader });
  // Shared
  arr.push({ id:"InboundWS", name:"Inbound WS", cap:CAP.shared.InboundWS });
  arr.push({ id:"E2SWS", name:"E2S WS", cap:CAP.shared.E2SWS });
  arr.push({ id:"ToteWS", name:"Tote WS", cap:CAP.shared.ToteWS });
  arr.push({ id:"SAP", name:"SAP", cap:CAP.shared.SAP });
  arr.push({ id:"AO5S", name:"AO / 5S", cap:CAP.shared.AO5S });
  arr.push({ id:"CB", name:"CB", cap:CAP.shared.CB });
  arr.push({ id:"TotePalletizer", name:"Tote Palletizer", cap:CAP.shared.TotePalletizer });
  return arr;
}

/***** CSV (stateless) *****/
function downloadCSV(filename, rows){
  const csv = rows.map(r=>r.map(x=>`"${String(x??"").replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv],{type:"text/csv"}); const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=filename; a.click();
}
function tagsToStr(t){ const out=[]; if(t?.vet) out.push("VET"); if(t?.vto) out.push("VTO"); if(t?.swapin) out.push("SwapIN"); if(t?.swapout) out.push("SwapOUT"); return out.join("|"); }
function exportQuarterCSV(quarter){
  const rows=[["Date","Shift Type","Quarter","EID","Name","Path ID","Path Name","Station","Present","Shift Code","Tags","Flip Time"]];
  // stations
  const e2s = STATE.placements.get("E2S-STATIONS") || new Map();
  for(const [station,eid] of e2s.entries()){
    const b=STATE.badges.get(eid); if(!b) continue;
    rows.push([STATE.date,STATE.shift,quarter,b.eid,b.name,"E2S","Each-to-Sort",station,b.present?"TRUE":"FALSE",b.shift_code,tagsToStr(b.tags),b.flip_time||""]);
  }
  // other lanes
  for(const p of allPaths().filter(p=>!p.ws)){
    const set = STATE.placements.get(p.id)||new Set();
    for(const eid of set){
      const b=STATE.badges.get(eid); if(!b) continue;
      rows.push([STATE.date,STATE.shift,quarter,b.eid,b.name,p.id,p.name,"",b.present?"TRUE":"FALSE",b.shift_code,tagsToStr(b.tags),b.flip_time||""]);
    }
  }
  downloadCSV(`CRETs_Rotation_${STATE.date}_${STATE.shift}_${quarter}.csv`, rows);
}

/***** FILES *****/
function bindFile(inputSel,hintSel,setter){
  $(inputSel).addEventListener("change",e=>{
    const f=e.target.files?.[0];
    if(!f){ $(hintSel).textContent="No file chosen"; setter([]); return; }
    Papa.parse(f,{header:true,skipEmptyLines:"greedy",complete:(res)=>{ $(hintSel).textContent=`${f.name} • ${res.data.length} rows`; setter(res.data||[]); rebuild(); }});
  });
}
function hookUploads(){
  bindFile("#fileRoster","#hintRoster",rows=>STATE.rosterRows=rows);
  bindFile("#fileSwapOut","#hintSwapOut",rows=>STATE.swapOutRows=rows);
  bindFile("#fileSwapIn","#hintSwapIn",rows=>STATE.swapInRows=rows);
  bindFile("#fileVetVto","#hintVetVto",rows=>STATE.vetvtoRows=rows);
  bindFile("#fileLaborShare","#hintLaborShare",rows=>STATE.laborShareRows=rows);
}

/***** BUILD DATA (CRETs only) *****/
function rebuild(){
  STATE.badges.clear();
  STATE.placements.clear();
  STATE.placements.set("E2S-STATIONS", new Map());
  for(const p of allPaths().filter(p=>!p.ws)) STATE.placements.set(p.id,new Set());

  const COLS = {
    eid:["Employee ID","Person ID","Person Number","Associate ID","Badge ID","ID","Employee 1 ID"],
    name:["Employee Name","Person Full Name","Name","Associate Name"],
    dept:["Department ID","Home Department Number","Dept ID","Department"],
    maid:["Management Area ID","Mgmt Area ID","Management Area","Area ID"],
    shift:["Shift Pattern","Shift Code","Pattern","Schedule Code","Shift"]
  };

  const roster = (STATE.rosterRows||[]).filter(r=>{
    const dept=String(pick(r,COLS.dept)||"").trim();
    if(!CRETS_DEPT_IDS.has(dept)) return false;
    const maid=String(pick(r,COLS.maid)||"").trim();
    if(maid===EXCLUDE_MAID) return false;
    return true;
  });

  roster.forEach((r,i)=>{
    const eid=normId(pick(r,COLS.eid)); if(!eid) return;
    const name=String(pick(r,COLS.name)||`Associate ${i+1}`);
    const rawSC=String(pick(r,COLS.shift)||"").toUpperCase(); const m=rawSC.match(/[A-Z]{2}/); const sc=m?m[0]:rawSC;
    STATE.badges.set(eid,{eid,name,shift_code:sc,planned:true,present:false,flip_time:null,tags:{vet:false,vto:false,swapin:false,swapout:false}});
  });

  applySwapsVetVtoLaborShare();
  renderBoard(); refreshUnassignedUI(); updateKPIs();
}
function applySwapsVetVtoLaborShare(){
  const idCols=["Employee ID","Person ID","Associate ID","Badge ID","Person Number","ID"];
  const statusCols=["Status","Swap Status"];
  const workDateCols=["Date to Work","Work Date","Work"];
  const skipDateCols=["Date to Skip","Skip Date","Skip"];
  const dateCols=["opportunity.startDate","startDate","date","Date"];
  const typeCols=["opportunity.type","Opportunity Type","type"];
  const accCols=["opportunity.acceptedCount","acceptedCount"];

  STATE.swapOutRows.forEach(r=>{
    const eid=normId(pick(r,idCols)); if(!eid||!STATE.badges.has(eid)) return;
    const status=String(pick(r,statusCols)||"").toUpperCase(); if(!APPROVED.has(status)) return;
    const d=pick(r,skipDateCols); if(d && DATE_FMT(new Date(d))!==STATE.date) return;
    const b=STATE.badges.get(eid); b.tags.swapout=true; b.planned=false;
  });
  STATE.swapInRows.forEach(r=>{
    const eid=normId(pick(r,idCols)); if(!eid||!STATE.badges.has(eid)) return;
    const status=String(pick(r,statusCols)||"").toUpperCase(); if(!APPROVED.has(status)) return;
    const d=pick(r,workDateCols); if(d && DATE_FMT(new Date(d))!==STATE.date) return;
    const b=STATE.badges.get(eid); b.tags.swapin=true;
  });
  STATE.vetvtoRows.forEach(r=>{
    const eid=normId(pick(r,["employeeId",...idCols])); if(!eid||!STATE.badges.has(eid)) return;
    const acceptedCount=String(pick(r,accCols)??"1").trim(); if(acceptedCount==="0") return;
    const kind=String(pick(r,typeCols)||"").toUpperCase();
    const d=pick(r,dateCols); if(d && DATE_FMT(new Date(d))!==STATE.date) return;
    const b=STATE.badges.get(eid);
    if(kind.includes("VTO")) b.tags.vto=true;
    if(kind.includes("VET")) b.tags.vet=true;
  });
}

/***** RENDER BOARD *****/
function renderBoard(){
  const root=$("#BOARD"); root.innerHTML="";
  // E2S block
  const e2s=allPaths()[0];
  const e2sCard=document.createElement("div");
  e2sCard.className="path ws"; e2sCard.dataset.path="E2S";
  e2sCard.innerHTML=`<h4><span>${e2s.name}</span><span class="cap"><span id="cap-E2S">0</span>/48</span></h4><div class="well" id="well-E2S"></div>`;
  root.appendChild(e2sCard);
  const wellE2S=e2sCard.querySelector("#well-E2S");
  // make station slots
  e2s.stations.forEach(st=>{
    const slot=document.createElement("div"); slot.className="slot"; slot.dataset.station=st; slot.textContent=st;
    wellE2S.appendChild(slot);
  });
  new Sortable(wellE2S,{group:"badges",animation:120,swapThreshold:0.5,onAdd:(evt)=>{ placeIntoStation(evt.item.dataset.eid, evt.to, evt); }});

  // other lanes
  for(const p of allPaths().filter(p=>!p.ws)){
    const col=document.createElement("div"); col.className="path"; col.dataset.path=p.id;
    const n=(STATE.placements.get(p.id)||new Set()).size;
    col.innerHTML=`<h4><span>${p.name}</span><span class="cap"><span id="cap-${p.id}">${n}</span>/${p.cap}</span></h4><div class="well" id="well-${p.id}"></div>`;
    root.appendChild(col);
    new Sortable(col.querySelector(".well"),{group:"badges",animation:120,onAdd:(evt)=>placeIntoPath(evt.item.dataset.eid,p.id)});
  }

  // render existing placements into DOM
  hydratePlacementsToDOM();

  // build targets in unassigned dropdown
  const targetSel=$("#unTarget"); targetSel.innerHTML="";
  targetSel.appendChild(new Option("— choose —",""));
  targetSel.appendChild(new Option("E2S (auto station)","E2S"));
  for(const p of allPaths().filter(p=>!p.ws)) targetSel.appendChild(new Option(p.name,p.id));

  updateCounts();
}

function hydratePlacementsToDOM(){
  // E2S
  const m=STATE.placements.get("E2S-STATIONS");
  for(const [station,eid] of m.entries()){
    const slot=document.querySelector(`.slot[data-station="${station}"]`);
    if(slot){ slot.innerHTML=""; slot.appendChild(makeBoardBadge(STATE.badges.get(eid))); }
  }
  // Other paths
  for(const p of allPaths().filter(p=>!p.ws)){
    const set=STATE.placements.get(p.id);
    const well=$(`#well-${p.id}`);
    for(const eid of set){ well.appendChild(makeBoardBadge(STATE.badges.get(eid))); }
  }
}

/***** BADGE (compact board version using your style) *****/
function makeBoardBadge(b){
  const el=document.createElement("div");
  el.className=`board-badge code-${b.shift_code||"DA"}${b.present?" present":""}`;
  el.dataset.eid=b.eid;
  el.innerHTML=`
    <div class="photo"><div class="ph" aria-hidden="true"></div></div>
    <div class="panel">
      <div class="name">${b.name}</div>
      <div class="meta">${b.eid} • ${b.shift_code||"-"}</div>
    </div>
    <div class="right">
      <div class="mark" style="display:${b.present?"inline-block":"none"}">PRESENT</div>
    </div>
  `;
  el.addEventListener("click", ()=>{
    b.present=!b.present;
    el.classList.toggle("present", b.present);
    el.querySelector(".mark").style.display = b.present?"inline-block":"none";
    updateKPIs();
  });
  return el;
}

/***** MOVE / PLACE *****/
function placeIntoPath(eid, pathId){
  const b=STATE.badges.get(eid); if(!b) return;
  // remove from stations
  const e2s=STATE.placements.get("E2S-STATIONS");
  for(const [st,v] of e2s.entries()){ if(v===eid) e2s.delete(st); }
  // remove from all paths
  for(const p of allPaths().filter(p=>!p.ws)){ STATE.placements.get(p.id).delete(eid); }
  // add to path if space
  const lane=STATE.placements.get(pathId);
  const cap=(allPaths().find(x=>x.id===pathId)||{}).cap||0;
  if(lane.size>=cap) return;
  lane.add(eid);
  const well=$(`#well-${pathId}`); well.appendChild(makeBoardBadge(b));
  STATE.lastQuarterAssign[eid]=pathId;
  updateCounts();
}
function placeIntoStation(eid, wellEl, evt){
  const b=STATE.badges.get(eid); if(!b) return;
  const e2s=STATE.placements.get("E2S-STATIONS");
  // remove from prior spots
  for(const [st,v] of e2s.entries()){ if(v===eid) e2s.delete(st); }
  for(const p of allPaths().filter(p=>!p.ws)){ STATE.placements.get(p.id).delete(eid); }

  // choose target slot
  let target = evt?.item?.closest(".slot") || null;
  if(!target || (target && e2s.has(target.dataset.station))){
    target = Array.from(wellEl.querySelectorAll(".slot")).find(s=>!e2s.has(s.dataset.station));
  }
  if(!target) return;
  e2s.set(target.dataset.station, eid);
  target.innerHTML=""; target.appendChild(makeBoardBadge(b));
  STATE.lastQuarterAssign[eid]="E2S";
  updateCounts();
}
function clearAllPlacements(){
  STATE.placements.set("E2S-STATIONS", new Map());
  for(const p of allPaths().filter(p=>!p.ws)) STATE.placements.set(p.id,new Set());
}

/***** UNASSIGNED DROPDOWN *****/
function refreshUnassignedUI(){
  const assigned=new Set();
  for(const v of (STATE.placements.get("E2S-STATIONS")||new Map()).values()) assigned.add(v);
  for(const p of allPaths().filter(p=>!p.ws)){ for(const v of STATE.placements.get(p.id)) assigned.add(v); }

  const list=$("#unList"); list.innerHTML="";
  let count=0;
  for(const b of STATE.badges.values()){
    const excluded=b.tags?.vto||b.tags?.swapout||b.planned===false;
    if(assigned.has(b.eid)||excluded) continue;
    count++;
    const row=document.createElement("div"); row.className="row";
    row.innerHTML=`<input type="checkbox" value="${b.eid}"/><span>${b.name}</span><small class="meta"> • ${b.eid} • ${b.shift_code||"-"}</small>`;
    list.appendChild(row);
  }
  $("#unCount").textContent=count;

  $("#unSearch").oninput=(e)=>{
    const q=e.target.value.toLowerCase();
    list.querySelectorAll(".row").forEach(r=>{
      r.style.display = r.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  }
}
$("#unAssign")?.addEventListener?.("click",()=>{
  const target=$("#unTarget").value; if(!target) return;
  const ids=Array.from($("#unList").querySelectorAll("input[type=checkbox]:checked")).map(x=>x.value);
  if(ids.length===0) return;
  if(target==="E2S"){
    const e2s=STATE.placements.get("E2S-STATIONS");
    const empties=allPaths()[0].stations.filter(s=>!e2s.has(s));
    ids.forEach((eid,i)=>{ const st=empties[i]; if(!st) return; e2s.set(st,eid); const slot=document.querySelector(`.slot[data-station="${st}"]`); if(slot){ slot.innerHTML=""; slot.appendChild(makeBoardBadge(STATE.badges.get(eid))); }});
  }else{
    const set=STATE.placements.get(target);
    const cap=(allPaths().find(p=>p.id===target)||{}).cap||0;
    for(const eid of ids){ if(set.size<cap) set.add(eid); }
    const well=$(`#well-${target}`); for(const eid of ids){ if([...set].includes(eid)) well.appendChild(makeBoardBadge(STATE.badges.get(eid))); }
  }
  refreshUnassignedUI(); updateCounts();
});

/***** KPIs *****/
function updateKPIs(){
  const planned=[...STATE.badges.values()].filter(b=>b.planned!==false).length;
  const actual=[...STATE.badges.values()].filter(b=>b.present).length;
  $("#kpiPlanned").textContent=planned;
  $("#kpiActual").textContent=actual;
  $("#kpiVariance").textContent=actual-planned;
}
function updateCounts(){
  $("#cap-E2S").textContent=(STATE.placements.get("E2S-STATIONS")||new Map()).size;
  for(const p of allPaths().filter(p=>!p.ws)){
    const el=$(`#cap-${p.id}`); if(el) el.textContent=(STATE.placements.get(p.id)||new Set()).size;
  }
  refreshUnassignedUI(); updateKPIs();
}

/***** AUTO-ASSIGN *****/
function seedRand(seed){ let s=seed>>>0; return ()=> (s=(s*1664525+1013904223)>>>0, (s&0xffff)/0x10000); }
function shuffle(a,r=Math.random){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(r()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function getEligibleUnassigned(){
  const assigned=new Set();
  for(const v of (STATE.placements.get("E2S-STATIONS")||new Map()).values()) assigned.add(v);
  for(const p of allPaths().filter(p=>!p.ws)){ for(const v of STATE.placements.get(p.id)) assigned.add(v); }
  const pool=[];
  for(const b of STATE.badges.values()){
    const excluded=b.tags?.vto||b.tags?.swapout||b.planned===false;
    if(!assigned.has(b.eid)&&!excluded) pool.push(b);
  }
  return pool;
}
function autoAssignPreview(){
  const target=Math.min(48,Math.max(0,Number($("#e2sTarget").value)||36));
  const fairness=$("#fairness").value; const critFirst=$("#critFirst").checked;
  const rnd=seedRand(Math.floor(Math.random()*1e9));
  let pool=shuffle(getEligibleUnassigned(),rnd);
  const moves=[];
  const last=STATE.lastQuarterAssign;

  // E2S
  const e2sMap=new Map(STATE.placements.get("E2S-STATIONS"));
  const empty=allPaths()[0].stations.filter(s=>!e2sMap.has(s));
  let need=target-e2sMap.size; need=Math.max(0,need);
  while(need>0 && pool.length>0 && empty.length>0){
    const b=pool.shift();
    if(last[b.eid]==="E2S" && fairness!=="off"){ pool.push(b); continue; }
    const st=empty.shift();
    moves.push({eid:b.eid,kind:"E2S",station:st}); e2sMap.set(st,b.eid); need--;
  }

  // Lanes
  const crit=["Trickle-L1","Trickle-L2","PalletBuilder-L1","PalletBuilder-L2","DockWS-L1","DockWS-L2"];
  const other=allPaths().filter(p=>!p.ws && !crit.includes(p.id)).map(p=>p.id);
  const order = critFirst ? [...crit, ...other] : [...other, ...crit];

  for(const pid of order){
    const cap=(allPaths().find(x=>x.id===pid)||{}).cap||0;
    const set=new Set(STATE.placements.get(pid));
    while(set.size<cap && pool.length>0){
      const b=pool.shift();
      if(last[b.eid]===pid && fairness!=="off"){ pool.push(b); continue; }
      moves.push({eid:b.eid,kind:"PATH",path:pid}); set.add(b.eid);
    }
  }
  STATE.previewMoves=moves;
  $("#aaMsg").textContent=`Preview: ${moves.length} proposed. Click Apply to commit.`;
}
function autoAssignApply(){
  for(const mv of STATE.previewMoves){
    if(mv.kind==="E2S"){
      const m=STATE.placements.get("E2S-STATIONS"); m.set(mv.station,mv.eid);
      const slot=document.querySelector(`.slot[data-station="${mv.station}"]`);
      if(slot){ slot.innerHTML=""; slot.appendChild(makeBoardBadge(STATE.badges.get(mv.eid))); }
      STATE.lastQuarterAssign[mv.eid]="E2S";
    }else{
      const set=STATE.placements.get(mv.path); set.add(mv.eid);
      const well=$(`#well-${mv.path}`); if(well) well.appendChild(makeBoardBadge(STATE.badges.get(mv.eid)));
      STATE.lastQuarterAssign[mv.eid]=mv.path;
    }
  }
  STATE.previewMoves=[]; $("#aaMsg").textContent="Applied."; updateCounts();
}

/***** QUARTER LOCK – FIXED (export BEFORE clearing) *****/
function requestLock(prevQ,nextQ){
  const dlg=$("#lockDlg"); $("#lockTitle").textContent=`Lock ${prevQ} assignments?`;
  STATE.pendingQuarter = nextQ; // remember destination but DON'T switch yet
  dlg.showModal();
}
$("#lockYes")?.addEventListener?.("click",()=>{
  const prevQ=$("#quarterSel").value; // still on previous quarter
  exportQuarterCSV(prevQ);            // 1) export snapshot
  // 2) now switch to next quarter & clear board
  const nextQ=STATE.pendingQuarter||prevQ;
  $("#quarterSel").value=nextQ; STATE.quarter=nextQ; STATE.pendingQuarter=null;
  clearAllPlacements(); renderBoard(); refreshUnassignedUI(); updateKPIs();
  $("#lockDlg").close();
});
$("#lockNo")?.addEventListener?.("click",()=>{ STATE.pendingQuarter=null; $("#lockDlg").close(); });

/***** UI BINDINGS *****/
function bindUI(){
  $("#datePick").value=STATE.date;
  $("#datePick").addEventListener("change",()=>STATE.date=$("#datePick").value);
  $("#shiftType").value=STATE.shift;
  $("#shiftType").addEventListener("change",()=>STATE.shift=$("#shiftType").value);
  $("#quarterSel").value=STATE.quarter;
  $("#quarterSel").addEventListener("change",(e)=>{
    const currentQ=STATE.quarter, newQ=e.target.value;
    if(currentQ!==newQ){ e.target.value=currentQ; requestLock(currentQ,newQ); } // keep view; lock first
  });

  $("#buildNow").addEventListener("click",rebuild);

  // Unassigned menu
  const menu=$("#unMenu"); $("#unBtn").onclick=()=>menu.classList.toggle("show");
  document.addEventListener("click",(e)=>{ if(!e.target.closest(".dropdown")) menu.classList.remove("show"); });

  // Auto-assign panel
  const ap=$("#autoPanel");
  $("#autoAssign").onclick=()=> ap.style.display = ap.style.display==="block" ? "none" : "block";
  document.addEventListener("click",(e)=>{ if(!e.target.closest("#autoAssign") && !e.target.closest("#autoPanel")) ap.style.display="none"; });

  $("#aaPreview").onclick=autoAssignPreview;
  $("#aaApply").onclick=autoAssignApply;
  $("#aaCancel").onclick=()=>{ STATE.previewMoves=[]; $("#aaMsg").textContent=""; ap.style.display="none"; };
}

/***** BOOT *****/
function boot(){ bindUI(); renderBoard(); }
boot();
