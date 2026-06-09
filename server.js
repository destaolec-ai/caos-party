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

app.use(express.static("public", { maxAge: "2m", etag: true }));

const rooms = new Map();

const CHARS = [
  { emoji: "🦊", color: "#ff4757", name: "Raposa" },
  { emoji: "🐧", color: "#38bdf8", name: "Pinguim" },
  { emoji: "🐸", color: "#22c55e", name: "Sapo" },
  { emoji: "🐰", color: "#a855f7", name: "Coelho" },
  { emoji: "🐵", color: "#f97316", name: "Macaco" },
  { emoji: "🐼", color: "#e5e7eb", name: "Panda" },
  { emoji: "🐱", color: "#facc15", name: "Gato" },
  { emoji: "🐶", color: "#fb7185", name: "Dog" },
  { emoji: "🐲", color: "#14b8a6", name: "Dragão" },
  { emoji: "🦁", color: "#f59e0b", name: "Leão" },
  { emoji: "🐺", color: "#94a3b8", name: "Lobo" },
  { emoji: "🦝", color: "#64748b", name: "Guaxinim" },
  { emoji: "🦄", color: "#ec4899", name: "Unicórnio" },
  { emoji: "🦖", color: "#84cc16", name: "Dino" },
  { emoji: "🐙", color: "#8b5cf6", name: "Polvo" },
  { emoji: "🦈", color: "#0ea5e9", name: "Tubarão" },
  { emoji: "🐢", color: "#16a34a", name: "Tartaruga" },
  { emoji: "🦉", color: "#a16207", name: "Coruja" },
  { emoji: "🐯", color: "#f97316", name: "Tigre" },
  { emoji: "🐨", color: "#cbd5e1", name: "Coala" }
];

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
    charIndex: p.charIndex,
    score: p.score || 0
  }));
}

function broadcastLobby(room) {
  io.to(room.code).emit("lobby", {
    code: room.code,
    hostId: room.hostId,
    players: publicPlayers(room),
    chars: CHARS
  });
}

function reindex(room) {
  room.players.forEach((p, idx) => {
    p.id = idx + 1;
    p.name = p.socketId === room.hostId ? "Host" : "P" + p.id;
  });
}

io.on("connection", (socket) => {
  socket.on("createRoom", (cb) => {
    let code;
    do code = makeCode();
    while (rooms.has(code));

    const c = CHARS[0];
    const room = {
      code,
      hostId: socket.id,
      started: false,
      createdAt: Date.now(),
      players: [{
        socketId: socket.id,
        id: 1,
        name: "Host",
        emoji: c.emoji,
        color: c.color,
        charIndex: 0,
        score: 0
      }]
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = 1;

    cb({ ok: true, code, playerId: 1, players: publicPlayers(room), chars: CHARS });
    broadcastLobby(room);
  });

  socket.on("joinRoom", (rawCode, cb) => {
    const code = String(rawCode || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) return cb({ ok: false, error: "Sala não encontrada" });
    if (room.started) return cb({ ok: false, error: "A partida já começou" });
    if (room.players.length >= 4) return cb({ ok: false, error: "Sala cheia" });

    const id = room.players.length + 1;
    const c = CHARS[(id - 1) % CHARS.length];

    room.players.push({
      socketId: socket.id,
      id,
      name: "P" + id,
      emoji: c.emoji,
      color: c.color,
      charIndex: (id - 1) % CHARS.length,
      score: 0
    });

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = id;

    cb({ ok: true, code, playerId: id, players: publicPlayers(room), chars: CHARS });
    broadcastLobby(room);
  });

  socket.on("setCharacter", (charIndex) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.started) return;
    const p = room.players.find(x => x.socketId === socket.id);
    const c = CHARS[Number(charIndex) % CHARS.length];
    if (!p || !c) return;
    p.charIndex = Number(charIndex) % CHARS.length;
    p.emoji = c.emoji;
    p.color = c.color;
    broadcastLobby(room);
  });

  socket.on("startGame", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.players.length < 2) return;
    room.started = true;
    io.to(room.code).emit("startGame", { players: publicPlayers(room) });
  });

  socket.on("input", (input) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const clean = {
      up: !!input?.up,
      down: !!input?.down,
      left: !!input?.left,
      right: !!input?.right,
      action: !!input?.action
    };
    io.to(room.hostId).volatile.emit("playerInput", {
      playerId: socket.data.playerId,
      input: clean
    });
  });

  socket.on("gameState", (state) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    socket.to(room.code).volatile.emit("gameState", state);
  });

  socket.on("sound", (name) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    socket.to(room.code).volatile.emit("sound", name);
  });

  socket.on("gameResult", (players) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    io.to(room.code).emit("gameResult", players);
    room.started = false;
    room.players.forEach(p => p.score = 0);
    broadcastLobby(room);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;

    if (room.hostId === socket.id) {
      io.to(room.code).emit("hostLeft");
      rooms.delete(room.code);
      return;
    }

    room.players = room.players.filter(p => p.socketId !== socket.id);
    reindex(room);
    broadcastLobby(room);
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
server.listen(PORT, () => console.log("Caos Party V9 Corrigido rodando na porta " + PORT));
