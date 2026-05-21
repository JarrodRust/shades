const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const SCALES = require('./data/scales');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ── Levenshtein distance ─────────────────────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

// Max edit distance allowed per word length
function spellTolerance(wordLen) {
  if (wordLen <= 4) return 0;  // short words must be exact
  if (wordLen <= 7) return 1;  // medium words: 1 edit
  return 2;                    // long words: 2 edits
}

function fuzzyMatch(input, wordList) {
  const cleaned = input.toLowerCase().trim().replace(/[^a-z\-]/g, '');
  for (const entry of wordList) {
    if (entry.w === cleaned) return { entry, exact: true };
  }
  // Try fuzzy
  for (const entry of wordList) {
    const tol = spellTolerance(entry.w.length);
    if (tol > 0 && levenshtein(cleaned, entry.w) <= tol) {
      return { entry, exact: false, corrected: entry.w };
    }
  }
  return null;
}

// ── Game state ───────────────────────────────────────────────────────────────
const rooms = {};

function createRoom(code, settings) {
  const scalePool = settings.category === 'all'
    ? [...SCALES]
    : SCALES.filter(s => s.category.toLowerCase() === settings.category);
  const shuffled = scalePool.sort(() => Math.random() - 0.5);
  const scales = [];
  while (scales.length < settings.rounds) {
    scales.push(...shuffled);
  }

  return {
    code,
    hostId: null,
    players: {},        // socketId → { name, score, roundScore }
    settings: { rounds: settings.rounds, roundTime: settings.roundTime },
    scales: scales.slice(0, settings.rounds),
    currentRound: 0,
    phase: 'lobby',     // lobby | playing | roundEnd | gameEnd
    usedWords: new Set(),
    timer: null,
    timeLeft: 0,
  };
}

function roomPublicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    currentRound: room.currentRound,
    totalRounds: room.settings.rounds,
    timeLeft: room.timeLeft,
    scale: room.currentRound > 0 ? {
      category: room.scales[room.currentRound - 1].category,
      type: room.scales[room.currentRound - 1].type,
      left: room.scales[room.currentRound - 1].left,
      right: room.scales[room.currentRound - 1].right,
    } : null,
    players: Object.values(room.players)
      .map(p => ({ name: p.name, score: p.score, roundScore: p.roundScore }))
      .sort((a, b) => b.score - a.score),
  };
}

function startRound(room) {
  room.currentRound++;
  room.phase = 'playing';
  room.usedWords = new Set();
  room.zoneWords = [[], [], [], [], []];

  Object.values(room.players).forEach(p => { p.roundScore = 0; p.roundWords = []; });

  const scale = room.scales[room.currentRound - 1];
  room.timeLeft = room.settings.roundTime;

  io.to(room.code).emit('roundStart', {
    round: room.currentRound,
    totalRounds: room.settings.rounds,
    scale: { category: scale.category, type: scale.type, left: scale.left, right: scale.right },
    timeLeft: room.timeLeft,
  });

  room.timer = setInterval(() => {
    room.timeLeft--;
    io.to(room.code).emit('timerTick', { timeLeft: room.timeLeft });
    if (room.timeLeft <= 0) endRound(room);
  }, 1000);
}

function endRound(room) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  room.phase = 'roundEnd';

  const scale = room.scales[room.currentRound - 1];

  // Build full zone picture (all valid words for the scale, mark which were found)
  const allByZone = [[], [], [], [], []];
  scale.words.forEach(w => allByZone[w.z - 1].push({ w: w.w, r: w.r, found: room.usedWords.has(w.w) }));

  const missedRare = scale.words
    .filter(w => w.r >= 4 && !room.usedWords.has(w.w))
    .map(w => w.w);

  const scoreboard = Object.values(room.players)
    .map(p => ({ name: p.name, score: p.score, roundScore: p.roundScore, words: p.roundWords || [] }))
    .sort((a, b) => b.score - a.score);

  io.to(room.code).emit('roundEnd', {
    round: room.currentRound,
    totalRounds: room.settings.rounds,
    scale: { left: scale.left, right: scale.right, category: scale.category },
    zoneWords: allByZone,
    missedRare,
    scoreboard,
    isLast: room.currentRound >= room.settings.rounds,
  });
}

function endGame(room) {
  room.phase = 'gameEnd';
  const scoreboard = Object.values(room.players)
    .map(p => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
  io.to(room.code).emit('gameEnd', { scoreboard });
}

// ── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // Host creates a room
  socket.on('createRoom', (settings, cb) => {
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    const room = createRoom(code, settings);
    room.hostId = socket.id;
    rooms[code] = room;
    socket.join(code);
    cb({ code, scales: SCALES.map(s => ({ id: s.id, category: s.category, left: s.left, right: s.right, type: s.type, wordCount: s.words.length })) });
  });

  // Player joins
  socket.on('joinRoom', ({ code, name }, cb) => {
    const room = rooms[code];
    if (!room) return cb({ error: 'Room not found. Check your code.' });
    if (room.phase !== 'lobby') return cb({ error: 'Game already in progress.' });
    if (Object.values(room.players).some(p => p.name.toLowerCase() === name.toLowerCase())) {
      return cb({ error: 'That name is already taken.' });
    }
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name;
    room.players[socket.id] = { name, score: 0, roundScore: 0, roundWords: [] };
    io.to(code).emit('playerJoined', { name, players: Object.values(room.players).map(p => p.name) });
    cb({ ok: true });
  });

  // Host starts game
  socket.on('startGame', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    if (Object.keys(room.players).length === 0) return;
    startRound(room);
  });

  // Host advances to next round
  socket.on('nextRound', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    if (room.currentRound >= room.settings.rounds) {
      endGame(room);
    } else {
      startRound(room);
    }
  });

  // Host ends round early
  socket.on('endRound', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    endRound(room);
  });

  // Player submits a word
  socket.on('submitWord', ({ code, word }, cb) => {
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return cb({ error: 'No active round.' });
    const player = room.players[socket.id];
    if (!player) return cb({ error: 'Not in this game.' });

    const scale = room.scales[room.currentRound - 1];
    const result = fuzzyMatch(word, scale.words);

    if (!result) return cb({ error: `"${word}" isn't on this scale.` });

    const canonical = result.entry.w;
    if (room.usedWords.has(canonical)) return cb({ error: `"${canonical}" has already been used!` });

    room.usedWords.add(canonical);
    const points = result.entry.r * 10;
    player.score += points;
    player.roundScore += points;
    if (!player.roundWords) player.roundWords = [];
    player.roundWords.push({ word: canonical, zone: result.entry.z, points });

    room.zoneWords[result.entry.z - 1].push({ word: canonical, player: player.name });

    // Broadcast the new word to everyone (host sees it appear on screen)
    io.to(code).emit('wordPlaced', {
      word: canonical,
      zone: result.entry.z,
      player: player.name,
      points,
      scoreboard: Object.values(room.players)
        .map(p => ({ name: p.name, score: p.score, roundScore: p.roundScore }))
        .sort((a, b) => b.score - a.score),
    });

    cb({
      ok: true,
      canonical,
      corrected: !result.exact,
      zone: result.entry.z,
      points,
      rarity: result.entry.r,
    });
  });


  // Host resets game for another round with same players
  socket.on('playAgain', ({ code, settings }, cb) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;

    // Reset scores
    Object.values(room.players).forEach(p => {
      p.score = 0;
      p.roundScore = 0;
      p.roundWords = [];
    });

    // Build new scale list
    const scalePool = settings.category === 'all'
      ? [...SCALES]
      : SCALES.filter(s => s.category.toLowerCase() === settings.category.toLowerCase());
    const shuffled = scalePool.sort(() => Math.random() - 0.5);
    const scales = [];
    while (scales.length < settings.rounds) scales.push(...shuffled);

    room.settings = { rounds: settings.rounds, roundTime: settings.roundTime };
    room.scales = scales.slice(0, settings.rounds);
    room.currentRound = 0;
    room.phase = 'lobby';
    room.usedWords = new Set();
    if (room.timer) { clearInterval(room.timer); room.timer = null; }

    // Tell everyone we're back in the lobby
    io.to(code).emit('backToLobby', {
      players: Object.values(room.players).map(p => p.name),
    });

    cb({ ok: true });
  });

  // Disconnect cleanup
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    if (room.hostId === socket.id) {
      io.to(code).emit('hostLeft');
      if (room.timer) clearInterval(room.timer);
      delete rooms[code];
    } else {
      const name = room.players[socket.id]?.name;
      delete room.players[socket.id];
      if (name) io.to(code).emit('playerLeft', { name, players: Object.values(room.players).map(p => p.name) });
    }
  });
});

// ── API: get all scales (for host preview) ───────────────────────────────────
app.get('/api/scales', (req, res) => {
  res.json(SCALES.map(s => ({
    id: s.id,
    category: s.category,
    type: s.type,
    left: s.left,
    right: s.right,
    wordCount: s.words.length,
    words: s.words,
  })));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Semantic Gradient running on http://localhost:${PORT}`));
