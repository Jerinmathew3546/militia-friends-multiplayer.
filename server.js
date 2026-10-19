'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  serveClient: true,
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e6,
  cors: { origin: true, methods: ['GET', 'POST'] },
});

io.engine.on('connection_error', err => {
  console.error('Socket.IO connection error:', err.message, err.context || '');
});

const PORT = Number(process.env.PORT) || 10000;
const MAX_PLAYERS = 4;
const WORLD_W = 1280;
const WORLD_H = 720;
const PLAYER_W = 52;
const PLAYER_H = 72;
const MAX_RESPAWNS = 5; // five extra lives after the first spawn
const TICK_MS = 50; // authoritative 20 Hz simulation
const ROOM = 'one-friends-arena';
const SPAWNS = [
  { x: 75, y: 593, face: 1 },
  { x: 390, y: 593, face: 1 },
  { x: 820, y: 593, face: -1 },
  { x: 1145, y: 593, face: -1 },
];
const PLATFORMS = [
  { x: 0, y: 665, w: 1280, h: 55 },
  { x: 118, y: 525, w: 240, h: 22 },
  { x: 430, y: 430, w: 220, h: 22 },
  { x: 760, y: 520, w: 245, h: 22 },
  { x: 1002, y: 365, w: 170, h: 22 },
  { x: 558, y: 585, w: 145, h: 18 },
];
// Damage intentionally reduced from the original offline game.
const WEAPONS = [
  { name: 'PISTOL', damage: 8, cooldown: 350, speed: 19, color: '#ffe08a' },
  { name: 'AK-47', damage: 5, cooldown: 105, speed: 18, color: '#ffb15e' },
  { name: 'SNIPER', damage: 20, cooldown: 850, speed: 27, color: '#b8e5ff' },
  { name: 'P90', damage: 3, cooldown: 75, speed: 17, color: '#8dffd0' },
];

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, status, players: players.size }));

const players = new Map();
let bullets = [];
let bulletSeq = 0;
let status = 'lobby'; // lobby | playing | finished
let winner = null;

function sanitiseName(value) {
  const name = String(value || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 16);
  return name || 'Player';
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function ack(callback, result) { if (typeof callback === 'function') callback(result); }
function getPlayer(socket) { return players.get(socket.id); }
function sortedPlayers() { return Array.from(players.values()); }
function snapshot() {
  return {
    status,
    winner,
    players: sortedPlayers().map(p => ({
      id: p.id, name: p.name, character: p.character, ready: p.ready,
      x: p.x, y: p.y, vx: p.vx, vy: p.vy, w: PLAYER_W, h: PLAYER_H,
      hp: p.hp, respawns: p.respawns, kills: p.kills, alive: p.alive,
      face: p.face, weapon: p.weapon, invulnerableUntil: p.invulnerableUntil,
      rematchVote: p.rematchVote,
    })),
    bullets: bullets.map(b => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, color: b.color })),
  };
}
function broadcast() { io.to(ROOM).emit('arena-state', snapshot()); }
function placeAtSpawn(p, index) {
  const s = SPAWNS[index % SPAWNS.length];
  p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0; p.face = s.face;
  p.grounded = false;
}
function clearRoundPlayer(p, index) {
  p.ready = false;
  p.hp = 100;
  p.respawns = MAX_RESPAWNS;
  p.kills = 0;
  p.alive = true;
  p.weapon = 0;
  p.cooldownUntil = 0;
  p.invulnerableUntil = 0;
  p.rematchVote = false;
  p.input = { x: 0, y: 0, fire: false, weapon: 0 };
  placeAtSpawn(p, index);
}
function resetToLobby() {
  status = 'lobby'; winner = null; bullets = [];
  sortedPlayers().forEach((p, i) => clearRoundPlayer(p, i));
  broadcast();
}
function startRound() {
  const ps = sortedPlayers();
  // Start with at least two ready players. Every connected player must have
  // chosen a unique fighter; with four in the lobby, two ready players are enough.
  if (ps.length < 2) return;
  if (ps.some(p => p.character === null)) return;
  if (ps.filter(p => p.ready).length < 2) return;
  bullets = []; winner = null; status = 'playing';
  const now = Date.now();
  ps.forEach((p, i) => {
    clearRoundPlayer(p, i);
    p.ready = true;
    p.invulnerableUntil = now + 1800;
  });
  io.to(ROOM).emit('server-message', `MATCH STARTED — ${ps.length}-PLAYER FREE-FOR-ALL!`);
  broadcast();
}
function ownerCanChoose(player, character) {
  if (!Number.isInteger(character) || character < 0 || character > 3) return false;
  return !sortedPlayers().some(p => p.id !== player.id && p.character === character);
}
function finishIfNeeded() {
  if (status !== 'playing') return;
  const alive = sortedPlayers().filter(p => p.alive);
  if (alive.length <= 1) {
    status = 'finished';
    winner = alive.length === 1 ? alive[0].id : null;
    bullets = [];
    io.to(ROOM).emit('server-message', winner ? `${alive[0].name} wins the round!` : 'Round over — no winner this time.');
    broadcast();
  }
}
function respawnOrEliminate(target, killerId) {
  const killer = killerId ? players.get(killerId) : null;
  if (killer && killer.id !== target.id) killer.kills += 1;
  if (target.respawns > 0) {
    target.respawns -= 1;
    target.hp = 100;
    target.alive = true;
    const index = Math.max(0, sortedPlayers().findIndex(p => p.id === target.id));
    placeAtSpawn(target, index);
    target.weapon = 0;
    target.cooldownUntil = 0;
    target.invulnerableUntil = Date.now() + 1800;
  } else {
    target.hp = 0;
    target.alive = false;
    target.input.fire = false;
  }
  finishIfNeeded();
}

function collidesPlatformOnLanding(p, oldY) {
  if (p.vy < 0) return false;
  for (const platform of PLATFORMS) {
    const overlapX = p.x + PLAYER_W > platform.x && p.x < platform.x + platform.w;
    const crossedTop = oldY + PLAYER_H <= platform.y && p.y + PLAYER_H >= platform.y;
    if (overlapX && crossedTop) {
      p.y = platform.y - PLAYER_H;
      p.vy = 0;
      p.grounded = true;
      return true;
    }
  }
  return false;
}
function fireBullet(p, now) {
  const wi = clamp(Number.isInteger(p.input.weapon) ? p.input.weapon : 0, 0, WEAPONS.length - 1);
  p.weapon = wi;
  const weapon = WEAPONS[wi];
  if (!p.input.fire || now < p.cooldownUntil || !p.alive) return;
  p.cooldownUntil = now + weapon.cooldown;
  const aimY = clamp(p.input.y, -0.6, 0.6) * 0.82;
  const len = Math.hypot(1, aimY) || 1;
  const dx = p.face || 1;
  bullets.push({
    id: ++bulletSeq, owner: p.id,
    x: p.x + PLAYER_W / 2 + dx * 25,
    y: p.y + 34,
    vx: (weapon.speed * dx) / len,
    vy: (weapon.speed * aimY) / len,
    damage: weapon.damage, color: weapon.color,
    born: now,
  });
}
function bulletHitsPlatform(b) {
  return PLATFORMS.some(p => b.x >= p.x && b.x <= p.x + p.w && b.y >= p.y && b.y <= p.y + p.h);
}
function updateRound() {
  if (status !== 'playing') return;
  const now = Date.now();
  const ps = sortedPlayers();
  for (const p of ps) {
    if (!p.alive) continue;
    const input = p.input;
    const oldY = p.y;
    p.vx = input.x * 7.0;
    if (Math.abs(input.x) > 0.12) p.face = input.x > 0 ? 1 : -1;
    if (input.y < -0.18) p.vy -= Math.min(0.95, Math.abs(input.y) * 0.82);
    else if (input.y > 0.35) p.vy += 0.2;
    p.vy = clamp(p.vy + 0.34, -9.5, 8.5);
    p.x = clamp(p.x + p.vx, 0, WORLD_W - PLAYER_W);
    p.y = clamp(p.y + p.vy, 0, WORLD_H + 40);
    p.grounded = false;
    collidesPlatformOnLanding(p, oldY);
    if (p.y + PLAYER_H > 665 && p.y + PLAYER_H < 700) { p.y = 665 - PLAYER_H; p.vy = 0; p.grounded = true; }
    if (p.y > WORLD_H) { respawnOrEliminate(p, null); continue; }
    fireBullet(p, now);
  }
  const remaining = [];
  for (const b of bullets) {
    b.x += b.vx; b.y += b.vy;
    if (b.x < -50 || b.x > WORLD_W + 50 || b.y < -50 || b.y > WORLD_H + 50 || now - b.born > 3000) continue;
    if (bulletHitsPlatform(b) && b.y < 660) continue;
    let hit = false;
    for (const target of ps) {
      if (!target.alive || target.id === b.owner || target.invulnerableUntil > now) continue;
      const overlapping = b.x >= target.x + 4 && b.x <= target.x + PLAYER_W - 4 && b.y >= target.y + 8 && b.y <= target.y + PLAYER_H - 5;
      if (!overlapping) continue;
      target.hp = Math.max(0, target.hp - b.damage);
      if (target.hp <= 0) respawnOrEliminate(target, b.owner);
      hit = true; break;
    }
    if (!hit) remaining.push(b);
  }
  bullets = remaining;
  finishIfNeeded();
  broadcast();
}
setInterval(updateRound, TICK_MS);

io.on('connection', socket => {
  socket.on('join-arena', (payload, callback) => {
    if (players.has(socket.id)) { ack(callback, { ok: true, id: socket.id }); return; }
    if (players.size >= MAX_PLAYERS) {
      const result = { ok: false, title: 'ARENA FULL', message: 'All four friend slots are occupied. Ask someone to leave, then try again.' };
      ack(callback, result); socket.emit('join-denied', result.message); return;
    }
    const p = {
      id: socket.id, name: sanitiseName(payload && payload.name), character: null,
      ready: false, x: 0, y: 593, vx: 0, vy: 0, hp: 100,
      respawns: MAX_RESPAWNS, kills: 0, alive: true, face: 1, weapon: 0,
      cooldownUntil: 0, invulnerableUntil: 0, grounded: false, rematchVote: false,
      input: { x: 0, y: 0, fire: false, weapon: 0 },
    };
    placeAtSpawn(p, players.size);
    players.set(socket.id, p);
    socket.join(ROOM);
    ack(callback, { ok: true, id: socket.id });
    socket.emit('join-result', { ok: true, id: socket.id });
    io.to(ROOM).emit('server-message', `${p.name} joined the shared lobby (${players.size}/4).`);
    broadcast();
  });

  socket.on('select-character', (value, callback) => {
    const p = getPlayer(socket);
    if (!p) { ack(callback, { ok: false, message: 'Join the arena first.' }); return; }
    if (status !== 'lobby' || p.ready) { ack(callback, { ok: false, message: 'You cannot change fighters right now.' }); return; }
    const character = Number(value);
    if (!ownerCanChoose(p, character)) {
      const result = { ok: false, message: 'That fighter has already been selected by another player.' };
      ack(callback, result); socket.emit('selection-result', result); return;
    }
    p.character = character;
    ack(callback, { ok: true });
    broadcast();
  });

  socket.on('ready-up', () => {
    const p = getPlayer(socket);
    if (!p || status !== 'lobby' || p.character === null) return;
    p.ready = true;
    broadcast();
    startRound();
  });

  socket.on('player-input', payload => {
    const p = getPlayer(socket);
    if (!p || status !== 'playing' || !p.alive || !payload || typeof payload !== 'object') return;
    p.input.x = clamp(Number(payload.x) || 0, -1, 1);
    p.input.y = clamp(Number(payload.y) || 0, -1, 1);
    p.input.fire = Boolean(payload.fire);
    const weapon = Number(payload.weapon);
    p.input.weapon = Number.isInteger(weapon) ? clamp(weapon, 0, WEAPONS.length - 1) : p.weapon;
  });

  socket.on('play-again', () => {
    const p = getPlayer(socket);
    if (!p || status !== 'finished') return;
    p.rematchVote = true;
    broadcast();
    const ps = sortedPlayers();
    if (ps.length === MAX_PLAYERS && ps.every(player => player.rematchVote)) {
      resetToLobby();
      io.to(ROOM).emit('server-message', 'Rematch ready. Confirm your fighter and ready up!');
    }
  });

  socket.on('leave-arena', () => removePlayer(socket));
  socket.on('disconnect', () => removePlayer(socket));
});

function removePlayer(socket) {
  const p = players.get(socket.id);
  if (!p) return;
  players.delete(socket.id);
  socket.leave(ROOM);
  if (status !== 'lobby') {
    status = 'lobby'; winner = null; bullets = [];
    sortedPlayers().forEach((other, i) => clearRoundPlayer(other, i));
  }
  io.to(ROOM).emit('server-message', `${p.name} left the arena. ${players.size}/4 player${players.size === 1 ? '' : 's'} remain.`);
  broadcast();
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Militia Friends Arena listening on 0.0.0.0:${PORT}`);
});
