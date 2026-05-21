const socket = io();
let roomCode = null;

// ── Utilities ────────────────────────────────────────────────
function show(screenName) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + screenName).classList.add('active');
}

function chipColor(zone) {
  return ['chip-1','chip-2','chip-3','chip-4','chip-5'][zone - 1] || 'chip-1';
}

function rankClass(i) {
  return ['rank-1','rank-2','rank-3'][i] || '';
}

// ── Setup screen ─────────────────────────────────────────────
function createRoom() {
  const settings = {
    category: document.getElementById('s-category').value,
    rounds:   parseInt(document.getElementById('s-rounds').value),
    roundTime:parseInt(document.getElementById('s-time').value),
  };
  socket.emit('createRoom', settings, ({ code }) => {
    roomCode = code;
    document.getElementById('lobby-code').textContent = code;
    document.getElementById('lobby-url').textContent = location.hostname + (location.port ? ':' + location.port : '');
    show('lobby');
  });
}

function showPreview() {
  fetch('/api/scales')
    .then(r => r.json())
    .then(scales => {
      const list = document.getElementById('preview-list');
      list.innerHTML = scales.map(s => `
        <div class="preview-card">
          <div class="preview-meta">
            <span class="badge badge-category">${s.category}</span>
            <span class="badge badge-teal">${s.type}</span>
            <span style="font-size:0.8rem;color:var(--c-hint)">${s.wordCount} words</span>
          </div>
          <div class="preview-scale">
            <span style="color:var(--c-blue);font-weight:700">${s.left}</span>
            <span class="preview-arrow">→</span>
            <span style="color:var(--c-coral);font-weight:700">${s.right}</span>
          </div>
        </div>
      `).join('');
      show('preview');
    });
}

// ── Lobby ────────────────────────────────────────────────────
socket.on('playerJoined', ({ name, players }) => {
  renderLobbyPlayers(players);
  const btn = document.getElementById('start-btn');
  btn.disabled = players.length === 0;
  btn.textContent = players.length === 0
    ? 'Start game (need at least 1 player)'
    : `Start game — ${players.length} player${players.length > 1 ? 's' : ''} ready`;
});

socket.on('playerLeft', ({ name, players }) => {
  renderLobbyPlayers(players);
});

function renderLobbyPlayers(players) {
  document.getElementById('lobby-count').textContent = players.length;
  document.getElementById('lobby-player-list').innerHTML =
    players.map(n => `<span class="player-chip">${n}</span>`).join('');
}

function startGame() {
  socket.emit('startGame', { code: roomCode });
}

// ── Round start ──────────────────────────────────────────────
socket.on('roundStart', ({ round, totalRounds, scale, timeLeft }) => {
  document.getElementById('g-category').textContent = scale.category;
  document.getElementById('g-round').textContent = `Round ${round} of ${totalRounds}`;
  document.getElementById('g-left').textContent = scale.left;
  document.getElementById('g-right').textContent = scale.right;
  document.getElementById('g-timer').textContent = timeLeft;
  document.getElementById('g-timer').className = 'timer-block';

  // Clear zones
  for (let z = 1; z <= 5; z++) {
    const zone = document.querySelector(`#g-zones .zone[data-zone="${z}"]`);
    zone.innerHTML = `<span class="zone-num">${z}</span>`;
  }

  document.getElementById('g-scoreboard').innerHTML = '';
  show('playing');
});

// ── Timer ────────────────────────────────────────────────────
socket.on('timerTick', ({ timeLeft }) => {
  const el = document.getElementById('g-timer');
  el.textContent = timeLeft;
  el.className = 'timer-block' + (timeLeft <= 10 ? ' warning' : '');
});

// ── Word placed ──────────────────────────────────────────────
socket.on('wordPlaced', ({ word, zone, player, points, scoreboard }) => {
  const zoneEl = document.querySelector(`#g-zones .zone[data-zone="${zone}"]`);
  const chip = document.createElement('span');
  chip.className = `word-chip ${chipColor(zone)}`;
  chip.textContent = word;
  chip.title = `${player} +${points}pts`;
  zoneEl.appendChild(chip);

  renderHostScoreboard(scoreboard);

  const wordCount = document.querySelectorAll('#g-zones .word-chip').length;
  // could add a count display here
});

function renderHostScoreboard(players) {
  document.getElementById('g-scoreboard').innerHTML = players.map((p, i) => `
    <div class="score-row">
      <div class="score-left">
        <span class="rank-num ${rankClass(i)}">${i + 1}</span>
        <span class="score-name">${p.name}</span>
      </div>
      <span class="score-pts">${p.score}
        ${p.roundScore ? `<span class="round-pts">+${p.roundScore}</span>` : ''}
      </span>
    </div>
  `).join('');
}

function endRoundEarly() {
  socket.emit('endRound', { code: roomCode });
}

// ── Round end ────────────────────────────────────────────────
socket.on('roundEnd', ({ round, totalRounds, scale, zoneWords, missedRare, scoreboard, isLast }) => {
  document.getElementById('re-title').textContent = `Round ${round} results`;
  document.getElementById('re-left').textContent = scale.left;
  document.getElementById('re-right').textContent = scale.right;

  // Build zones with all words (found = full colour, not found = faded)
  document.getElementById('re-zones').innerHTML = zoneWords.map((words, i) => {
    const z = i + 1;
    const chips = words.map(w =>
      `<span class="word-chip ${chipColor(z)} ${w.found ? '' : 'not-found'}" title="${w.found ? 'Found!' : 'Missed'} — rarity ${w.r}">${w.w}</span>`
    ).join('');
    return `<div class="zone" data-zone="${z}"><span class="zone-num">${z}</span>${chips}</div>`;
  }).join('');

  document.getElementById('re-missed').textContent = missedRare.length
    ? `Rare words no one found: ${missedRare.join(', ')}`
    : '';

  document.getElementById('re-scoreboard').innerHTML = scoreboard.map((p, i) => `
    <div class="score-row">
      <div class="score-left">
        <span class="rank-num ${rankClass(i)}">${i + 1}</span>
        <span class="score-name">${p.name}</span>
        <span style="font-size:0.8rem;color:var(--c-muted)">${p.words.map(w => w.word).join(', ')}</span>
      </div>
      <span class="score-pts">${p.score}
        ${p.roundScore ? `<span class="round-pts">+${p.roundScore} this round</span>` : ''}
      </span>
    </div>
  `).join('');

  const btn = document.getElementById('re-next-btn');
  btn.textContent = isLast ? 'See final scores →' : 'Next round →';

  show('roundend');
});

function nextRound() {
  socket.emit('nextRound', { code: roomCode });
}

// ── Game end ─────────────────────────────────────────────────
socket.on('gameEnd', ({ scoreboard }) => {
  document.getElementById('ge-scoreboard').innerHTML = scoreboard.map((p, i) => `
    <div class="score-row">
      <div class="score-left">
        <span class="rank-num ${rankClass(i)}">${i + 1}</span>
        <span class="score-name">${p.name}</span>
        ${i === 0 ? '<span class="badge badge-amber" style="margin-left:6px">Champion 🏆</span>' : ''}
      </div>
      <span class="score-pts">${p.score}</span>
    </div>
  `).join('');
  show('gameend');
});
