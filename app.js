/* ========= SHIFT CALENDAR (Wed = DA, DB) ========= */
const SCHEDULE = {
  day: {
    0:["DA","DL","DC","DH"],
    1:["DA","DL","DC","DH"],
    2:["DA","DL","DC"],
    3:["DA","DB"],        // Wed ✅
    4:["DB","DN","DC"],
    5:["DB","DN","DC","DH"],
    6:["DB","DN","DL","DH"],
  },
  night: {
    0:["NA","NL","NC","NH"],
    1:["NA","NL","NC","NH"],
    2:["NA","NL","NC"],
    3:["NA","NB"],
    4:["NB","NN","NC"],
    5:["NB","NN","NC","NH"],
    6:["NB","NN","NL","NH"],
  }
};
function weekdayLocal(dateStr){ if(!dateStr) return 0; const [y,m,d]=dateStr.split("-").map(Number); return new Date(y,m-1,d).getDay(); }
function codesFor(date, view){
  const wd = weekdayLocal(date);
  if (view==="day") return SCHEDULE.day[wd]||[];
  if (view==="night") return SCHEDULE.night[wd]||[];
  const set = new Set([...(SCHEDULE.day[wd]||[]), ...(SCHEDULE.night[wd]||[])]);
  return [...set];
}

/* ========= COLOR MAP (legend + badge chip) ========= */
const SHIFT_COLORS = {
  // Day
  DA:"#7C3AED", DB:"#16A34A", DC:"#0EA5E9", DL:"#F59E0B", DN:"#22C55E", DH:"#06B6D4",
  // Night
  NA:"#4F46E5", NB:"#9333EA", NC:"#2563EB", NL:"#A855F7", NN:"#1D4ED8", NH:"#7C3AED",
};

/* ========= STATE ========= */
let RAW = [];          // normalized roster rows (all)
let CURRENT = [];      // filtered IXD scheduled for date/view AFTER swaps & vacations
let SWAPS = {};        // {(eid,date)=>code or ""/"off"}
let VAC = [];          // [{eid,start,end}]
/* simple in-memory assignments just for demo; your PXT board likely has richer */
const ASSIGNMENTS = {};

/* ========= DOM ========= */
const rosterRef = document.getElementById("ROSTER");
const unassigned = document.getElementById("UNASSIGNED");
const metrics = document.getElementById("metrics");
const legendEl = document.getElementById("legend");
const codesTodayEl = document.getElementById("codesToday");

/* ========= CSV helpers ========= */
async function readFileText(file){ return file ? await file.text() : ""; }
function parseCSV(text){
  const lines = text.replace(/\r/g,"").split("\n").filter(l=>l.trim().length);
  if (!lines.length) return {headers:[], rows:[]};
  const headers = lines.shift().split(",").map(h=>h.trim());
  const rows = lines.map(line=>{
    const out=[]; let cur="", q=false;
    for (let i=0;i<line.length;i++){
      const ch=line[i];
      if (ch === '"'){ q=!q; continue; }
      if (ch === ',' && !q){ out.push(cur); cur=""; continue; }
      cur+=ch;
    }
    out.push(cur);
    const obj={}; headers.forEach((h,i)=> obj[h]=out[i]??"");
    return obj;
  });
  return {headers, rows};
}
const canon = s => s.toLowerCase().replace(/[^a-z0-9]/g,"");
function normalizeRoster(rows, headers){
  const map = Object.fromEntries(headers.map(h=>[canon(h), h]));
  const pick=(row,cands)=>{ for(const c of cands){ const k=map[canon(c)]; if(k && (k in row)) return String(row[k]||""); } return ""; };
  return rows.map(r=>({
    name: pick(r,["Employee Name","Name"]),
    eid:  pick(r,["Badge Barcode ID","Badge","Login","EID","Employee ID"]),
    dept: pick(r,["Department ID"]),
    area: pick(r,["Management Area ID"]),
    code: pick(r,["Shift Pattern","Shift","Pattern"]).toUpperCase(),
    mgr:  pick(r,["Manager Login","Manager EID","Manager Employee ID","Manager Badge","Manager User ID","Manager Name"]),
  }));
}
function isIXD(p){ return (String(p.dept).trim()==="1211070" || String(p.dept).trim()==="1299070") && String(p.area).trim()==="22"; }

function normalizeSwaps(rows, headers){
  const map = Object.fromEntries(headers.map(h=>[canon(h), h]));
  const pick=(row,cands)=>{ for(const c of cands){ const k=map[canon(c)]; if(k && (k in row)) return String(row[k]||""); } return ""; };
  const out={};
  rows.forEach(r=>{
    const eid = pick(r,["eid","employee id","badge","login"]);
    const date = pick(r,["date","day"]);
    const to = (pick(r,["swap_to_code","to_code","code"])||"").toUpperCase();
    if (eid && date){ out[`${eid}__${date}`] = to; }
  });
  return out;
}
function normalizeVacations(rows, headers){
  const map = Object.fromEntries(headers.map(h=>[canon(h), h]));
  const pick=(row,cands)=>{ for(const c of cands){ const k=map[canon(c)]; if(k && (k in row)) return String(row[k]||""); } return ""; };
  const out=[];
  rows.forEach(r=>{
    const eid = pick(r,["eid","employee id","badge","login"]);
    const start = pick(r,["start_date","from"]);
    const end   = pick(r,["end_date","to"]) || start;
    if (eid && start) out.push({eid, start, end});
  });
  return out;
}
function dateInRange(date, start, end){
  const d=new Date(date+"T00:00"); const s=new Date(start+"T00:00"); const e=new Date(end+"T00:00");
  return s<=d && d<=e;
}

/* ========= Adjust (apply date/view + swaps + vacations) ========= */
function buildTodayScheduled(date, view){
  const active = codesFor(date, view);
  codesTodayEl.textContent = "Codes: " + (active.join(", ")||"—");

  const base = RAW.filter(isIXD).filter(r=> active.some(c => (r.code||"").startsWith(c)));
  // vacations
  const notOnLeave = base.filter(r=>{
    const eid=r.eid||"";
    return !VAC.some(v => v.eid===eid && dateInRange(date, v.start, v.end));
  });
  // swaps
  const fin = [];
  notOnLeave.forEach(r=>{
    const key = `${r.eid||""}__${date}`;
    if (key in SWAPS){
      const to = (SWAPS[key]||"").toUpperCase();
      if (!to || ["OFF","PTO","VAC"].includes(to)) return; // day off
      const copy = {...r, code: to};
      fin.push(copy);
    } else {
      fin.push(r);
    }
  });
  return fin;
}

/* ========= Badges + Board ========= */
function badgeFor(p, i){
  const b=document.createElement("div"); b.className="badge"; b.id=`p_${(p.eid||i)}_${i}`; b.draggable=true;
  const corner = (p.code||"").slice(0,2);
  const color = SHIFT_COLORS[corner] || "#475569";
  b.innerHTML = `
    <div class="name">${p.name||""}</div>
    <div class="eid">${p.eid||""} <span class="corner" style="background:${color}">${corner}</span></div>
    <div class="mgr">${p.mgr||""}</div>
  `;
  b.addEventListener("dragstart", e=> e.dataTransfer.setData("id", b.id));
  return b;
}

function mkSlot(){
  const slot=document.createElement("div"); slot.className="slot"; slot.textContent="+"; slot.dataset.max="1";
  slot.addEventListener("dragover", e=>{e.preventDefault(); slot.classList.add("active");});
  slot.addEventListener("dragleave", ()=> slot.classList.remove("active"));
  slot.addEventListener("drop", e=>{
    e.preventDefault(); slot.classList.remove("active");
    if (slot.querySelector(".badge")){ slot.classList.add("full"); setTimeout(()=>slot.classList.remove("full"),400); return; }
    const id=e.dataTransfer.getData("id"); const el=document.getElementById(id);
    if (el){ slot.textContent=""; slot.appendChild(el); updateMetrics(); }
  });
  return slot;
}
function addSlots(areaId, count){
  const parent=document.getElementById(areaId);
  for (let i=0;i<count;i++){ if(areaId==="DOCK"){ parent.appendChild(mkSlot()); parent.appendChild(mkSlot()); } else { parent.appendChild(mkSlot()); } }
  updateMetrics();
}
document.querySelectorAll(".addbtn").forEach(b=> b.addEventListener("click", ()=> addSlots(b.dataset.add, 2)));

function buildSortGrid(){
  const grid=document.getElementById("SORTGRID");
  if (grid.childElementCount) return;
  for (let n=1;n<=32;n++){
    const cell=document.createElement("div"); cell.className="cell";
    const id=(n<10? "0"+n : ""+n);
    cell.innerHTML = `<h4>Sort ${id}<span class="muted" data-sortcap="${id}">0/2</span></h4>`;
    const slot=document.createElement("div"); slot.className="slot"; slot.dataset.max="2";
    ["a","b"].forEach(()=>{
      const sub=document.createElement("div"); sub.className="slotlet"; sub.textContent="+";
      sub.addEventListener("dragover", e=>{e.preventDefault(); sub.classList.add("active");});
      sub.addEventListener("dragleave", ()=> sub.classList.remove("active"));
      sub.addEventListener("drop", e=>{
        e.preventDefault(); sub.classList.remove("active");
        if (sub.querySelector(".badge")){ sub.classList.add("full"); setTimeout(()=>sub.classList.remove("full"),400); return; }
        const id=e.dataTransfer.getData("id"); const el=document.getElementById(id);
        if (el){ sub.textContent=""; sub.appendChild(el); updateCaps(); }
      });
      slot.appendChild(sub);
    });
    cell.appendChild(slot); grid.appendChild(cell);
  }
}
function updateCaps(){
  document.querySelectorAll(".cell").forEach(c=>{
    const id=c.querySelector("h4").textContent.match(/\d{2}/)[0];
    const filled=c.querySelectorAll(".badge").length;
    c.querySelector(`[data-sortcap='${id}']`).textContent = `${filled}/2`;
  });
  updateMetrics();
}
function updateMetrics(){
  const scheduled = CURRENT.length;
  const assigned = document.querySelectorAll(".board .badge").length;
  const un = Math.max(0, scheduled - assigned);
  document.getElementById("unassignedCount").textContent = un;
  metrics.textContent = `Scheduled: ${scheduled} • Assigned: ${assigned} • Unassigned: ${un}`;
}

/* ========= LEGEND ========= */
function rollupByCode(rows){
  const m={}; rows.forEach(r=>{ const c=(r.code||"").slice(0,2); if(!c) return; m[c]=(m[c]||0)+1; }); return m;
}
function computeAssignedByCode(){
  const m={};
  document.querySelectorAll(".board .badge").forEach(b=>{
    const chip = b.querySelector(".corner"); if(!chip) return;
    const code = chip.textContent.trim(); m[code]=(m[code]||0)+1;
  });
  return m;
}
function renderLegend(activeCodes){
  const scheduledCounts = rollupByCode(CURRENT);
  const assignedCounts = computeAssignedByCode();
  legendEl.innerHTML = "";
  activeCodes.forEach(c=>{
    const color = SHIFT_COLORS[c] || "#475569";
    const chip = document.createElement("div");
    chip.className="chip";
    chip.innerHTML = `<span class="swatch" style="background:${color}"></span><strong>${c}</strong><span class="num">${assignedCounts[c]||0}/${scheduledCounts[c]||0}</span>`;
    legendEl.appendChild(chip);
  });
}

/* ========= REFRESH ========= */
async function refresh(){
  const date = document.getElementById("datePick").value;
  const view = document.getElementById("viewMode").value;
  if (!date || RAW.length===0) return;

  CURRENT = buildTodayScheduled(date, view).sort((a,b)=> (a.name||"").localeCompare(b.name||"") || (a.eid||"").localeCompare(b.eid||""));

  // Right roster (reference)
  rosterRef.innerHTML="";
  CURRENT.forEach((p,i)=>{
    const r=document.createElement("div"); r.className="badge"; r.draggable=false;
    const corner=(p.code||"").slice(0,2); const color=SHIFT_COLORS[corner]||"#475569";
    r.innerHTML = `<div class="name">${p.name||""}</div><div class="eid">${p.eid||""} <span class="corner" style="background:${color}">${corner}</span></div><div class="mgr">${p.mgr||""}</div>`;
    rosterRef.appendChild(r);
  });

  // Unassigned pool resets to CURRENT
  unassigned.innerHTML="";
  CURRENT.forEach((p,i)=> unassigned.appendChild(badgeFor(p,i)) );

  renderLegend(codesFor(date, view));
  updateCaps();
}

/* ========= EVENTS ========= */
document.getElementById("csvRoster").addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const {headers, rows} = parseCSV(await readFileText(f));
  RAW = normalizeRoster(rows, headers);
  refresh();
});
document.getElementById("csvSwaps").addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f){ SWAPS={}; return refresh(); }
  const {headers, rows} = parseCSV(await readFileText(f));
  SWAPS = normalizeSwaps(rows, headers);
  refresh();
});
document.getElementById("csvVac").addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f){ VAC=[]; return refresh(); }
  const {headers, rows} = parseCSV(await readFileText(f));
  VAC = normalizeVacations(rows, headers);
  refresh();
});
document.getElementById("datePick").addEventListener("change", refresh);
document.getElementById("viewMode").addEventListener("change", refresh);

/* publish toggle */
const publishBtn = document.getElementById("publishBtn");
const exitPublishBtn = document.getElementById("exitPublishBtn");
publishBtn.addEventListener("click", ()=>{
  document.body.classList.add("published");
  publishBtn.classList.add("hide"); exitPublishBtn.classList.remove("hide");
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
});
exitPublishBtn.addEventListener("click", ()=>{
  document.body.classList.remove("published");
  exitPublishBtn.classList.add("hide"); publishBtn.classList.remove("hide");
  if (document.fullscreenElement) document.exitFullscreen();
});

/* ========= INIT ========= */
function initBoard(){
  addSlots("DOCK", 6); addSlots("CENTER", 6); addSlots("TRAINING", 6);
  buildSortGrid();
  const today = new Date(); const yyyy=today.getFullYear();
  const mm=String(today.getMonth()+1).padStart(2,"0");
  const dd=String(today.getDate()).padStart(2,"0");
  document.getElementById("datePick").value = `${yyyy}-${mm}-${dd}`;
}
initBoard();
