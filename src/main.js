import './style.css';
import {World} from './world/scene.js';
import {Sound} from './audio.js';
import {Hud} from './hud.js';
import * as UI from './ui.js';
import {loadSettings,saveSettings} from './settings.js';
import {Room} from '../shared/room.mjs';
import {BUILD,SEASONS,CHARACTERS,COSMETICS,MAPS,RULES,seasonFor} from '../shared/content.mjs';
import {clamp,moveBody,peltAt,sweptHit,makePelt,rateFor,onIce,flightEnd} from '../shared/physics.mjs';
import {relativeMove,driveVelocity,diveSpeed,slideSpeed,cameraBasis} from '../shared/controller.mjs';
import {RemoteTrack,CODE,safeName,flagsOf} from '../shared/protocol.mjs';
import {connect,api,profileToken} from './network.js';
import * as Acct from './account.js';
import {LATEST} from './updates.js';

const $=s=>document.querySelector(s),app=$('#app'),hudRoot=$('#hud-root'),canvas=$('#world');
const params=new URLSearchParams(location.search),token=profileToken(),testMode=params.get('test')==='1',touch=matchMedia('(pointer: coarse)').matches||params.has('touch');
const settings=loadSettings(),sound=new Sound();sound.setVolumes(settings);sound.muted=settings.muted;
if(params.has('debug'))settings.showFps=true;

/* ------------------------------------------------------------------ profile */
function loadProfile(){
  let s={};try{s=JSON.parse(localStorage.getItem('pelt-profile')||'{}')||{};}catch{}
  const list=(v,base)=>Array.isArray(v)?[...new Set([...base,...v.filter(x=>typeof x==='string')])]:base;
  return {name:safeName(s.name)||`Sprout ${token.slice(0,3).toUpperCase()}`,character:CHARACTERS.some(c=>c.id===s.character)?s.character:'pip',hat:COSMETICS.some(c=>c.id===s.hat)?s.hat:'beanie',
    coins:Number.isFinite(s.coins)?Math.max(0,Math.floor(s.coins)):60,owned:list(s.owned,['none','beanie']),ownedChars:list(s.ownedChars,CHARACTERS.filter(c=>!c.price).map(c=>c.id)),
    xp:Number.isFinite(s.xp)?Math.max(0,s.xp):0,matches:s.matches|0,wins:s.wins|0,splats:s.splats|0,last:{map:'commons',mode:'ffa',size:8,difficulty:'regular',...(s.last||{})}};
}
// Guest progress lives on this device; a signed-in profile mirrors the server's view.
const guest=loadProfile();let profile=guest;
const persist=()=>{if(profile!==guest)guest.last=profile.last;try{localStorage.setItem('pelt-profile',JSON.stringify(guest));}catch{toast('Progress cannot be saved in this browser session.');}};
function useAccount(view){
  if(!view){profile=guest;return;}
  profile={...guest,name:view.display,character:view.character,hat:view.hat,coins:view.coins,owned:view.owned,ownedChars:view.ownedChars,xp:view.xp,matches:view.life?.matches|0,wins:view.life?.wins|0,splats:view.life?.splats|0,last:profile.last||guest.last,account:view.username};
}
useAccount(Acct.session.view);
function toast(text){const t=$('#toast');t.textContent=text;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3600);}

/* -------------------------------------------------------------------- world */
let season=seasonFor(new Date(params.get('date')||Date.now()),params.get('season')),world;
try{world=new World(canvas,settings);}catch(error){app.innerHTML='<main class="unsupported"><h1>Need a little more graphics power</h1><p>Pelt Party needs WebGL. Try Chrome, Edge, Firefox or Safari with hardware acceleration turned on.</p><button onclick="location.reload()">Try again</button></main>';throw error;}

/* ------------------------------------------------------------ session state */
let screen='menu',panel=null,lockerTab='characters',settingsTab='graphics',demo=null,room=null,wire=null,state=null,mySlot=-1,status='local',hud=null,paused=false,soloTime=0,phaseSeen='',results=null;
let local=null,tracks=new Map(),poses=new Map(),hitSent=new Map(),keys=new Set(),aim={x:0,z:0,y:0},chargeAt=0,chargeReadyPlayed=false,aiming=false,lastShot=0,shotCounter=0,lastSnap=0,scoopOn=false,crouchToggle=false,sprintToggle=false,wasDead=false,killer=null,frenzyOn=false,boardOn=false,hintUntil=0,fps=0,frames=0,fpsAt=0,lastFrame=performance.now(),lastRender=0,pendingOnline=false;
let moveStick={x:0,y:0},padPrev=[],winners=new Set();
const now=()=>room?soloTime:wire?wire.now():Date.now();
const me=()=>state?.players.find(p=>p.slot===mySlot);
const limitFor=(mode,n)=>mode==='ffa'?Math.min(25,10+n):mode==='king'?120:Math.min(60,15+2*n);

/* --------------------------------------------------------------- menu demo */
function startDemo(){
  const ids=MAPS.map(m=>m.id),map=ids[Math.floor(Math.random()*ids.length)],t=Date.now();
  demo=new Room({season,map,now:t,emit:m=>{if(m.t!=='fx'||screen==='play')return;world.fx(m);if(m.kind==='splat'&&demo){const v=demo.players.find(p=>p.slot===m.slot),k=demo.players.find(p=>p.slot===m.by);if(v)world.ragdoll(m.slot,v,k);}}});demo.botsTo(8,t,'regular');demo.start(t-4000);demo.step(t);
  world.clearActors();world.sync(demo,-1);world.cameraReady=false;world.hero(profile);
}
const seenUpdate=()=>{try{return localStorage.getItem('pelt-seen-update')===LATEST.version;}catch{return true;}};
const menuHtml=()=>UI.menu({profile,season,muted:settings.muted,badge:Acct.claimable(Acct.session.view),unseen:!seenUpdate()});
function refreshMenu(){if(screen==='menu'&&!panel)app.innerHTML=menuHtml();}
function showMenu(){
  screen='menu';panel=null;document.body.className=`menu-screen s-${season}`;hudRoot.innerHTML='';hud=null;
  if(!demo||demo.season!==season)startDemo();world.mode='menu';world.hero(profile);
  app.innerHTML=menuHtml();sound.music('menu',season);
}
function openPanel(kind){
  panel=kind;document.exitPointerLock?.();$('#panel')?.remove();const wrap=document.createElement('div');wrap.id='panel';
  if(kind==='play')wrap.innerHTML=UI.playSetup(profile.last);
  if(kind==='join')wrap.innerHTML=UI.joinPanel(profile.name);
  if(kind==='settings')wrap.innerHTML=UI.settingsPanel(settings,settingsTab,{hz:refreshHz()});
  if(kind==='how')wrap.innerHTML=UI.howPanel(touch);
  if(kind==='vault')wrap.innerHTML=UI.vaultPanel(season);
  if(kind==='updates'){wrap.innerHTML=UI.updatesPanel();try{localStorage.setItem('pelt-seen-update',LATEST.version);}catch{}}
  if(kind==='pause')wrap.innerHTML=UI.pausePanel();
  if(kind==='error')wrap.innerHTML=UI.errorPanel(openPanel.error||'Something went wrong.');
  if(kind==='account')wrap.innerHTML=UI.accountPanel({mode:openPanel.mode||'login',view:Acct.signedIn()?Acct.session.view:null});
  if(kind==='challenges')wrap.innerHTML=UI.challengesPanel(Acct.signedIn()?Acct.session.view:null);
  if(kind==='leaderboard'){wrap.innerHTML=UI.leaderboardPanel(null,null,profile.account&&profile.name);Acct.leaderboard().then(rows=>{if(panel==='leaderboard')$('#panel').innerHTML=UI.leaderboardPanel(rows,null,profile.account&&profile.name);}).catch(e=>{if(panel==='leaderboard')$('#panel').innerHTML=UI.leaderboardPanel(null,e.message,profile.account&&profile.name);});}
  if(kind==='locker'){wrap.innerHTML=UI.locker(profile,lockerTab);world.mode='hero';world.hero(profile);document.body.classList.add('locker-open');}
  app.append(wrap);wrap.querySelector('input:not([type=range]):not([type=checkbox])')?.focus();
}
function closePanel(){
  const was=panel;panel=null;$('#panel')?.remove();
  if(was==='locker'){document.body.classList.remove('locker-open');commitName();world.mode=screen==='play'?'play':'menu';}
  if(['locker','account','challenges','updates'].includes(was))refreshMenu();
  if(screen==='play'&&state?.phase!=='results'){paused=false;if(!touch)lockPointer();}
}
function commitName(){if(profile.account)return true;const input=$('#name');if(!input)return true;const n=safeName(input.value);if(!n){toast('Pick a nickname with letters and numbers.');return false;}profile.name=n;persist();return true;}

/* ------------------------------------------------------------ match control */
function resetSession(){
  document.exitPointerLock?.();wire?.close();wire=null;room=null;state=null;local=null;mySlot=-1;tracks.clear();poses.clear();hitSent.clear();keys.clear();
  chargeAt=0;aiming=false;scoopOn=false;crouchToggle=false;paused=false;phaseSeen='';results=null;frenzyOn=false;wasDead=false;winners=new Set();hudRoot.innerHTML='';hud=null;
  try{sessionStorage.removeItem('pelt-room');}catch{}
}
function stop(){resetSession();world.clearActors();history.replaceState(null,'',location.pathname+location.search.replace(/([?&])room=[^&]*(&?)/,'$1').replace(/[?&]$/,''));}
function startSolo(size=8,difficulty='regular',map='commons',mode='ffa'){
  stop();demo=null;status='local';soloTime=Date.now();mySlot=0;
  room=new Room({season,map,now:soloTime,emit:onEvent});room.mode=mode;room.join({name:profile.name,character:profile.character,hat:profile.hat},soloTime);
  room.start(soloTime,{fill:true,size,difficulty});state=room;enterMatch();history.pushState({match:true},'',location.href);
}
function openRoom(code,watch=false){
  stop();screen='connecting';status='connecting';document.body.className=`lobby-screen s-${season}`;app.innerHTML=UI.connecting(code);
  try{sessionStorage.setItem('pelt-room',JSON.stringify({code,watch}));}catch{}
  wire=connect({code,name:profile.name,character:profile.character,hat:profile.hat,watch,token,accountToken:Acct.session.token,onMessage:onEvent,onStatus:s=>{status=s;},onError:e=>{openPanel.error=e;openPanel('error');}});
  history.pushState({match:true},'',`?room=${code}`);
}
function enterMatch(){
  screen='play';panel=null;document.body.className=`play-screen s-${season} ${touch?'touch':''}`;app.innerHTML='';
  world.hero(null);world.clearActors();world.sync(state,mySlot);world.mode=me()?.spectator?'menu':'play';
  const p=me();if(p){local={x:p.x,z:p.z,vx:0,vz:0,facing:p.facing||0,crouch:false,diveStart:0,diveDir:{x:0,z:1},slideStart:0,slideDir:{x:0,z:1},kx:0,kz:0};world.resetCombat(local);}
  hud=new Hud(hudRoot,{touch});hud.setMap(state.map,season,SEASONS[state.season||season].ammo);if(touch){hudRoot.insertAdjacentHTML('beforeend',UI.touchControls());bindTouch();}
  hintUntil=settings.hints&&profile.matches<3?Date.now()+42000:0;sound.music('battle',state.season||season);sound.intensity(0);
  if(!touch&&!testMode)setTimeout(()=>{if(screen==='play'&&!panel)toast('Click to lock the mouse · ESC to pause');},400);
}
function showLobby(){
  screen='lobby';document.body.className=`lobby-screen s-${season}`;hudRoot.innerHTML='';hud=null;world.mode='menu';world.sync(state,mySlot);
  app.innerHTML=UI.lobby(state,mySlot,{copyText:'COPY INVITE'});sound.music('menu',season);
}
function phaseChanged(){
  const ph=state.phase;if(ph===phaseSeen)return;const prev=phaseSeen;phaseSeen=ph;
  if(ph==='lobby'){showLobby();return;}
  if((ph==='starting'||ph==='playing')&&screen!=='play'){enterMatch();}
  if(ph==='starting'){for(let i=3;i>=1;i--)setTimeout(()=>{if(state?.phase==='starting')sound.play('tick');},Math.max(0,state.startAt-now()-i*1000));}
  if(ph==='playing'&&prev==='starting')sound.play('go');
  if(ph==='results')finishMatch();
}
function finishMatch(){
  document.exitPointerLock?.();chargeAt=0;aiming=false;
  const mine=state.results.find(r=>r.slot===mySlot),first=state.results.filter(r=>r.place===1).map(r=>r.slot);winners=new Set(first);
  const key=`${state.code}-${state.round}-${state.startAt}`;let coins=0,xp=0;
  const fresh=mine&&results!==key;let note='';
  if(fresh&&!profile.account){results=key;coins=mine.coins;xp=25+mine.score*12+(mine.place===1?40:0);profile.coins+=coins;profile.xp+=xp;profile.matches++;profile.splats+=mine.score;if(mine.place===1&&!mine.draw)profile.wins++;persist();note='Playing as a guest. <button class="link" data-action="account">Sign up</button> to save progress and earn challenge rewards.';}
  if(fresh&&profile.account){results=key;coins='…';xp='…';note='Saving to your account…';settleAccount(mine,key);}
  sound.music(null);sound.play(mine?.place===1?'win':'lose');
  document.body.classList.add('results-screen');const wrap=document.createElement('div');wrap.id='results';wrap.innerHTML=UI.results(state,mySlot,{coins,xp,solo:!!room,note});app.append(wrap);
}

// Signed-in rewards come from the server: solo reports are capped, online results arrive from the room itself.
async function settleAccount(mine,key){
  const show=(coins,xp,note)=>{const c=$('#earn-coins'),x=$('#earn-xp'),n=$('#earn-note');if(c)c.textContent=coins;if(x)x.textContent=xp;if(n)n.innerHTML=note;};
  const before=Acct.claimable(Acct.session.view);
  try{
    let earned;
    if(room){const n=state.active.length;const r=await Acct.reportMatch({...mine.stat,place:mine.place,win:mine.place===1&&!mine.draw,draw:mine.draw,players:n});earned=r.earned;}
    else{const want=`${state.code}:${state.round}:${state.startAt}`;for(let i=0;i<6;i++){await new Promise(r=>setTimeout(r,900));const r=await Acct.refresh();if(r.profile.lastAward?.key===want){earned=r.profile.lastAward;break;}}}
    useAccount(Acct.session.view);const ready=Acct.claimable(Acct.session.view);
    if(!earned){show(0,0,'Saved. Rewards will appear on your account shortly.');return;}
    const extra=earned.skipped==='too-soon'?'Bot matches less than a minute apart don’t pay out.':earned.coins===0&&room?'Daily bot-match coin cap reached — online matches still pay.':'';
    show(earned.coins,earned.xp,`${earned.levels?`<b>LEVEL UP!</b> +◈${earned.levels*50} · `:''}Saved to @${UI.esc(profile.name)}. ${ready>before?`<button class="link" data-action="challenges">${ready} reward${ready>1?'s':''} ready to claim ▸</button>`:''} ${extra}`);
    if(earned.levels)sound.play('callout');
  }catch(e){show(0,0,UI.esc(e.message));}
}

/* ------------------------------------------------------------- net events */
function onEvent(m){
  if(m.t==='welcome')mySlot=m.slot;
  if(m.t==='state'||m.t==='welcome'){
    if(!room){const roundChanged=!state||state.round!==m.round;state=m;season=m.season||season;if(roundChanged){tracks.clear();hitSent.clear();lastSnap=0;if(screen==='play')world.clearActors();}
      world.sync(state,mySlot);const p=me();if(p&&(roundChanged||!local||m.t==='welcome')&&state.phase!=='lobby'){local={x:p.x,z:p.z,vx:0,vz:0,facing:p.facing||0,crouch:false,diveStart:0,diveDir:{x:0,z:1},slideStart:0,slideDir:{x:0,z:1},kx:0,kz:0};world.resetCombat(local);}
      if(screen==='lobby'&&state.phase==='lobby'&&!panel)app.innerHTML=UI.lobby(state,mySlot,{copyText:'COPY INVITE'});}
    else if(!state)return;else world.sync(state,mySlot);
    phaseChanged();return;
  }
  if(!state||m.round!==undefined&&m.round!==state.round)return;
  if(m.t==='world'){if(room)return;for(const p of m.players){if(p.slot===mySlot)continue;let tr=tracks.get(p.slot);if(!tr){tr=new RemoteTrack();tracks.set(p.slot,tr);}tr.push(p,m.now,now(),rateFor(state.players.length));const sp=state.players.find(q=>q.slot===p.slot);if(sp)sp.crouch=!!(p.flags&4);}return;}
  if(m.t==='stats'){if(!room){const p=state.players.find(p=>p.slot===m.player.slot);if(p)Object.assign(p,m.player);}return;}
  if(m.t==='throw'){if(!room){if(m.clientId)state.pelts=state.pelts.filter(p=>p.id!==m.clientId);if(!state.pelts.some(p=>p.id===m.pelt.id))state.pelts.push(m.pelt);}
    if(m.pelt.by!==mySlot){world.animate(m.pelt.by,'throw',320);sound.play(m.pelt.charge?'charged':'throw',{pan:panOf(m.pelt.x,m.pelt.z),vol:volOf(m.pelt.x,m.pelt.z)*.8});}return;}
  if(m.t==='remove'){if(!room)state.pelts=state.pelts.filter(p=>p.id!==m.id);return;}
  if(m.t==='pads'){if(!room)state.pads=m.pads;return;}
  if(m.t==='forts'){if(!room)state.forts=m.forts;return;}
  if(m.t==='correct'&&m.slot===mySlot&&local){local.x=m.x;local.z=m.z;return;}
  if(m.t==='fx')onFx(m);
}
function onFx(m){
  world.fx(m);const pan=panOf(m.x,m.z),vol=volOf(m.x,m.z),by=state.players.find(p=>p.slot===m.by),victim=state.players.find(p=>p.slot===m.slot);
  switch(m.kind){
    case 'impact':sound.play('impact',{pan,vol});break;
    case 'thud':sound.play('thud',{pan,vol});break;
    case 'burst':sound.play('burst',{pan,vol});if(vol>.7)world.hurt(.12);break;
    case 'break':sound.play('break',{pan,vol});break;
    case 'build':sound.play('build',{pan,vol});world.animate(m.slot,'build',350);break;
    case 'dive':if(m.slot!==mySlot)sound.play('dive',{pan,vol:vol*.7});break;
    case 'slide':if(m.slot!==mySlot)sound.play('slide',{pan,vol:vol*.6});break;
    case 'dodge':if(m.slot===mySlot){sound.play('dodge');hud?.callout('DODGED!');}break;
    case 'block':sound.play('block',{pan,vol});break;
    case 'power':sound.play('power',{pan,vol});if(m.slot===mySlot)hud?.callout(({triple:'TRIPLE TOSS',shield:'SNOW SHIELD',heal:'HOT COCOA',giga:'GIGA BALL',rush:'SUGAR RUSH'})[m.power]||'POWER UP');break;
    case 'spawn':if(m.slot===mySlot)sound.play('spawn');break;
    case 'nobuild':if(m.slot===mySlot){sound.play('empty');hud?.callout('NO ROOM HERE');}break;
    case 'hit':
      world.animate(m.slot,'hit',300);
      if(m.by===mySlot){hud?.hitmarker(false);sound.play('hitConfirm');}
      if(m.slot===mySlot){sound.play('hurt');world.hurt(.3);if(local){local.kx=(m.dx||0)*6;local.kz=(m.dz||0)*6;}const b=cameraBasis(world.yaw),ang=Math.atan2(-(m.dx||0)*b.rx-(m.dz||0)*b.rz,-(m.dx||0)*b.fx-(m.dz||0)*b.fz);hud?.damage(ang);}
      else if(m.by!==mySlot)sound.play('impact',{pan,vol});break;
    case 'splat':
      world.ragdoll(m.slot,poses.get(m.slot)||{x:m.x,z:m.z},poses.get(m.by)||by);
      hud?.killfeed(by,victim,m.by===mySlot||m.slot===mySlot);
      if(m.by===mySlot){hud?.hitmarker(true);sound.play('splat');world.freeze(settings.shake?70:0);world.impulse(.12);for(const c of m.calls||[])setTimeout(()=>{hud?.callout(c,true);sound.play('callout');},120);if(!(m.calls||[]).length)hud?.callout(`SPLATTED ${String(victim?.name||'').toUpperCase()}`);}
      else if(m.slot===mySlot){sound.play('splatted');killer=by?{name:by.name,character:by.character,streak:m.streak||by.streak||0,hp:by.hp}:null;world.hurt(.5);world.freeze(settings.shake?120:0);}
      else sound.play('impact',{pan,vol:vol*.8});break;
  }
}
function panOf(x,z){if(!Number.isFinite(x))return 0;const b=cameraBasis(world.yaw),c=world.camera.position;return clamp(((x-c.x)*b.rx+(z-c.z)*b.rz)/12,-1,1);}
function volOf(x,z){if(!Number.isFinite(x))return 1;const c=world.camera.position;return clamp(1.25-Math.hypot(x-c.x,z-c.z)/30,.15,1);}

/* ------------------------------------------------------------------ actions */
function send(m){if(!state)return;const msg={...m,r:state.round};if(room)room.command(mySlot,msg,now());else wire?.send(msg);}
async function action(a,el){
  if(a==='close'){closePanel();return;}
  if(a==='account'||a==='challenges'||a==='leaderboard'){if(screen==='play'&&state?.phase!=='results'&&a!=='challenges')return;openPanel(a);if(a==='challenges'&&Acct.signedIn())Acct.refresh().then(()=>{useAccount(Acct.session.view);if(panel==='challenges')openPanel('challenges');}).catch(()=>{});return;}
  if(a.startsWith('acct-mode:')){openPanel.mode=a.split(':')[1];openPanel('account');return;}
  if(a==='acct-login'||a==='acct-register'){
    const u=$('#acct-user')?.value.trim(),pw=$('#acct-pass')?.value||'';if(a==='acct-register'&&pw!==$('#acct-pass2')?.value){toast('Passwords don’t match.');return;}
    try{const r=a==='acct-register'?await Acct.register(u,pw):await Acct.login(u,pw);useAccount(r.profile);sound.play('power');toast(a==='acct-register'?`Welcome, ${r.profile.display}! ◈150 to get you started.`:`Welcome back, ${r.profile.display}!`);closePanel();world.hero(profile);refreshMenu();}
    catch(e){toast(e.message);sound.play('empty');}return;}
  if(a==='acct-logout'){await Acct.logout();useAccount(null);closePanel();world.hero(profile);refreshMenu();toast('Logged out. Playing as a guest.');return;}
  if(a==='acct-password'){try{await Acct.changePassword($('#pw-current').value,$('#pw-next').value);toast('Password updated. Other devices were signed out.');openPanel('account');}catch(e){toast(e.message);}return;}
  if(a.startsWith('claim:')){const id=a.slice(6);el&&(el.disabled=true);try{const r=await Acct.claim(id);useAccount(r.profile);sound.play('power');toast(`+◈${r.claimed.coins}${r.claimed.xp?` · +${r.claimed.xp} XP`:''}${r.claimed.hat?' · new hat unlocked!':''}${r.claimed.levels?' · LEVEL UP!':''}`);if(panel==='challenges')openPanel('challenges');}catch(e){toast(e.message);if(el)el.disabled=false;}return;}
  if(a==='updates'){openPanel('updates');return;}
  if(['join','settings','how','vault','locker'].includes(a)){if(a==='locker'&&screen!=='menu')return;openPanel(a);return;}
  if(a==='play'){openPanel('play');return;}
  if(a==='pause'){openPanel('pause');paused=!!room;return;}
  if(a==='resume'){closePanel();return;}
  if(a==='mute'){settings.muted=!settings.muted;sound.setMuted(settings.muted);saveSettings(settings);if(screen==='menu'&&!panel)app.innerHTML=menuHtml();return;}
  if(a==='start-solo'){const pick=k=>$(`[data-seg="${k}"] .on`)?.dataset.value;const map=$('.map-card.on')?.dataset.map||'commons';profile.last={map,mode:pick('mode')||'ffa',size:+(pick('size')||8),difficulty:pick('difficulty')||'regular'};persist();startSolo(profile.last.size,profile.last.difficulty,map,profile.last.mode);return;}
  if(a==='create'||a==='quick'){if(pendingOnline)return;pendingOnline=true;toast(a==='quick'?'Finding a match…':'Making a room…');try{const r=await api(a==='quick'?'/api/quick':'/api/rooms',{token,season});openRoom(r.code);}catch(e){toast(e.message);}finally{pendingOnline=false;}return;}
  if(a==='join-room'){if(!commitName())return;const code=$('#code').value.trim().toUpperCase();if(!CODE.test(code)){toast('Use the 4-character code your friend sees.');return;}openRoom(code,$('#watch').checked);return;}
  if(a==='copy'){try{await navigator.clipboard.writeText(`${location.origin}/?room=${state.code}`);toast('Invite link copied!');}catch{toast(`Room code: ${state.code}`);}return;}
  if(a==='start'){send({t:'start'});return;}
  if(a==='ready'){send({t:'ready',on:!me()?.ready});return;}
  if(a==='fill'){send({t:'fill'});return;}
  if(a==='confirm-leave'){stop();$('#results')?.remove();$('#panel')?.remove();panel=null;showMenu();return;}
  if(a==='rematch'){const l=profile.last;startSolo(room?.active.length||l.size,room?.difficulty||l.difficulty,room?.mapId||l.map,room?.mode||l.mode);return;}
  if(a.startsWith('season:')){season=a.split(':')[1];closePanel();demo=null;showMenu();return;}
  if(a.startsWith('tab:')){commitName();lockerTab=a.split(':')[1];openPanel('locker');return;}
  if(a.startsWith('stab:')){settingsTab=a.split(':')[1];openPanel('settings');return;}
  if(profile.account&&(a.startsWith('character:')||a.startsWith('hat:'))){
    const [kind,id]=a.split(':'),owned=kind==='character'?profile.ownedChars.includes(id):profile.owned.includes(id);
    try{if(!owned){await Acct.buy(kind,id);const item=(kind==='character'?CHARACTERS:COSMETICS).find(c=>c.id===id);sound.play('power');toast(`Unlocked ${item.name}!`);}
      const r=await Acct.equip(kind==='character'?{character:id}:{hat:id});useAccount(r.profile);}catch(e){toast(e.message);}openPanel('locker');return;}
  if(a.startsWith('character:')){const id=a.split(':')[1],c=CHARACTERS.find(c=>c.id===id);if(!profile.ownedChars.includes(id)){if(profile.coins<c.price){toast(`Need ◈ ${c.price-profile.coins} more coins. Play a few matches!`);return;}profile.coins-=c.price;profile.ownedChars.push(id);sound.play('power');toast(`Unlocked ${c.name}!`);}commitName();profile.character=id;persist();openPanel('locker');return;}
  if(a.startsWith('hat:')){const id=a.split(':')[1],c=COSMETICS.find(c=>c.id===id);if(!profile.owned.includes(id)){if(profile.coins<c.price){toast(`Need ◈ ${c.price-profile.coins} more coins.`);return;}profile.coins-=c.price;profile.owned.push(id);sound.play('power');toast(`Unlocked ${c.name}!`);}commitName();profile.hat=id;persist();openPanel('locker');return;}
}
app.addEventListener('click',e=>{
  sound.unlock();
  const segBtn=e.target.closest('[data-seg] button');if(segBtn){const group=segBtn.parentElement;group.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===segBtn));sound.play('tap');onSeg(group.dataset.seg,segBtn.dataset.value);return;}
  const card=e.target.closest('[data-map]');if(card){app.querySelectorAll('[data-map]').forEach(b=>b.classList.toggle('on',b===card));sound.play('tap');return;}
  const el=e.target.closest('[data-action]');if(el){e.preventDefault();sound.play('tap');action(el.dataset.action,el);return;}
  if(e.target.dataset?.close&&panel!=='pause')closePanel();
});
app.addEventListener('pointerover',e=>{if(e.target.closest?.('button')&&e.pointerType==='mouse')sound.play('hover');});
function onSeg(name,value){
  if(name==='lobby-map'){send({t:'settings',map:value});return;}if(name==='lobby-mode'){send({t:'settings',mode:value});return;}
  if(name==='quality'||name==='fpsCap'){settings[name]=name==='fpsCap'?+value:value;applySettings();}
}
app.addEventListener('input',e=>{
  const id=e.target.id;if(!id?.startsWith('set-'))return;const key=id.slice(4),el=e.target;
  settings[key]=el.type==='checkbox'?el.checked:+el.value;const out=el.parentElement.querySelector('output');if(out)out.textContent=key==='renderScale'?`${Math.round(el.value*100)}%`:key==='fov'?`${el.value}°`:['master','music','sfx'].includes(key)?Math.round(el.value*100):Number(el.value).toFixed(2);
  applySettings();
});
function applySettings(){saveSettings(settings);sound.setVolumes(settings);if(sound.muted!==settings.muted)sound.setMuted(settings.muted);world.applySettings(settings);}

/* -------------------------------------------------------------------- input */
function lockPointer(){if(touch||document.pointerLockElement===canvas)return;try{const r=canvas.requestPointerLock?.({unadjustedMovement:true});r?.catch?.(()=>{try{canvas.requestPointerLock()?.catch?.(()=>{});}catch{}});}catch{}}
const playing=()=>screen==='play'&&state?.phase==='playing'&&!panel&&!paused;
addEventListener('keydown',e=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)){if(e.code==='Enter'&&panel==='join')action('join-room');return;}
  if(e.code==='Escape'){if(panel&&panel!=='pause')closePanel();else if(screen==='play'&&state?.phase!=='results'){if(panel==='pause')closePanel();else action('pause');}return;}
  if(screen!=='play')return;
  if(['Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  if(e.code==='Tab'){hud?.showBoard(true);return;}
  keys.add(e.code);if(e.repeat||!playing())return;
  if(e.code==='Space')dive();
  if(e.code==='KeyC'||e.code==='ControlLeft'){if(!trySlide()&&settings.toggleCrouch)crouchToggle=!crouchToggle;}
  if(e.code==='KeyQ')build();
  if(e.code==='KeyR')setScoop(true);
  if((e.code==='ShiftLeft'||e.code==='ShiftRight')&&settings.toggleSprint)sprintToggle=!sprintToggle;
});
addEventListener('keyup',e=>{keys.delete(e.code);if(e.code==='Tab')hud?.showBoard(false);if(e.code==='KeyR')setScoop(false);});
addEventListener('blur',()=>{keys.clear();moveStick={x:0,y:0};chargeAt=0;aiming=false;setScoop(false);});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement&&playing()&&!testMode){chargeAt=0;aiming=false;openPanel('pause');paused=!!room;}});
addEventListener('mousemove',e=>{if(screen!=='play'||panel||document.pointerLockElement!==canvas)return;const k=.0022*settings.sens*(aiming?settings.aimSens:1);world.look(e.movementX*k,e.movementY*k*(settings.invertY?-1:1));});
canvas.addEventListener('mousedown',e=>{sound.unlock();if(screen!=='play'||panel||touch)return;if(document.pointerLockElement!==canvas&&!testMode){lockPointer();return;}if(!playing())return;if(e.button===0)startCharge();if(e.button===2)aiming=true;});
addEventListener('mouseup',e=>{if(touch)return;if(e.button===0&&chargeAt)release();if(e.button===2)aiming=false;});
addEventListener('popstate',()=>{if(state){history.pushState({match:true},'',location.href);if(screen==='play')action('pause');}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();chargeAt=0;setScoop(false);if(room&&screen==='play'&&!panel)openPanel('pause'),paused=true;}});

function startCharge(){const p=me();if(!p||p.respawnAt)return;if(p.ammo<=0){sound.play('empty');hud?.callout('NO AMMO · HOLD R');return;}chargeAt=performance.now();chargeReadyPlayed=false;}
function chargeLevel(){return chargeAt?(performance.now()-chargeAt)/RULES.chargeTime:0;}
function release(){
  const p=me(),level=chargeLevel();chargeAt=0;if(!p||!playing()||p.respawnAt||!local)return;
  const t=now(),charged=level>=1,cost=charged?(p.giga?0:state.endAt-t<=RULES.frenzy?1:2):1;
  if(t<(local.diveStart||0)+RULES.diveMove)return;
  if(p.ammo<cost){if(charged&&p.ammo>0)return throwAt(false,t,p);sound.play('empty');return;}
  if(t-lastShot<(charged?RULES.chargedCooldown:RULES.throwCooldown))return;
  throwAt(charged,t,p);
}
function throwAt(charged,t,p){
  lastShot=t;const id=`pred-${++shotCounter}`;world.animate(mySlot,'throw',320);world.impulse(charged?.16:.06);sound.play(charged?'charged':'throw');
  setScoop(false);local.crouch=false;
  if(!room){p.ammo=Math.max(0,p.ammo-(charged?(p.giga?0:2):1));state.pelts.push(makePelt(id,mySlot,local,aim,charged,t));}
  send({t:'throw',id,x:aim.x,z:aim.z,y:aim.y,charge:charged});
}
function moveInput(){
  let x=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+moveStick.x,z=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0)+moveStick.y;
  const gp=pad();if(gp){if(Math.abs(gp.axes[0])>.15)x=gp.axes[0];if(Math.abs(gp.axes[1])>.15)z=gp.axes[1];}
  return {x,z};
}
function dive(){
  const p=me(),t=now();if(!p||!local||!playing()||p.respawnAt)return;const rush=(p.rushUntil||0)>t;
  if(!rush&&(p.dives||0)<1)return;if(t<local.diveStart+RULES.diveMove)return;
  const i=moveInput(),d=Math.hypot(i.x,i.z);let dir=d>.2?relativeMove(i.x,-i.z,world.yaw):(()=>{const b=cameraBasis(world.yaw);return {x:b.fx,z:b.fz};})();const n=Math.hypot(dir.x,dir.z)||1;dir={x:dir.x/n,z:dir.z/n};
  local.diveStart=t;local.diveDir=dir;local.slideStart=0;chargeAt=0;setScoop(false);
  const b=cameraBasis(world.yaw);local.diveSide=Math.sign(dir.x*b.rx+dir.z*b.rz)||0;
  if(!room&&!rush){p.dives--;}
  send({t:'dive',x:dir.x,z:dir.z});world.animate(mySlot,'dive',RULES.diveMove);sound.play('dive');world.fx({kind:'dive',x:local.x,z:local.z});
}
function trySlide(){
  const p=me(),t=now();if(!p||!local||!playing()||t<(p.slideReady||0)||t<local.diveStart+RULES.diveMove)return false;
  const speed=Math.hypot(local.vx,local.vz);if(speed<RULES.run+.4)return false;
  local.slideStart=t;local.slideDir={x:local.vx/speed,z:local.vz/speed};if(!room)p.slideReady=t+RULES.slideTime+RULES.slideCooldown;
  send({t:'slide'});sound.play('slide');world.fx({kind:'slide',x:local.x,z:local.z});return true;
}
function build(){const p=me();if(!p||!playing()||p.respawnAt)return;if(now()<(p.buildReady||0)){sound.play('empty');return;}if(local)p.facing=local.facing;send({t:'build'});world.animate(mySlot,'build',350);}
function setScoop(on){if(scoopOn===on)return;scoopOn=on;if(state?.phase==='playing')send({t:'scoop',on});}
function pad(){if(!navigator.getGamepads)return null;const gp=navigator.getGamepads()[0];return gp?.connected?gp:null;}
function pollGamepad(dt){
  const gp=pad();if(!gp||panel)return;const b=i=>!!gp.buttons[i]?.pressed,edge=i=>b(i)&&!padPrev[i];
  const lx=gp.axes[2]||0,ly=gp.axes[3]||0,mag=Math.hypot(lx,ly);if(mag>.12){const k=dt*3*settings.sens*(aiming?settings.aimSens:1)*Math.min(1,(mag-.12)/.88)/mag*mag;world.look(lx*k,ly*k*.7*(settings.invertY?-1:1));}
  if(playing()){if(edge(0))dive();if(edge(1)&&!trySlide())crouchToggle=!crouchToggle;if(edge(2))build();if(b(3)!==!!padPrev[3])setScoop(b(3));aiming=b(6);if(b(7)&&!padPrev[7])startCharge();if(!b(7)&&padPrev[7]&&chargeAt)release();}
  if(edge(9))action(panel==='pause'?'resume':'pause');
  padPrev=gp.buttons.map(x=>x.pressed);
}
function bindTouch(){
  const zone=$('#move-zone'),stick=zone.querySelector('.stick'),knob=stick.querySelector('span');let mid=null,origin=null;
  zone.addEventListener('pointerdown',e=>{sound.unlock();mid=e.pointerId;origin={x:e.clientX,y:e.clientY};stick.style.transform=`translate(${e.clientX-60}px,${e.clientY-60}px)`;stick.classList.add('on');zone.setPointerCapture(e.pointerId);});
  zone.addEventListener('pointermove',e=>{if(e.pointerId!==mid)return;const dx=e.clientX-origin.x,dy=e.clientY-origin.y,d=Math.hypot(dx,dy),r=Math.min(1,d/55);moveStick={x:d?dx/d*r:0,y:d?dy/d*r:0};knob.style.transform=`translate(${moveStick.x*38}px,${moveStick.y*38}px)`;});
  const end=e=>{if(e.pointerId!==mid)return;mid=null;moveStick={x:0,y:0};knob.style.transform='';stick.classList.remove('on');};zone.addEventListener('pointerup',end);zone.addEventListener('pointercancel',end);
  const look=$('#look-zone'),lookers=new Map();
  const lookStart=e=>{lookers.set(e.pointerId,{x:e.clientX,y:e.clientY});};
  const lookMove=e=>{const l=lookers.get(e.pointerId);if(!l)return;const k=.006*settings.sens*(aiming?settings.aimSens:1);world.look((e.clientX-l.x)*k,(e.clientY-l.y)*k*.8*(settings.invertY?-1:1));l.x=e.clientX;l.y=e.clientY;};
  const lookEnd=e=>lookers.delete(e.pointerId);
  look.addEventListener('pointerdown',e=>{sound.unlock();look.setPointerCapture(e.pointerId);lookStart(e);});look.addEventListener('pointermove',lookMove);look.addEventListener('pointerup',lookEnd);look.addEventListener('pointercancel',lookEnd);
  for(const b of hudRoot.querySelectorAll('[data-touch]')){const kind=b.dataset.touch;
    b.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();sound.unlock();b.setPointerCapture(e.pointerId);b.classList.add('down');lookStart(e);
      if(!playing())return;if(kind==='throw')startCharge();if(kind==='dive')dive();if(kind==='wall')build();if(kind==='scoop')setScoop(true);if(kind==='crouch'&&!trySlide())crouchToggle=!crouchToggle;});
    b.addEventListener('pointermove',e=>{if(kind==='throw')lookMove(e);});
    const up=e=>{b.classList.remove('down');lookEnd(e);if(kind==='throw'&&chargeAt)release();if(kind==='scoop')setScoop(false);};b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);}
}

/* ---------------------------------------------------------------- the loop */
function stepLocal(dt,t,p){
  const alive=state.phase==='playing'&&!p.respawnAt&&!p.spectator&&status!=='reconnecting'&&!paused;
  if(p.respawnAt){wasDead=true;return;}
  if(wasDead){wasDead=false;Object.assign(local,{x:p.x,z:p.z,vx:0,vz:0,kx:0,kz:0,diveStart:0,slideStart:0});world.resetCombat(local);killer=null;}
  const i=moveInput(),gp=pad(),dir=relativeMove(i.x,-i.z,world.yaw),moving=Math.hypot(i.x,i.z)>.1;
  const crouchHeld=settings.toggleCrouch?crouchToggle:(keys.has('KeyC')||keys.has('ControlLeft')||crouchToggle);
  const diving=t<local.diveStart+RULES.diveMove,sliding=!diving&&t<local.slideStart+RULES.slideTime;
  const sprintKey=settings.toggleSprint?sprintToggle:(keys.has('ShiftLeft')||keys.has('ShiftRight'));
  const sprint=!crouchHeld&&!chargeAt&&!aiming&&!scoopOn&&(sprintKey||Math.hypot(moveStick.x,moveStick.y)>.92||!!gp?.buttons[10]?.pressed);
  local.crouch=sliding||(!diving&&(crouchHeld||scoopOn));
  if(!alive){local.vx=local.vz=0;}
  else if(diving){const u=(t-local.diveStart)/RULES.diveMove;local.vx=local.diveDir.x*diveSpeed(u);local.vz=local.diveDir.z*diveSpeed(u);}
  else if(sliding){const u=(t-local.slideStart)/RULES.slideTime,s=slideSpeed(u);local.slideDir.x+=dir.x*dt*1.5;local.slideDir.z+=dir.z*dt*1.5;const n=Math.hypot(local.slideDir.x,local.slideDir.z)||1;local.slideDir.x/=n;local.slideDir.z/=n;local.vx=local.slideDir.x*s;local.vz=local.slideDir.z*s;}
  else Object.assign(local,driveVelocity(local,dir,dt,{sprint,charging:!!chargeAt||aiming,crouch:local.crouch,ice:onIce(state.map,local),rush:(p.rushUntil||0)>t}));
  let vx=local.vx,vz=local.vz;if(Math.abs(local.kx)+Math.abs(local.kz)>.05){vx+=local.kx;vz+=local.kz;const k=Math.exp(-8*dt);local.kx*=k;local.kz*=k;}else local.kx=local.kz=0;
  if(alive){Object.assign(local,moveBody(local,vx,vz,dt,state.map,state.forts));local.facing=world.yaw;}
  local.flags=(diving?1:0)|(local.crouch?4:0)|(sliding?8:0)|(scoopOn&&!diving&&!sliding?16:0);
  if(chargeAt){world.animate(mySlot,'charge',90);if(chargeLevel()>=1&&!chargeReadyPlayed){chargeReadyPlayed=true;sound.play('chargeReady');}}
  aim=world.aimAt(local,state.players,poses,chargeLevel()>=1,mySlot,state.mode!=='ffa',p.team);
  // Movement snapshots: every frame locally, adaptive rate online.
  if(alive&&!p.spectator){const hz=room?60:rateFor(state.players.filter(q=>!q.spectator).length);if(t-lastSnap>=1000/hz){lastSnap=t;send({t:'snap',x:local.x,z:local.z,vx:local.vx,vz:local.vz,facing:local.facing,crouch:local.crouch});}}
  // The victim decides hits; the room validates them against the pelt's path and cover.
  if(alive){for(const shot of state.pelts){if(shot.by===mySlot||shot.id.startsWith('pred-')||t<shot.release||t>flightEnd(shot)+60||hitSent.has(shot.id))continue;const by=state.players.find(q=>q.slot===shot.by);if(state.mode!=='ffa'&&by?.team===p.team)continue;
    if(sweptHit(peltAt(shot,t-dt*1000-4),peltAt(shot,t),{x:local.x,z:local.z,crouch:local.crouch})){hitSent.set(shot.id,t);send({t:'hit',id:shot.id,tm:t});}}}
  for(const [id,at]of hitSent)if(t-at>10000)hitSent.delete(id);
  if(!room)state.pelts=state.pelts.filter(q=>!q.id.startsWith('pred-')||t<flightEnd(q)+400);
}
const scratch=new Map();
function updatePoses(t){
  poses.clear();if(!state)return;
  for(const p of state.players){if(p.spectator)continue;let pose;
    if(p.slot===mySlot&&local)pose=local;
    else if(room||state===demo){pose=scratch.get(p.slot)||{};scratch.set(p.slot,pose);pose.x=p.x;pose.z=p.z;pose.vx=p.vx;pose.vz=p.vz;pose.facing=p.facing;pose.crouch=p.crouch;pose.flags=flagsOf(p,t);}
    else pose=tracks.get(p.slot)?.sample(t)||p;
    poses.set(p.slot,pose);}
}
// Measure how often the browser actually gives us frames (its refresh rate) to explain FPS limits.
const gaps=[];function refreshHz(){if(gaps.length<30)return 0;const g=[...gaps].sort((a,b)=>a-b)[gaps.length>>1];return Math.round(1000/g);}
let lastTick=0;
function frame(ts){
  requestAnimationFrame(frame);if(lastTick&&!document.hidden){gaps.push(ts-lastTick);if(gaps.length>240)gaps.shift();}lastTick=ts;
  const cap=settings.fpsCap;if(cap&&ts-lastRender<1000/cap-.6)return;
  const raw=(ts-lastFrame)/1000;lastFrame=ts;lastRender=ts;const dt=Math.min(.05,Math.max(0,raw));
  frames++;if(ts-fpsAt>500){fps=Math.round(frames*1000/(ts-fpsAt));frames=0;fpsAt=ts;}
  if(document.hidden)return;
  if(room&&!paused)soloTime+=Math.min(250,raw*1000);
  pollGamepad(dt);
  if(screen==='menu'||(screen==='connecting')){if(demo){const t=Date.now();demo.step(t);if(demo.phase==='results'||demo.phase==='lobby'){startDemo();}state=null;const prev=mySlot;updatePosesFor(demo,t);world.render(dt,t,{state:demo,poses,mySlot:-1,reduced:settings.reduced});}else world.render(dt,Date.now(),{state:null,poses,mySlot:-1,reduced:settings.reduced});return;}
  const t=now();
  if(room&&!paused)room.step(t);
  const p=state&&me();
  if(screen==='play'&&state&&local&&p)stepLocal(dt,t,p);
  updatePoses(t);
  const frenzy=state?.phase==='playing'&&state.endAt-t<=RULES.frenzy;if(frenzy&&!frenzyOn){frenzyOn=true;hud?.callout('BLIZZARD! FINAL 30',true);sound.play('frenzy');sound.intensity(1);}
  if(state){
    const diving=local&&t<local.diveStart+RULES.diveMove,sliding=local&&t<local.slideStart+RULES.slideTime;
    world.render(dt,t,{state,poses,mySlot,aim,dead:!!p?.respawnAt,reduced:settings.reduced,charge:chargeLevel(),aiming,diving,sliding,diveSide:local?.diveSide||0,sprinting:local&&Math.hypot(local.vx,local.vz)>RULES.run+.5,winners,target:world.aimLocked?aim.slot:-1});
    if(hud&&screen==='play'){
      const n=state.players.filter(q=>!q.spectator).length,rtt=wire?.stats?.rtt;
      hud.update({state,me:p,time:t,poses,mySlot,yaw:world.yaw,local,charge:chargeLevel(),aiming,locked:world.aimLocked,frenzy,limit:limitFor(state.mode,n),killerInfo:killer,season:state.season||season,scooping:scoopOn,
        net:settings.showFps?`${fps} FPS${wire?` · ${Math.round(rtt||0)} ms`:''}`:status==='reconnecting'?'RECONNECTING…':wire&&(rtt||0)>220?`SLOW CONNECTION · ${Math.round(rtt)} ms`:''});
      hud.hint(hintText(t,p));
    }
    if(screen==='lobby')lobbyTick(t);
  }else world.render(dt,Date.now(),{state:null,poses,mySlot:-1,reduced:settings.reduced});
}
function updatePosesFor(r,t){poses.clear();for(const p of r.players){const pose=scratch.get('d'+p.slot)||{};scratch.set('d'+p.slot,pose);pose.x=p.x;pose.z=p.z;pose.vx=p.vx;pose.vz=p.vz;pose.facing=p.facing;pose.crouch=p.crouch;pose.flags=flagsOf(p,t);poses.set(p.slot,pose);}}
function hintText(t,p){
  if(!p||state.phase!=='playing'||p.respawnAt)return'';
  if(p.ammo===0)return touch?'Out of ammo — hold SCOOP or run to a glowing pile':'Out of ammo — hold R to scoop, or run to a glowing pile';
  if(!hintUntil||Date.now()>hintUntil)return'';const k=Math.floor((42000-(hintUntil-Date.now()))/8400);
  return (touch?['Left side moves · push all the way to sprint','Tap THROW · hold it to charge a Big Pelt','DIVE through incoming throws — you are untouchable mid-dive','WALL throws up cover · CROUCH behind it','Grab glowing pads for power-ups']:['WASD move · SHIFT sprint · mouse aims','Click to throw · hold to charge a Big Pelt (2 ammo, splash)','SPACE dives — untouchable mid-dive, 2 charges','Q slams a wall · C crouches · C while sprinting slides','Glowing pads hold power-ups · TAB shows the scoreboard'])[clamp(k,0,4)];
}
function lobbyTick(t){
  const el=$('#lobby-clock');if(!el)return;const humans=state.players.filter(p=>!p.spectator&&!p.bot&&p.connected).length;
  const text=state.deadline?`Match starts in ${Math.max(0,Math.ceil((state.deadline-t)/1000))}…`:`${humans} / ${state.minPlayers} players to auto-start`;if(el.textContent!==text)el.textContent=text;
  const fill=$('#bot-fill');if(state.publicRoom&&!state.deadline&&t-state.waitSince>=20000&&fill&&!fill.firstChild)fill.innerHTML='<button class="wide-btn" data-action="fill">FILL WITH BOTS ▸</button>';
}

/* ------------------------------------------------------------------- boot */
world.onLand=(x,z)=>sound.play('boing',{pan:panOf(x,z),vol:volOf(x,z),pitch:.8+Math.random()*.4});
showMenu();requestAnimationFrame(frame);
if(Acct.signedIn())Acct.refresh().then(r=>{useAccount(r.profile);refreshMenu();world.hero(profile);}).catch(e=>{if(!Acct.signedIn()){useAccount(null);refreshMenu();toast('Your session ended. Please log in again.');}});
addEventListener('pointerdown',()=>sound.unlock(),{once:true});
const deep=params.get('room')?.toUpperCase();if(deep&&CODE.test(deep))openRoom(deep);else{let resume;try{resume=JSON.parse(sessionStorage.getItem('pelt-room')||'null');}catch{}if(resume&&CODE.test(resume.code))openRoom(resume.code,resume.watch);}
// Test hooks exist only on the explicitly requested local test URL.
if(testMode)window.__pelt={get world(){return world;},get state(){return state;},get room(){return room;},get local(){return local;},get metrics(){return world.metrics;},get camera(){return {position:world.camera.position.toArray(),yaw:world.yaw,pitch:world.pitch};},get screen(){return screen;},get fps(){return fps;},look(dx,dy){world.look(dx,dy);},startSolo,send,finish(){room?.finish(now());},stop,get profile(){return profile;},settings,action,dive,build,throwNow(charged=false){const p=me();if(p)throwAt(charged,now(),p);}};
