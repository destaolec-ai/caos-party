const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static("public"));

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
    score: p.score || 0,
    connected: true
  }));
}

function broadcastLobby(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit("lobby", {
    code,
    players: publicPlayers(room),
    hostId: room.hostId
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

    if (!room) {
      cb({ ok: false, error: "Sala não encontrada" });
      return;
    }

    if (room.started) {
      cb({ ok: false, error: "A partida já começou" });
      return;
    }

    if (room.players.length >= 4) {
      cb({ ok: false, error: "Sala cheia" });
      return;
    }

    const id = room.players.length + 1;
    const base = [
      null,
      { emoji: "🦊", color: "#ff4757" },
      { emoji: "🐧", color: "#38bdf8" },
      { emoji: "🐸", color: "#22c55e" },
      { emoji: "🐰", color: "#a855f7" }
    ][id];

    const player = {
      socketId: socket.id,
      id,
      name: "P" + id,
      emoji: base.emoji,
      color: base.color,
      score: 0,
      input: { up:false, down:false, left:false, right:false, action:false }
    };

    room.players.push(player);
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
    io.to(code).emit("startGame", {
      players: publicPlayers(room)
    });
  });

  socket.on("input", (input) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    player.input = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
      action: !!input.action
    };

    // Envia input para o host, que roda a física.
    io.to(room.hostId).emit("playerInput", {
      playerId: player.id,
      input: player.input
    });
  });

  socket.on("gameState", (state) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    socket.to(code).emit("gameState", state);
  });

  socket.on("gameResult", (players) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    io.to(code).emit("gameResult", players);
    room.started = false;
    room.players.forEach(p => p.score = 0);
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

    // Reorganiza IDs para manter 1..4
    room.players.forEach((p, index) => {
      p.id = index + 1;
      if (p.socketId === room.hostId) p.name = "Host";
      else p.name = "P" + p.id;
    });

    broadcastLobby(code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Caos Party rodando na porta " + PORT);
});
