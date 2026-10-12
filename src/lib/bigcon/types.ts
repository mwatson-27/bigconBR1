// Shared types between host and guest for The Big Con FPS Battle Royale

import type { MoodKey, NodeType, WeaponId } from "./constants";

export type PlayerState = {
  id: string; // peer id (unique per client)
  idx: number; // seat 0..7
  name: string;
  color: string;
  charId: string | null;
  // Resources
  money: number;
  intel: number;
  cortisol: number;
  cortisolCap: number;
  // Spatial
  pos: [number, number, number];
  vel: [number, number, number];
  yaw: number;
  pitch: number;
  // Combat
  weapon: WeaponId;
  lastShotMs: number;
  cooldownUntil: number; // ability cooldown
  // Status flags
  alive: boolean;
  dc: boolean;
  raided: boolean;
  cloakedUntil: number;
  markedUntil: number;
  buffUntil: number;
  // Score
  kills: number;
  // Owned nodes (set of node ids)
  owned: string[];
  // Death/exit info
  diedAt: number;
  rank: number; // 0 means alive; placement otherwise
  // Bot flag (set in practice mode)
  bot?: boolean;
};

export type ProjectileState = {
  id: number;
  ownerId: number; // player idx
  weapon: WeaponId;
  pos: [number, number, number];
  vel: [number, number, number];
  bornAt: number;
};

export type LootState = {
  id: number;
  kind: "MONEY" | "INTEL" | "CORTISOL_DOWN" | "MAGNET";
  amount: number;
  mesh: "cash" | "intel" | "shoe" | "magnet";
  color: number;
  label: string;
  pos: [number, number, number];
  bornAt: number;
  // For magnet: pulls money from defeated players
  magnet: boolean;
};

export type KillFeedEntry = {
  id: number;
  killerIdx: number; // -1 = regulators
  victimIdx: number;
  weapon: WeaponId | "ZONE" | "RAID";
  ts: number;
};

export type LogEntry = { ts: number; text: string };
export type ChatEntry = { ts: number; idx: number; name: string; text: string };

export type GameState = {
  players: PlayerState[];
  projectiles: ProjectileState[];
  loot: LootState[];
  killFeed: KillFeedEntry[];
  log: LogEntry[];
  chat: ChatEntry[];
  logN: number;
  chatN: number;
  // Node ownership: nodeId -> playerIdx
  owner: Record<string, number>;
  // Capture progress: nodeId -> { idx, startedAt }
  capture: Record<string, { idx: number; startedAt: number }>;
  // Battle royale zone
  zoneCenter: [number, number];
  zoneRadius: number;
  zoneTargetRadius: number;
  zoneTargetCenter: [number, number];
  zoneShrinkStart: number;
  zoneShrinkEnd: number;
  zonePhase: "STABLE" | "SHRINKING";
  zoneStage: number; // how many shrinks have happened
  zoneNextShrink: number; // timestamp
  // Market mood
  mood: MoodKey;
  moodUntil: number;
  wire: string;
  // Game meta
  startedAt: number;
  elapsed: number;
  goal: number;
  over: boolean;
  winnerIdx: number; // -1 if none
  winReason: string;
  // Effects (transient, displayed on every screen)
  fx: FxEntry[];
  // Loot respawn timer
  nextLootSpawn: number;
};

export type FxEntry = {
  id: number;
  ts: number;
  text: string;
  color: string;
  pos?: [number, number, number];
  big?: boolean;
};

// ============ Network protocol messages ============
export type NetMessage =
  // Lobby phase
  | { t: "hello"; name: string; charId: string | null; playerId: string }
  | { t: "welcome"; idx: number; roster: LobbyPlayer[]; code: string; goal: number }
  | { t: "roster"; roster: LobbyPlayer[]; goal: number; chat: ChatEntry[] }
  | { t: "charPick"; idx: number; charId: string | null }
  | { t: "chat"; msg: ChatEntry }
  | { t: "lobbyText"; text: string }
  | { t: "start"; s: GameState; idx: number }
  // In-game (host -> guest): authoritative state
  | { t: "state"; s: Partial<GameState> }
  // In-game (guest -> host): player input
  | { t: "input"; input: PlayerInput }
  | { t: "shoot"; weapon: WeaponId; pos: [number, number, number]; dir: [number, number, number]; ts: number }
  | { t: "ability"; ts: number }
  | { t: "switchWeapon"; weapon: WeaponId }
  | { t: "capture"; nodeId: string; start: boolean }
  | { t: "ping"; ts: number }
  | { t: "pong"; ts: number }
  | { t: "goodbye" }
  | { t: "reload" };

export type LobbyPlayer = {
  name: string;
  playerId: string;
  charId: string | null;
  ready: boolean;
};

export type PlayerInput = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  yaw: number;
  pitch: number;
  ts: number;
};

// Type alias for node ownership lookups
export type NodeOwner = Record<string, number>;

export type NodeTypeMap = Record<string, NodeType>;
