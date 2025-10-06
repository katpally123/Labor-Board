// ================== INIT ==================
window.addEventListener("DOMContentLoaded", ()=>{
  const unassignedBody = document.querySelector("#unassigned .bucket-body");

  // --- sample associates (you can replace with roster import) ---
  const associates = [
    {id:"205514534", name:"Krishna P.", dept:"1211070", shift:"DB"},
    {id:"205487471", name:"Rama Bhisht", dept:"1211070", shift:"DB"},
    {id:"205387091", name:"Gaurav Verma", dept:"1211070", shift:"DB"},
    {id:"205367200", name:"Patel Harshkumar", dept:"1211070", shift:"DB"},
    {id:"205668432", name:"Gaurav Duttkarsh", dept:"1211070", shift:"DB"},
  ];

  associates.forEach(a=>unassignedBody.appendChild(makeAssocCard(a)));

  enableDragAndDrop();
  recalcAllCounts();
});

// ================== CARD FACTORY ==================
function makeAssocCard({id,name,dept,shift,defaultStatus='unknown'}){
  const card=document.createElement('div');
  card.className='assoc-card dim-unknown';
  card.dataset.id=id;
  card.dataset.status=defaultStatus;

  card.innerHTML=`
    <div class="presence-pill" data-status="unknown" data-icon="–" title="Toggle presence"></div>
    <div class="name">${name}</div>
    <div class="meta">${id} · ${dept} · ${shift}</div>
  `;

  // Presence toggle
  const pill=card.querySelector('.presence-pill');
  pill.addEventListener('click',e=>{
    e.stopPropagation();
    togglePresence(card);
  });
  pill.addEventListener('mousedown',e=>{
    if(e.altKey){ setPresence(card,'unknown'); }
    else if(e.shiftKey){ setPresence(card,'absent'); }
  });

  setPresence(card,defaultStatus);
  return card;
}

// ================== PRESENCE LOGIC ==================
function setPresence(card,status){
  card.dataset.status=status;
  const pill=card.querySelector('.presence-pill');
  pill.dataset.status=status;
  pill.dataset.icon=status==='present'?'✓':status==='absent'?'✗':'–';
  card.classList.toggle('dim-unknown',status==='unknown');
  recalcAllCounts();
}
function togglePresence(card){
  const now=card.dataset.status;
  const next=(now==='present')?'absent':'present';
  setPresence(card,next);
  card.dataset.flip_time=new Date().toISOString();
}

// ================== COUNT UPDATES ==================
function recalcAllCounts(){
  document.querySelectorAll('.bucket').forEach(updateBucketCount);
  updateGlobalHeader();
}
function updateBucketCount(bucket){
  const planned=bucket.querySelectorAll('.assoc-card').length;
  const actual=bucket.querySelectorAll('.assoc-card[data-status="present"]').length;
  const label=bucket.querySelector('.bucket-title-count');
  if(label) label.textContent=`${planned}/${actual}`;
}
function updateGlobalHeader(){
  const planned=document.querySelectorAll('.assoc-card').length;
  const actual=document.querySelectorAll('.assoc-card[data-status="present"]').length;
  document.querySelector('#planned').textContent=planned;
  document.querySelector('#actual').textContent=actual;
}

// ================== DRAG & DROP ==================
function enableDragAndDrop(){
  document.querySelectorAll('.bucket-body').forEach(body=>{
    body.addEventListener('dragover',e=>{
      e.preventDefault(); body.classList.add('drag-over');
    });
    body.addEventListener('dragleave',()=>body.classList.remove('drag-over'));
    body.addEventListener('drop',e=>{
      e.preventDefault(); body.classList.remove('drag-over');
      const id=e.dataTransfer.getData('text/plain');
      const card=document.querySelector(`.assoc-card[data-id="${id}"]`);
      if(card) body.appendChild(card);
      recalcAllCounts();
    });
  });

  document.addEventListener('dragstart',e=>{
    if(e.target.classList.contains('assoc-card')){
      e.dataTransfer.setData('text/plain',e.target.dataset.id);
    }
  });
}
