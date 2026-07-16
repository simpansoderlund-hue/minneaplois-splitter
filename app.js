// ---------- Setup ----------
// 1. Deploy the Apps Script in apps-script/Code.gs as a Web App (see README.md).
// 2. Paste the resulting /exec URL below.
// 3. Pick the same SHARED_KEY here and in Code.gs (a shared secret, not real security —
//    anyone who views this page's source can read it, same as the URL below).

const API_URL = 'https://script.google.com/macros/s/AKfycbyFvreQ2xqhzGyDjvsx0gftvunTz0s9yuhpSBu9-F7HhP2zqQ5zwskJ37TiXKNG2PVFew/exec';
const SHARED_KEY = 'minneapolis-ope';

const state = {
  people: [],
  expenses: [],
  log: [],
  gameScores: [],
  reactionScores: [],
  dylan: [],
};

let currentUserName = null;

if (API_URL.includes('PASTE_YOUR')) {
  document.getElementById('setup-warning').classList.remove('hidden');
}

// ---------- Backend calls ----------

// Reads are a plain GET — the Apps Script /exec endpoint returns JSON and is
// readable cross-origin, so no special handling is needed here.
async function refreshData() {
  const res = await fetch(API_URL, { method: 'GET' });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  state.people = data.people || [];
  state.expenses = data.expenses.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  state.log = data.log || [];
  state.gameScores = data.gameScores || [];
  state.reactionScores = data.reactionScores || [];
  state.dylan = data.dylan || [];
  return data;
}

// Writes are a POST with a form-encoded body (URLSearchParams), which stays a
// CORS "simple request" and avoids the preflight issues Apps Script doesn't
// handle well. If the browser still can't read the response for some reason
// (e.g. a stricter network setup), we fall back to a fire-and-forget no-cors
// POST and just re-fetch the data afterward.
async function callAction(action, data) {
  const body = new URLSearchParams({ action, key: SHARED_KEY, data: JSON.stringify(data) });
  try {
    const res = await fetch(API_URL, { method: 'POST', body });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  } catch (err) {
    if (err instanceof TypeError) {
      // Likely a CORS/network-level failure reading the response, not a
      // rejected action — retry blind and let the caller re-fetch state.
      await fetch(API_URL, { method: 'POST', body, mode: 'no-cors' });
      return null;
    }
    throw err;
  }
}

// ---------- Who are you? (name gate) ----------
// Every visitor picks their name from the People sheet before using the app.
// Matching is case-insensitive, and it's remembered per-browser afterward so
// it only asks once. If the typed name isn't on the sheet yet, it offers to
// add them as a new person (so this doesn't create a chicken-and-egg problem
// for the very first person to open the app).

const NAME_STORAGE_KEY = 'tripSplitterName';

function getSavedName() {
  return localStorage.getItem(NAME_STORAGE_KEY);
}

function saveName(name) {
  localStorage.setItem(NAME_STORAGE_KEY, name);
}

function clearSavedName() {
  localStorage.removeItem(NAME_STORAGE_KEY);
}

function updateWhoamiBadge() {
  const badge = document.getElementById('whoami-badge');
  const label = document.getElementById('whoami-label');
  if (currentUserName) {
    label.textContent = `${avatarFor(currentUserName)} ${currentUserName}`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function ensureIdentified() {
  try {
    await refreshData();
  } catch (e) {
    console.error(e);
  }

  const saved = getSavedName();
  const savedMatch = saved && state.people.find(p => p.name.toLowerCase() === saved.toLowerCase());
  if (savedMatch) return savedMatch.name;

  const overlay = document.getElementById('name-gate');
  const form = document.getElementById('name-gate-form');
  const input = document.getElementById('name-gate-input');
  const errorEl = document.getElementById('name-gate-error');
  const addBtn = document.getElementById('name-gate-add');

  overlay.classList.remove('hidden');
  addBtn.classList.add('hidden');
  errorEl.textContent = '';
  input.focus();

  return new Promise(resolve => {
    function finish(name) {
      saveName(name);
      overlay.classList.add('hidden');
      form.removeEventListener('submit', onSubmit);
      addBtn.removeEventListener('click', onAdd);
      resolve(name);
    }

    function onSubmit(e) {
      e.preventDefault();
      const entered = input.value.trim();
      if (!entered) return;
      const match = state.people.find(p => p.name.toLowerCase() === entered.toLowerCase());
      if (match) {
        finish(match.name);
        return;
      }
      errorEl.textContent = `No one named "${entered}" yet.`;
      addBtn.textContent = `Add me as "${entered}"`;
      addBtn.classList.remove('hidden');
    }

    async function onAdd() {
      const entered = input.value.trim();
      if (!entered) return;
      errorEl.textContent = '';
      addBtn.disabled = true;
      try {
        const created = await callAction('addPerson', { name: entered });
        await refreshData();
        finish(created.name);
      } catch (err) {
        errorEl.textContent = err.message;
      } finally {
        addBtn.disabled = false;
      }
    }

    form.addEventListener('submit', onSubmit);
    addBtn.addEventListener('click', onAdd);
  });
}

document.getElementById('whoami-badge').addEventListener('click', async () => {
  clearSavedName();
  currentUserName = null;
  updateWhoamiBadge();
  currentUserName = await ensureIdentified();
  updateWhoamiBadge();
  renderPaidBySelect();
});

// ---------- Tabs ----------

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    await loadForTab(btn.dataset.tab);
  });
});

async function loadForTab(tab) {
  try {
    await refreshData();
  } catch (e) {
    console.error(e);
  }
  renderPeopleList();
  renderPaidBySelect();
  renderParticipantCheckboxes();
  if (tab === 'expenses') renderExpenses();
  if (tab === 'balances') renderBalancesAndSettleUp();
}

// ---------- Helpers ----------

function money(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function nameOf(id) {
  const p = state.people.find(p => p.id === id);
  return p ? p.name : 'Unknown';
}

// ---------- Avatars ----------
// A little emoji next to each person's name — picked deterministically from
// the name itself, so the same person always gets the same emoji. Leans on a
// few Up-North critters (loon, moose, beaver) alongside the usual crew.

const AVATAR_EMOJIS = ['🦆', '🫎', '🦫', '🐻', '🦊', '🐺', '🦉', '🦅', '🐿️', '🦌', '🐸', '🦁', '🐯', '🐵', '🐶', '🐱', '🐰', '🦄', '🐷', '🐮', '🐔', '🐙', '🦋', '🐝', '🐳', '🐢', '🦖', '🐧', '🦔'];

function avatarFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_EMOJIS[hash % AVATAR_EMOJIS.length];
}

function avatarHtml(name) {
  return `<span class="avatar" title="${escapeHtml(name)}">${avatarFor(name)}</span>`;
}

function setDefaultDate() {
  const dateInput = document.getElementById('exp-date');
  dateInput.value = new Date().toISOString().slice(0, 10);
}

// ---------- People ----------

function renderPeopleList() {
  const container = document.getElementById('people-list');
  if (state.people.length === 0) {
    container.innerHTML = '<p class="empty-state">No one added yet. Add your friends above.</p>';
    return;
  }
  container.innerHTML = state.people.map(p => `
    <div class="person-row">
      <span>${avatarHtml(p.name)}${escapeHtml(p.name)}</span>
    </div>
  `).join('');
}

function renderPaidBySelect() {
  const select = document.getElementById('exp-paid-by');
  const prev = select.value;
  select.innerHTML = state.people.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  if (state.people.some(p => p.id === prev)) {
    select.value = prev;
  } else if (currentUserName) {
    const me = state.people.find(p => p.name.toLowerCase() === currentUserName.toLowerCase());
    if (me) select.value = me.id;
  }
}

function renderParticipantCheckboxes() {
  const container = document.getElementById('participant-checkboxes');
  container.innerHTML = state.people.map(p => `
    <label>
      <input type="checkbox" value="${p.id}" checked />
      ${avatarHtml(p.name)}${escapeHtml(p.name)}
    </label>
  `).join('');
}

document.getElementById('select-all-btn').addEventListener('click', () => {
  document.querySelectorAll('#participant-checkboxes input[type="checkbox"]').forEach(cb => cb.checked = true);
});
document.getElementById('select-none-btn').addEventListener('click', () => {
  document.querySelectorAll('#participant-checkboxes input[type="checkbox"]').forEach(cb => cb.checked = false);
});

document.getElementById('person-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('person-name');
  const errorEl = document.getElementById('person-error');
  errorEl.textContent = '';
  try {
    await callAction('addPerson', { name: input.value });
    input.value = '';
    await refreshData();
    renderPeopleList();
    renderPaidBySelect();
    renderParticipantCheckboxes();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// ---------- Add expense form ----------

document.getElementById('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('add-error');
  errorEl.textContent = '';

  const description = document.getElementById('exp-description').value;
  const amount = document.getElementById('exp-amount').value;
  const date = document.getElementById('exp-date').value;
  const paidBy = document.getElementById('exp-paid-by').value;
  const participantIds = Array.from(
    document.querySelectorAll('#participant-checkboxes input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  if (state.people.length === 0) {
    errorEl.textContent = 'Add at least one person first (People tab).';
    return;
  }
  if (!paidBy) {
    errorEl.textContent = 'Choose who paid.';
    return;
  }
  if (participantIds.length === 0) {
    errorEl.textContent = 'Select at least one person to split with.';
    return;
  }

  try {
    await callAction('addExpense', { description, amount, date, paidBy, participantIds });
    document.getElementById('expense-form').reset();
    setDefaultDate();
    renderParticipantCheckboxes();
    errorEl.textContent = '';
    showSuccess(`✅ "${description}" (${money(Number(amount))}) added!`);
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// ---------- Expenses list ----------

function renderExpenses() {
  const container = document.getElementById('expenses-list');
  if (state.expenses.length === 0) {
    container.innerHTML = '<p class="empty-state">No expenses yet. Add one in the Add Expense tab.</p>';
    return;
  }
  container.innerHTML = state.expenses.map(exp => `
    <div class="card${exp.isSettlement ? ' settlement' : ''}">
      <div class="card-row">
        <div>
          <div class="card-title">${
            exp.isSettlement
              ? `🤝 ${escapeHtml(nameOf(exp.paidBy))} paid ${escapeHtml(nameOf(exp.participantIds[0]))}`
              : escapeHtml(exp.description)
          }</div>
          <div class="card-sub">
            ${
              exp.isSettlement
                ? `${exp.date} &middot; settlement`
                : `${exp.date} &middot; paid by ${escapeHtml(nameOf(exp.paidBy))}<br/>
            split: ${exp.participantIds.map(id => escapeHtml(nameOf(id))).join(', ')}`
            }
          </div>
        </div>
        <div style="text-align:right">
          <div class="card-amount">${money(exp.amount)}</div>
        </div>
      </div>
    </div>
  `).join('');
}

// ---------- Balances (computed client-side from people + expenses) ----------
// Same math as the original app's server-side /api/balances endpoint.

function computeBalances() {
  const balances = {};
  state.people.forEach(p => { balances[p.id] = 0; });

  for (const expense of state.expenses) {
    const share = expense.amount / expense.participantIds.length;
    for (const pid of expense.participantIds) {
      if (balances[pid] === undefined) balances[pid] = 0;
      balances[pid] -= share;
    }
    if (balances[expense.paidBy] === undefined) balances[expense.paidBy] = 0;
    balances[expense.paidBy] += expense.amount;
  }

  const net = state.people.map(p => ({
    id: p.id,
    name: p.name,
    amount: Math.round((balances[p.id] || 0) * 100) / 100,
  }));

  return { balances: net, transactions: simplifyDebts(net) };
}

function simplifyDebts(balances) {
  const EPSILON = 0.005;
  const creditors = balances
    .filter(b => b.amount > EPSILON)
    .map(b => ({ ...b }))
    .sort((a, b) => b.amount - a.amount);
  const debtors = balances
    .filter(b => b.amount < -EPSILON)
    .map(b => ({ ...b, amount: -b.amount }))
    .sort((a, b) => b.amount - a.amount);

  const transactions = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    transactions.push({
      fromId: debtors[i].id,
      from: debtors[i].name,
      toId: creditors[j].id,
      to: creditors[j].name,
      amount: Math.round(pay * 100) / 100,
    });
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount <= EPSILON) i++;
    if (creditors[j].amount <= EPSILON) j++;
  }
  return transactions;
}

function renderBalancesAndSettleUp() {
  const { balances, transactions } = computeBalances();
  renderBalances(balances);
  renderSettleUp(transactions);
}

function renderBalances(balances) {
  const container = document.getElementById('balances-list');
  if (balances.length === 0) {
    container.innerHTML = '<p class="empty-state">Add people and expenses to see balances.</p>';
    return;
  }
  container.innerHTML = balances.map(b => {
    const cls = b.amount > 0.005 ? 'positive' : b.amount < -0.005 ? 'negative' : 'zero';
    const label = b.amount > 0.005 ? 'is owed' : b.amount < -0.005 ? 'owes' : 'is settled up';
    return `
      <div class="balance-row">
        <span>${avatarHtml(b.name)}${escapeHtml(b.name)}</span>
        <span class="balance-amount ${cls}">${label} ${money(Math.abs(b.amount))}</span>
      </div>
    `;
  }).join('');
}

function renderSettleUp(transactions) {
  const container = document.getElementById('settle-list');
  if (transactions.length === 0) {
    container.innerHTML = '<p class="empty-state">Everyone is settled up! 🎉</p>';
    return;
  }
  container.innerHTML = transactions.map((t, i) => `
    <button type="button" class="settle-row" data-index="${i}">
      <span><strong>${avatarHtml(t.from)}${escapeHtml(t.from)}</strong> pays <strong>${avatarHtml(t.to)}${escapeHtml(t.to)}</strong></span>
      <span class="settle-amount">${money(t.amount)}</span>
    </button>
  `).join('');

  container.querySelectorAll('.settle-row').forEach(btn => {
    btn.addEventListener('click', async () => {
      const t = transactions[Number(btn.dataset.index)];
      const ok = await confirmDialog(
        `Are you sure ${t.from} paid ${t.to} ${money(t.amount)}?`,
        { okLabel: 'Mark as Paid', okClass: 'btn-confirm' }
      );
      if (!ok) return;
      try {
        await callAction('settle', { fromId: t.fromId, toId: t.toId, amount: t.amount });
        await refreshData();
        renderBalancesAndSettleUp();
      } catch (e) {
        alert(e.message);
      }
    });
  });
}

// ---------- Confirm modal ----------

function confirmDialog(message, { okLabel = 'Confirm', okClass = 'btn-confirm' } = {}) {
  const overlay = document.getElementById('confirm-overlay');
  const okBtn = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');
  document.getElementById('confirm-message').textContent = message;
  okBtn.textContent = okLabel;
  okBtn.className = okClass;
  overlay.classList.remove('hidden');

  return new Promise(resolve => {
    function cleanup(result) {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlayClick);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlayClick(e) { if (e.target === overlay) cleanup(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlayClick);
  });
}

// ---------- Success confirmation ----------

function showSuccess(message, autoCloseMs = 2000) {
  const overlay = document.getElementById('success-overlay');
  const okBtn = document.getElementById('success-ok');
  document.getElementById('success-message').textContent = message;
  overlay.classList.remove('hidden');

  function close() {
    overlay.classList.add('hidden');
    okBtn.removeEventListener('click', close);
    overlay.removeEventListener('click', onOverlayClick);
    clearTimeout(timer);
  }
  function onOverlayClick(e) { if (e.target === overlay) close(); }

  okBtn.addEventListener('click', close);
  overlay.addEventListener('click', onOverlayClick);
  const timer = setTimeout(close, autoCloseMs);
}

// ---------- State Fair easter egg mini-game ----------
// State Fair Scramble: grab 🍪 Sweet Martha's cookies before they vanish to
// the next stall. Sometimes a 🦟 mosquito (Minnesota's "state bird") shows up
// instead — swat that one by mistake and it's -2 points. Scores are saved to
// the sheet (per identified person) so everyone can see who got what.

const GAME_DURATION_SECONDS = 15;
const GAME_CELL_COUNT = 9;
const GAME_SPAWN_MS = 800;
const GAME_DECOY_EMOJI = '🦟';
const GAME_DECOY_CHANCE = 0.25;
const GAME_DECOY_PENALTY = 2;

let gameState = null; // { score, timeLeft, activeCell, activeIsDecoy, spawnTimer, tickTimer }

const GAME_RESULT_LINES = [
  "still not enough for a bucket of Sweet Martha's.",
  "Princess Kay of the Milky Way is impressed, but unpaid.",
  "somebody on the Balances tab still owes for cheese curds.",
  "add it to the tab — right next to the corn dogs.",
];

function buildGameGrid() {
  const grid = document.getElementById('game-grid');
  grid.innerHTML = '';
  for (let i = 0; i < GAME_CELL_COUNT; i++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'game-cell';
    cell.dataset.index = String(i);
    grid.appendChild(cell);
  }
}

function onGameGridClick(e) {
  const cell = e.target.closest('.game-cell');
  if (!cell || !gameState) return;

  // A hit scores (or penalizes, for the decoy); a miss scores nothing — but
  // either way the target immediately relocates, so you can't just spam-click
  // the whole grid.
  if (Number(cell.dataset.index) === gameState.activeCell) {
    gameState.score += gameState.activeIsDecoy ? -GAME_DECOY_PENALTY : 1;
    document.getElementById('game-score').textContent = String(gameState.score);
  }
  spawnMole();
}

function spawnMole() {
  if (!gameState) return;
  document.querySelectorAll('.game-cell').forEach(c => {
    c.classList.remove('active', 'decoy');
    c.textContent = '';
  });
  const idx = Math.floor(Math.random() * GAME_CELL_COUNT);
  const isDecoy = Math.random() < GAME_DECOY_CHANCE;
  gameState.activeCell = idx;
  gameState.activeIsDecoy = isDecoy;
  const cell = document.querySelector(`.game-cell[data-index="${idx}"]`);
  cell.classList.add('active');
  if (isDecoy) cell.classList.add('decoy');
  cell.textContent = isDecoy ? GAME_DECOY_EMOJI : '🍪';
}

function startFairGame() {
  buildGameGrid();
  document.getElementById('game-intro').classList.add('hidden');
  document.getElementById('game-result').classList.add('hidden');
  document.getElementById('game-start-btn').classList.add('hidden');
  document.getElementById('game-leaderboard').classList.add('hidden');
  document.getElementById('game-hud').classList.remove('hidden');
  document.getElementById('game-grid').classList.remove('hidden');

  gameState = { score: 0, timeLeft: GAME_DURATION_SECONDS, activeCell: null, activeIsDecoy: false };
  document.getElementById('game-score').textContent = '0';
  document.getElementById('game-time').textContent = String(GAME_DURATION_SECONDS);

  spawnMole();
  gameState.spawnTimer = setInterval(spawnMole, GAME_SPAWN_MS);
  gameState.tickTimer = setInterval(() => {
    gameState.timeLeft--;
    document.getElementById('game-time').textContent = String(gameState.timeLeft);
    if (gameState.timeLeft <= 0) endFairGame();
  }, 1000);
}

async function endFairGame() {
  if (!gameState) return;
  clearInterval(gameState.spawnTimer);
  clearInterval(gameState.tickTimer);
  const score = gameState.score;
  gameState = null;

  document.getElementById('game-grid').classList.add('hidden');
  document.getElementById('game-hud').classList.add('hidden');

  // Modulo can go negative in JS when score is negative — normalize the index.
  const line = GAME_RESULT_LINES[((score % GAME_RESULT_LINES.length) + GAME_RESULT_LINES.length) % GAME_RESULT_LINES.length];
  const resultEl = document.getElementById('game-result');
  resultEl.textContent = `🍪 Final score: ${score}! That's ${line}`;
  resultEl.classList.remove('hidden');

  const startBtn = document.getElementById('game-start-btn');
  startBtn.textContent = 'Play again';
  startBtn.classList.remove('hidden');

  if (currentUserName) {
    try {
      await callAction('addGameScore', { name: currentUserName, score });
      await refreshData();
    } catch (e) {
      console.error(e);
    }
  }
  renderLeaderboard('game-leaderboard', state.gameScores);
  document.getElementById('game-leaderboard').classList.remove('hidden');
}

// Shared by every mini-game's leaderboard: keep only each person's best
// score (so one person can't occupy every spot), then take the top N.
function topScoresByPerson(scores, limit = 5) {
  const bestByPerson = new Map();
  for (const s of scores) {
    const key = s.name.toLowerCase();
    const existing = bestByPerson.get(key);
    if (!existing || s.score > existing.score) bestByPerson.set(key, s);
  }
  return Array.from(bestByPerson.values()).sort((a, b) => b.score - a.score).slice(0, limit);
}

function renderLeaderboard(containerId, scores) {
  const container = document.getElementById(containerId);
  if (!scores.length) {
    container.innerHTML = '';
    return;
  }
  const top5 = topScoresByPerson(scores);
  container.innerHTML = `
    <p class="hint" style="margin-bottom: 6px">🏆 Top 5 scores</p>
    ${top5.map(s => `
      <div class="balance-row">
        <span>${avatarHtml(s.name)}${escapeHtml(s.name)}</span>
        <span>${s.score} pts</span>
      </div>
    `).join('')}
  `;
}

function resetFairGameView() {
  if (gameState) {
    clearInterval(gameState.spawnTimer);
    clearInterval(gameState.tickTimer);
    gameState = null;
  }
  document.getElementById('game-intro').classList.remove('hidden');
  document.getElementById('game-result').classList.add('hidden');
  document.getElementById('game-hud').classList.add('hidden');
  document.getElementById('game-grid').classList.add('hidden');
  document.getElementById('game-leaderboard').classList.remove('hidden');
  const startBtn = document.getElementById('game-start-btn');
  startBtn.textContent = 'Start';
  startBtn.classList.remove('hidden');
}

function closeFairGame() {
  resetFairGameView();
  document.getElementById('fair-game-overlay').classList.add('hidden');
}

document.getElementById('fair-badge').addEventListener('click', async () => {
  document.getElementById('fair-game-overlay').classList.remove('hidden');
  try {
    await refreshData();
  } catch (e) {
    console.error(e);
  }
  renderLeaderboard('game-leaderboard', state.gameScores);
});
document.getElementById('game-grid').addEventListener('click', onGameGridClick);
document.getElementById('game-start-btn').addEventListener('click', startFairGame);
document.getElementById('game-close').addEventListener('click', closeFairGame);
document.getElementById('fair-game-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeFairGame();
});

// ---------- Ice-fishing easter egg mini-game ("Set the Hook") ----------
// Wait for the tip-up flag to go green (a bite), then set the hook as fast as
// possible. Jig while it's still red (waiting) and that's a spooked-the-fish
// miss. Faster hooksets on green score more. Everyone gets the exact same
// number of rounds (not a fixed time window) so scores are directly
// comparable — a time window would let random luck (short vs. long waits)
// decide how many chances someone even gets.

const REACTION_ROUND_COUNT = 6;
const REACTION_MIN_DELAY_MS = 1000;
const REACTION_MAX_DELAY_MS = 3500;
const REACTION_EARLY_PENALTY = 6;
const REACTION_POINT_STEP_MS = 100; // one point per 100ms faster than the cap
const REACTION_POINT_CAP_MS = 1000; // reactions at/above this score 0

let reactionState = null; // { score, roundsPlayed, phase, readyAt, roundTimeout }

function startReactionRound() {
  if (!reactionState) return;
  const btn = document.getElementById('reaction-btn');
  reactionState.phase = 'waiting';
  btn.textContent = 'Wait for a bite…';
  btn.classList.remove('ready');
  btn.classList.add('waiting');

  const delay = REACTION_MIN_DELAY_MS + Math.random() * (REACTION_MAX_DELAY_MS - REACTION_MIN_DELAY_MS);
  reactionState.roundTimeout = setTimeout(() => {
    if (!reactionState) return;
    reactionState.phase = 'ready';
    reactionState.readyAt = performance.now();
    btn.textContent = 'Set the hook!';
    btn.classList.remove('waiting');
    btn.classList.add('ready');
  }, delay);
}

function onReactionBtnClick() {
  if (!reactionState) return;
  const feedbackEl = document.getElementById('reaction-feedback');

  if (reactionState.phase === 'waiting') {
    clearTimeout(reactionState.roundTimeout);
    reactionState.score -= REACTION_EARLY_PENALTY;
    feedbackEl.textContent = `Jigged too soon — you spooked it! -${REACTION_EARLY_PENALTY}`;
  } else {
    const elapsed = performance.now() - reactionState.readyAt;
    const points = Math.max(0, Math.round((REACTION_POINT_CAP_MS - elapsed) / REACTION_POINT_STEP_MS));
    reactionState.score += points;
    feedbackEl.textContent = `${Math.round(elapsed)}ms — +${points}`;
  }

  reactionState.roundsPlayed++;
  document.getElementById('reaction-score').textContent = String(reactionState.score);
  document.getElementById('reaction-round').textContent = `${reactionState.roundsPlayed}/${REACTION_ROUND_COUNT}`;

  if (reactionState.roundsPlayed >= REACTION_ROUND_COUNT) {
    endReactionGame();
  } else {
    startReactionRound();
  }
}

function startReactionGame() {
  document.getElementById('reaction-intro').classList.add('hidden');
  document.getElementById('reaction-result').classList.add('hidden');
  document.getElementById('reaction-start-btn').classList.add('hidden');
  document.getElementById('reaction-leaderboard').classList.add('hidden');
  document.getElementById('reaction-hud').classList.remove('hidden');
  document.getElementById('reaction-feedback').classList.remove('hidden');
  document.getElementById('reaction-btn').classList.remove('hidden');

  reactionState = { score: 0, roundsPlayed: 0, phase: null, readyAt: 0, roundTimeout: null };
  document.getElementById('reaction-score').textContent = '0';
  document.getElementById('reaction-round').textContent = `0/${REACTION_ROUND_COUNT}`;
  document.getElementById('reaction-feedback').textContent = '';

  startReactionRound();
}

async function endReactionGame() {
  if (!reactionState) return;
  clearTimeout(reactionState.roundTimeout);
  const score = reactionState.score;
  reactionState = null;

  document.getElementById('reaction-btn').classList.add('hidden');
  document.getElementById('reaction-hud').classList.add('hidden');
  document.getElementById('reaction-feedback').classList.add('hidden');

  const resultEl = document.getElementById('reaction-result');
  resultEl.textContent = `🎣 Final score: ${score}! ${score >= 36 ? 'Fastest hook on the lake.' : 'Reflexes could use a hotdish break.'}`;
  resultEl.classList.remove('hidden');

  const startBtn = document.getElementById('reaction-start-btn');
  startBtn.textContent = 'Play again';
  startBtn.classList.remove('hidden');

  if (currentUserName) {
    try {
      await callAction('addReactionScore', { name: currentUserName, score });
      await refreshData();
    } catch (e) {
      console.error(e);
    }
  }
  renderLeaderboard('reaction-leaderboard', state.reactionScores);
  document.getElementById('reaction-leaderboard').classList.remove('hidden');
}

function resetReactionGameView() {
  if (reactionState) {
    clearTimeout(reactionState.roundTimeout);
    reactionState = null;
  }
  document.getElementById('reaction-intro').classList.remove('hidden');
  document.getElementById('reaction-result').classList.add('hidden');
  document.getElementById('reaction-hud').classList.add('hidden');
  document.getElementById('reaction-btn').classList.add('hidden');
  document.getElementById('reaction-feedback').classList.add('hidden');
  document.getElementById('reaction-leaderboard').classList.remove('hidden');
  const startBtn = document.getElementById('reaction-start-btn');
  startBtn.textContent = 'Start';
  startBtn.classList.remove('hidden');
}

function closeReactionGame() {
  resetReactionGameView();
  document.getElementById('reaction-game-overlay').classList.add('hidden');
}

document.getElementById('reaction-game-badge').addEventListener('click', async () => {
  document.getElementById('reaction-game-overlay').classList.remove('hidden');
  try {
    await refreshData();
  } catch (e) {
    console.error(e);
  }
  renderLeaderboard('reaction-leaderboard', state.reactionScores);
});
document.getElementById('reaction-btn').addEventListener('click', onReactionBtnClick);
document.getElementById('reaction-start-btn').addEventListener('click', startReactionGame);
document.getElementById('reaction-close').addEventListener('click', closeReactionGame);
document.getElementById('reaction-game-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeReactionGame();
});

// ---------- Mini-game champion prizes ----------
// Two independent $2 bounties added to the REAL expense ledger — one for
// whoever holds the best State Fair Scramble score, one for whoever holds the
// best Set the Hook score, at the moment this is clicked. (Winning both means
// two separate $2 credits, not one combined $2.) There's no "end of trip"
// date in this app, so it's a manual button rather than something automatic.
// Ties split that game's $2 evenly among the tied winners, funded by
// everyone else. Each prize reuses the existing addExpense action (paidBy =
// winner, participants = everyone but that game's winner(s)) — no new
// backend endpoint needed, same trick settle() uses with more participants.
//
// To undo a prize: it's a normal row in the Expenses sheet (description
// "🏆 <game> champion prize"), so delete or edit it directly in the sheet
// like any other expense mistake — same as everything else in this app.

const PRIZE_AMOUNT = 2;
const PRIZE_GAMES = [
  { key: 'gameScores', label: 'State Fair Scramble' },
  { key: 'reactionScores', label: 'Set the Hook' },
];

function resolvePrizeAward(scores, gameLabel) {
  if (!scores.length) return { gameLabel, status: 'no-scores' };

  const ranked = topScoresByPerson(scores, Infinity);
  const topScore = ranked[0].score;
  const champions = ranked.filter(s => s.score === topScore);

  const winners = champions
    .map(c => state.people.find(p => p.name.toLowerCase() === c.name.toLowerCase()))
    .filter(Boolean);
  if (!winners.length) return { gameLabel, status: 'winner-missing' };

  const winnerIds = new Set(winners.map(w => w.id));
  const payers = state.people.filter(p => !winnerIds.has(p.id));
  if (payers.length === 0) return { gameLabel, status: 'all-tied' };

  const share = Math.round((PRIZE_AMOUNT / winners.length) * 100) / 100;
  return { gameLabel, status: 'ok', winners, payers, share };
}

function describePrizeAward(award) {
  if (award.status === 'no-scores') return `${award.gameLabel}: no scores yet — skipped.`;
  if (award.status === 'winner-missing') return `${award.gameLabel}: top scorer isn't in the People list anymore — skipped.`;
  if (award.status === 'all-tied') return `${award.gameLabel}: everyone's tied for first — skipped.`;
  const names = award.winners.map(w => w.name).join(' & ');
  return award.winners.length > 1
    ? `${award.gameLabel}: split $${PRIZE_AMOUNT.toFixed(2)} between ${names} ($${award.share.toFixed(2)} each).`
    : `${award.gameLabel}: $${award.share.toFixed(2)} to ${names}.`;
}

async function awardArcadePrizes() {
  try {
    await refreshData();
  } catch (e) {
    alert(`Couldn't load the latest scores: ${e.message}`);
    return;
  }

  const awards = PRIZE_GAMES.map(g => resolvePrizeAward(state[g.key], g.label));
  const usable = awards.filter(a => a.status === 'ok');
  if (!usable.length) {
    alert('No mini-game prizes to award right now — play a round first.');
    return;
  }

  const ok = await confirmDialog(awards.map(describePrizeAward).join('\n'), {
    okLabel: 'Award prizes',
    okClass: 'btn-confirm',
  });
  if (!ok) return;

  try {
    for (const award of usable) {
      for (const winner of award.winners) {
        await callAction('addExpense', {
          description: award.winners.length > 1
            ? `🏆 ${award.gameLabel} champion prize (tied)`
            : `🏆 ${award.gameLabel} champion prize`,
          amount: award.share,
          date: new Date().toISOString().slice(0, 10),
          paidBy: winner.id,
          participantIds: award.payers.map(p => p.id),
        });
      }
    }
    await refreshData();
    renderBalancesAndSettleUp();
    showSuccess('🏆 Prizes awarded!');
  } catch (e) {
    alert(e.message);
  }
}

document.getElementById('award-prize-btn').addEventListener('click', awardArcadePrizes);

// ---------- Bob Dylan Clicker easter egg (idle "cookie clicker") ----------
// Minnesota's own Bob Dylan (born in Duluth, raised in Hibbing) reimagined as
// Cookie Clicker: click Bob to earn "Dylans", then spend them on gear/gigs
// that auto-earn Dylans per second. State (count + upgrades) is saved to the
// Google Sheet, one row per identified person, so it follows you across
// devices/browsers and everyone shares a Top-5 leaderboard — including a
// capped bit of "while you were away" progress based on the last save time.
// Saving needs a name + a working backend; if neither is set up the game still
// plays, just without persistence.

const DYLAN_COST_GROWTH = 1.15;               // classic cookie-clicker price ramp
const DYLAN_OFFLINE_CAP_SECONDS = 8 * 3600;   // don't gift more than 8h of idle
const DYLAN_TICK_MS = 100;
const DYLAN_SAVE_MS = 15000;                  // push to the sheet at most this often

const DYLAN_UPGRADES = [
  { id: 'harmonica', emoji: '🎵', name: 'Harmonica rack', desc: '+0.2 / sec', baseCost: 15, dps: 0.2 },
  { id: 'lyrics', emoji: '✍️', name: 'Sharper lyrics', desc: '+1 per click', baseCost: 50, click: 1 },
  { id: 'acoustic', emoji: '🎸', name: 'Acoustic guitar', desc: '+1 / sec', baseCost: 100, dps: 1 },
  { id: 'electric', emoji: '🔌', name: 'Electric guitar ("Judas!")', desc: '+8 / sec', baseCost: 1100, dps: 8 },
  { id: 'band', emoji: '🥁', name: 'The Band', desc: '+47 / sec', baseCost: 12000, dps: 47 },
  { id: 'radio', emoji: '📻', name: 'Radio airplay', desc: '+260 / sec', baseCost: 130000, dps: 260 },
  { id: 'nobel', emoji: '🏅', name: 'Nobel Prize in Literature', desc: '+1.4K / sec', baseCost: 1400000, dps: 1400 },
  { id: 'tour', emoji: '🚌', name: 'Never Ending Tour', desc: '+7.8K / sec', baseCost: 20000000, dps: 7800 },
];

let dylanState = null; // { count, owned: {id: n}, dirty }
let dylanTickTimer = null;
let dylanSaveTimer = null;
let dylanSaving = false;

function dylanUpgradeCost(up) {
  const owned = dylanState.owned[up.id] || 0;
  return Math.ceil(up.baseCost * Math.pow(DYLAN_COST_GROWTH, owned));
}

function dylanDps() {
  return DYLAN_UPGRADES.reduce((sum, up) => sum + (up.dps || 0) * (dylanState.owned[up.id] || 0), 0);
}

function dylanClickPower() {
  return DYLAN_UPGRADES.reduce((p, up) => p + (up.click || 0) * (dylanState.owned[up.id] || 0), 1);
}

// 1234 -> "1.23K", 5000000 -> "5.00M" (Dylan counts get big fast).
function formatDylans(n) {
  if (n < 1000) return Number.isInteger(n) ? String(n) : n.toFixed(1);
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx'];
  let u = -1, v = n;
  do { v /= 1000; u++; } while (v >= 1000 && u < units.length - 1);
  return `${v.toFixed(2)}${units[u]}`;
}

function earnDylans(amount) {
  dylanState.count += amount;
  dylanState.dirty = true;
}

// Push the current save to the sheet. No name or no backend => can't persist,
// so it just no-ops (the game still plays this session). A single in-flight
// guard keeps the periodic timer from stacking requests.
async function saveDylanState() {
  if (!dylanState || !dylanState.dirty || !currentUserName) return;
  if (API_URL.includes('PASTE_YOUR') || dylanSaving) return;
  dylanSaving = true;
  dylanState.dirty = false;
  try {
    await callAction('saveDylan', {
      name: currentUserName,
      count: Math.floor(dylanState.count),
      owned: dylanState.owned,
    });
  } catch (e) {
    console.error(e);
    dylanState.dirty = true; // let the next tick retry
  } finally {
    dylanSaving = false;
  }
}

function renderDylanStats() {
  document.getElementById('dylan-count').textContent = formatDylans(Math.floor(dylanState.count));
  document.getElementById('dylan-dps').textContent =
    `${formatDylans(dylanDps())}/s · ${formatDylans(dylanClickPower())}/click`;
}

function renderDylanUpgrades() {
  const container = document.getElementById('dylan-upgrades');
  container.innerHTML = DYLAN_UPGRADES.map(up => {
    const owned = dylanState.owned[up.id] || 0;
    const cost = dylanUpgradeCost(up);
    const affordable = dylanState.count >= cost;
    return `
      <button type="button" class="dylan-upgrade" data-id="${up.id}" ${affordable ? '' : 'disabled'}>
        <span class="dylan-up-emoji">${up.emoji}</span>
        <span class="dylan-up-main">
          <span class="dylan-up-name">${escapeHtml(up.name)}</span>
          <span class="dylan-up-desc">${escapeHtml(up.desc)}</span>
        </span>
        <span class="dylan-up-side">
          <span class="dylan-up-cost">🎸 ${formatDylans(cost)}</span>
          <span class="dylan-up-owned">×${owned}</span>
        </span>
      </button>
    `;
  }).join('');
}

// Cheap per-tick update: only toggle each upgrade's affordability (its cost
// text only changes when you actually buy one, so no full re-render needed).
function refreshDylanAffordability() {
  document.querySelectorAll('#dylan-upgrades .dylan-upgrade').forEach(btn => {
    const up = DYLAN_UPGRADES.find(u => u.id === btn.dataset.id);
    if (up) btn.disabled = dylanState.count < dylanUpgradeCost(up);
  });
}

// Top 5 by current Dylan count. Others come from the last fetch; the current
// player's row is overlaid with their live count so the board moves in
// real time as they click and idle.
function renderDylanLeaderboard() {
  const container = document.getElementById('dylan-leaderboard');
  const rows = (state.dylan || []).map(d => ({ name: d.name, count: Number(d.count) || 0 }));
  if (currentUserName && dylanState) {
    const mine = rows.find(r => r.name.toLowerCase() === currentUserName.toLowerCase());
    if (mine) mine.count = Math.floor(dylanState.count);
    else rows.push({ name: currentUserName, count: Math.floor(dylanState.count) });
  }
  if (!rows.length) {
    container.innerHTML = '';
    return;
  }
  const top5 = rows.sort((a, b) => b.count - a.count).slice(0, 5);
  container.innerHTML = `
    <p class="hint" style="margin-bottom: 6px">🏆 Top 5 Dylans</p>
    ${top5.map(r => `
      <div class="balance-row">
        <span>${avatarHtml(r.name)}${escapeHtml(r.name)}</span>
        <span>🎸 ${formatDylans(r.count)}</span>
      </div>
    `).join('')}
  `;
}

function spawnDylanFloater(text) {
  const layer = document.getElementById('dylan-click-wrap');
  const span = document.createElement('span');
  span.className = 'dylan-floater';
  span.textContent = text;
  span.style.left = `${42 + Math.random() * 16}%`;
  layer.appendChild(span);
  setTimeout(() => span.remove(), 800);
}

function onDylanClick() {
  const gain = dylanClickPower();
  earnDylans(gain);
  renderDylanStats();
  refreshDylanAffordability();
  renderDylanLeaderboard();
  spawnDylanFloater(`+${formatDylans(gain)}`);
  const target = document.getElementById('dylan-click-target');
  target.classList.remove('pop');
  void target.offsetWidth; // restart the animation
  target.classList.add('pop');
}

function buyDylanUpgrade(id) {
  const up = DYLAN_UPGRADES.find(u => u.id === id);
  if (!up) return;
  const cost = dylanUpgradeCost(up);
  if (dylanState.count < cost) return;
  dylanState.count -= cost;
  dylanState.owned[id] = (dylanState.owned[id] || 0) + 1;
  dylanState.dirty = true;
  renderDylanStats();
  renderDylanUpgrades(); // cost changed, so a full re-render is warranted here
  saveDylanState();      // persist a purchase promptly
}

function dylanTick() {
  const dps = dylanDps();
  if (dps > 0) {
    earnDylans(dps * (DYLAN_TICK_MS / 1000));
    renderDylanStats();
    refreshDylanAffordability();
    renderDylanLeaderboard();
  }
}

async function openDylanGame() {
  const overlay = document.getElementById('dylan-game-overlay');
  const noteEl = document.getElementById('dylan-away');
  overlay.classList.remove('hidden');

  // First open this session: load this person's save from the sheet. Reopening
  // in the same session keeps the live in-memory state as-is.
  if (!dylanState) {
    let mine = null;
    if (currentUserName && !API_URL.includes('PASTE_YOUR')) {
      try {
        await refreshData();
        mine = (state.dylan || []).find(d => d.name.toLowerCase() === currentUserName.toLowerCase());
      } catch (e) {
        console.error(e);
      }
    }
    dylanState = {
      count: mine ? Number(mine.count) || 0 : 0,
      owned: mine && mine.owned && typeof mine.owned === 'object' ? mine.owned : {},
      dirty: false,
    };

    if (!currentUserName) {
      noteEl.textContent = '⚠️ Pick your name (tap your badge in the header) to save your Dylans and join the leaderboard.';
      noteEl.classList.remove('hidden');
    } else if (mine && mine.updatedAt) {
      // "While you were away" — capped idle earnings since the last save.
      const elapsed = Math.min(Math.max(0, (Date.now() - new Date(mine.updatedAt).getTime()) / 1000), DYLAN_OFFLINE_CAP_SECONDS);
      const away = dylanDps() * elapsed;
      if (away >= 1) {
        earnDylans(away);
        noteEl.textContent = `🎵 You earned ${formatDylans(Math.floor(away))} Dylans while you were away.`;
        noteEl.classList.remove('hidden');
      } else {
        noteEl.classList.add('hidden');
      }
    } else {
      noteEl.classList.add('hidden');
    }
  } else if (currentUserName && !API_URL.includes('PASTE_YOUR')) {
    // Refresh other players' standings for the leaderboard without disturbing
    // the live local count.
    try { await refreshData(); } catch (e) { console.error(e); }
  }

  renderDylanStats();
  renderDylanUpgrades();
  renderDylanLeaderboard();

  clearInterval(dylanTickTimer);
  dylanTickTimer = setInterval(dylanTick, DYLAN_TICK_MS);
  clearInterval(dylanSaveTimer);
  dylanSaveTimer = setInterval(saveDylanState, DYLAN_SAVE_MS);
}

function closeDylanGame() {
  clearInterval(dylanTickTimer); dylanTickTimer = null;
  clearInterval(dylanSaveTimer); dylanSaveTimer = null;
  saveDylanState();
  document.getElementById('dylan-game-overlay').classList.add('hidden');
}

async function resetDylanGame() {
  const ok = await confirmDialog(
    'Reset your Bob Dylan Clicker? This wipes your Dylans and all upgrades.',
    { okLabel: 'Reset', okClass: 'btn-danger' }
  );
  if (!ok) return;
  dylanState = { count: 0, owned: {}, dirty: true };
  await saveDylanState();
  renderDylanStats();
  renderDylanUpgrades();
  renderDylanLeaderboard();
  document.getElementById('dylan-away').classList.add('hidden');
}

document.getElementById('dylan-badge').addEventListener('click', openDylanGame);
document.getElementById('dylan-click-target').addEventListener('click', onDylanClick);
document.getElementById('dylan-upgrades').addEventListener('click', (e) => {
  const btn = e.target.closest('.dylan-upgrade');
  if (btn) buyDylanUpgrade(btn.dataset.id);
});
document.getElementById('dylan-reset').addEventListener('click', resetDylanGame);
document.getElementById('dylan-close').addEventListener('click', closeDylanGame);
document.getElementById('dylan-game-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDylanGame();
});

// A last-ditch save on page close — a normal fetch would be cancelled mid-flight,
// so use sendBeacon, which the browser delivers even as the page unloads.
window.addEventListener('beforeunload', () => {
  if (!dylanState || !dylanState.dirty || !currentUserName || API_URL.includes('PASTE_YOUR')) return;
  try {
    const body = new URLSearchParams({
      action: 'saveDylan',
      key: SHARED_KEY,
      data: JSON.stringify({ name: currentUserName, count: Math.floor(dylanState.count), owned: dylanState.owned }),
    });
    navigator.sendBeacon(API_URL, body);
  } catch (e) { /* best effort */ }
});

// ---------- Activity log ----------

document.getElementById('log-badge').addEventListener('click', openActivityLog);

async function openActivityLog() {
  const overlay = document.getElementById('log-overlay');
  const content = document.getElementById('log-content');
  content.textContent = 'Loading...';
  overlay.classList.remove('hidden');
  try {
    await refreshData();
    content.textContent = state.log.length ? state.log.join('\n') : 'No activity logged yet.';
  } catch (e) {
    content.textContent = `Couldn't load the log: ${e.message}`;
  }
}

function closeActivityLog() {
  document.getElementById('log-overlay').classList.add('hidden');
}

document.getElementById('log-close').addEventListener('click', closeActivityLog);
document.getElementById('log-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeActivityLog();
});

// ---------- Init ----------

async function init() {
  setDefaultDate();
  if (!API_URL.includes('PASTE_YOUR')) {
    currentUserName = await ensureIdentified();
    updateWhoamiBadge();
  }
  await loadForTab('add');
}

init();
