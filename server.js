const express=require("express"),http=require("http"),{Server}=require("socket.io");
const app=express(),httpServer=http.createServer(app);
const io=new Server(httpServer,{cors:{origin:"*"},transports:["websocket","polling"],pingInterval:9000,pingTimeout:22000,perMessageDeflate:false});
app.use(express.static("public",{maxAge:"0s",etag:false}));

const W=1280,H=720,TICK=1000/30,rooms=new Map();
const COLORS=["#38bdf8","#fb7185","#4ade80","#facc15","#a78bfa","#f97316"];
const WEAP={
  basic:{name:"Laser",emoji:"🔫",cd:14,dmg:18,speed:16,life:50,pellets:[0],size:10},
  shotgun:{name:"Shotgun",emoji:"💥",cd:28,dmg:13,speed:13,life:20,pellets:[-.34,-.18,0,.18,.34],size:11},
  sniper:{name:"Sniper",emoji:"🎯",cd:38,dmg:52,speed:21,life:78,pellets:[0],size:9},
  rifle:{name:"Rifle",emoji:"⚡",cd:8,dmg:12,speed:17,life:54,pellets:[0],size:9},
  smg:{name:"SMG",emoji:"🌪️",cd:5,dmg:8,speed:16,life:36,pellets:[0],size:8},
  cannon:{name:"Cannon",emoji:"🧨",cd:42,dmg:64,speed:11,life:48,pellets:[0],size:15,splash:64}
};
const UPGRADE_POOL=["shotgun","sniper","rifle","smg","cannon"];
const POWERS=[{kind:"heal",txt:"❤️"},{kind:"shield",txt:"🛡️"},{kind:"speed",txt:"🏎️"},{kind:"xp",txt:"⬆️"}];
const WALLS=[
{x:0,y:0,w:W,h:26},{x:0,y:H-26,w:W,h:26},{x:0,y:0,w:26,h:H},{x:W-26,y:0,w:26,h:H},
{x:160,y:120,w:260,h:28},{x:860,y:120,w:260,h:28},{x:160,y:572,w:260,h:28},{x:860,y:572,w:260,h:28},
{x:590,y:100,w:100,h:180},{x:590,y:440,w:100,h:180},{x:330,y:332,w:230,h:30},{x:720,y:332,w:230,h:30},
{x:110,y:250,w:32,h:220},{x:1138,y:250,w:32,h:220},
{x:450,y:190,w:32,h:130},{x:798,y:400,w:32,h:130}
];
function rand(arr){return arr[Math.floor(Math.random()*arr.length)]}
function code(){const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let c="";for(let i=0;i<4;i++)c+=a[Math.floor(Math.random()*a.length)];return c}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function rect(a,b){return !(a.x+a.w<b.x||a.x>b.x+b.w||a.y+a.h<b.y||a.y>b.y+b.h)}
function dist(ax,ay,bx,by){return Math.hypot(ax-bx,ay-by)}
function spawnPoint(i){return[{x:70,y:70,a:0},{x:W-120,y:H-120,a:Math.PI},{x:70,y:H-120,a:0},{x:W-120,y:70,a:Math.PI},{x:W/2-25,y:70,a:Math.PI/2},{x:W/2-25,y:H-120,a:-Math.PI/2}][i%6]}
function mkPlayer(socketId,id){const s=spawnPoint(id-1);return{socketId,id,name:'Tanque '+id,color:COLORS[(id-1)%COLORS.length],x:s.x,y:s.y,w:54,h:56,angle:s.a,hp:100,maxHp:100,shield:0,score:0,kills:0,deaths:0,level:1,xp:0,needXp:60,weapon:'basic',speedBoost:0,cooldown:0,respawn:0,input:{up:false,down:false,left:false,right:false,shoot:false},pendingUpgrade:false,upgradeChoices:[]}}
function publicRoom(room){return{code:room.code,hostId:room.hostId,players:room.players.map(p=>({id:p.id,name:p.name,color:p.color,score:p.score,kills:p.kills,deaths:p.deaths,level:p.level,weapon:p.weapon}))}}
function resetPlayer(p){const s=spawnPoint(p.id-1);p.x=s.x;p.y=s.y;p.angle=s.a;p.hp=p.maxHp;p.shield=0;p.respawn=0;p.cooldown=20;p.input={up:false,down:false,left:false,right:false,shoot:false}}
function playerBySocket(room,sid){return room.players.find(p=>p.socketId===sid)}
function chooseUpgrades(current){const pool=UPGRADE_POOL.filter(w=>w!==current).sort(()=>Math.random()-.5);return pool.slice(0,3)}
function gainXp(room,p,amt){if(!p||p.pendingUpgrade)return;p.xp+=amt;while(p.xp>=p.needXp&&!p.pendingUpgrade){p.xp-=p.needXp;p.level++;p.needXp=Math.round(p.needXp*1.32+22);p.maxHp+=8;p.hp=Math.min(p.maxHp,p.hp+32);p.pendingUpgrade=true;p.upgradeChoices=chooseUpgrades(p.weapon);room.effects.push({x:p.x+26,y:p.y+26,txt:'LEVEL UP',life:28});io.to(p.socketId).emit('upgradeAvailable',{choices:p.upgradeChoices,level:p.level})}}
function spawnPower(room){if(room.powers.length>=4)return;let tries=0;while(tries++<60){const p=rand(POWERS),o={id:room.nextPower++,type:'power',kind:p.kind,txt:p.txt,x:70+Math.random()*(W-140),y:70+Math.random()*(H-140),w:34,h:34};if(!WALLS.some(w=>rect(o,w))){room.powers.push(o);return}}}
function makeRoom(hostSocket){let c;do c=code();while(rooms.has(c));const room={code:c,hostId:hostSocket.id,created:Date.now(),started:false,players:[mkPlayer(hostSocket.id,1)],bullets:[],powers:[],effects:[],nextBullet:1,nextPower:1,powerTimer:0,tick:null,broadcast:null};rooms.set(c,room);return room}
function applyPower(room,p,o){if(o.kind==='heal')p.hp=Math.min(p.maxHp,p.hp+35);if(o.kind==='shield')p.shield=Math.min(80,p.shield+40);if(o.kind==='speed')p.speedBoost=210;if(o.kind==='xp')gainXp(room,p,22);room.effects.push({x:p.x+26,y:p.y+26,txt:o.txt,life:18})}
function damage(room,target,amount,attackerId,impact){if(target.respawn>0)return;if(target.shield>0){const used=Math.min(target.shield,amount);target.shield-=used;amount-=used}if(amount<=0)return;target.hp-=amount;room.effects.push({x:target.x+26,y:target.y+26,txt:'✦',life:8});if(impact){const dx=target.x+target.w/2-impact.x,dy=target.y+target.h/2-impact.y,d=Math.hypot(dx,dy)||1;target.x=clamp(target.x+dx/d*impact.push,26,W-target.w-26);target.y=clamp(target.y+dy/d*impact.push,26,H-target.h-26)}const attacker=room.players.find(p=>p.id===attackerId);if(attacker&&attacker.id!==target.id)gainXp(room,attacker,4);if(target.hp<=0){target.hp=0;target.deaths++;target.respawn=75;if(attacker&&attacker.id!==target.id){attacker.kills++;attacker.score+=100;gainXp(room,attacker,40)}}}
function shoot(room,p){if(p.cooldown>0||p.respawn>0||p.pendingUpgrade)return;const s=WEAP[p.weapon]||WEAP.basic;p.cooldown=s.cd;for(const off of s.pellets){const a=p.angle+off;room.bullets.push({id:room.nextBullet++,owner:p.id,kind:p.weapon,x:p.x+p.w/2-s.size/2,y:p.y+p.h/2-s.size/2,w:s.size,h:s.size,vx:Math.cos(a)*s.speed,vy:Math.sin(a)*s.speed,life:s.life,dmg:s.dmg,splash:s.splash||0})}}
function movePlayer(p){if(p.respawn>0){p.respawn--;if(p.respawn===0)resetPlayer(p);return}if(p.pendingUpgrade)return;p.cooldown=Math.max(0,p.cooldown-1);p.speedBoost=Math.max(0,p.speedBoost-1);const i=p.input,turn=.085;if(i.left)p.angle-=turn;if(i.right)p.angle+=turn;let sp=p.speedBoost>0?5.2:4;if(p.weapon==='sniper')sp*=.92;if(p.weapon==='smg')sp*=1.05;const ox=p.x,oy=p.y;if(i.up){p.x+=Math.cos(p.angle)*sp;p.y+=Math.sin(p.angle)*sp}if(i.down){p.x-=Math.cos(p.angle)*sp*.72;p.y-=Math.sin(p.angle)*sp*.72}p.x=clamp(p.x,26,W-p.w-26);p.y=clamp(p.y,26,H-p.h-26);if(WALLS.some(w=>rect(p,w))){p.x=ox;p.y=oy}}
function tickRoom(room){if(!room.started)return;for(const p of room.players){movePlayer(p);if(p.input.shoot)shoot(room,p)}for(let bi=room.bullets.length-1;bi>=0;bi--){const b=room.bullets[bi];b.x+=b.vx;b.y+=b.vy;b.life--;if(b.life<=0||b.x<0||b.x>W||b.y<0||b.y>H||WALLS.some(w=>rect(b,w))){if(b.splash){for(const p of room.players){if(p.id!==b.owner&&p.respawn<=0&&dist(p.x+p.w/2,p.y+p.h/2,b.x,b.y)<b.splash){damage(room,p,Math.max(8,Math.floor(b.dmg*.45)),b.owner,{x:b.x,y:b.y,push:16})}}room.effects.push({x:b.x,y:b.y,txt:'💥',life:14})}room.bullets.splice(bi,1);continue;}let hitSomeone=false;for(const p of room.players){if(p.id!==b.owner&&p.respawn<=0&&rect(b,p)){damage(room,p,b.dmg,b.owner,{x:b.x,y:b.y,push:b.kind==='shotgun'?12:b.kind==='cannon'?18:8});if(b.splash){for(const o of room.players){if(o.id!==b.owner&&o.id!==p.id&&o.respawn<=0&&dist(o.x+o.w/2,o.y+o.h/2,b.x,b.y)<b.splash){damage(room,o,Math.max(8,Math.floor(b.dmg*.45)),b.owner,{x:b.x,y:b.y,push:12})}}room.effects.push({x:b.x,y:b.y,txt:'💥',life:14})}room.bullets.splice(bi,1);hitSomeone=true;break;}}if(hitSomeone)continue;}for(let pi=room.powers.length-1;pi>=0;pi--){const o=room.powers[pi];for(const p of room.players){if(p.respawn<=0&&!p.pendingUpgrade&&rect(p,o)){applyPower(room,p,o);room.powers.splice(pi,1);break}}}room.powerTimer++;if(room.powerTimer>=210){room.powerTimer=0;spawnPower(room)}room.effects.forEach(e=>e.life--);room.effects=room.effects.filter(e=>e.life>0)}
function snap(room){return{t:Date.now(),w:W,h:H,walls:WALLS,players:room.players.map(p=>({id:p.id,name:p.name,color:p.color,x:Math.round(p.x),y:Math.round(p.y),w:p.w,h:p.h,angle:Math.round(p.angle*100)/100,hp:Math.round(p.hp),maxHp:p.maxHp,shield:Math.round(p.shield),score:p.score,kills:p.kills,deaths:p.deaths,level:p.level,xp:p.xp,needXp:p.needXp,weapon:p.weapon,respawn:p.respawn,pendingUpgrade:p.pendingUpgrade})),bullets:room.bullets.map(b=>({id:b.id,kind:b.kind,x:Math.round(b.x),y:Math.round(b.y),w:b.w,h:b.h})),powers:room.powers.map(o=>({id:o.id,kind:o.kind,txt:o.txt,x:Math.round(o.x),y:Math.round(o.y),w:o.w,h:o.h})),effects:room.effects}}
function startLoops(room){clearInterval(room.tick);clearInterval(room.broadcast);for(let i=0;i<2;i++)spawnPower(room);room.tick=setInterval(()=>tickRoom(room),TICK);room.broadcast=setInterval(()=>io.to(room.code).volatile.emit('state',snap(room)),TICK)}
io.on('connection',socket=>{
 socket.on('createRoom',cb=>{try{const room=makeRoom(socket);socket.join(room.code);socket.data.room=room.code;socket.data.playerId=1;cb&&cb({ok:true,room:publicRoom(room),playerId:1});io.to(room.code).emit('lobby',publicRoom(room))}catch(e){cb&&cb({ok:false,error:e.message})}});
 socket.on('joinRoom',(raw,cb)=>{try{const code=String(raw||'').trim().toUpperCase(),room=rooms.get(code);if(!room)return cb&&cb({ok:false,error:'Sala não encontrada'});if(room.players.length>=6)return cb&&cb({ok:false,error:'Sala cheia'});const id=room.players.length+1;room.players.push(mkPlayer(socket.id,id));socket.join(code);socket.data.room=code;socket.data.playerId=id;cb&&cb({ok:true,room:publicRoom(room),playerId:id});io.to(code).emit('lobby',publicRoom(room))}catch(e){cb&&cb({ok:false,error:e.message})}});
 socket.on('rename',name=>{const room=rooms.get(socket.data.room),p=room&&playerBySocket(room,socket.id);if(!p)return;p.name=String(name||'').slice(0,14)||p.name;io.to(room.code).emit('lobby',publicRoom(room))});
 socket.on('start',()=>{const room=rooms.get(socket.data.room);if(!room||room.hostId!==socket.id)return;room.started=true;startLoops(room);io.to(room.code).emit('started',snap(room))});
 socket.on('input',inp=>{const room=rooms.get(socket.data.room),p=room&&playerBySocket(room,socket.id);if(!p)return;p.input={up:!!inp?.up,down:!!inp?.down,left:!!inp?.left,right:!!inp?.right,shoot:!!inp?.shoot}});
 socket.on('chooseUpgrade',choice=>{const room=rooms.get(socket.data.room),p=room&&playerBySocket(room,socket.id);if(!p||!p.pendingUpgrade)return;if(!p.upgradeChoices.includes(choice))return;p.weapon=choice;p.pendingUpgrade=false;p.upgradeChoices=[];room.effects.push({x:p.x+24,y:p.y+24,txt:WEAP[choice].name,life:24})});
 socket.on('disconnect',()=>{const room=rooms.get(socket.data.room);if(!room)return;if(room.hostId===socket.id){io.to(room.code).emit('closed');clearInterval(room.tick);clearInterval(room.broadcast);rooms.delete(room.code);return}room.players=room.players.filter(p=>p.socketId!==socket.id);io.to(room.code).emit('lobby',publicRoom(room))});
});
setInterval(()=>{const now=Date.now();for(const [code,room] of rooms){if(now-room.created>1000*60*60*4){clearInterval(room.tick);clearInterval(room.broadcast);rooms.delete(code)}}},1000*60*10);
const PORT=process.env.PORT||3000;httpServer.listen(PORT,()=>console.log('Laser Tank Arena V2 Horizon rodando na porta '+PORT));
