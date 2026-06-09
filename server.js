const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 8000,
  pingTimeout: 18000,
  transports: ["websocket", "polling"],
  perMessageDeflate: false
});

app.use(express.static("public", {
  maxAge: "5m",
  etag: true
}));

const rooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function publicPlayers(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    color: p.color,
    score: p.score || 0
  }));
}

function broadcastLobby(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit("lobby", {
    code,
    players: publicPlayers(room),
    hostId: room.hostId,
    createdAt: room.createdAt
  });
}

function reindexRoom(room) {
  const base = [
    null,
    { emoji: "🦊", color: "#ff4757" },
    { emoji: "🐧", color: "#38bdf8" },
    { emoji: "🐸", color: "#22c55e" },
    { emoji: "🐰", color: "#a855f7" }
  ];

  room.players.forEach((p, index) => {
    const id = index + 1;
    p.id = id;
    p.name = p.socketId === room.hostId ? "Host" : "P" + id;
    p.emoji = base[id].emoji;
    p.color = base[id].color;
  });
}

io.on("connection", (socket) => {
  socket.on("createRoom", (cb) => {
    let code;
    do code = makeCode();
    while (rooms.has(code));

    const room = {
      code,
      hostId: socket.id,
      createdAt: Date.now(),
      started: false,
      players: [{
        socketId: socket.id,
        id: 1,
        name: "Host",
        emoji: "🦊",
        color: "#ff4757",
        score: 0,
        input: { up:false, down:false, left:false, right:false, action:false }
      }]
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = 1;
    socket.data.isHost = true;

    cb({ ok: true, code, playerId: 1, players: publicPlayers(room) });
    broadcastLobby(code);
  });

  socket.on("joinRoom", (codeRaw, cb) => {
    const code = String(codeRaw || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) return cb({ ok: false, error: "Sala não encontrada" });
    if (room.started) return cb({ ok: false, error: "A partida já começou" });
    if (room.players.length >= 4) return cb({ ok: false, error: "Sala cheia" });

    const id = room.players.length + 1;
    const base = [
      null,
      { emoji: "🦊", color: "#ff4757" },
      { emoji: "🐧", color: "#38bdf8" },
      { emoji: "🐸", color: "#22c55e" },
      { emoji: "🐰", color: "#a855f7" }
    ][id];

    room.players.push({
      socketId: socket.id,
      id,
      name: "P" + id,
      emoji: base.emoji,
      color: base.color,
      score: 0,
      input: { up:false, down:false, left:false, right:false, action:false }
    });

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = id;
    socket.data.isHost = false;

    cb({ ok: true, code, playerId: id, players: publicPlayers(room) });
    broadcastLobby(code);
  });

  socket.on("startGame", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    room.started = true;
    io.to(code).emit("startGame", { players: publicPlayers(room) });
  });

  socket.on("input", (input) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    const clean = {
      up: !!input?.up,
      down: !!input?.down,
      left: !!input?.left,
      right: !!input?.right,
      action: !!input?.action
    };

    player.input = clean;
    // volatile: se atrasar, descarta input velho em vez de acumular lag
    io.to(room.hostId).volatile.emit("playerInput", { playerId: player.id, input: clean });
  });

  socket.on("gameState", (state) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    socket.to(code).volatile.emit("gameState", state);
  });

  socket.on("gameResult", (players) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    io.to(code).emit("gameResult", players);
    room.started = false;
    room.players.forEach(p => p.score = 0);
    broadcastLobby(code);
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (room.hostId === socket.id) {
      io.to(code).emit("hostLeft");
      rooms.delete(code);
      return;
    }

    room.players = room.players.filter(p => p.socketId !== socket.id);
    reindexRoom(room);
    broadcastLobby(code);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.players.length || now - room.createdAt > 1000 * 60 * 60 * 4) {
      rooms.delete(code);
    }
  }
}, 1000 * 60 * 10);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Caos Party Socket V4 rodando na porta " + PORT));
