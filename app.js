/***** CONSTANTS *****/
const CRETS_DEPT_IDS = new Set(["1299070","1211070"]);
// Relaxed MAID: allow blank/unknown; explicitly exclude 27 (ICQA)
const EXCLUDE_MAID = "27";   // exclude ICQA
const PREFERRED_CRETS_MAID = "22"; // counted if present, but not required

// Shift schedule you provided
const SETTINGS = {
  shift_schedule: {
    Day: {
      Sunday:    ["DA","DN","DL","DH"],
      Monday:    ["DA","DL","DC","DH"],
      Tuesday:   ["DA","DL","DC"],
      Wednesday: ["DA","DB"],
      Thursday:  ["DB","DN","DC"],
      Friday:    ["DB","DN","DC","DH"],
      Saturday:  ["DB","DN","DL","DH"]
    },
    Night: {
      Sunday:    ["NA","NN","NL","NH"],
      Monday:    ["NA","NL","NC","NH"],
      Tuesday:   ["NA","NL","NC"],
      Wednesday: ["NA","NB"],
      Thursday:  ["NB","NN","NC"],
      Friday:    ["NB","NN","NC","NH"],
      Saturday:  ["NB","NN","NL","NH"]
    }
  }
};

// Board paths (capacities can be tuned)
const PATHS = [
  { id:"CB",     name:"CB",                      cap:5 },
  { id:"IBWS",   name:"IB Waterspider",         cap:3 },
  { id:"LINE",   name:"Line Loaders",           cap:5 },
  { id:"TRICK",  name:"Trickle",                cap:4 },
  { id:"DEST",   name:"Destination Markers",    cap:8 },
  { id:"IDRT",   name:"IDRT",                   cap:6 },
  { id:"E2S1",   name:"Each-to-Sort L1 (32)",   cap:32 },
  { id:"E2S2",   name:"Each-to-Sort L2 (32)",   cap:32 },
  { id:"DOCKWS", name:"Dock WS",                cap:6 },
  { id:"TOTE",   name:"Tote Pallet Build",      cap:6 },
  { id:"TOTEWS", name:"Tote WS",                cap:4 },
  { id:"SAP",    name:"SAP",                    cap:4 },
  { id:"AO5S",   name:"AO / 5S",                cap:4 }
];

/***** STATE *****/
const STATE = {
  date: null,
  shift: "Day",
  zoom: 1,
  // data from uploads
  rosterRows: [],
  swapOutRows: [],
  swapInRows: [],
  vetvtoRows: [],
  laborShareRows: [],
  // derived
  badges: new Map(),      // eid -> badge
  placements: new Map(),  // pathId -> Set(eid)
  log: []
};

/***** DOM & HELPERS *****/
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const pad2 = n => String(n).padStart(2,"0");
function todayISO(){ const d=new Date(); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function weekdayStr(d){ return d.toLocaleDateString(undefined,{weekday:"long"}); }
function codesFor(dayName,shift){ return SETTINGS.shift_schedule?.[shift]?.[dayName] || []; }
function initials(name){ const p=(name||"").split(" "); return (p[0]?.[0]||"").toUpperCase()+(p[1]?.[0]||"").toUpperCase(); }
function normId(v){ return String(v ?? "").trim().replace(".0","").replace(/\s+/g,"").replace(/\u200b/g,""); }
function toISODate(x){ if(!x) return ""; const t = new Date(String(x)); if (isNaN(t)) return ""; return `${t.getFullYear()}-${pad2(t.getMonth()+1)}-${pad2(t.getDate())}`; }
function pick(row,keys){ for(const k of keys){ if (k in row && row[k] !== undefined) return row[k]; } return ""; }
function setHint(id,text){ $(id).textContent=text; }
function logEvent(kind,meta={}){ const ts=new Date().toLocaleTimeString(); STATE.log.unshift({ts,kind,...meta}); renderLog(); }

/***** FILE INPUTS *****/
function hookUploads(){
  bindFile("#fileRoster","#hintRoster",      rows => { STATE.rosterRows = rows; rebuild(); });
  bindFile("#fileSwapOut","#hintSwapOut",    rows => { STATE.swapOutRows = rows; rebuild(); });
  bindFile("#fileSwapIn","#hintSwapIn",      rows => { STATE.swapInRows  = rows; rebuild(); });
  bindFile("#fileVetVto","#hintVetVto",      rows => { STATE.vetvtoRows  = rows; rebuild(); });
  bindFile("#fileLaborShare","#hintLaborShare", rows => { STATE.laborShareRows = rows; rebuild(); });

  $("#resetFiles").addEventListener("click", ()=>{
    for (const id of ["fileRoster","fileSwapOut","fileSwapIn","fileVetVto","fileLaborShare"]) $(`#${id}`).value="";
    STATE.rosterRows=[]; STATE.swapOutRows=[]; STATE.swapInRows=[]; STATE.vetvtoRows=[]; STATE.laborShareRows=[];
    rebuild();
  });
  $("#buildNow").addEventListener("click", rebuild);
}
function bindFile(inputSel, hintSel, onRows){
  $(inputSel).addEventListener("change", e=>{
    const f = e.target.files?.[0];
    if(!f){ setHint(hintSel,"No file chosen"); onRows([]); return; }
    Papa.parse(f,{ header:true, skipEmptyLines:"greedy",
      complete:(res)=>{ setHint(hintSel, `${f.name} • ${res.data.length} rows`); onRows(res.data||[]); }
    });
  });
}

/***** CORE: REBUILD PIPELINE (CRETs-only) *****/
function rebuild(){
  STATE.badges.clear(); STATE.placements.clear(); STATE.log = [];

  const dayName = weekdayStr(new Date(STATE.date));
  const shiftCodes = new Set(codesFor(dayName, STATE.shift));
  $("#codesToday").textContent = [...shiftCodes].join(", ") || "—";

  // 1) ROSTER -> CRETs subset
  const COLS = {
    eid:  ["Employee ID","Person ID","Person Number","Associate ID","Badge ID","ID","Employee 1 ID"],
    name: ["Employee Name","Person Full Name","Name","Associate Name"],
    dept: ["Department ID","Home Department Number","Dept ID","Department"],
    maid: ["Management Area ID","Mgmt Area ID","Management Area","Area ID"],
    shift:["Shift Pattern","Shift Code","Pattern","Schedule Code","Shift"]
  };
  const rosterCRETs = STATE.rosterRows.filter(r=>{
    const dept = String(pick(r,COLS.dept) || "").trim();
    if (!CRETS_DEPT_IDS.has(dept)) return false;          // must be one of the two dept IDs

    const maid = String(pick(r,COLS.maid) || "").trim();
    if (maid === EXCLUDE_MAID) return false;              // explicit ICQA exclusion
    // relaxed MAID: accept blank/unknown; prefer 22 if present

    const rawSC = String(pick(r,COLS.shift) || "").toUpperCase();
    // Extract first two-letter token like DA/DB/... even if extra text
    const m = rawSC.match(/[A-Z]{2}/);
    const sc = m ? m[0] : rawSC;
    return shiftCodes.has(sc);
  });

  rosterCRETs.forEach((r,i)=>{
    const eid  = normId(pick(r,COLS.eid)); if (!eid) return;
    const name = String(pick(r,COLS.name) || `Associate ${i+1}`);
    const dept = String(pick(r,COLS.dept) || "");
    const rawSC = String(pick(r,COLS.shift) || "").toUpperCase();
    const m = rawSC.match(/[A-Z]{2}/); const sc = m ? m[0] : rawSC;

    STATE.badges.set(eid, {
      eid, name, dept_id: dept, shift_code: sc,
      present:false, planned:true, flip_time:null, path:null,
      tags:{vet:false, vto:false, swapin:false, swapout:false, break:false, train:false}
    });
  });

  // 2) SWAPS (approved) — only for EIDs already in CRETs subset
  const APPROVED = new Set(["APPROVED","ACCEPTED","COMPLETED"]);
  const swapIdCols = ["Employee ID","Person ID","Associate ID","Badge ID","Person Number","ID"];
  const statusCols = ["Status","Swap Status"];
  const skipDateCols = ["Date to Skip","Skip Date","Skip"];
  const workDateCols = ["Date to Work","Work Date","Work"];

  // OUT
  STATE.swapOutRows.forEach(r=>{
    const eid = normId(pick(r, swapIdCols)); if (!eid || !STATE.badges.has(eid)) return;
    const status = String(pick(r,statusCols)||"").toUpperCase(); if (!APPROVED.has(status)) return;
    const d = toISODate(pick(r,skipDateCols)); if (d && d !== STATE.date) return;
    const b = STATE.badges.get(eid); b.planned=false; b.tags.swapout=true;
  });
  // IN
  STATE.swapInRows.forEach(r=>{
    const eid = normId(pick(r, swapIdCols)); if (!eid || !STATE.badges.has(eid)) return; // only CRETs roster EIDs
    const status = String(pick(r,statusCols)||"").toUpperCase(); if (!APPROVED.has(status)) return;
    const d = toISODate(pick(r,workDateCols)); if (d && d !== STATE.date) return;
    const b = STATE.badges.get(eid); b.planned=true; b.tags.swapin=true;
  });

  // 3) VET/VTO (accepted) — only for EIDs in CRETs subset
  const vetIdCols = ["employeeId","Employee ID","Person ID","Associate ID","Badge ID","ID"];
  const typeCols  = ["opportunity.type","Opportunity Type","type"];
  const accCols   = ["opportunity.acceptedCount","acceptedCount"];
  const dateCols  = ["opportunity.startDate","startDate","date","Date"];
  STATE.vetvtoRows.forEach(r=>{
    const eid = normId(pick(r,vetIdCols)); if (!eid || !STATE.badges.has(eid)) return;
    const acceptedCount = String(pick(r,accCols) ?? "1").trim(); if (acceptedCount === "0") return;
    const kind = String(pick(r,typeCols) || "").toUpperCase();
    const rd = toISODate(pick(r,dateCols)); if (rd && rd !== STATE.date) return;
    const b = STATE.badges.get(eid);
    if (kind.includes("VTO")){ b.planned=false; b.tags.vto=true; }
    else if (kind.includes("VET")){ b.planned=true; b.tags.vet=true; }
  });

  // 4) LABOR SHARE (optional)
  // A) by EID: Employee ID, Direction(IN|OUT)
  // B) by Count: Direction, Count
  STATE.laborShareRows.forEach((r,idx)=>{
    const dir = String(r["Direction"]||"").toUpperCase();
    const cnt = Number(r["Count"]||0);
    const eid = normId(pick(r, swapIdCols));
    if ((eid && dir) && STATE.badges.has(eid)){
      if (dir==="IN") STATE.badges.get(eid).planned = true;
      if (dir==="OUT") STATE.badges.get(eid).planned = false;
    } else if (dir && cnt>0){
      if (dir==="IN"){
        for (let i=0;i<cnt;i++){
          const sid=`LSIN-${idx}-${i}`;
          STATE.badges.set(sid,{
            eid:sid,name:"Labor Share",dept_id:"1299070",shift_code:"LS",
            present:false,planned:true,flip_time:null,path:null,
            tags:{vet:false,vto:false,swapin:true,swapout:false,break:false,train:false}
          });
        }
      } else if (dir==="OUT"){
        const pool = [...STATE.badges.values()].filter(b=>b.planned && !b.present);
        for (let i=0;i<Math.min(cnt,pool.length); i++){ pool[i].planned=false; }
      }
    }
  });

  renderBoard();
}

/***** RENDERING *****/
function renderBoard(){
  $("#BOARD").innerHTML = "";
  PATHS.forEach(p=>{
    const col = document.createElement("div");
    col.className="path"; col.dataset.path=p.id;

    const planned = countInPath(p.id,"planned");
    const actual  = countInPath(p.id,"present");

    col.innerHTML = `
      <h4><span>${p.name}</span>
      <span class="cap">${actual}/${p.cap} <span class="sub">(Planned ${planned})</span></span></h4>
      <div class="well" id="well-${p.id}"></div>
    `;
    $("#BOARD").appendChild(col);

    new Sortable(col.querySelector(".well"), {
      group:"badges", animation:120,
      onAdd:(evt)=>{ placeBadge(evt.item.dataset.eid, p.id); }
    });
  });

  new Sortable($("#UNASSIGNED"), {
    group:"badges", animation:120,
    onAdd:(evt)=>{ placeBadge(evt.item.dataset.eid, null); }
  });

  const un=$("#UNASSIGNED"); un.innerHTML="";
  for (const b of STATE.badges.values()){
    if (!b.planned) continue;
    const el = makeBadge(b);
    (b.path ? $(`#well-${b.path}`) : un).appendChild(el);
  }

  updateKPIs();
  renderLog();
}

function makeBadge(b){
  const el=document.createElement("div");
  el.className="badge "+(b.present?"present":"planned");
  el.dataset.eid=b.eid;
  el.innerHTML=`
    <div class="av">${initials(b.name)}</div>
    <div>
      <div class="name">${b.name}</div>
      <div class="meta">${b.eid} • ${b.dept_id||""} • ${b.shift_code||""}</div>
    </div>
    <div class="icons"></div>
  `;
  el.addEventListener("click", ()=>{
    b.present=!b.present; b.planned=true;
    if (b.present){
      el.classList.remove("planned"); el.classList.add("present");
      const now=new Date(); b.flip_time=`${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
      logEvent("flip",{eid:b.eid,to:b.path||"Unassigned"});
    }else{
      el.classList.add("planned"); el.classList.remove("present");
      b.flip_time=null; logEvent("unflip",{eid:b.eid});
    }
    updateKPIs();
  });
  el.addEventListener("contextmenu",(e)=>{
    e.preventDefault(); b.tags.break=!b.tags.break; renderIcons(el,b);
    logEvent("break-toggle",{eid:b.eid,val:b.tags.break});
  });
  renderIcons(el,b);
  return el;
}
function renderIcons(el,b){
  const wrap=el.querySelector(".icons"); wrap.innerHTML="";
  for(const k of Object.keys(b.tags)){ if(!b.tags[k]) continue;
    const i=document.createElement("i"); i.className=`ic ${k}`; wrap.appendChild(i);
  }
}
function placeBadge(eid,pathId){
  const b=STATE.badges.get(eid); if(!b) return;
  const prev=b.path; if(prev && STATE.placements.has(prev)) STATE.placements.get(prev).delete(eid);
  b.path=pathId;
  if(pathId){ if(!STATE.placements.has(pathId)) STATE.placements.set(pathId,new Set()); STATE.placements.get(pathId).add(eid); }
  logEvent("move",{eid,from:prev||"Unassigned",to:pathId||"Unassigned"});
  updateKPIs();
}
function countInPath(pathId, field){
  return [...STATE.badges.values()].filter(b => (b.path===pathId) && b[field]).length;
}

/***** KPIs & LOG *****/
function updateKPIs(){
  const planned=[...STATE.badges.values()].filter(b=>b.planned).length;
  const actual =[...STATE.badges.values()].filter(b=>b.present).length;
  $("#kpiPlanned").textContent=planned;
  $("#kpiActual").textContent=actual;
  $("#kpiVariance").textContent=actual-planned;

  const lateCut="07:35";
  const late=[...STATE.badges.values()].filter(b=>b.flip_time && b.flip_time>lateCut).length;
  $("#kpiLate").textContent=late;

  const unPlanned=[...STATE.badges.values()].filter(b=>!b.path && b.planned).length;
  const unActual =[...STATE.badges.values()].filter(b=>!b.path && b.present).length;
  $("#unPlanned").textContent=unPlanned;
  $("#unActual").textContent=unActual;
}
function renderLog(){
  const lines=STATE.log.slice(0,300).map(r=>{
    const base=`${r.ts} • ${r.kind.toUpperCase()}`;
    if(r.eid && r.to) return `${base} • EID ${r.eid} • ${r.from||""}→${r.to}`;
    if(r.eid) return `${base} • EID ${r.eid}`;
    return base;
  }).join("\n");
  $("#LOG").textContent = lines || "—";
}
function exportLogCSV(){
  const rows=[["ts","kind","eid","from","to"]];
  STATE.log.slice().reverse().forEach(r=> rows.push([r.ts,r.kind,r.eid||"",r.from||"",r.to||""]));
  const csv=rows.map(r=>r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`live_log_${STATE.date}_${STATE.shift}.csv`; a.click();
}

/***** UI BINDINGS *****/
function bindUI(){
  $("#datePick").addEventListener("change", ()=>{ STATE.date=$("#datePick").value; updateCodesToday(); rebuild(); });
  $("#shiftType").addEventListener("change", ()=>{ STATE.shift=$("#shiftType").value; updateCodesToday(); rebuild(); });
  $("#exportLog").addEventListener("click", exportLogCSV);
  $("#reset").addEventListener("click", ()=>location.reload());
  $("#zoomPlus").addEventListener("click", ()=>{ STATE.zoom=Math.min(1.25,STATE.zoom+0.05); document.body.style.zoom=STATE.zoom; });
  $("#zoomMinus").addEventListener("click", ()=>{ STATE.zoom=Math.max(0.75,STATE.zoom-0.05); document.body.style.zoom=STATE.zoom; });
  $("#search").addEventListener("keydown",(e)=>{
    if(e.key==="Enter"){
      const q=e.currentTarget.value.trim().toLowerCase();
      const b=[...STATE.badges.values()].find(x=>x.name.toLowerCase().includes(q)||x.eid.includes(q));
      if(b){
        const el=document.querySelector(`.badge[data-eid="${b.eid}"]`);
        if(el){ el.scrollIntoView({behavior:"smooth",block:"center"}); el.style.outline="3px dashed #0ea5e9"; setTimeout(()=>el.style.outline="",1200); }
      }
    }
  });
  document.addEventListener("keydown",(e)=>{ if(e.key==="F3"){ e.preventDefault(); $("#search").focus(); }});
}
function updateCodesToday(){
  const dayName = weekdayStr(new Date($("#datePick").value || STATE.date));
  const codes = codesFor(dayName, STATE.shift);
  $("#codesToday").textContent = codes.join(", ") || "—";
}

/***** BOOT *****/
function boot(){
  $("#datePick").value = todayISO();
  STATE.date = $("#datePick").value;
  $("#shiftType").value = STATE.shift;
  updateCodesToday();
  hookUploads();
  bindUI();
  renderBoard(); // show lanes even before files
}
boot();
