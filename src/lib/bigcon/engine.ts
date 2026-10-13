// Host-side authoritative simulation for The Big Con FPS Battle Royale
// Runs the game loop, processes inputs, advances zone, computes hits.

import {
  GAME,
  NODES,
  WEAPONS,
  MOODS,
  LOOT_TABLE,
  PCOLORS,
  BOT_NAMES,
  CHARS,
  charById,
  type MoodKey,
  type WeaponId,
  type WeaponDef,
  type NodeDef,
  type CharDef,
} from "./constants";
import type {
  GameState,
  PlayerState,
  PlayerInput,
  ProjectileState,
  LootState,
  KillFeedEntry,
  FxEntry,
  LogEntry,
} from "./types";

// ============ Helpers ============

function now() {
  return Date.now();
}

function dist2D(
  a: [number, number, number],
  b: [number, number, number]
): number {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dz * dz);
}

function len3(v: [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function norm3(v: [number, number, number]): [number, number, number] {
  const l = len3(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function yawDir(yaw: number): [number, number] {
  return [Math.sin(yaw), Math.cos(yaw)];
}

export function clampGoal(v: number): number {
  const n = Math.round(Number(v) || 0);
  if (!n) return GAME.GOAL_DEF;
  return Math.max(GAME.GOAL_MIN, Math.min(GAME.GOAL_MAX, n));
}

// ============ Initial state ============

export function createInitialState(
  roster: {
    name: string;
    playerId: string;
    charId: string | null;
  }[],
  goal: number,
  botCount: number = 0
): GameState {
  // Compose full roster including bots (only used in practice mode)
  const fullRoster = [...roster];
  const usedCharIds = new Set(roster.map((r) => r.charId).filter(Boolean));
  const availableChars = CHARS.filter((c) => !usedCharIds.has(c.id));
  for (let b = 0; b < botCount; b++) {
    const name = BOT_NAMES[b % BOT_NAMES.length] + " " + (b + 1);
    const char = availableChars.length > 0
      ? availableChars.splice(Math.floor(Math.random() * availableChars.length), 1)[0]
      : null;
    fullRoster.push({
      name,
      playerId: "bot-" + b + "-" + Math.random().toString(36).slice(2, 8),
      charId: char ? char.id : null,
    });
  }

  // Shuffle starting seats (same vibe as the board game)
  const order = fullRoster.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  const seated = order.map((i) => fullRoster[i]);

  // Spawn points: ring around center, 25m out
  const players: PlayerState[] = seated.map((d, i) => {
    const angle = (i / seated.length) * Math.PI * 2;
    const r = 25;
    const char = d.charId ? charById(d.charId) : null;
    return {
      id: d.playerId,
      idx: i,
      name: d.name,
      color: PCOLORS[i % PCOLORS.length],
      charId: d.charId,
      money: GAME.START_MONEY,
      intel: GAME.START_INTEL,
      cortisol: GAME.START_CORTISOL,
      cortisolCap: char && char.id === "thousandyardwax"
        ? GAME.CORTISOL_MAX + 1
        : GAME.CORTISOL_MAX,
      pos: [Math.cos(angle) * r, 0, Math.sin(angle) * r],
      vel: [0, 0, 0],
      yaw: -angle + Math.PI,
      pitch: 0,
      weapon: "LEAK",
      lastShotMs: 0,
      cooldownUntil: 0,
      alive: true,
      dc: false,
      raided: false,
      cloakedUntil: 0,
      markedUntil: 0,
      buffUntil: 0,
      kills: 0,
      owned: [],
      diedAt: 0,
      rank: 0,
      bot: d.playerId.startsWith("bot-"),
    };
  });

  // Initial loot spread
  const loot: LootState[] = [];
  for (let i = 0; i < 30; i++) {
    loot.push(spawnLootItem(loot.length, i * 137 + 17));
  }

  const startMs = now();
  return {
    players,
    projectiles: [],
    loot,
    killFeed: [],
    log: [
      { ts: startMs, text: "The board is pinned up. The con begins." },
      { ts: startMs, text: `Win: ${goal} in the bank, OR last con standing.` },
    ],
    chat: [],
    logN: 2,
    chatN: 0,
    owner: {},
    capture: {},
    zoneCenter: [0, 0],
    zoneRadius: GAME.ZONE_START_RADIUS,
    zoneTargetRadius: GAME.ZONE_START_RADIUS,
    zoneTargetCenter: [0, 0],
    zoneShrinkStart: 0,
    zoneShrinkEnd: 0,
    zonePhase: "STABLE",
    zoneStage: 0,
    zoneNextShrink: startMs + GAME.ZONE_SHRINK_INTERVAL_MS,
    mood: "CALM",
    moodUntil: 0,
    wire: "all quiet on the wire… for now",
    startedAt: startMs,
    elapsed: 0,
    goal,
    over: false,
    winnerIdx: -1,
    winReason: "",
    fx: [],
    nextLootSpawn: startMs + 20000,
  };
}

let lootIdCounter = 1;
function spawnLootItem(prevId: number, seed: number): LootState {
  const id = lootIdCounter++;
  const idx = Math.floor(Math.random() * LOOT_TABLE.length);
  const def = LOOT_TABLE[idx];
  // Spread around the arena, biased toward node positions sometimes
  let pos: [number, number, number];
  if (seed % 3 === 0 && NODES.length > 0) {
    const n = NODES[Math.floor(Math.random() * NODES.length)];
    const a = Math.random() * Math.PI * 2;
    const r = n.radius + 2 + Math.random() * 6;
    pos = [n.pos[0] + Math.cos(a) * r, 0.5, n.pos[2] + Math.sin(a) * r];
  } else {
    const a = Math.random() * Math.PI * 2;
    const r = 15 + Math.random() * 75;
    pos = [Math.cos(a) * r, 0.5, Math.sin(a) * r];
  }
  return {
    id,
    kind: def.kind,
    amount: def.amount,
    mesh: def.mesh,
    color: def.color,
    label: def.label,
    pos,
    bornAt: now(),
    magnet: def.kind === "MAGNET",
  };
}

// ============ Logging ============

export function log(s: GameState, text: string) {
  s.log.push({ ts: now(), text });
  s.logN = (s.logN | 0) + 1;
  if (s.log.length > 200) s.log.shift();
}

export function chat(s: GameState, msg: { idx: number; name: string; text: string }) {
  s.chat.push({ ts: now(), ...msg });
  s.chatN = (s.chatN | 0) + 1;
  if (s.chat.length > 60) s.chat.shift();
}

let fxIdCounter = 1;
export function fx(
  s: GameState,
  text: string,
  color: string,
  pos?: [number, number, number],
  big: boolean = false
) {
  const id = fxIdCounter++;
  s.fx.push({ id, ts: now(), text, color, pos, big });
  if (s.fx.length > 60) s.fx.shift();
  return id;
}

export function setMood(s: GameState, k: MoodKey, headline: string) {
  const prev = s.mood;
  s.mood = k;
  s.moodUntil = now() + 30000;
  s.wire = headline;
  if (prev !== k) {
    log(s, `THE MOOD SHIFTS — ${MOODS[k].label} (${MOODS[k].desc}).`);
    fx(s, MOODS[k].label, MOODS[k].color, [0, 6, 0], true);
  }
}

// ============ Effects on players ============

export function gain(s: GameState, idx: number, amt: number, why: string) {
  const p = s.players[idx];
  if (!p || !p.alive) return;
  p.money += amt;
  fx(s, `+$${amt}`, "#7fe08d", [p.pos[0], p.pos[1] + 2.4, p.pos[2]]);
}

export function lose(s: GameState, idx: number, amt: number, why: string) {
  const p = s.players[idx];
  if (!p || !p.alive) return;
  const real = Math.min(p.money, amt);
  p.money -= real;
  fx(s, `-$${real}`, "#ff6b5e", [p.pos[0], p.pos[1] + 2.4, p.pos[2]]);
}

export function giveIntel(s: GameState, idx: number, n: number, why: string) {
  const p = s.players[idx];
  if (!p || !p.alive) return;
  p.intel += n;
  fx(s, `INTEL+${n}`, "#55c1ff", [p.pos[0], p.pos[1] + 2.4, p.pos[2]]);
}

export function addCortisol(
  s: GameState,
  idx: number,
  n: number,
  why: string,
  srcIdx: number = -1
) {
  const p = s.players[idx];
  if (!p || !p.alive || n === 0) return;
  // Tomkins "BACKROOM DEAL" mark: +2 cortisol from every source
  if (p.markedUntil > now() && n > 0) {
    n += 2;
  }
  // Denial Swan passive: first lethal hit each life only adds +3
  if (p.charId === "denialswan" && !p.raided && p.cortisol + n >= p.cortisolCap) {
    // If this hit would be lethal, reduce to +3 instead (once per life)
    if (p.cortisol < 3) {
      n = 3 - p.cortisol;
      fx(s, "DENIED", "#55c1ff", [p.pos[0], p.pos[1] + 2.4, p.pos[2]]);
    }
  }
  p.cortisol = Math.max(0, Math.min(p.cortisolCap, p.cortisol + n));
  fx(
    s,
    `${n > 0 ? "+" : ""}${n} FIRE`,
    n > 0 ? "#ffa94d" : "#8fbf7f",
    [p.pos[0], p.pos[1] + 2.4, p.pos[2]]
  );
  if (p.cortisol >= p.cortisolCap) {
    raidPlayer(s, idx, srcIdx);
  }
}

// ============ Raid: the only way to die ============
export function raidPlayer(
  s: GameState,
  idx: number,
  srcIdx: number = -1
) {
  const p = s.players[idx];
  if (!p || !p.alive) return;
  p.alive = false;
  p.raided = true;
  p.cortisol = p.cortisolCap;
  p.diedAt = now();
  // Count alive players to assign rank
  const aliveCount = s.players.filter((q) => q.alive).length;
  p.rank = aliveCount + 1; // they placed at this rank
  // Drop their money as loot bundles
  const droppedMoney = Math.floor(p.money * 0.6);
  if (droppedMoney > 0) {
    s.loot.push({
      id: lootIdCounter++,
      kind: "MONEY",
      amount: droppedMoney,
      mesh: "cash",
      color: 0x7fe08d,
      label: `$${droppedMoney} (from ${p.name})`,
      pos: [p.pos[0], 0.5, p.pos[2]],
      bornAt: now(),
      magnet: false,
    });
    p.money -= droppedMoney;
  }
  // Drop their intel
  if (p.intel > 0) {
    s.loot.push({
      id: lootIdCounter++,
      kind: "INTEL",
      amount: p.intel,
      mesh: "intel",
      color: 0x55c1ff,
      label: `INTEL+${p.intel} (from ${p.name})`,
      pos: [p.pos[0] + 1.5, 0.5, p.pos[2]],
      bornAt: now(),
      magnet: false,
    });
    p.intel = 0;
  }
  // Release their nodes
  Object.keys(s.owner).forEach((nid) => {
    if (s.owner[nid] === idx) {
      delete s.owner[nid];
    }
  });
  // Add killfeed entry
  const kfe: KillFeedEntry = {
    id: s.killFeed.length,
    killerIdx: srcIdx,
    victimIdx: idx,
    weapon: srcIdx < 0 ? "RAID" : "RAID",
    ts: now(),
  };
  s.killFeed.push(kfe);
  if (s.killFeed.length > 8) s.killFeed.shift();
  // Award kill if a source player caused it
  if (srcIdx >= 0 && srcIdx !== idx && s.players[srcIdx]) {
    s.players[srcIdx].kills++;
    // Tomkins passive
    if (s.players[srcIdx].charId === "tomkins") {
      giveIntel(s, srcIdx, 1, "backroom dealer");
    }
    // Japsn Chen passive: 25% of damage -> intel (already done on damage)
  }
  log(
    s,
    `REGULATOR RAID! ${p.name} is stripped of everything and removed from the table.`
  );
  fx(s, "RAIDED", "#ff6b5e", [p.pos[0], p.pos[1] + 3, p.pos[2]], true);
  // Check win condition
  checkWin(s);
}

// ============ Win condition ============

export function checkWin(s: GameState) {
  if (s.over) return;
  const alive = s.players.filter((p) => p.alive);
  // Money win: any alive player reaches goal AND holds at least 3 different node types
  for (const p of alive) {
    if (p.money >= s.goal) {
      const heldTypes = new Set<string>();
      Object.keys(s.owner).forEach((nid) => {
        if (s.owner[nid] === p.idx) {
          const node = NODES.find((n) => n.id === nid);
          if (node) heldTypes.add(node.type);
        }
      });
      if (heldTypes.size >= 3) {
        s.over = true;
        s.winnerIdx = p.idx;
        s.winReason = `Extracted $${p.money} to offshore — diversified across ${heldTypes.size} sectors.`;
        log(s, `${p.name} WINS — extracted $${p.money} offshore. THE CON IS COMPLETE.`);
        return;
      }
    }
  }
  // Last-standing win
  if (alive.length === 1 && s.players.length > 1) {
    s.over = true;
    s.winnerIdx = alive[0].idx;
    s.winReason = "Last con standing — every rival was raided by the regulators.";
    log(s, `${alive[0].name} WINS — last con standing.`);
    return;
  }
  // Everyone died simultaneously — shouldn't happen, but handle
  if (alive.length === 0) {
    s.over = true;
    s.winnerIdx = -1;
    s.winReason = "The regulators raided everyone. No winner.";
  }
}

// ============ Movement & physics ============

export function applyInput(
  s: GameState,
  idx: number,
  input: PlayerInput,
  dtMs: number
) {
  const p = s.players[idx];
  if (!p || !p.alive) return;
  const dt = dtMs / 1000;
  // Apply look before movement so direction always matches the camera
  // (Three.js camera forward at yaw=0 is world -Z; right is world +X).
  p.yaw = Number.isFinite(input.yaw) ? input.yaw : p.yaw;
  p.pitch = Number.isFinite(input.pitch) ? input.pitch : p.pitch;
  const sinYaw = Math.sin(p.yaw);
  const cosYaw = Math.cos(p.yaw);
  let mx = 0;
  let mz = 0;
  if (input.forward) {
    mx -= sinYaw;
    mz -= cosYaw;
  }
  if (input.back) {
    mx += sinYaw;
    mz += cosYaw;
  }
  if (input.left) {
    mx -= cosYaw;
    mz += sinYaw;
  }
  if (input.right) {
    mx += cosYaw;
    mz -= sinYaw;
  }
  const len = Math.sqrt(mx * mx + mz * mz);
  if (len > 0) {
    mx /= len;
    mz /= len;
  }
  const speed = input.sprint ? GAME.PLAYER_SPRINT : GAME.PLAYER_SPEED;
  // Apply horizontal velocity (instant — arcade feel)
  p.vel[0] = mx * speed;
  p.vel[2] = mz * speed;
  // Gravity & jump
  p.vel[1] -= GAME.GRAVITY * dt;
  if (input.jump && p.pos[1] <= 0.01) {
    p.vel[1] = GAME.PLAYER_JUMP;
  }
  // Integrate
  p.pos[0] += p.vel[0] * dt;
  p.pos[1] += p.vel[1] * dt;
  p.pos[2] += p.vel[2] * dt;
  // Floor
  if (p.pos[1] < 0) {
    p.pos[1] = 0;
    p.vel[1] = 0;
  }
  // World bounds
  const half = GAME.WORLD_SIZE / 2 - 2;
  p.pos[0] = Math.max(-half, Math.min(half, p.pos[0]));
  p.pos[2] = Math.max(-half, Math.min(half, p.pos[2]));
  // Look was applied before movement to keep the movement basis in sync.
}

// ============ Shooting ============

let projIdCounter = 1;
export function fireShot(
  s: GameState,
  idx: number,
  weapon: WeaponId,
  pos: [number, number, number],
  dir: [number, number, number]
): ProjectileState | null {
  const p = s.players[idx];
  if (!p || !p.alive) return null;
  const w = WEAPONS.find((x) => x.id === weapon);
  if (!w) return null;
  // Resource check
  if (p.intel < w.costIntel) return null;
  if (p.money < w.costMoney) return null;
  // Fire rate
  if (now() - p.lastShotMs < w.fireRateMs) return null;
  // Requirement: must own a node of `requires` type
  if (w.requires) {
    const hasIt = Object.keys(s.owner).some((nid) => {
      if (s.owner[nid] !== idx) return false;
      const node = NODES.find((n) => n.id === nid);
      return node && node.type === w.requires;
    });
    if (!hasIt) return null;
  }
  // Pay cost
  p.intel -= w.costIntel;
  p.money -= w.costMoney;
  p.lastShotMs = now();
  // Apply Japsn Chen buff: next 3 shots +2 dmg, steal $3
  let dmg = w.damage;
  let steal = w.stealMoney;
  if (p.buffUntil > now()) {
    dmg += 2;
    steal += 3;
  }
  // Spawn projectile
  const nd = norm3(dir);
  const proj: ProjectileState = {
    id: projIdCounter++,
    ownerId: idx,
    weapon,
    pos: [pos[0], pos[1], pos[2]],
    vel: [nd[0] * w.projectileSpeed, nd[1] * w.projectileSpeed, nd[2] * w.projectileSpeed],
    bornAt: now(),
  };
  s.projectiles.push(proj);
  // Store buff dmg/steal on projectile via id encoding (simpler: stash on weapon damage at hit time)
  // We'll just look up the buff on the owner at hit time.
  // Mark for japsn chen buff consumption
  if (p.buffUntil > now() && p.charId === "japsnchen") {
    // Decrement by counting projectiles in flight from buffed owner — handled at hit
  }
  return proj;
}

// ============ Projectile simulation & hits ============

export function tickProjectiles(s: GameState, dtMs: number) {
  const dt = dtMs / 1000;
  const nowMs = now();
  const keep: ProjectileState[] = [];
  for (const proj of s.projectiles) {
    proj.pos[0] += proj.vel[0] * dt;
    proj.pos[1] += proj.vel[1] * dt;
    proj.pos[2] += proj.vel[2] * dt;
    if (nowMs - proj.bornAt > GAME.PROJECTILE_LIFETIME_MS) continue;
    if (proj.pos[1] < 0 || proj.pos[1] > 30) continue;
    // World bounds
    const half = GAME.WORLD_SIZE / 2;
    if (Math.abs(proj.pos[0]) > half || Math.abs(proj.pos[2]) > half) continue;
    // Hit check vs alive players (not owner)
    let hit = false;
    for (let i = 0; i < s.players.length; i++) {
      if (i === proj.ownerId) continue;
      const p = s.players[i];
      if (!p.alive) continue;
      // Cloak: ignore leak projectiles
      if (p.cloakedUntil > nowMs && proj.weapon === "LEAK") continue;
      const dx = p.pos[0] - proj.pos[0];
      const dy = p.pos[1] + 1.0 - proj.pos[1]; // body center ~1m up
      const dz = p.pos[2] - proj.pos[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 1.2) {
        // Hit!
        applyHit(s, proj, i);
        hit = true;
        break;
      }
    }
    if (hit) continue;
    keep.push(proj);
  }
  s.projectiles = keep;
}

function applyHit(s: GameState, proj: ProjectileState, victimIdx: number) {
  const w = WEAPONS.find((x) => x.id === proj.weapon);
  if (!w) return;
  const owner = s.players[proj.ownerId];
  if (!owner) return;
  // Compute damage (apply japsn chen buff if active)
  let dmg = w.damage;
  let steal = w.stealMoney;
  if (owner.buffUntil > now() && owner.charId === "japsnchen") {
    dmg += 2;
    steal += 3;
  }
  // Mood: FRENZY makes leaks hit harder
  if (s.mood === "FRENZY" && proj.weapon === "LEAK") {
    dmg += 1;
  }
  // Apply cortisol
  addCortisol(s, victimIdx, dmg, `${w.name} from ${owner.name}`, proj.ownerId);
  // Steal money
  if (steal > 0) {
    const victim = s.players[victimIdx];
    const real = Math.min(victim.money, steal);
    victim.money -= real;
    owner.money += real;
    fx(s, `-$${real}`, "#ff6b5e", [victim.pos[0], victim.pos[1] + 2.4, victim.pos[2]]);
    fx(s, `+$${real}`, "#7fe08d", [owner.pos[0], owner.pos[1] + 2.4, owner.pos[2]]);
  }
  // Japsn Chen: 25% of damage -> intel (round up)
  if (owner.charId === "japsnchen" && dmg > 0) {
    const gainedIntel = Math.max(1, Math.floor(dmg * 0.25));
    giveIntel(s, proj.ownerId, gainedIntel, "hedge fund skim");
  }
  // Hit marker fx for owner
  fx(s, "HIT", w.projectileColor === 0x55c1ff ? "#55c1ff" : "#f5c542", [
    s.players[victimIdx].pos[0],
    s.players[victimIdx].pos[1] + 2.0,
    s.players[victimIdx].pos[2],
  ]);
}

// ============ Zone (battle royale regulator perimeter) ============

export function tickZone(s: GameState) {
  const nowMs = now();
  if (s.over) return;
  // Shrink interpolation
  if (s.zonePhase === "SHRINKING") {
    const t = Math.min(1, (nowMs - s.zoneShrinkStart) / (s.zoneShrinkEnd - s.zoneShrinkStart));
    s.zoneRadius = lerp(s.zoneRadius, s.zoneTargetRadius, 0.02); // smooth
    if (t >= 1) {
      s.zonePhase = "STABLE";
      s.zoneRadius = s.zoneTargetRadius;
      s.zoneCenter = s.zoneTargetCenter;
      s.zoneNextShrink = nowMs + GAME.ZONE_SHRINK_INTERVAL_MS;
      log(s, `The regulator perimeter holds at radius ${Math.round(s.zoneRadius)}m.`);
    }
  } else {
    // Stable — check if time to start next shrink
    if (nowMs >= s.zoneNextShrink && s.zoneRadius > GAME.ZONE_MIN_RADIUS) {
      // Pick a new target — smaller radius, shifted center
      const newR = Math.max(GAME.ZONE_MIN_RADIUS, s.zoneRadius * 0.65);
      // New center: random shift toward current zone center, biased inward
      const ang = Math.random() * Math.PI * 2;
      const maxShift = Math.max(0, s.zoneRadius - newR);
      const shift = Math.random() * maxShift * 0.6;
      s.zoneTargetCenter = [
        s.zoneCenter[0] + Math.cos(ang) * shift,
        s.zoneCenter[1] + Math.sin(ang) * shift,
      ];
      s.zoneTargetRadius = newR;
      s.zoneShrinkStart = nowMs;
      s.zoneShrinkEnd = nowMs + GAME.ZONE_SHRINK_TIME_MS;
      s.zonePhase = "SHRINKING";
      s.zoneStage++;
      log(s, `REGULATOR CRACKDOWN ${s.zoneStage} — perimeter tightening to ${Math.round(newR)}m.`);
      fx(s, `CRACKDOWN ${s.zoneStage}`, "#ff6b5e", [0, 6, 0], true);
      // Random mood shift on crackdown
      if (Math.random() < 0.6) {
        const moods: MoodKey[] = ["PANIC", "FRENZY", "BOOM"];
        const pick = moods[Math.floor(Math.random() * moods.length)];
        setMood(s, pick, `crackdown ${s.zoneStage} — ${MOODS[pick].desc}`);
      }
    }
  }
  // Damage players outside zone
  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i];
    if (!p.alive) continue;
    const dx = p.pos[0] - s.zoneCenter[0];
    const dz = p.pos[2] - s.zoneCenter[1];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > s.zoneRadius) {
      // Apply cortisol per second (scaled by stage)
      const dmgPerSec = GAME.ZONE_DAMAGE_PER_SEC * (1 + s.zoneStage * 0.5);
      // We tick at every state-send (~50ms), so apply proportional dmg
      const applyDmg = dmgPerSec * 0.05; // approximate per-tick
      addCortisol(s, i, applyDmg, "outside the regulator perimeter");
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ============ Node income & capture ============

let incomeAccumulator = 0;
export function tickNodes(s: GameState, dtMs: number) {
  if (s.over) return;
  const dt = dtMs / 1000;
  incomeAccumulator += dt;
  if (incomeAccumulator < 0.5) return; // pay out every 0.5s
  const payout = incomeAccumulator;
  incomeAccumulator = 0;
  const mood = MOODS[s.mood];
  for (const node of NODES) {
    const ownerIdx = s.owner[node.id];
    if (ownerIdx == null) continue;
    const p = s.players[ownerIdx];
    if (!p || !p.alive) {
      delete s.owner[node.id];
      continue;
    }
    let amt = node.income * payout;
    // Mood modifiers
    if (node.type === "COMMODITY") amt += mood.commodityBonus * payout;
    if (node.type === "BANK") amt -= mood.bankPenalty * payout;
    if (node.type === "MEDIA") amt += mood.mediaBonus * payout;
    if (node.type === "REGULATOR") amt += mood.regulatorBonus * payout;
    // Bessock passive: +$1/sec anywhere
    if (p.charId === "bessock") amt += payout;
    // Mark Watson passive: +$1/sec inside commodity radius
    if (
      p.charId === "markwatson" &&
      node.type === "COMMODITY" &&
      dist2D(p.pos, node.pos) < node.radius + 3
    ) {
      amt += payout;
    }
    // Jim Chalmers passive: +$2/sec inside regulator radius
    if (
      p.charId === "jimchalmers" &&
      node.type === "REGULATOR" &&
      dist2D(p.pos, node.pos) < node.radius + 3
    ) {
      amt += 2 * payout;
    }
    p.money += amt;
  }
  // Tick capture progress for players standing in node radii
  const nowMs = now();
  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i];
    if (!p.alive) continue;
    for (const node of NODES) {
      const d = dist2D(p.pos, node.pos);
      if (d > node.radius) continue;
      // Player is inside this node
      const currentOwner = s.owner[node.id];
      if (currentOwner === i) continue; // already own it
      // Start or continue capture
      const c = s.capture[node.id];
      if (!c || c.idx !== i) {
        s.capture[node.id] = { idx: i, startedAt: nowMs };
      } else {
        const elapsed = nowMs - c.startedAt;
        if (elapsed >= GAME.CAPTURE_TIME_MS) {
          // Capture!
          if (currentOwner != null) {
            const old = s.players[currentOwner];
            if (old) {
              log(s, `${p.name} seizes ${node.name.join(" ")} from ${old.name}.`);
            }
          } else {
            log(s, `${p.name} seizes ${node.name.join(" ")}.`);
          }
          s.owner[node.id] = i;
          // Add to player's owned set
          if (!p.owned.includes(node.id)) p.owned.push(node.id);
          // Remove from any previous owner
          s.players.forEach((q, j) => {
            if (j !== i) {
              const k = q.owned.indexOf(node.id);
              if (k >= 0) q.owned.splice(k, 1);
            }
          });
          delete s.capture[node.id];
          fx(s, "SEIZED", p.color, [node.pos[0], 4, node.pos[2]], true);
        }
      }
    }
  }
  // Cancel captures where the player left the radius
  Object.keys(s.capture).forEach((nid) => {
    const c = s.capture[nid];
    const p = s.players[c.idx];
    if (!p || !p.alive) {
      delete s.capture[nid];
      return;
    }
    const node = NODES.find((n) => n.id === nid);
    if (!node) {
      delete s.capture[nid];
      return;
    }
    const d = dist2D(p.pos, node.pos);
    if (d > node.radius) {
      delete s.capture[nid];
    }
  });
}

// ============ Loot pickup ============

export function tickLoot(s: GameState) {
  if (s.over) return;
  const nowMs = now();
  // Spawn more loot periodically
  if (nowMs > s.nextLootSpawn && s.loot.length < 50) {
    s.loot.push(spawnLootItem(s.loot.length, nowMs));
    s.nextLootSpawn = nowMs + 8000 + Math.random() * 8000;
  }
  // Pickup check
  const keep: LootState[] = [];
  for (const item of s.loot) {
    let pickedUp = false;
    for (let i = 0; i < s.players.length; i++) {
      const p = s.players[i];
      if (!p.alive) continue;
      const d = dist2D(p.pos, item.pos);
      if (d < 1.8) {
        applyLoot(s, i, item);
        pickedUp = true;
        break;
      }
    }
    if (!pickedUp) keep.push(item);
  }
  s.loot = keep;
}

function applyLoot(s: GameState, idx: number, item: LootState) {
  const p = s.players[idx];
  if (!p) return;
  switch (item.kind) {
    case "MONEY":
      gain(s, idx, item.amount, "picked up cash");
      break;
    case "INTEL":
      giveIntel(s, idx, item.amount, "picked up dossier");
      break;
    case "CORTISOL_DOWN":
      addCortisol(s, idx, item.amount, "running shoes");
      break;
    case "MAGNET":
      // Pulls $5 from every other alive player
      s.players.forEach((q, j) => {
        if (j === idx || !q.alive) return;
        const amt = Math.min(q.money, 5);
        q.money -= amt;
        p.money += amt;
      });
      fx(s, "MADE MAGNET", "#e19bff", [p.pos[0], p.pos[1] + 3, p.pos[2]], true);
      log(s, `${p.name} triggers MADE — siphons $5 from every rival.`);
      break;
  }
}

// ============ Abilities ============

// Renamed to avoid eslint reacting to the "use" prefix as if it were a React hook.
export function triggerAbility(s: GameState, idx: number): boolean {
  const p = s.players[idx];
  if (!p || !p.alive) return false;
  const char = p.charId ? charById(p.charId) : null;
  if (!char) return false;
  if (now() < p.cooldownUntil) return false;
  const cost = char.abilityCost;
  if (cost.intel && p.intel < cost.intel) return false;
  if (cost.money && p.money < cost.money) return false;
  if (cost.intel) p.intel -= cost.intel;
  if (cost.money) p.money -= cost.money;
  p.cooldownUntil = now() + char.abilityCost.cooldownMs;
  switch (p.charId) {
    case "markwatson": {
      p.cloakedUntil = now() + 6000;
      log(s, `${p.name} stages a CEO photo op — cloaked for 6s.`);
      fx(s, "CLOAKED", "#9ad", [p.pos[0], p.pos[1] + 2.4, p.pos[2]]);
      break;
    }
    case "tomkins": {
      // Mark nearest rival
      let nearest = -1;
      let nd = 9999;
      s.players.forEach((q, j) => {
        if (j === idx || !q.alive) return;
        const d = dist2D(p.pos, q.pos);
        if (d < nd) {
          nd = d;
          nearest = j;
        }
      });
      if (nearest >= 0) {
        s.players[nearest].markedUntil = now() + 8000;
        log(s, `${p.name} marks ${s.players[nearest].name} — backroom deal.`);
        fx(s, "MARKED", "#ff6b5e", [
          s.players[nearest].pos[0],
          s.players[nearest].pos[1] + 2.4,
          s.players[nearest].pos[2],
        ]);
      }
      break;
    }
    case "jimchalmers": {
      s.players.forEach((q, j) => {
        if (j === idx || !q.alive) return;
        const d = dist2D(p.pos, q.pos);
        if (d < 20) {
          const amt = Math.min(q.money, 4);
          q.money -= amt;
          p.money += amt;
          addCortisol(s, j, 1, "the Treasurer collects");
        }
      });
      log(s, `${p.name} delivers the budget — nearby rivals pay up.`);
      fx(s, "BUDGET", "#f5c542", [p.pos[0], p.pos[1] + 3, p.pos[2]], true);
      break;
    }
    case "bessock": {
      addCortisol(s, idx, -3, "Big Bessent speaks");
      log(s, `${p.name} speaks — yields calm and a refilled briefcase.`);
      fx(s, "SPOKE", "#55c1ff", [p.pos[0], p.pos[1] + 2.4, p.pos[2]]);
      break;
    }
    case "calvinathanasius": {
      // Reveal all players — implemented via state flag guests can read
      s.players.forEach((q, j) => {
        if (j === idx) return;
        q.cloakedUntil = 0; // remove cloaks
      });
      log(s, `${p.name} blows the whistle — everyone is exposed for 10s.`);
      fx(s, "WHISTLE", "#55c1ff", [p.pos[0], p.pos[1] + 3, p.pos[2]], true);
      // Mark all players as "revealed" via a state field — set cloakedUntil back to 0
      break;
    }
    case "denialswan": {
      p.cortisol = 0;
      p.raided = false;
      log(s, `${p.name} holds a denial press conference — cortisol cleared.`);
      fx(s, "DENIED", "#7fe08d", [p.pos[0], p.pos[1] + 2.4, p.pos[2]]);
      break;
    }
    case "japsnchen": {
      p.buffUntil = now() + 10000;
      log(s, `${p.name} shorts the book — next 3 shots hit harder.`);
      fx(s, "SHORTED", "#e19bff", [p.pos[0], p.pos[1] + 2.4, p.pos[2]]);
      break;
    }
    case "thousandyardwax": {
      // Charge forward 12m
      const [dx, dz] = yawDir(p.yaw);
      p.pos[0] += dx * 12;
      p.pos[2] -= dz * 12;
      // World bounds
      const half = GAME.WORLD_SIZE / 2 - 2;
      p.pos[0] = Math.max(-half, Math.min(half, p.pos[0]));
      p.pos[2] = Math.max(-half, Math.min(half, p.pos[2]));
      // Knockback & damage nearby rivals
      s.players.forEach((q, j) => {
        if (j === idx || !q.alive) return;
        const d = dist2D(p.pos, q.pos);
        if (d < 4) {
          addCortisol(s, j, 2, "boulder roll");
          const kx = q.pos[0] - p.pos[0];
          const kz = q.pos[2] - p.pos[2];
          const kl = Math.sqrt(kx * kx + kz * kz) || 1;
          q.pos[0] += (kx / kl) * 4;
          q.pos[2] += (kz / kl) * 4;
        }
      });
      log(s, `${p.name} rolls the boulder forward.`);
      fx(s, "BOULDER", "#ffa94d", [p.pos[0], p.pos[1] + 2.4, p.pos[2]], true);
      break;
    }
  }
  return true;
}

// ============ Main tick — host advances the world ============

let lastTickMs = 0;
export function tick(s: GameState) {
  if (s.over) return;
  const nowMs = now();
  if (lastTickMs === 0) lastTickMs = nowMs;
  const dtMs = Math.min(100, nowMs - lastTickMs);
  lastTickMs = nowMs;
  s.elapsed = nowMs - s.startedAt;
  // Process player inputs (handled in handleInput calls)
  // Projectiles
  tickProjectiles(s, dtMs);
  // AI bots — driven by the host simulation
  tickBots(s, dtMs);
  // Zone
  tickZone(s);
  // Nodes (income & capture)
  tickNodes(s, dtMs);
  // Loot
  tickLoot(s);
  // Mood expiry
  if (s.mood !== "CALM" && nowMs > s.moodUntil) {
    setMood(s, "CALM", "the desk settles — back to calm");
  }
  // Random mood shifts
  if (Math.random() < 0.001) {
    const moods: MoodKey[] = ["BOOM", "PANIC", "FRENZY", "CALM"];
    const pick = moods[Math.floor(Math.random() * moods.length)];
    if (pick !== s.mood) {
      setMood(s, pick, `the wire says: ${MOODS[pick].desc}`);
    }
  }
  // Decay fx
  s.fx = s.fx.filter((f) => nowMs - f.ts < 3000);
  // Win check
  checkWin(s);
}

// ============ AI bot driver ============
// Bots are flagged with `bot: true` in their player state (added in createInitialState).
// They wander, capture nearby nodes, shoot at visible rivals, and grab nearby loot.

type BotState = {
  targetNodeId: string | null;
  targetPlayerIdx: number;
  retargetAt: number;
  nextShotAt: number;
  wanderYaw: number;
  wanderUntil: number;
};

const botStates = new Map<number, BotState>();

function isBot(p: PlayerState): boolean {
  return !!(p as unknown as { bot?: boolean }).bot;
}

export function tickBots(s: GameState, dtMs: number) {
  if (s.over) return;
  const nowMs = now();
  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i];
    if (!p.alive || !isBot(p)) continue;
    let bs = botStates.get(i);
    if (!bs) {
      bs = {
        targetNodeId: null,
        targetPlayerIdx: -1,
        retargetAt: 0,
        nextShotAt: 0,
        wanderYaw: Math.random() * Math.PI * 2,
        wanderUntil: 0,
      };
      botStates.set(i, bs);
    }
    // Pick a target node if none or every 15s
    if (!bs.targetNodeId || nowMs > bs.retargetAt) {
      // Prefer unowned nodes, or nodes owned by others
      const candidates = NODES.filter((n) => s.owner[n.id] !== i);
      if (candidates.length > 0) {
        // Prefer closest
        candidates.sort((a, b) => dist2D(p.pos, a.pos) - dist2D(p.pos, b.pos));
        bs.targetNodeId = candidates[Math.floor(Math.random() * Math.min(3, candidates.length))].id;
      }
      bs.retargetAt = nowMs + 12000 + Math.random() * 8000;
    }
    // Find nearest rival
    let nearestRival = -1;
    let nd = 9999;
    for (let j = 0; j < s.players.length; j++) {
      if (j === i) continue;
      const q = s.players[j];
      if (!q.alive) continue;
      if (q.cloakedUntil > nowMs) continue; // can't see cloaked
      const d = dist2D(p.pos, q.pos);
      if (d < nd) {
        nd = d;
        nearestRival = j;
      }
    }
    bs.targetPlayerIdx = nearestRival;
    // Combat: shoot if rival in line of sight (under 30m) and cooldown elapsed
    if (nearestRival >= 0 && nd < 30 && nowMs > bs.nextShotAt) {
      const target = s.players[nearestRival];
      const dx = target.pos[0] - p.pos[0];
      const dy = (target.pos[1] + 1.2) - (p.pos[1] + 1.5);
      const dz = target.pos[2] - p.pos[2];
      const dir: [number, number, number] = [dx, dy, dz];
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dir[0] /= dl; dir[1] /= dl; dir[2] /= dl;
      // Pick a weapon the bot can use (LEAK always available)
      let weapon: WeaponId = "LEAK";
      // 30% chance to use SPIN if they own a media node
      const ownedTypes = new Set<string>();
      Object.keys(s.owner).forEach((nid) => {
        if (s.owner[nid] === i) {
          const node = NODES.find((n) => n.id === nid);
          if (node) ownedTypes.add(node.type);
        }
      });
      if (Math.random() < 0.3 && ownedTypes.has("MEDIA") && p.money >= 0) weapon = "SPIN";
      // Aim yaw at target
      p.yaw = Math.atan2(dx, dz);
      const shot = fireShot(s, i, weapon, [p.pos[0], p.pos[1] + 1.5, p.pos[2]], dir);
      if (shot) {
        bs.nextShotAt = nowMs + 600 + Math.random() * 1200;
      } else {
        bs.nextShotAt = nowMs + 400;
      }
    }
    // Movement: head to target node, but evade if cortisol high
    let targetPos: [number, number, number] | null = null;
    if (p.cortisol > 6 && s.loot.length > 0) {
      // Find nearest loot
      let bestLoot: LootState | null = null;
      let bestD = 9999;
      for (const item of s.loot) {
        const d = dist2D(p.pos, item.pos);
        if (d < bestD) {
          bestD = d;
          bestLoot = item;
        }
      }
      if (bestLoot) targetPos = bestLoot.pos;
    }
    if (!targetPos && bs.targetNodeId) {
      const node = NODES.find((n) => n.id === bs.targetNodeId);
      if (node) targetPos = node.pos;
    }
    // Stay inside zone
    const zoneDx = p.pos[0] - s.zoneCenter[0];
    const zoneDz = p.pos[2] - s.zoneCenter[1];
    const zoneD = Math.sqrt(zoneDx * zoneDx + zoneDz * zoneDz);
    if (zoneD > s.zoneRadius - 8) {
      // Pull toward zone center
      targetPos = [s.zoneCenter[0], 0, s.zoneCenter[1]];
    }
    if (targetPos) {
      const dx = targetPos[0] - p.pos[0];
      const dz = targetPos[2] - p.pos[2];
      const dl = Math.sqrt(dx * dx + dz * dz);
      if (dl > 0.5) {
        p.yaw = Math.atan2(dx, dz);
        const speed = GAME.PLAYER_SPEED;
        p.pos[0] += (dx / dl) * speed * (dtMs / 1000);
        p.pos[2] += (dz / dl) * speed * (dtMs / 1000);
      }
    } else if (nowMs > bs.wanderUntil) {
      bs.wanderYaw = Math.random() * Math.PI * 2;
      bs.wanderUntil = nowMs + 2000 + Math.random() * 2000;
    } else {
      const speed = GAME.PLAYER_SPEED * 0.5;
      p.pos[0] += Math.sin(bs.wanderYaw) * speed * (dtMs / 1000);
      p.pos[2] += Math.cos(bs.wanderYaw) * speed * (dtMs / 1000);
    }
    // World bounds
    const half = GAME.WORLD_SIZE / 2 - 2;
    p.pos[0] = Math.max(-half, Math.min(half, p.pos[0]));
    p.pos[2] = Math.max(-half, Math.min(half, p.pos[2]));
    // Use ability sometimes
    if (Math.random() < 0.005 && nowMs > p.cooldownUntil) {
      triggerAbility(s, i);
    }
  }
}

export function resetTickClock() {
  lastTickMs = 0;
}

// ============ State publishing (delta-aware) ============

export function pubState(s: GameState): Partial<GameState> {
  // Send a deep clone of the relevant fields
  const out: Partial<GameState> = JSON.parse(JSON.stringify(s));
  return out;
}
