// The Big Con — FPS Battle Royale constants
// Adapted from the original board game at github.com/waxmotson/bigcon

// ============ Player colors (same palette as the original) ============
export const PCOLORS = [
  "#f5c542", // gold
  "#55c1ff", // blue
  "#e19bff", // purple
  "#7fe08d", // green
  "#ff5e9c", // pink
  "#ffffff", // white
  "#00e5c0", // mint
  "#ffa94d", // orange
];

// ============ Characters (the same 8 faces from the board game) ============
export type CharDef = {
  id: string;
  name: string;
  file: string;
  passive: string;
  ability: string;
  abilityDesc: string;
  abilityCost: { money?: number; intel?: number; cooldownMs: number };
};

export const CHARS: CharDef[] = [
  {
    id: "markwatson",
    name: "Mark Watson",
    file: "markwatson.png",
    passive: "Coal corp: +$1/sec while inside a commodity node radius",
    ability: "CEO PHOTO OP",
    abilityDesc: "Cloak for 6s — invisible on minimaps and unable to be hit by Leaks",
    abilityCost: { intel: 2, cooldownMs: 30000 },
  },
  {
    id: "tomkins",
    name: "Tomkins",
    file: "tomkins.png",
    passive: "Backroom dealer: +1 Intel on every kill",
    ability: "BACKROOM DEAL",
    abilityDesc: "Mark a rival — they take +2 Cortisol from every source for 8s",
    abilityCost: { money: 5, cooldownMs: 25000 },
  },
  {
    id: "jimchalmers",
    name: "Jim Chalmers",
    file: "jimchalmers.png",
    passive: "Treasurer: +$2/sec while inside a regulator node radius",
    ability: "DELIVER THE BUDGET",
    abilityDesc: "All rivals within 20m pay you $4 and gain +1 Cortisol",
    abilityCost: { money: 3, cooldownMs: 28000 },
  },
  {
    id: "bessock",
    name: "Bessock",
    file: "bessock.png",
    passive: "Big Bessent: bond yields obey — passive +$1/sec anywhere",
    ability: "BIG BESSENT SPEAKS",
    abilityDesc: "Self-heal -3 Cortisol and refill magazine for free",
    abilityCost: { intel: 2, cooldownMs: 22000 },
  },
  {
    id: "calvinathanasius",
    name: "Calvin Athanasius",
    file: "calvinathanasius.png",
    passive: "The Whistleblower: see enemy cortisol bars at all times",
    ability: "BLOW THE WHISTLE",
    abilityDesc: "Reveal every player on the minimap for 10s",
    abilityCost: { intel: 3, cooldownMs: 30000 },
  },
  {
    id: "denialswan",
    name: "Denial Swan",
    file: "denialswan.png",
    passive: "Deny everything: first lethal hit each life only adds +3 Cortisol",
    ability: "DENIAL PRESS CONFERENCE",
    abilityDesc: "Cleanse all Cortisol instantly",
    abilityCost: { money: 6, cooldownMs: 35000 },
  },
  {
    id: "japsnchen",
    name: "Japsn Chen",
    file: "japsnchen.png",
    passive: "Hedge fund: 25% of all damage you deal returns to you as Intel",
    ability: "SHORT THE BOOK",
    abilityDesc: "Next 3 shots deal +2 Cortisol and steal $3 each hit",
    abilityCost: { intel: 3, cooldownMs: 26000 },
  },
  {
    id: "thousandyardwax",
    name: "Thousand Yard Wax",
    file: "thousandyardwax.png",
    passive: "The outback survivor: +1 max Cortisol cap (11 instead of 10)",
    ability: "BOULDER ROLL",
    abilityDesc: "Charge forward 12m, knocking back rivals and looting on contact",
    abilityCost: { money: 4, cooldownMs: 20000 },
  },
];

export function charById(id: string): CharDef | undefined {
  return CHARS.find((c) => c.id === id);
}

export const CHAR_URL = "/bigcon/characters/";

// ============ The Market Mood ============
export type MoodKey = "CALM" | "BOOM" | "PANIC" | "FRENZY";

export const MOODS: Record<
  MoodKey,
  {
    label: string;
    color: string;
    tint: string;
    desc: string;
    commodityBonus: number;
    bankPenalty: number;
    mediaBonus: number;
    regulatorBonus: number;
  }
> = {
  CALM: {
    label: "MARKET: CALM",
    color: "#8fbf7f",
    tint: "rgba(70,130,70,0.045)",
    desc: "no modifiers - the desk is quiet",
    commodityBonus: 0,
    bankPenalty: 0,
    mediaBonus: 0,
    regulatorBonus: 0,
  },
  BOOM: {
    label: "MARKET: BOOM",
    color: "#f5c542",
    tint: "rgba(200,160,40,0.075)",
    desc: "commodities payout - banks stable",
    commodityBonus: 1,
    bankPenalty: 0,
    mediaBonus: 0,
    regulatorBonus: 0,
  },
  PANIC: {
    label: "MARKET: PANIC",
    color: "#ff6b5e",
    tint: "rgba(170,30,20,0.10)",
    desc: "banks bleed - the zone tightens faster",
    commodityBonus: 0,
    bankPenalty: 1,
    mediaBonus: 0,
    regulatorBonus: 0,
  },
  FRENZY: {
    label: "MEDIA FRENZY",
    color: "#e19bff",
    tint: "rgba(150,60,170,0.075)",
    desc: "media payouts - leaks hit harder",
    commodityBonus: 0,
    bankPenalty: 0,
    mediaBonus: 1,
    regulatorBonus: 0,
  },
};

// ============ Node types ============
export type NodeType =
  | "BANK"
  | "REGULATOR"
  | "CHART"
  | "WILD"
  | "CORPORATE"
  | "COMMODITY"
  | "MEDIA";

export const WIN_TYPES: NodeType[] = [
  "BANK",
  "REGULATOR",
  "CHART",
  "WILD",
  "CORPORATE",
  "COMMODITY",
  "MEDIA",
];

// ============ Map nodes ============
export type NodeDef = {
  id: string;
  name: string[];
  image: string;
  type: NodeType;
  pos: [number, number, number];
  radius: number;
  income: number;
  cost: number;
};

export const NODES: NodeDef[] = [
  // Banks — corner cluster (north-west)
  { id: "cba", name: ["COMMONWEALTH", "BANK"], image: "/bigcon/static/cba.png", type: "BANK", pos: [-80, 0, -80], radius: 7, income: 2, cost: 2 },
  { id: "westpac", name: ["WESTPAC"], image: "/bigcon/static/westpac.png", type: "BANK", pos: [-60, 0, -90], radius: 6, income: 2, cost: 2 },
  { id: "nab", name: ["NAB"], image: "/bigcon/static/nab.png", type: "BANK", pos: [-90, 0, -60], radius: 6, income: 2, cost: 2 },
  { id: "anz", name: ["ANZ"], image: "/bigcon/static/anz.png", type: "BANK", pos: [-100, 0, -85], radius: 6, income: 2, cost: 2 },
  // Regulators — government plaza (north-east)
  { id: "rba", name: ["RESERVE BANK", "OF AUSTRALIA"], image: "/bigcon/static/rba.png", type: "REGULATOR", pos: [70, 0, -80], radius: 8, income: 2, cost: 3 },
  { id: "asic", name: ["ASIC"], image: "/bigcon/static/asic.png", type: "REGULATOR", pos: [85, 0, -70], radius: 6, income: 1, cost: 2 },
  { id: "accc", name: ["ACCC"], image: "/bigcon/static/accc.png", type: "REGULATOR", pos: [90, 0, -85], radius: 6, income: 1, cost: 2 },
  { id: "gov", name: ["AUSTRALIAN", "GOVERNMENT"], image: "/bigcon/static/coat of arms.png", type: "REGULATOR", pos: [75, 0, -95], radius: 7, income: 2, cost: 3 },
  // Charts — bond desk row (east side)
  { id: "us10y", name: ["US TREASURY", "10Y YIELD"], image: "/bigcon/static/us treasury yeild.png", type: "CHART", pos: [90, 0, 10], radius: 6, income: 1, cost: 1 },
  { id: "jpn10y", name: ["JAPAN", "BOND YIELD"], image: "/bigcon/static/debt japan.png", type: "CHART", pos: [90, 0, -10], radius: 6, income: 1, cost: 1 },
  { id: "uk10y", name: ["UK BOND", "YIELD"], image: "/bigcon/static/uk bond yield.png", type: "CHART", pos: [85, 0, 25], radius: 6, income: 1, cost: 1 },
  { id: "aus10y", name: ["AUS BOND", "YIELD"], image: "/bigcon/static/aus bond yield.png", type: "CHART", pos: [80, 0, 40], radius: 6, income: 1, cost: 1 },
  // Commodities — industrial yards (south)
  { id: "oil", name: ["WTI", "CRUDE"], image: "/bigcon/static/wti crude.png", type: "COMMODITY", pos: [60, 0, 80], radius: 7, income: 3, cost: 2 },
  { id: "barrels", name: ["OIL", "BARRELS"], image: "/bigcon/static/blue oil barrels.png", type: "COMMODITY", pos: [75, 0, 70], radius: 6, income: 2, cost: 1 },
  { id: "tanker", name: ["TANKER", "FLEET"], image: "/bigcon/static/tanker fleet.png", type: "COMMODITY", pos: [85, 0, 60], radius: 6, income: 2, cost: 2 },
  { id: "petronas", name: ["PETRONAS"], image: "/bigcon/static/petronas.png", type: "COMMODITY", pos: [50, 0, 90], radius: 6, income: 2, cost: 2 },
  { id: "coal", name: ["COAL CORP", "HQ"], image: "/bigcon/static/coal corp hq.png", type: "COMMODITY", pos: [-50, 0, 90], radius: 8, income: 3, cost: 3 },
  { id: "train", name: ["COAL", "TRAIN"], image: "/bigcon/static/coal train.png", type: "COMMODITY", pos: [-65, 0, 80], radius: 6, income: 2, cost: 2 },
  { id: "port", name: ["COAL", "TERMINAL"], image: "/bigcon/static/coal terminal.png", type: "COMMODITY", pos: [-80, 0, 70], radius: 6, income: 2, cost: 2 },
  { id: "bhp", name: ["BHP"], image: "/bigcon/static/bhp.png", type: "COMMODITY", pos: [-35, 0, 85], radius: 6, income: 2, cost: 2 },
  { id: "gold", name: ["GOLD", "COINS"], image: "/bigcon/static/gold coloured coin.jpg", type: "COMMODITY", pos: [-60, 0, 60], radius: 6, income: 3, cost: 3 },
  // Corporate — financial district (west)
  { id: "citi", name: ["CITI", "TOWER"], image: "/bigcon/static/citi tower.webp", type: "CORPORATE", pos: [-90, 0, 20], radius: 7, income: 2, cost: 3 },
  { id: "bloomberg", name: ["BLOOMBERG", "TERMINAL"], image: "/bigcon/static/bloomberg terminal.png", type: "CORPORATE", pos: [-85, 0, 35], radius: 6, income: 2, cost: 3 },
  { id: "hedge", name: ["HEDGE", "FUND"], image: "/bigcon/static/hedge fund.png", type: "CORPORATE", pos: [-95, 0, 5], radius: 6, income: 2, cost: 3 },
  { id: "bond007", name: ["BOND", "DESK"], image: "/bigcon/static/bond desk.png", type: "CORPORATE", pos: [-75, 0, 50], radius: 6, income: 2, cost: 2 },
  // Media — press row (south-west)
  { id: "press", name: ["PRESS", "ROOM"], image: "/bigcon/static/all the newspapers.jpg", type: "MEDIA", pos: [-30, 0, -80], radius: 7, income: 2, cost: 2 },
  { id: "fox", name: ["FOX", "BUSINESS"], image: "/bigcon/static/fox business.png", type: "MEDIA", pos: [-15, 0, -90], radius: 6, income: 2, cost: 2 },
  { id: "herald", name: ["THE JIM", "REAPER"], image: "/bigcon/static/the jim reaper.png", type: "MEDIA", pos: [-45, 0, -70], radius: 6, income: 2, cost: 2 },
  { id: "wire", name: ["THE WIRE"], image: "/bigcon/static/insider trading graphic.png", type: "MEDIA", pos: [-50, 0, -50], radius: 6, income: 1, cost: 1 },
  // Wild cards — scattered
  { id: "jt", name: ["JTPORTAL", "QUITE FRANKLY"], image: "/bigcon/static/jt portal.png", type: "WILD", pos: [0, 0, 0], radius: 9, income: 2, cost: 4 },
  { id: "quik", name: ["QUIKSTOP"], image: "/bigcon/static/quikstop.png", type: "WILD", pos: [20, 0, 30], radius: 7, income: 1, cost: 2 },
  { id: "wef", name: ["WORLD", "ECONOMIC FORUM"], image: "/bigcon/static/world economic forum.webp", type: "WILD", pos: [-20, 0, -30], radius: 7, income: 2, cost: 3 },
  { id: "made", name: ["MADE"], image: "/bigcon/static/made logo.png", type: "WILD", pos: [25, 0, -25], radius: 6, income: 1, cost: 2 },
];

// ============ Weapons ============
export type WeaponId = "LEAK" | "AUDIT" | "TWEET" | "SPIN" | "ROAST";
export type WeaponDef = {
  id: WeaponId;
  name: string;
  short: string;
  desc: string;
  costIntel: number;
  costMoney: number;
  damage: number;
  stealMoney: number;
  fireRateMs: number;
  projectileSpeed: number;
  projectileColor: number;
  requires?: NodeType;
};

export const WEAPONS: WeaponDef[] = [
  { id: "LEAK", name: "LEAK", short: "L", desc: "Dirt in the morning paper. Free, fast, +1 Cortisol.", costIntel: 0, costMoney: 0, damage: 1, stealMoney: 0, fireRateMs: 250, projectileSpeed: 90, projectileColor: 0x55c1ff },
  { id: "AUDIT", name: "AUDIT", short: "A", desc: "ASIC sends the regulator. +2 Cortisol, costs 1 Intel.", costIntel: 1, costMoney: 0, damage: 2, stealMoney: 0, fireRateMs: 700, projectileSpeed: 70, projectileColor: 0x7fe08d, requires: "REGULATOR" },
  { id: "TWEET", name: "TWEET", short: "T", desc: "All caps. Devastating. +3 Cortisol, costs $3.", costIntel: 0, costMoney: 3, damage: 3, stealMoney: 0, fireRateMs: 1000, projectileSpeed: 100, projectileColor: 0xff6b5e, requires: "WILD" },
  { id: "SPIN", name: "SPIN", short: "S", desc: "Press room coverage. +1 Cortisol, steals $2.", costIntel: 0, costMoney: 0, damage: 1, stealMoney: 2, fireRateMs: 450, projectileSpeed: 80, projectileColor: 0xf5c542, requires: "MEDIA" },
  { id: "ROAST", name: "ROAST", short: "R", desc: "Fox Business unflattering coverage. +2 Cortisol, steals $4, costs $2.", costIntel: 0, costMoney: 2, damage: 2, stealMoney: 4, fireRateMs: 850, projectileSpeed: 75, projectileColor: 0xffa94d, requires: "MEDIA" },
];

// ============ Loot pickups ============
export type LootKind = "MONEY" | "INTEL" | "CORTISOL_DOWN" | "MAGNET";
export type LootDef = {
  kind: LootKind;
  amount: number;
  mesh: "cash" | "intel" | "shoe" | "magnet";
  color: number;
  label: string;
};

export const LOOT_TABLE: LootDef[] = [
  { kind: "MONEY", amount: 8, mesh: "cash", color: 0x7fe08d, label: "$8" },
  { kind: "MONEY", amount: 15, mesh: "cash", color: 0x7fe08d, label: "$15" },
  { kind: "MONEY", amount: 25, mesh: "cash", color: 0x7fe08d, label: "$25" },
  { kind: "INTEL", amount: 1, mesh: "intel", color: 0x55c1ff, label: "INTEL+1" },
  { kind: "INTEL", amount: 2, mesh: "intel", color: 0x55c1ff, label: "INTEL+2" },
  { kind: "INTEL", amount: 3, mesh: "intel", color: 0x55c1ff, label: "INTEL+3" },
  { kind: "CORTISOL_DOWN", amount: -3, mesh: "shoe", color: 0xffa94d, label: "RUN SHOES -3 FIRE" },
  { kind: "MAGNET", amount: 0, mesh: "magnet", color: 0xe19bff, label: "MADE MAGNET" },
];

// ============ Buzzwords for room codes ============
export const BUZZWORDS = [
  "WORLD ECONOMIC FORUM",
  "NESA",
  "JAKE TOMKINS",
  "ELIJAH SON",
  "SETH WEGRZYN",
  "AIDAN NEWLING",
  "DANIEL SWAIN",
  "TOKTIMER",
  "RBA",
  "BIG BESSENT",
  "NEW LAKEMBA",
  "JTPORTAL",
  "MCMETRO",
  "CEO OF COAL",
  "INKDIN",
  "HORMUZ",
  "PYONGYANG UNIVERSITY",
  "LOW CORTISOL",
];

export function codeSlug(s: string): string {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function codeLabel(slug: string): string {
  const hit = BUZZWORDS.find((b) => codeSlug(b) === slug);
  return hit || slug;
}

export function matchBuzzword(input: string): string {
  const s = codeSlug(input);
  if (!s) return "";
  if (BUZZWORDS.some((b) => codeSlug(b) === s)) return s;
  const hits = BUZZWORDS.filter((b) => codeSlug(b).startsWith(s));
  return hits.length === 1 ? codeSlug(hits[0]) : s;
}

export function genCode(): string {
  return codeSlug(BUZZWORDS[Math.floor(Math.random() * BUZZWORDS.length)]);
}

// ============ Network config ============
export const PFX = "bigcon-fps-";

export const ICE_CONFIG = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
        "stun:global.stun.twilio.com:3478",
      ],
    },
    {
      urls: [
        "turn:eu-0.turn.peerjs.com:3478",
        "turn:us-0.turn.peerjs.com:3478",
        "turn:eu-0.turn.peerjs.com:3478?transport=tcp",
        "turn:us-0.turn.peerjs.com:3478?transport=tcp",
      ],
      username: "peerjs",
      credential: "peerjsp",
    },
    {
      urls: ["turns:eu-0.turn.peerjs.com:5349", "turns:us-0.turn.peerjs.com:5349"],
      username: "peerjs",
      credential: "peerjsp",
    },
  ],
  sdpSemantics: "unified-plan" as const,
  iceCandidatePoolSize: 4,
};

export const PEER_OPTIONS = {
  config: ICE_CONFIG,
  debug: 1,
  pingInterval: 5000,
};

// ============ Game balance ============
export const GAME = {
  MAX_PLAYERS: 8,
  MIN_PLAYERS: 2,
  CORTISOL_MAX: 10,
  CORTISOL_RAID: 8,
  START_MONEY: 15,
  START_INTEL: 2,
  START_CORTISOL: 0,
  GOAL_DEF: 100,
  GOAL_MIN: 50,
  GOAL_MAX: 500,
  ZONE_START_RADIUS: 95,
  ZONE_MIN_RADIUS: 8,
  ZONE_SHRINK_INTERVAL_MS: 45000,
  ZONE_SHRINK_TIME_MS: 20000,
  ZONE_DAMAGE_PER_SEC: 1,
  CAPTURE_TIME_MS: 4000,
  RESPAWN_TIME_MS: 0,
  PLAYER_SPEED: 8,
  PLAYER_SPRINT: 12,
  PLAYER_JUMP: 6,
  PLAYER_HEIGHT: 1.7,
  PLAYER_RADIUS: 0.6,
  GRAVITY: 22,
  WORLD_SIZE: 200,
  PROJECTILE_LIFETIME_MS: 2500,
  PROJECTILE_RADIUS: 0.2,
  HEARTBEAT_MS: 4000,
  CONN_TIMEOUT_MS: 16000,
  STATE_MIN_GAP: 50,
  LOG_TAIL: 30,
  CHAT_TAIL: 25,
} as const;

// Bot names for solo practice mode (Australian finance satire flavour)
export const BOT_NAMES = [
  "RBA INTERN",
  "ASIC JUNIOR",
  "BLOOMBERG INTERN",
  "QUIKSTOP CLERK",
  "THE JIM REAPER",
  "BIG BESSENT JR",
  "HEDGE FUND ANALYST",
  "COAL CORP INTERN",
];

export type Game = typeof GAME;
