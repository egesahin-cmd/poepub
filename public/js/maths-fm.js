/* ═══ MATHS — FM OPERATOR GRID ═══════════════════════════════════════════════════════════════════
   Classic script loaded AFTER the inline block, so multiOscs / multiRebuildRouting / renderMulti and
   friends are out of their temporal dead zone, and mounted on DOMContentLoaded so load order stops
   mattering. State is flat fm*-prefixed vars and the inline-attribute entry points are top-level
   function declarations — the shape nsRf uses, and the only shape an onclick= can reach.

   ONE delegated pointer machine on #mathsGrid owns tap, drag and long-press. That is forced, not
   stylistic: pointerdown must preventDefault (no synthetic click, no iOS callout), which kills the
   per-cell click handlers outright — so tap dispatch has to come out of the shared pointerup. The
   four gestures are disjoint by construction, which is why there is no mode switch:

     tap, top third    -> ratio menu, ALWAYS, selected or not
     tap, elsewhere    -> select / deselect (binds the footer fader and wave dropdown to this op)
     drag past FM_SLOP -> move / swap the pad
     press FM_HOLD_MS  -> switch the operator on / off                                            */

var FM_HOLD_MS=1000;   // >1s to switch an op on/off; the contextmenu guard below makes it reachable
var FM_SLOP=8;         // 6px is tight when the whole gesture is "move one cell over"
var fmDrag=null;       // the single in-flight gesture, or null
var fmPrevPos=null;    // one level of undo for ROLL POS
var fmRollPosUndone=false;
var fmBaseSetWave=null;

function mathsGridEl(){return document.getElementById('mathsGrid');}
function fmCellAtIndex(i){var o=multiOscs[i];return o?document.getElementById('mcell'+o.id):null;}
function fmCellOf(op){return op?document.getElementById('mcell'+op.id):null;}

/* ── render: structural / state / per-frame ──────────────────────────────────────────────────── */
function fmMakeCell(){
  var cell=document.createElement('div');cell.className='maths-cell';cell.setAttribute('role','button');
  var rclick=document.createElement('div');rclick.className='mc-rclick';
  var rat=document.createElement('span');rat.className='mc-ratio';
  rclick.appendChild(rat);cell.appendChild(rclick);
  var freq=document.createElement('span');freq.className='mc-freq';cell.appendChild(freq);
  var i1=document.createElement('i');i1.className='mc-in';cell.appendChild(i1);
  var o1=document.createElement('i');o1.className='mc-out';cell.appendChild(o1);
  return cell;
}
/* structural only — runs when the operator COUNT changed. Existing nodes are never touched, so a
   sweep landing mid-drag cannot delete the pad under the finger. */
function mathsCellsEnsure(){
  var g=mathsGridEl();if(!g)return;
  var links=document.getElementById('mathsLinks');
  if(!links){links=document.createElement('div');links.id='mathsLinks';g.appendChild(links);}
  /* the portal menu layer belongs on #modMulti, NOT inside the grid: #muStage is a stacking context
     (position:relative;z-index:2), which would trap a position:fixed z-1000 layer underneath the
     footer sliders (z6) and the settings panel (z7). */
  if(!document.getElementById('mathsMenuLayer')){
    var layer=document.createElement('div');layer.id='mathsMenuLayer';
    var menu=document.createElement('div');menu.className='mr-menu';
    layer.appendChild(menu);
    var host=document.getElementById('modMulti');if(host)host.appendChild(layer);
  }
  /* Reconcile by op ID, never by DOM order. Matching positionally meant removing an operator
     deleted the LAST cell and then re-pointed every cell after the removal at a different op — so
     each survivor animated across to someone else's coordinates instead of staying put. */
  var live={};
  multiOscs.forEach(function(o){live['mcell'+o.id]=1;});
  Array.prototype.slice.call(g.querySelectorAll('.maths-cell')).forEach(function(c){
    if(!live[c.id])c.remove();
  });
  multiOscs.forEach(function(o){
    if(document.getElementById('mcell'+o.id))return;
    var c=fmMakeCell();c.id='mcell'+o.id;
    // place it before it is in the document, so a new pad appears where it belongs
    // instead of flying in from the grid origin
    c.style.setProperty('--c',o.p%4);c.style.setProperty('--r',(o.p/4)|0);
    c.style.setProperty('--v',Math.max(0,Math.min(100,Math.round(o.vol)))+'%');
    g.insertBefore(c,links);
  });
}
/* idempotent per-cell state: no allocation, no node churn, safe to call from any tick */
function mathsCellsSync(){
  var g=mathsGridEl();if(!g)return;
  /* The dots are the literal LEFT and RIGHT ports, so they light only for a horizontal edge —
     lighting the left dot for an edge arriving from above put a mark where no link landed. A
     vertical edge is carried by its link, which terminates on the pad's top or bottom edge. */
  var inbound={};
  multiOscs.forEach(function(o){(o.fmOut||[]).forEach(function(x){if(x.p===o.p+1)inbound[x.id]=1;});});
  multiOscs.forEach(function(o,i){
    var cell=document.getElementById('mcell'+o.id);if(!cell)return;
    cell.dataset.i=i;
    var rat=cell.querySelector('.mc-ratio'),freq=cell.querySelector('.mc-freq');
    rat.id='mrat'+o.id;freq.id='mfq'+o.id;
    rat.textContent=(multiHarmonicIdx>=0&&o.ratio!=null)?'×'+fmtRatio(o.ratio):''+(i+1);
    setMcFreq(freq,o.freq);
    cell.style.setProperty('--v',Math.max(0,Math.min(100,Math.round(o.vol)))+'%');
    // a live drag owns its pad's position until the drop
    if(!fmDrag||fmDrag.idx!==i){cell.style.setProperty('--c',o.p%4);cell.style.setProperty('--r',(o.p/4)|0);}
    cell.classList.toggle('muted',!!o.muted);
    cell.classList.toggle('fm-mod',!o.isCarrier);
    cell.classList.toggle('fm-out',(o.fmOut||[]).some(function(x){return x.p===o.p+1;}));
    cell.classList.toggle('fm-in',!!inbound[o.id]);
    cell.classList.toggle('fm-sel',muSelIdx===i);
    cell.setAttribute('aria-label','operator '+(i+1)+', '+(o.isCarrier?'carrier':'modulator')+', '+(o.muted?'off':'on'));
  });
  fmSyncStrip();
}
/* Geometry from col/row PERCENTAGES only, never measured rects: renderMulti runs at boot while no
   module is .active (.mod{display:none}), so getBoundingClientRect is all zeros then — and again on
   every tab switch back. */
function mathsFmDraw(){
  var links=document.getElementById('mathsLinks');if(!links)return;
  var h='';
  multiOscs.forEach(function(o){
    var col=o.p%4,row=(o.p/4)|0;
    (o.fmOut||[]).forEach(function(x){
      if(x.p===o.p+1)h+='<i class="fml fml-h" style="left:'+((col+1)*25)+'%;top:'+((row+0.5)*25)+'%"></i>';
      else h+='<i class="fml fml-v" style="left:'+((col+0.5)*25)+'%;top:'+((row+1)*25)+'%"></i>';
    });
  });
  links.innerHTML=h;
}

/* ── the pointer machine ─────────────────────────────────────────────────────────────────────── */
function fmCellFromPoint(cx,cy){
  var g=mathsGridEl();if(!g)return -1;
  var r=g.getBoundingClientRect();if(r.width<=0||r.height<=0)return -1;
  var c=Math.floor((cx-r.left)/(r.width/4)),w=Math.floor((cy-r.top)/(r.height/4));
  if(c<0||c>3||w<0||w>3)return -1;
  return w*4+c;
}
function fmDown(e){
  if(fmDrag)return;                      // a 4x4 pad grid WILL get two simultaneous touches
  var cell=e.target&&e.target.closest?e.target.closest('.maths-cell'):null;
  var g=mathsGridEl();
  if(!g)return;
  if(!cell){fmBackgroundTap(e);return;}
  /* no synthetic click, so the per-cell handlers are gone and tap comes out of fmUp. That also means
     the document's click-away listener never runs for this gesture — close the menus here. */
  e.preventDefault();
  /* who the menu belonged to must be read BEFORE closing it, or fmUp can never tell "tap the strip
     that is already open" (close) from "tap a different strip" (reopen) */
  var om=document.querySelector('#mathsMenuLayer .mr-menu');
  var wasFor=(om&&om.classList.contains('open'))?om.dataset.idx:null;
  closeRatioMenu();
  Array.prototype.forEach.call(document.querySelectorAll('#modMulti .msel.open'),function(m){m.classList.remove('open');});
  var idx=+cell.dataset.i,cr=cell.getBoundingClientRect();
  fmDrag={id:e.pointerId,idx:idx,el:cell,x:e.clientX,y:e.clientY,moved:false,held:false,tgt:-2,wasFor:wasFor,
    zone:(e.clientY-cr.top)<cr.height/3?'ratio':'body',
    timer:setTimeout(function(){fmHoldFire(idx);},FM_HOLD_MS)};
  cell.classList.add('fm-press');
  try{g.setPointerCapture(e.pointerId);}catch(_){}
}
function fmMove(e){
  var d=fmDrag;if(!d||e.pointerId!==d.id)return;
  var dx=e.clientX-d.x,dy=e.clientY-d.y;
  if(!d.moved&&!d.held&&Math.sqrt(dx*dx+dy*dy)>FM_SLOP){
    d.moved=true;clearTimeout(d.timer);
    d.el.classList.remove('fm-press');d.el.classList.add('fm-drag');
  }
  if(!d.moved)return;
  d.el.style.transform='translate('+dx+'px,'+dy+'px)';
  var t=fmCellFromPoint(e.clientX,e.clientY);
  if(t===d.tgt)return;
  d.tgt=t;
  Array.prototype.forEach.call(mathsGridEl().querySelectorAll('.maths-cell'),function(c){c.classList.remove('fm-drop');});
  if(t>=0){var occ=multiCellAt(t),oc=occ?fmCellOf(occ):null;if(oc&&oc!==d.el)oc.classList.add('fm-drop');}
  fmPreview(t);
}
/* Render the routing AS IT WOULD BE at the hovered cell, so a wrong drop is visible before release.
   The prospective positions are applied, drawn, then rolled back — the rollback deliberately does
   not redraw, which is what leaves the preview on screen. */
function fmPreview(t){
  var d=fmDrag;if(!d)return;
  var op=multiOscs[d.idx];if(!op)return;
  var saved=multiOscs.map(function(o){return o.p;});
  if(t>=0&&t!==op.p){var occ=multiCellAt(t);if(occ)occ.p=op.p;op.p=t;}
  multiComputeEdges();mathsFmDraw();
  multiOscs.forEach(function(o,i){o.p=saved[i];});
  multiComputeEdges();
}
function fmUp(e){
  var d=fmDrag;if(!d||e.pointerId!==d.id)return;
  fmDrag=null;clearTimeout(d.timer);
  var g=mathsGridEl();
  try{g.releasePointerCapture(e.pointerId);}catch(_){}
  d.el.classList.remove('fm-press','fm-drag');
  d.el.style.transform='';
  Array.prototype.forEach.call(g.querySelectorAll('.maths-cell'),function(c){c.classList.remove('fm-drop');});
  if(d.held){renderMulti();return;}                       // the on/off hold already fired
  if(d.moved){fmDrop(d,e.clientX,e.clientY);return;}
  /* the ratio strip answers a tap whether the pad is selected or not, and tapping the SAME strip
     again closes the menu rather than rebuilding it in place */
  if(d.zone==='ratio'){
    if(d.wasFor!==''+d.idx)openRatioMenu(d.idx,d.el.querySelector('.mc-rclick'));
    return;                                 // already open for this pad -> fmDown's close is the toggle
  }
  mathsSetSel(muSelIdx===d.idx?-1:d.idx);                 // tap highlights; tap again releases
}
function fmDrop(d,cx,cy){
  var op=multiOscs[d.idx];if(!op){renderMulti();return;}
  var t=fmCellFromPoint(cx,cy);
  if(t>=0&&t!==op.p){
    var occ=multiCellAt(t);
    if(occ)occ.p=op.p;                                    // occupied -> swap, so the grid never loses a pad
    op.p=t;
    multiRebuildRouting();
  }
  renderMulti();
}

/* ── on/off (hold) and selection (tap) ───────────────────────────────────────────────────────── */
/* the long press is the operator's on/off switch */
function fmHoldFire(idx){
  var d=fmDrag;if(!d||d.idx!==idx||d.moved)return;
  d.held=true;
  if(d.el)d.el.classList.remove('fm-press');
  multiMuteToggle(idx);
}
function mathsSetSel(i){muSelIdx=i;fmSyncSelUI();renderMulti();}
function mathsClearSel(){if(muSelIdx>=0)mathsSetSel(-1);}
/* tapping bare canvas drops the selection, so a highlight is never sticky */
function fmBackgroundTap(e){if(!e.target||!e.target.closest||!e.target.closest('.maths-cell'))mathsClearSel();}
function fmSyncSelUI(){
  var o=muSelIdx>=0?multiOscs[muSelIdx]:null;
  var wrap=document.getElementById('msVolumeWrap'),sel=document.getElementById('mathsWaveSel');
  var lab=document.getElementById('msVolumeLabel'),r=document.getElementById('multiMVolR');
  var wt=document.getElementById('mselWaveText');
  if(wrap)wrap.classList.toggle('fm-sel',!!o);
  if(sel)sel.classList.toggle('fm-sel',!!o);
  if(o){
    /* per-op level means loudness on a carrier and modulation index on a modulator — and which one
       it is flips the moment the pad is dragged, so the label has to follow the role */
    if(lab)lab.textContent=(o.isCarrier?'osc ':'index ')+(muSelIdx+1);
    if(r){r.value=Math.round(o.vol);updateSliderVal('msVolumeVal',r,Math.round(o.vol));}
    if(wt)wt.textContent=o.wv>=0?WN[o.wv]:'AUTO';
  }else{
    if(lab)lab.textContent='volume';
    if(r){r.value=multiMVol;updateSliderVal('msVolumeVal',r,multiMVol);}
    if(wt)wt.textContent=WN[multiWv];
  }
  fmSyncStrip();
}
/* the footer fader is the module's, or the selected operator's */
function mathsVolInput(v){
  if(muSelIdx<0){multiSetMasterVol(v);return;}
  var o=multiOscs[muSelIdx];if(!o)return;
  o.vol=v;o.vFrom=v;o.vProg=0;           // muVolTick skips the selected op, so this actually sticks
  if(o.gain&&AC&&!o.muted&&multiPlaying)o.gain.gain.setTargetAtTime(v2g(v),AC.currentTime,.02);
  multiApplyFmDepth(o);
  updateSliderVal('msVolumeVal',document.getElementById('multiMVolR'),v);
  var cell=fmCellAtIndex(muSelIdx);if(cell)cell.style.setProperty('--v',Math.round(v)+'%');
}
/* Wrapping multiSetWave rather than editing initMselWave keeps the option list, its .active sync and
   the archive path in the inline block untouched. A sine modulator is not a nicety: a saw or square
   modulator contributes every one of its harmonics independently, which at any usable index is
   broadband noise rather than FM. */
function mathsWaveRoute(i){
  if(muSelIdx<0){fmBaseSetWave(i);return;}
  var o=multiOscs[muSelIdx];if(!o)return;
  o.wv=((i%WF.length)+WF.length)%WF.length;
  if(o.osc)o.osc.type=WF[o.wv];
  var t=document.getElementById('mselWaveText');if(t)t.textContent=WN[o.wv];
  Array.prototype.forEach.call(document.querySelectorAll('#mselWaveOpts .msel-opt'),function(x){
    x.classList.toggle('active',+x.dataset.val===o.wv);});
}

/* ── strip: + / −, ROLL POS, FM DEPTH, sweeper scope ─────────────────────────────────────────── */
function fmSyncStrip(){
  var b=document.getElementById('muStripPlus');if(!b)return;
  var sel=muSelIdx>=0;
  b.textContent=sel?'−':'+';
  b.classList.toggle('minus',sel);
  b.setAttribute('aria-disabled',(!sel&&multiOscs.length>=MU_MAX_OPS)?'true':'false');
  b.setAttribute('aria-label',sel?'remove operator':'add operator');
}
function mathsPlusMinus(){
  if(muSelIdx>=0){var i=muSelIdx;mathsSetSel(-1);multiOpRemove(i);return;}
  multiOpAdd(null);
}
/* the graph is a DAG by construction, so this always terminates */
function fmMaxChain(){
  var memo={},max=0;
  function depth(o){
    if(memo[o.id]!=null)return memo[o.id];
    var d=1;(o.fmOut||[]).forEach(function(x){d=Math.max(d,1+depth(x));});
    memo[o.id]=d;return d;
  }
  multiOscs.forEach(function(o){max=Math.max(max,depth(o));});
  return max;
}
/* A uniform draw from the 16 cells very often lands ZERO adjacency — which is just the additive
   module again, so the button would read as broken — or one degenerate deep stack. Score each draw
   and keep the best rather than the first: an unscored fallback would happily ship an edgeless
   layout. The chain cap has to scale, because a 4x4 holds a 7-deep staircase and a fixed cap of 4
   becomes unreachable as soon as the grid fills up. */
function mathsRollPos(){
  if(fmRollPosUndone){fmRollPosUndone=false;return;}      // the press was an undo, not a roll
  var n=multiOscs.length;if(!n)return;
  mathsClearSel();
  fmPrevPos=multiOscs.map(function(o){return o.p;});
  var cap=Math.max(3,Math.ceil(n/2)),best=null,bestScore=-1;
  for(var a=0;a<60;a++){
    var cells=[],i,j,t;
    for(i=0;i<16;i++)cells.push(i);
    for(i=15;i>0;i--){j=Math.floor(Math.random()*(i+1));t=cells[i];cells[i]=cells[j];cells[j]=t;}
    var pick=cells.slice(0,n);
    multiOscs.forEach(function(o,x){o.p=pick[x];});
    var e=multiComputeEdges();
    var score=e>0?(fmMaxChain()<=cap?1000+e:e):0;
    if(score>bestScore){bestScore=score;best=pick.slice();}
    if(score>=1000)break;
  }
  multiOscs.forEach(function(o,x){o.p=best[x];});
  multiRebuildRouting();
  renderMulti();
}
/* there is no undo anywhere else in this app, and a bad roll or a mis-drop destroys a patch */
function mathsRollPosUndo(){
  if(!fmPrevPos||fmPrevPos.length!==multiOscs.length)return;
  multiOscs.forEach(function(o,i){o.p=fmPrevPos[i];});
  multiRebuildRouting();renderMulti();
}
function fmBindRollPosUndo(){
  var b=document.getElementById('muRollPos');if(!b)return;
  var tm=null;
  b.addEventListener('pointerdown',function(){
    tm=setTimeout(function(){tm=null;fmRollPosUndone=true;mathsRollPosUndo();},FM_HOLD_MS);});
  ['pointerup','pointercancel','pointerleave'].forEach(function(ev){
    b.addEventListener(ev,function(){if(tm){clearTimeout(tm);tm=null;}});});
}
function mathsSetFmDepth(v){
  multiFmDepth=Math.max(0,Math.min(100,v));
  multiAutoLast=null;multiAutoRecalc();      // the clipping headroom tracks depth
  updateSliderVal('msFmDepthVal',document.getElementById('multiFmDepthR'),Math.round(multiFmDepth));
  /* multiSweepTick is not a heartbeat — it stops between sweeps, so without an explicit pass the
     slider would look dead until the next ROLL */
  multiApplyFmDepthAll();
}
function mathsToggleVolScope(){
  muVolCarriersOnly=!muVolCarriersOnly;
  var b=document.getElementById('mVolCarBtn');
  if(b){b.classList.toggle('on',muVolCarriersOnly);b.textContent=muVolCarriersOnly?'ON':'OFF';}
}
function mathsFmSyncUI(){
  var d=document.getElementById('multiFmDepthR');
  if(d){d.value=multiFmDepth;updateSliderVal('msFmDepthVal',d,Math.round(multiFmDepth));}
  var vc=document.getElementById('mVolCarBtn');
  if(vc){vc.classList.toggle('on',muVolCarriersOnly);vc.textContent=muVolCarriersOnly?'ON':'OFF';}
}

function mathsFmMount(){
  var g=mathsGridEl();if(!g)return;
  g.addEventListener('pointerdown',fmDown);
  g.addEventListener('pointermove',fmMove);
  g.addEventListener('pointerup',fmUp);
  g.addEventListener('pointercancel',fmUp);
  /* Android raises its context menu at ~500ms and CANCELS the pointer stream with it, which would
     put a 1s hold out of reach on most phones. */
  g.addEventListener('contextmenu',function(e){e.preventDefault();});
  if(typeof multiSetWave==='function'&&!fmBaseSetWave){fmBaseSetWave=multiSetWave;multiSetWave=mathsWaveRoute;}
  fmBindRollPosUndo();
  mathsFmSyncUI();
  renderMulti();
}
document.addEventListener('DOMContentLoaded',mathsFmMount);
