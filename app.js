/***** SETTINGS (inline to keep a single-file drop-in) *****/
const SETTINGS = {
  departments: {
    Inbound: { dept_ids: ["1211010","1211020","1299010","1299020"] },
    DA:      { dept_ids: ["1211030","1211040","1299030","1299040"] },
    ICQA:    { dept_ids: ["1299070","1211070"], management_area_id: "27" },
    CRETs:   { dept_ids: ["1299070","1211070"], management_area_id: "22" }
  },
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

/***** PATHS (adjust capacities to match floor) *****/
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
  badges: new Map(),        // eid -> badge
  placements: new Map(),    // pathId -> Set(eid)
  log: [],
  files: {
    roster: null,
    mytime: null,
    hours: null,
    swapOut: null,
    swapIn: null,
    vetvto: null
  }
};

/***** UTIL *****/
const $  = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));
const pad2 = (n)=>String(n).padStart(2,"0");
function todayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function weekdayStr(d){ return d.toLocaleDateString(undefined, { weekday:"long" }); }
function initials(name){
  const p = (name||"").split(" ");
  return (p[0]?.[0]||"").toUpperCase() + (p[1]?.[0]||"").toUpperCase();
}
function codesFor(dayName, shift){
  return SETTINGS?.shift_schedule?.[shift]?.[dayName] || [];
}
function normId(v){
  return String(v ?? "").trim().replace(".0","").replace(/\s+/g,"").replace(/\u200b/g,"");
}
function logEvent(kind, meta={}){
  const ts = new Date().toLocaleTimeString();
  STATE.log.unshift({ ts, kind, ...meta });
  renderLog();
}
function updateKPIs(){
  const planned = [...STATE.badges.values()].filter(b=>b.planned).length;
  const actual  = [...STATE.badges.values()].filter(b=>b.present).length;
  $("#kpiPlanned").textContent  = planned;
  $("#kpiActual").textContent   = actual;
  $("#kpiVariance").textContent = actual - planned;

  const lateCut = "07:35";
  const late = [...STATE.badges.values()].filter(b=>b.flip_time && b.flip_time > lateCut).length;
  $("#kpiLate").textContent = late;

  // Unassigned KPIs
  const unPlanned = [...STATE.badges.values()].filter(b=>!b.path && b.planned).length;
  const unActual  = [...STATE.badges.values()].filter(b=>!b.path && b.present).length;
  $("#unPlanned").textContent = unPlanned;
  $("#unActual").textContent  = unActual;
}

/***** FILE PARSING *****/
function setHint(id, text){ $(id).textContent = text; }
function hookUploads(){
  const bind = (inputSel, hintSel, key) => {
    $(inputSel).addEventListener("change", (e)=>{
      const f = e.target.files?.[0];
      if(!f){ setHint(hintSel, "No file chosen"); STATE.files[key]=null; return; }
      setHint(hintSel, `${f.name}`);
      Papa.parse(f, {
        header: true, skipEmptyLines: "greedy",
        complete: (res)=>{
          STATE.files[key] = { name: f.name, rows: res.data };
          setHint(hintSel, `${f.name} • ${res.data.length} rows`);
        }
      });
    });
  };
  bind("#fileRoster","#hintRoster","roster");
  bind("#fileMyTime","#hintMyTime","mytime");
  bind("#fileHours","#hintHours","hours");
  bind("#fileSwapOut","#hintSwapOut","swapOut");
  bind("#fileSwapIn","#hintSwapIn","swapIn");
  bind("#fileVetVto","#hintVetVto","vetvto");

  $("#resetFiles").addEventListener("click", ()=>{
    for (const id of ["fileRoster","fileMyTime","fileHours","fileSwapOut","fileSwapIn","fileVetVto"]){
      $(`#${id}`).value = "";
    }
    for (const k of Object.keys(STATE.files)) STATE.files[k]=null;
    ["#hintRoster","#hintMyTime","#hintHours","#hintSwapOut","#hintSwapIn","#hintVetVto"]
      .forEach(h=>setHint(h,"No file chosen"));
  });
}

/***** BUILD DATA (Roster ± Swaps + VET − VTO; MyTime/Hours hooks ready) *****/
function buildData(){
  STATE.badges.clear();
  STATE.placements.clear();

  const dayName = weekdayStr(new Date(STATE.date));
  const shiftCodes = new Set(codesFor(dayName, STATE.shift));
  $("#codesToday").textContent = [...shiftCodes].join(", ") || "—";

  // --- Roster (required to see badges) ---
  const roster = STATE.files.roster?.rows || [];
  const excludeNew = $("#excludeNew").checked;

  // Guess columns by common names
  const COLS = {
    eid: ["Employee ID","Person ID","Employee 1 ID","Person Number","Badge ID","Associate ID","ID"],
    name: ["Employee Name","Person Full Name","Name","Associate Name"],
    dept: ["Department ID","Home Department Number","Dept ID","Department"],
    shift: ["Shift Pattern","Shift Code","Pattern","Schedule Code","Shift"]
  };
  function pick(row, keys){
    for (const k of keys){ if (k in row && row[k] !== undefined) return row[k]; }
    return "";
  }

  roster.forEach((r,i)=>{
    const eid  = normId(pick(r,COLS.eid));
    if (!eid) return;

    const name = String(pick(r,COLS.name) || `Associate ${i+1}`);
    const dept = String(pick(r,COLS.dept) || "");
    const sc   = String(pick(r,COLS.shift) || "").trim().toUpperCase();

    // Shift filter (Planned if today's codes include their shift code)
    const planned = shiftCodes.has(sc);

    // Optionally filter new hires (<3 days) using "Employment Start Date" if present
    if (excludeNew && r["Employment Start Date"]){
      const d0 = new Date(r["Employment Start Date"]);
      const diff = (new Date(STATE.date) - d0)/(1000*60*60*24);
      if (diff < 3) return;
    }

    STATE.badges.set(eid, {
      eid, name, dept_id: dept, shift_code: sc,
      present:false, planned, flip_time:null, path:null,
      tags:{vet:false, vto:false, swapin:false, swapout:false, break:false, train:false}
    });
  });

  // --- Swaps (optional) ---
  // Mark Swap OUT (remove from planned), Swap IN (force planned)
  const applySwaps = (rows, kind) => {
    rows.forEach(r=>{
      const eid = normId(pick(r,["Employee ID","Person ID","Associate ID","Badge ID","Person Number","ID"]));
      if(!eid || !STATE.badges.has(eid)) return;
      if (kind==="OUT"){
        STATE.badges.get(eid).planned = false;
        STATE.badges.get(eid).tags.swapout = true;
      }else{
        STATE.badges.get(eid).planned = true;
        STATE.badges.get(eid).tags.swapin = true;
      }
    });
  };
  if (STATE.files.swapOut?.rows) applySwaps(STATE.files.swapOut.rows,"OUT");
  if (STATE.files.swapIn?.rows)  applySwaps(STATE.files.swapIn.rows,"IN");

  // --- VET/VTO (optional) ---
  if (STATE.files.vetvto?.rows){
    STATE.files.vetvto.rows.forEach(r=>{
      const eid = normId(pick(r,["employeeId","Employee ID","Person ID","Associate ID","Badge ID","ID"]));
      if (!eid || !STATE.badges.has(eid)) return;
      const opp = String(r["opportunity.type"] || r["Opportunity Type"] || r["type"] || "").toUpperCase();
      const accepted = (String(r["opportunity.acceptedCount"] ?? r["acceptedCount"] ?? "1") !== "0");
      if (!accepted) return;
      if (opp.includes("VTO")){
        STATE.badges.get(eid).planned = false;
        STATE.badges.get(eid).tags.vto = true;
      }else if (opp.includes("VET")){
        STATE.badges.get(eid).planned = true;
        STATE.badges.get(eid).tags.vet = true;
      }
    });
  }

  // (Hooks) MyTime & Hours Summary are parsed and available in STATE.files.mytime / STATE.files.hours
  // Use them later to auto-flip present or exclude Vacation/BH if you want full automation.

  renderBoard();
}

/***** BADGES *****/
function makeBadge(b){
  const el = document.createElement("div");
  el.className = "badge " + (b.present ? "present" : "planned");
  el.dataset.eid = b.eid;
  el.innerHTML = `
    <div class="av">${initials(b.name)}</div>
    <div>
      <div class="name">${b.name}</div>
      <div class="meta">${b.eid} • ${b.dept_id || ""} • ${b.shift_code || ""}</div>
    </div>
    <div class="icons"></div>
  `;

  el.addEventListener("click", ()=>{
    b.present = !b.present;
    b.planned = true;
    if (b.present){
      el.classList.remove("planned"); el.classList.add("present");
      const now = new Date();
      b.flip_time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
      logEvent("flip",{eid:b.eid, to:b.path||"Unassigned"});
    }else{
      el.classList.add("planned"); el.classList.remove("present");
      b.flip_time = null;
      logEvent("unflip",{eid:b.eid});
    }
    updateKPIs();
  });

  el.addEventListener("contextmenu", (e)=>{
    e.preventDefault();
    b.tags.break = !b.tags.break;
    renderIcons(el,b);
    logEvent("break-toggle",{eid:b.eid, val:b.tags.break});
  });

  renderIcons(el,b);
  return el;
}
function renderIcons(el,b){
  const wrap = el.querySelector(".icons");
  wrap.innerHTML = "";
  for (const k of Object.keys(b.tags)){
    if (!b.tags[k]) continue;
    const i = document.createElement("i");
    i.className = `ic ${k}`;
    wrap.appendChild(i);
  }
}

/***** BOARD RENDERING *****/
function renderBoard(){
  $("#BOARD").innerHTML = "";
  PATHS.forEach(p=>{
    const col = document.createElement("div");
    col.className = "path";
    col.dataset.path = p.id;

    const planned = countInPath(p.id, "planned");
    const actual  = countInPath(p.id, "present");

    col.innerHTML = `
      <h4>
        <span>${p.name}</span>
        <span class="cap">${actual}/${p.cap} <span class="sub">(Planned ${planned})</span></span>
      </h4>
      <div class="well" id="well-${p.id}"></div>
    `;

    $("#BOARD").appendChild(col);

    new Sortable(col.querySelector(".well"), {
      group: "badges",
      animation: 120,
      onAdd: (evt)=>{
        const eid = evt.item.dataset.eid;
        placeBadge(eid, p.id);
      }
    });
  });

  // Unassigned well (left rail)
  new Sortable($("#UNASSIGNED"), {
    group: "badges", animation:120,
    onAdd: (evt)=>{ placeBadge(evt.item.dataset.eid, null); }
  });

  // paint badges
  const un = $("#UNASSIGNED");
  for (const b of STATE.badges.values()){
    if (!b.planned) continue; // only show planned on the board
    const el = makeBadge(b);
    (b.path ? $(`#well-${b.path}`) : un).appendChild(el);
  }

  updateKPIs();
}
function placeBadge(eid, pathId){
  const b = STATE.badges.get(eid);
  const prev = b.path;
  if (prev && STATE.placements.has(prev)) STATE.placements.get(prev).delete(eid);
  b.path = pathId;
  if (pathId){
    if (!STATE.placements.has(pathId)) STATE.placements.set(pathId, new Set());
    STATE.placements.get(pathId).add(eid);
  }
  logEvent("move",{eid, from: prev||"Unassigned", to: pathId||"Unassigned"});
  updateKPIs();
}
function countInPath(pathId, field){
  return [...STATE.badges.values()].filter(b => (b.path===pathId) && b[field]).length;
}

/***** LOG *****/
function renderLog(){
  const lines = STATE.log.slice(0,300).map(r=>{
    const base = `${r.ts} • ${r.kind.toUpperCase()}`;
    if (r.eid && r.to) return `${base} • EID ${r.eid} • ${r.from||""}→${r.to}`;
    if (r.eid) return `${base} • EID ${r.eid}`;
    return base;
  }).join("\n");
  $("#LOG").textContent = lines || "—";
}
function exportLogCSV(){
  const rows = [["ts","kind","eid","from","to"]];
  STATE.log.slice().reverse().forEach(r=>{
    rows.push([r.ts, r.kind, r.eid||"", r.from||"", r.to||""]);
  });
  const csv = rows.map(r=>r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `live_log_${STATE.date}_${STATE.shift}.csv`;
  a.click();
}

/***** UI BINDINGS *****/
function bindUI(){
  $("#datePick").addEventListener("change", e=>{
    STATE.date = e.target.value;
    updateCodesToday();
  });
  $("#shiftType").addEventListener("change", e=>{
    STATE.shift = e.target.value;
    updateCodesToday();
  });
  $("#excludeNew").addEventListener("change", ()=>{/* only affects next Build */});

  $("#buildData").addEventListener("click", buildData);
  $("#exportLog").addEventListener("click", exportLogCSV);
  $("#reset").addEventListener("click", ()=>location.reload());
  $("#zoomPlus").addEventListener("click", ()=>{ STATE.zoom=Math.min(1.25, STATE.zoom+0.05); document.body.style.zoom=STATE.zoom; });
  $("#zoomMinus").addEventListener("click", ()=>{ STATE.zoom=Math.max(0.75, STATE.zoom-0.05); document.body.style.zoom=STATE.zoom; });

  $("#search").addEventListener("keydown", (e)=>{
    if (e.key === "Enter"){
      const q = e.currentTarget.value.trim().toLowerCase();
      const b = [...STATE.badges.values()].find(x => x.name.toLowerCase().includes(q) || x.eid.includes(q));
      if (b){
        const el = document.querySelector(`.badge[data-eid="${b.eid}"]`);
        if (el){ el.scrollIntoView({behavior:"smooth", block:"center"}); el.style.outline="3px dashed #0ea5e9"; setTimeout(()=>el.style.outline="", 1200); }
      }
    }
  });
  document.addEventListener("keydown",(e)=>{ if (e.key==="F3"){ e.preventDefault(); $("#search").focus(); } });
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

  // Draw empty board so lanes appear before data arrives
  renderBoard();
}
boot();
