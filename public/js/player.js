const socket = io();
let myName = '';
let myScore = 0;
let myRoundScore = 0;
let myRoundWords = [];

// ── Utilities ────────────────────────────────────────────────
function show(screenName) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + screenName).classList.add('active');
}

function setFeedback(msg, type) {
  const el = document.getElementById('p-feedback');
  el.textContent = msg;
  el.className = 'feedback-bar feedback-' + type;
}

// ── Join ─────────────────────────────────────────────────────
function joinGame() {
  const code = document.getElementById('j-code').value.trim().toUpperCase();
  const name = document.getElementById('j-name').value.trim();
  const errEl = document.getElementById('j-error');

  if (!code || code.length < 4) { errEl.textContent = 'Enter the room code from your teacher\'s screen.'; return; }
  if (!name) { errEl.textContent = 'Enter your name.'; return; }
  errEl.textContent = '';

  socket.emit('joinRoom', { code, name }, (res) => {
    if (res.error) { errEl.textContent = res.error; return; }
    myName = name;
    document.getElementById('w-name').textContent = `Hi, ${name}!`;
    show('waiting');
  });
}

// ── Waiting room updates ──────────────────────────────────────
socket.on('playerJoined', ({ players }) => {
  document.getElementById('w-players').innerHTML =
    players.map(n => `<span class="player-chip">${n}</span>`).join('');
});

socket.on('playerLeft', ({ players }) => {
  document.getElementById('w-players').innerHTML =
    players.map(n => `<span class="player-chip">${n}</span>`).join('');
});

// ── Round start ──────────────────────────────────────────────
socket.on('roundStart', ({ round, totalRounds, scale, timeLeft }) => {
  myRoundScore = 0;
  myRoundWords = [];

  document.getElementById('p-name').textContent = myName;
  document.getElementById('p-score').textContent = myScore;
  document.getElementById('p-category').textContent = scale.category;
  document.getElementById('p-left').textContent = scale.left;
  document.getElementById('p-right').textContent = scale.right;
  document.getElementById('p-timer').textContent = timeLeft;
  document.getElementById('p-timer').className = 'timer-block sm';
  document.getElementById('p-input').value = '';
  document.getElementById('p-words').innerHTML = '';
  setFeedback('', 'info');

  show('playing');
  document.getElementById('p-input').focus();
});

// ── Timer ────────────────────────────────────────────────────
socket.on('timerTick', ({ timeLeft }) => {
  const el = document.getElementById('p-timer');
  el.textContent = timeLeft;
  el.className = 'timer-block sm' + (timeLeft <= 10 ? ' warning' : '');
});

// ── Submit word ──────────────────────────────────────────────
function submitWord() {
  const input = document.getElementById('p-input');
  const word = input.value.trim();
  if (!word) return;
  input.value = '';
  input.focus();

  socket.emit('submitWord', { code: getCode(), word }, (res) => {
    if (res.error) {
      setFeedback(res.error, 'err');
      return;
    }

    myScore += res.points;
    myRoundScore += res.points;
    myRoundWords.push({ word: res.canonical, zone: res.zone, points: res.points });
    document.getElementById('p-score').textContent = myScore;

    const correctedNote = res.corrected ? ` (accepted as "${res.canonical}")` : '';
    const isRare = res.rarity >= 4;

    if (isRare) {
      setFeedback(`⭐ "${res.canonical}" — rare word! Zone ${res.zone} · +${res.points} pts${correctedNote}`, 'rare');
    } else {
      setFeedback(`"${res.canonical}" placed in zone ${res.zone} · +${res.points} pts${correctedNote}`, 'ok');
    }

    renderSubmittedWords();
  });
}

function renderSubmittedWords() {
  document.getElementById('p-words').innerHTML = myRoundWords.slice().reverse().map(w => `
    <div class="submitted-item">
      <span class="sub-word">${w.word}</span>
      <div class="sub-meta">
        <span>zone ${w.zone}</span>
        <span class="sub-pts">+${w.points}</span>
      </div>
    </div>
  `).join('');
}

// ── Round end ─────────────────────────────────────────────────
socket.on('roundEnd', ({ round, totalRounds, scale, scoreboard, isLast }) => {
  document.getElementById('pre-title').textContent = isLast ? 'Final round done!' : `Round ${round} done!`;
  document.getElementById('pre-round-score').textContent = myRoundScore;
  document.getElementById('pre-total-score').textContent = myScore;
  document.getElementById('pre-waiting').textContent = isLast ? 'Waiting for final scores…' : 'Waiting for next round…';

  document.getElementById('pre-words').innerHTML = myRoundWords.length
    ? myRoundWords.map(w => `
        <div class="submitted-item">
          <span class="sub-word">${w.word}</span>
          <div class="sub-meta"><span>zone ${w.zone}</span><span class="sub-pts">+${w.points}</span></div>
        </div>`).join('')
    : '<p style="color:var(--c-hint);font-size:0.85rem;padding:8px 0">No words placed this round.</p>';

  document.getElementById('pre-scoreboard').innerHTML = scoreboard.map((p, i) => {
    const rankClasses = ['rank-1','rank-2','rank-3'];
    return `
      <div class="score-row">
        <div class="score-left">
          <span class="rank-num ${rankClasses[i]||''}">${i + 1}</span>
          <span class="score-name">${p.name}${p.name === myName ? ' (you)' : ''}</span>
        </div>
        <span class="score-pts">${p.score}</span>
      </div>`;
  }).join('');

  show('roundend');
});

// ── Game end ──────────────────────────────────────────────────
socket.on('gameEnd', ({ scoreboard }) => {
  document.getElementById('pge-scoreboard').innerHTML = scoreboard.map((p, i) => {
    const rankClasses = ['rank-1','rank-2','rank-3'];
    return `
      <div class="score-row">
        <div class="score-left">
          <span class="rank-num ${rankClasses[i]||''}">${i + 1}</span>
          <span class="score-name">${p.name}${p.name === myName ? ' (you)' : ''}</span>
          ${i === 0 ? '<span class="badge badge-amber" style="margin-left:6px">🏆 Winner</span>' : ''}
        </div>
        <span class="score-pts">${p.score}</span>
      </div>`;
  }).join('');
  show('gameend');
});

// ── Host left ─────────────────────────────────────────────────
socket.on('hostLeft', () => {
  alert('The host has ended the game.');
  location.href = '/';
});

// ── Helper ───────────────────────────────────────────────────
function getCode() {
  return document.getElementById('j-code')?.value?.trim()?.toUpperCase() || '';
}

// Allow Enter key on join form
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('j-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') joinGame();
  });
  document.getElementById('j-code')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') joinGame();
  });
});
