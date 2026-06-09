const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 10000,
  pingTimeout: 20000,
  transports: ["websocket", "polling"],
  perMessageDeflate: false
});

app.use(express.static("public", { maxAge: "0s", etag: false, lastModified: false }));
app.get("/health", (req, res) => res.json({ ok: true, version: "v13" }));

const rooms = new Map();

const CHARS = [
  ["🦊","#ff4757","Raposa"],["🐧","#38bdf8","Pinguim"],["🐸","#22c55e","Sapo"],["🐰","#a855f7","Coelho"],
  ["🐵","#f97316","Macaco"],["🐼","#e5e7eb","Panda"],["🐱","#facc15","Gato"],["🐶","#fb7185","Dog"],
  ["🐲","#14b8a6","Dragão"],["🦁","#f59e0b","Leão"],["🦄","#ec4899","Unicórnio"],["🦖","#84cc16","Dino"],
  ["🐙","#8b5cf6","Polvo"],["🦈","#0ea5e9","Tubarão"],["🐢","#16a34a","Tartaruga"],["🐯","#f97316","Tigre"]
].map((c,i)=>({id:i,emoji:c[0],color:c[1],name:c[2]}));

function code(){
  const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c="";
  for(let i=0;i<4;i++) c+=a[Math.floor(Math.random()*a.length)];
  return c;
}

function players(room){
  return room.players.map(p=>({
    id:p.id,name:p.name,emoji:p.emoji,color:p.color,charId:p.charId,score:p.score||0
  }));
}

function lobby(room){
  io.to(room.code).emit("lobby", {code:room.code,hostId:room.hostId,players:players(room),chars:CHARS});
}

io.on("connection", socket=>{
  socket.on("createRoom", cb=>{
    try{
      let c;
      do c=code(); while(rooms.has(c));
      const ch=CHARS[0];
      const room={
        code:c,hostId:socket.id,started:false,created:Date.now(),
        players:[{socketId:socket.id,id:1,name:"Host",emoji:ch.emoji,color:ch.color,charId:0,score:0}]
      };
      rooms.set(c,room);
      socket.join(c);
      socket.data.room=c;
      socket.data.playerId=1;
      cb && cb({ok:true,code:c,playerId:1,players:players(room),chars:CHARS});
      lobby(room);
    }catch(e){
      cb && cb({ok:false,error:e.message});
    }
  });

  socket.on("joinRoom",(raw,cb)=>{
    try{
      const c=String(raw||"").trim().toUpperCase();
      const room=rooms.get(c);
      if(!room) return cb && cb({ok:false,error:"Sala não encontrada"});
      if(room.started) return cb && cb({ok:false,error:"Partida já começou"});
      if(room.players.length>=4) return cb && cb({ok:false,error:"Sala cheia"});
      const id=room.players.length+1;
      const ch=CHARS[(id-1)%CHARS.length];
      room.players.push({socketId:socket.id,id,name:"P"+id,emoji:ch.emoji,color:ch.color,charId:ch.id,score:0});
      socket.join(c);
      socket.data.room=c;
      socket.data.playerId=id;
      cb && cb({ok:true,code:c,playerId:id,players:players(room),chars:CHARS});
      lobby(room);
    }catch(e){
      cb && cb({ok:false,error:e.message});
    }
  });

  socket.on("setCharacter", charId=>{
    const room=rooms.get(socket.data.room);
    if(!room || room.started) return;
    const p=room.players.find(x=>x.socketId===socket.id);
    const ch=CHARS[Number(charId)||0] || CHARS[0];
    if(!p) return;
    p.charId=ch.id; p.emoji=ch.emoji; p.color=ch.color;
    lobby(room);
  });

  socket.on("startGame", ()=>{
    const room=rooms.get(socket.data.room);
    if(!room || room.hostId!==socket.id || room.players.length<2) return;
    room.started=true;
    io.to(room.code).emit("startGame",{players:players(room)});
  });

  socket.on("input", input=>{
    const room=rooms.get(socket.data.room);
    if(!room) return;
    io.to(room.hostId).emit("playerInput",{
      playerId:socket.data.playerId,
      input:{
        up:!!input?.up,down:!!input?.down,left:!!input?.left,right:!!input?.right,action:!!input?.action
      }
    });
  });

  socket.on("gameState", state=>{
    const room=rooms.get(socket.data.room);
    if(!room || room.hostId!==socket.id) return;
    socket.to(room.code).volatile.emit("gameState",state);
  });

  socket.on("gameResult", result=>{
    const room=rooms.get(socket.data.room);
    if(!room || room.hostId!==socket.id) return;
    io.to(room.code).emit("gameResult",result);
    room.started=false;
    room.players.forEach(p=>p.score=0);
    lobby(room);
  });

  socket.on("disconnect",()=>{
    const room=rooms.get(socket.data.room);
    if(!room) return;
    if(room.hostId===socket.id){
      io.to(room.code).emit("hostLeft");
      rooms.delete(room.code);
      return;
    }
    room.players=room.players.filter(p=>p.socketId!==socket.id);
    room.players.forEach((p,i)=>{p.id=i+1;p.name=p.socketId===room.hostId?"Host":"P"+(i+1)});
    lobby(room);
  });
});

setInterval(()=>{
  const now=Date.now();
  for(const [c,r] of rooms){
    if(now-r.created>1000*60*60*3) rooms.delete(c);
  }
},1000*60*10);

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log("Caos Party V13 Conexão Fix rodando na porta "+PORT));
