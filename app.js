// ===== Shift code calendar =====
const SCHEDULE = {
  day: {0:["DA","DL","DC","DH"],1:["DA","DL","DC","DH"],2:["DA","DL","DC"],3:["DA","DB","DL"],4:["DB","DN","DC"],5:["DB","DN","DC","DH"],6:["DB","DN","DL","DH"],},
  night:{0:["NA","NL","NC","NH"],1:["NA","NL","NC","NH"],2:["NA","NL","NC"],3:["NA","NB"],4:["NB","NN","NC"],5:["NB","NN","NC","NH"],6:["NB","NN","NL","NH"],}
};
function codesFor(date, mode){
  const wd = new Date(date).getDay();
  if (mode === "day") return SCHEDULE.day[wd] || [];
  if (mode === "night") return SCHEDULE.night[wd] || [];
  const set = new Set([...(SCHEDULE.day[wd]||[]), ...(SCHEDULE.night[wd]||[])]);
  return [...set];
}

// ===== DOM
const rosterRef = document.getElementById("ROSTER");
const unassigned = document.getElementById("UNASSIGNED");
const metrics = document.getElementById("metrics");
const codesTodayEl = document.getElementById("codesToday");

// ===== Board building
function mkSlot(){
  const slot = document.createElement("div");
  slot.className = "slot";
  slot.textContent = "+";
  slot.dataset.max = "1";
  slot.addEventListener("dragover", e => { e.preventDefault(); slot.classList.add("active"); });
  slot.addEventListener("dragleave", () => slot.classList.remove("active"));
  slot.addEventListener("drop", e => {
    e.preventDefault(); slot.classList.remove("active");
    if (slot.querySelector(".badge")) { slot.classList.add("full"); setTimeout(() => slot.classList.remove("full"), 400); return; }
    const id = e.dataTransfer.getData("id"); const el = document.getElementById(id);
    if (el) { slot.textContent=""; slot.appendChild(el); updateMetrics(); }
  });
  return slot;
}
function addSlots(areaId, n){
  const parent = document.getElementById(areaId);
  for (let i=0;i<n;i++){
    if (areaId === "DOCK") { parent.appendChild(mkSlot()); parent.appendChild(mkSlot()); }
    else { parent.appendChild(mkSlot()); }
  }
  updateCaps();
}
document.querySelectorAll(".addbtn").forEach(b=> b.addEventListener("click", ()=> addSlots(b.dataset.add, 2)));

function buildSortGrid(){
  const grid = document.getElementById("SORTGRID");
  for (let n=1;n<=32;n++){
    const cell = document.createElement("div"); cell.className="cell";
    const id = (n<10? "0"+n : ""+n);
    cell.innerHTML = `<h4>Sort ${id}<span class="muted" data-sortcap="${id}">0/2</span></h4>`;
    const slot = document.createElement("div"); slot.className="slot"; slot.dataset.max="2";
    ["a","b"].forEach(()=>{
      const sub=document.createElement("div"); sub.className="slotlet"; sub.textContent="+";
      sub.addEventListener("dragover", e=>{e.preventDefault(); sub.classList.add("active");});
      sub.addEventListener("dragleave", ()=> sub.classList.remove("active"));
      sub.addEventListener("drop", e=>{
        e.preventDefault(); sub.classList.remove("active");
        if (sub.querySelector(".badge")){ sub.classList.add("full"); setTimeout(()=>sub.classList.remove("full"), 400); return; }
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
  const assigned = document.querySelectorAll(".left .badge").length;
  const un = Math.max(0, scheduled - assigned);
  document.getElementById("unassignedCount").textContent = un;
  metrics.textContent = `Scheduled: ${scheduled} • Assigned: ${assigned} • Unassigned: ${un}`;
}

// ===== CSV utils & filtering
function parseCSV(text){
  const lines = text.replace(/\r/g,"").split("\n").filter(Boolean);
  const headers = lines.shift().split(",").map(h=>h.trim());
  const rows = lines.map(line => {
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
function normalize(rows, headers){
  const canon = h => h.toLowerCase().replace(/[^a-z0-9]/g,"");
  const map = Object.fromEntries(headers.map(h=>[canon(h), h]));
  const pick = (row, candidates) => {
    for (const c of candidates){
      const key = map[c.toLowerCase().replace(/[^a-z0-9]/g,"")];
      if (key && (key in row)) return String(row[key]||"");
    }
    return "";
  };
  return rows.map(r => ({
    name: pick(r, ["Employee Name","Name"]),
    eid:  pick(r, ["Badge Barcode ID","Badge","Login","EID","Employee ID"]),
    dept: pick(r, ["Department ID"]),
    area: pick(r, ["Management Area ID"]),
    code: pick(r, ["Shift Pattern","Shift","Pattern"]).toUpperCase(),
  }));
}
function isIXD(p){ return (String(p.dept).trim()==="1211070" || String(p.dept).trim()==="1299070") && String(p.area).trim()==="22"; }

function badgeFor(p, i){
  const b=document.createElement("div"); b.className="badge"; b.id=`p_${(p.eid||i)}_${i}`; b.draggable=true;
  b.innerHTML = `<div class="name">${p.name||""}</div><div class="tag">${p.eid||""}</div><div class="code">${p.code||""}</div>`;
  b.addEventListener("dragstart", e=> e.dataTransfer.setData("id", b.id));
  return b;
}

// ===== State & refresh
let RAW=[], CURRENT=[];

async function refresh(){
  const date = document.getElementById("datePick").value;
  const mode = document.getElementById("viewMode").value;
  if (!date || RAW.length===0) return;
  const codes = codesFor(date, mode);
  document.getElementById("codesToday").textContent = "Codes: " + (codes.join(", ") || "—");
  const ixd = RAW.filter(isIXD);
  CURRENT = ixd.filter(p => codes.some(c => (p.code||"").startsWith(c)));
  // right reference
  rosterRef.innerHTML="";
  CURRENT.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach((p,i)=>{
    const r=document.createElement("div"); r.className="badge"; r.draggable=false;
    r.innerHTML = `<div class="name">${p.name||""}</div><div class="tag">${p.eid||""}</div><div class="code">${p.code||""}</div>`;
    rosterRef.appendChild(r);
  });
  // left unassigned
  unassigned.innerHTML="";
  CURRENT.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach((p,i)=> unassigned.appendChild(badgeFor(p,i)) );
  updateCaps();
}

// ===== Events
document.getElementById("csvInput").addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const txt = await f.text();
  const parsed = parseCSV(txt);
  RAW = normalize(parsed.rows, parsed.headers);
  refresh();
});
document.getElementById("datePick").addEventListener("change", refresh);
document.getElementById("viewMode").addEventListener("change", refresh);

// ===== Init
addSlots("DOCK", 4); addSlots("CENTER", 4); addSlots("TRAINING", 4);
buildSortGrid();
document.getElementById("datePick").value = new Date().toISOString().slice(0,10);
