<script src="usage.js"></script>
<script>
  trackUsage(); // counts one silent use
</script>
// === app.js ===
/* ====== CONFIG ====== */
const CRETS_DEPT_IDS = new Set(["1299070","1211070"]); // CRETs filter
// Example schedule map (tune to site truth)
const CODE_DAYS = { DA:[1,2,3,4], DB:[2,3,4,5], DC:[3,4,5,6], DN:[5,6,0,1], DL:[0,1,2,3] };

/* ====== STATE ====== */
const STATE = {
  roster: [], swapIn: [], swapOut: [], vetvto: [],
  badges: new Map(), // eid -> badge obj {eid,name,shift,present,flip_time}
  date: new Date(), shift: "Day"
};

document.getElementById("datePick").value = new Date().toISOString().slice(0,10);

/* ====== CSV HEADER MAP ====== */
const MAP = {
  eid:["Employee ID","Person Number","Badge ID","ID","Associate ID"],
  name:["Associate Name","Worker Name","Name","Full Name"],
  dept:["department_code","Department","Dept ID","Dept Code","Department Code"],
  shift:["shift_code","Schedule Code","Shift","Shift Code"],
  status:["Status","Swap Status","Request Status","Decision","Approval Status"],
  type:["Type","Request Type","Action"],
  date:["Date","Work Date","Date to Work","Effective Date"]
};
function pick(row, keys){
  for(const k of keys){ if(row[k]!==undefined && String(row[k]).trim()!=="") return String(row[k]).trim(); }
  return "";
}
function norm(row){
  return {
    eid:  pick(row, MAP.eid),
    name: pick(row, MAP.name),
    dept: pick(row, MAP.dept),
    shift:pick(row, MAP.shift),
    status: (pick(row, MAP.status) || "").toLowerCase(),
    type: (pick(row, MAP.type) || "").toUpperCase(),
    date: pick(row, MAP.date)
  };
}

/* ====== HELPERS ====== */
function parseCSV(file, cb){
  if(!file) return cb([]);
  Papa.parse(file,{header:true,skipEmptyLines:true,complete:r=>cb(r.data)});
}
function accepted(r){ return /(accept|approved|yes)/i.test(r.status||""); }
function worksThatDate(shiftCode, date){
  const dow = date.getDay();
  return (CODE_DAYS[shiftCode]||[]).includes(dow) || CODE_DAYS[shiftCode]===undefined;
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])); }
function handleFromName(n){ return (n||"").split(/\s+/)[0]?.toLowerCase() || "user"; }
function slug(s){ return s.replace(/[^a-z0-9_]/g,""); }

/* ====== FILE BINDINGS ====== */
bindFile("fileRoster", rows=>STATE.roster = rows);
bindFile("fileSwapIn", rows=>STATE.swapIn = rows);
bindFile("fileSwapOut", rows=>STATE.swapOut = rows);
bindFile("fileVetVto", rows=>STATE.vetvto = rows);

["datePick","shiftType"].forEach(id=>{
  document.getElementById(id).addEventListener("change", ()=>{
    if(id==="datePick") STATE.date = new Date(document.getElementById("datePick").value);
    if(id==="shiftType") STATE.shift = document.getElementById("shiftType").value;
    rebuild();
  });
});

function bindFile(id, setter){
  document.getElementById(id).addEventListener("change", ev=>{
    const f = ev.target.files[0];
    if(!f){ setter([]); rebuild(); return; }
    parseCSV(f, rows=>{
      setter(rows);
      document.getElementById("hint"+id.slice(4)).textContent = `${f.name} · ${rows.length} rows`;
      rebuild();
    });
  });
}

/* ====== CORE: REBUILD ====== */
function rebuild(){
  STATE.badges.clear();

  const date = new Date(document.getElementById("datePick").value || new Date());

  // Filter roster to CRETs + on-schedule associates
  const rosterCRETs = STATE.roster
    .map(norm)
    .filter(r=>CRETS_DEPT_IDS.has(r.dept))
    .filter(r=>worksThatDate(r.shift, date));

  const planned = new Map(rosterCRETs.map(r=>[r.eid, r]));

  // Swaps / VET-VTO (accepted only)
  STATE.swapOut.map(norm).filter(accepted).forEach(r=>planned.delete(r.eid));
  STATE.swapIn .map(norm).filter(accepted).forEach(r=>{ if(r.eid) planned.set(r.eid, r); });
  STATE.vetvto .map(norm).filter(accepted).forEach(r=>{
    if(r.type.includes("VTO")) planned.delete(r.eid);
    if(r.type.includes("VET") && r.eid) planned.set(r.eid, r);
  });

  // Build badges
  for(const [eid, r] of planned){
    STATE.badges.set(eid, {
      eid, name: r.name || eid, shift: r.shift || "—",
      present:false, flip_time:null
    });
  }

  renderBoard();
  refreshExpectedDropdown(planned.size);
  updateKPIs();
}

/* ====== RENDER ====== */
function renderBoard(){
  const board = document.getElementById("board");
  board.innerHTML = "";

  if(STATE.badges.size===0){
    // Demo badge (static) so UI isn’t empty on first load
    const demo = {eid:"1006020", name:"Raviteja K", shift:"DA", present:true, flip_time:"7:31 AM"};
    board.appendChild(makeBadgeEl(demo, true));
  } else {
    for(const b of STATE.badges.values()){
      board.appendChild(makeBadgeEl(b,false));
    }
  }

  // Generate barcodes after nodes paint
  requestAnimationFrame(()=>document.querySelectorAll("svg.barcode").forEach(svg=>{
    const val = svg.getAttribute("data-value") || "";
    try{ JsBarcode(svg, val || "0000000", {displayValue:false, height:60, margin:0}); }catch(e){}
  }));
}

function makeBadgeEl(b, demo=false){
  const card = document.createElement("div");
  card.className = "badge";
  if(b.present) card.classList.add("present");
  card.innerHTML = `
    <div class="chip">PRESENT</div>
    <div class="left"><div class="avatar"></div></div>
    <div class="right">
      <div class="name">${escapeHtml(b.name||"")}</div>
      <div class="lineSmall"><strong>${escapeHtml(b.shift||"")}</strong><span class="dot"></span><span>Regular</span></div>
      <div class="barcodeWrap"><svg class="barcode" data-value="${escapeHtml(b.eid||"")}"></svg></div>
      <div class="handle">@${slug(handleFromName(b.name))}</div>
    </div>
  `;
  if(!demo){
    card.addEventListener("click", ()=>{
      b.present = !b.present;
      b.flip_time = b.present ? new Date().toLocaleTimeString() : null;
      card.classList.toggle("present", b.present);
      updateKPIs();
      saveDay();
    });
  } else {
    card.style.cursor = "default";
  }
  return card;
}

/* ====== KPIs & EXPECTED HC ====== */
function updateKPIs(){
  const planned = +document.getElementById("expectedSelect").value || STATE.badges.size;
  const actual = Array.from(STATE.badges.values()).filter(b=>b.present).length;
  document.getElementById("kpiPlanned").textContent = planned;
  document.getElementById("kpiActual").textContent = actual;
  document.getElementById("kpiVariance").textContent = (actual - planned);
}
function refreshExpectedDropdown(N){
  const sel = document.getElementById("expectedSelect");
  sel.innerHTML = "";
  const start = Math.max(0, N-15), end = N+15;
  for(let i=start; i<=end; i++){
    const opt=document.createElement("option");
    opt.value = i; opt.textContent = i; if(i===N) opt.selected=true;
    sel.appendChild(opt);
  }
  sel.onchange = updateKPIs;
}

/* ====== PERSISTENCE & EXPORT ====== */
document.getElementById("btnClear").onclick = ()=>{
  STATE.badges.forEach(b=>{ b.present=false; b.flip_time=null; });
  renderBoard(); updateKPIs(); saveDay();
};
document.getElementById("btnExport").onclick = ()=>{
  const dateStr = (document.getElementById("datePick").value || new Date().toISOString().slice(0,10));
  const shift = document.getElementById("shiftType").value;
  const rows = [["date","shift","eid","name","present","flip_time"]];
  STATE.badges.forEach(b=>rows.push([dateStr, shift, b.eid, b.name, b.present, b.flip_time||""]));
  const csv = rows.map(r=>r.join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
  a.download = `crets_${dateStr}_${shift}.csv`; a.click();
};

function saveDay(){ localStorage.setItem("crets-day", JSON.stringify([...STATE.badges.entries()])); }
function loadDay(){
  const raw = localStorage.getItem("crets-day"); if(!raw) return;
  try{
    const arr = JSON.parse(raw);
    STATE.badges = new Map(arr);
    renderBoard(); updateKPIs();
  }catch(e){}
}

/* ====== BOOT ====== */
STATE.date = new Date(document.getElementById("datePick").value);
STATE.shift = document.getElementById("shiftType").value;
rebuild();      // initial render (shows demo until files loaded)
loadDay();      // restore any previous state
