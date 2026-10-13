// PeerJS networking for The Big Con FPS Battle Royale
// Mirrors the host-authoritative model from the original board game:
// the host owns the GameState, guests send inputs, host broadcasts state.

import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import {
  PFX,
  PEER_OPTIONS,
  GAME,
  BUZZWORDS,
  genCode,
  codeSlug,
  codeLabel,
  matchBuzzword,
} from "./constants";
import type {
  NetMessage,
  LobbyPlayer,
  ChatEntry,
  GameState,
  PlayerInput,
} from "./types";

export type NetRole = "host" | "guest" | null;

export type NetState = {
  role: NetRole;
  peer: Peer | null;
  // For host: conns[i] is the connection to player i (null for self)
  // For guest: conns[0] is the host
  conns: (DataConnection | null)[];
  roster: LobbyPlayer[];
  myIdx: number;
  myName: string;
  playerId: string;
  roomCode: string | null;
  roomLabel: string | null;
  started: boolean;
  lobbyChat: ChatEntry[];
  goal: number;
  // Latest authoritative state, retained so a rejoining guest can resync.
  currentState: GameState | null;
  // Stats
  lastSeen: number;
  hbTimer: ReturnType<typeof setInterval> | null;
};

export function makePlayerId(): string {
  return "p-" + Math.random().toString(36).slice(2, 10);
}

export function createNet(): NetState {
  return {
    role: null,
    peer: null,
    conns: [],
    roster: [],
    myIdx: 0,
    myName: "",
    playerId: makePlayerId(),
    roomCode: null,
    roomLabel: null,
    started: false,
    lobbyChat: [],
    goal: GAME.GOAL_DEF,
    currentState: null,
    lastSeen: Date.now(),
    hbTimer: null,
  };
}

export type NetHandlers = {
  onStatus?: (msg: string, isErr?: boolean) => void;
  onRoster?: (roster: LobbyPlayer[], chat: ChatEntry[]) => void;
  onCharPick?: (idx: number, charId: string | null) => void;
  onChat?: (msg: ChatEntry) => void;
  onStart?: (s: GameState, myIdx: number) => void;
  onState?: (s: Partial<GameState>) => void;
  onInput?: (pi: PlayerInput, fromIdx: number) => void;
  onShoot?: (msg: Extract<NetMessage, { t: "shoot" }>, fromIdx: number) => void;
  onAbility?: (ts: number, fromIdx: number) => void;
  onSwitchWeapon?: (w: Extract<NetMessage, { t: "switchWeapon" }>["weapon"], fromIdx: number) => void;
  onCapture?: (nodeId: string, start: boolean, fromIdx: number) => void;
  onLobbyText?: (text: string) => void;
  onReload?: () => void;
  onGoodbye?: (fromIdx: number) => void;
  onRejoin?: (idx: number) => void;
  onFatal?: (msg: string) => void;
  onPong?: (fromIdx: number, ts: number) => void;
};

function safeSend(c: DataConnection | null, msg: NetMessage) {
  if (!c || !c.open) return;
  try {
    c.send(msg);
  } catch (e) {
    // Ignore transient send errors
  }
}

// ============ HOST ============

export function hostCreate(
  net: NetState,
  name: string,
  handlers: NetHandlers
): NetState {
  net.role = "host";
  net.myName = name;
  net.myIdx = 0;
  net.roster = [
    { name, playerId: net.playerId, charId: null, ready: false },
  ];
  net.conns = [null];
  net.roomCode = genCode();
  net.roomLabel = codeLabel(net.roomCode);
  // Room IDs are the public buzzwords themselves, so a room may collide
  // with another active host. Track tried IDs to avoid endlessly selecting
  // the same occupied room and ensure the displayed code follows the peer ID.
  const triedRoomCodes = new Set<string>([net.roomCode]);
  hostOpenPeer(net, handlers, triedRoomCodes);
  startHostHeartbeat(net, handlers);
  return net;
}

function hostOpenPeer(
  net: NetState,
  handlers: NetHandlers,
  triedRoomCodes: Set<string>
) {
  if (!net.roomCode) return;
  const old = net.peer;
  if (old && !old.destroyed) {
    try {
      old.destroy();
    } catch (_) {
      // ignore
    }
  }
  const peer = new Peer(PFX + net.roomCode, PEER_OPTIONS);
  net.peer = peer;
  let opened = false;
  peer.on("open", () => {
    opened = true;
    if (net.peer !== peer) return;
    handlers.onStatus?.(
      `Room created — seats up to ${GAME.MAX_PLAYERS}. Waiting for co-conspirators…`
    );
  });
  peer.on("disconnected", () => {
    if (net.peer !== peer || peer.destroyed) return;
    try {
      peer.reconnect();
    } catch (_) {
      setTimeout(() => {
        if (net.peer === peer) hostOpenPeer(net, handlers, triedRoomCodes);
      }, 1500);
    }
  });
  peer.on("error", (e: { type?: string }) => {
    const ty = e && e.type;
    if (net.peer !== peer) return;
    if (ty === "unavailable-id" && !opened && !net.started) {
      try {
        peer.destroy();
      } catch (_) {
        // ignore
      }
      const nextCode = BUZZWORDS
        .map((word) => codeSlug(word))
        .find((candidate) => !triedRoomCodes.has(candidate));
      if (!nextCode) {
        handlers.onStatus?.(
          "All room codes are currently in use. Please try again in a moment.",
          true
        );
        return;
      }
      net.roomCode = nextCode;
      net.roomLabel = codeLabel(nextCode);
      triedRoomCodes.add(nextCode);
      handlers.onStatus?.("Room code was already in use — trying a different code…");
      setTimeout(() => {
        if (net.peer === peer) hostOpenPeer(net, handlers, triedRoomCodes);
      }, 250);
      return;
    }
    if (ty === "unavailable-id") {
      setTimeout(() => {
        if (net.peer === peer) hostOpenPeer(net, handlers, triedRoomCodes);
      }, 2000);
      return;
    }
    if (
      ty === "network" ||
      ty === "socket-error" ||
      ty === "socket-closed" ||
      ty === "server-error"
    ) {
      handlers.onStatus?.(
        "Matchmaker hiccup — reopening the room…",
        true
      );
      setTimeout(() => {
        if (net.peer === peer) hostOpenPeer(net, handlers, triedRoomCodes);
      }, 2000);
      return;
    }
    if (ty === "peer-unavailable") return;
    handlers.onStatus?.(
      `Network error: ${ty || "unknown"} — check your internet and try again.`,
      true
    );
  });
  peer.on("connection", (c) => {
    c.on("open", () => {
      c.__lastSeen = Date.now();
      c.on("data", (d) => {
        try {
          onHostData(net, c, d as NetMessage, handlers);
        } catch (err) {
          // swallow individual message errors
          console.error(err);
        }
      });
      c.on("close", () => onHostClose(net, c, handlers));
      c.on("error", () => onHostClose(net, c, handlers));
    });
  });
}

function startHostHeartbeat(net: NetState, _handlers: NetHandlers) {
  if (net.hbTimer) clearInterval(net.hbTimer);
  net.hbTimer = setInterval(() => {
    const now = Date.now();
    for (let i = 0; i < net.conns.length; i++) {
      const c = net.conns[i];
      if (!c) continue;
      if (!c.open) {
        onHostClose(net, c, _handlers);
        continue;
      }
      if (now - (c.__lastSeen || now) > GAME.CONN_TIMEOUT_MS) {
        try {
          c.close();
        } catch (_) {
          // ignore
        }
        onHostClose(net, c, _handlers);
        continue;
      }
      safeSend(c, { t: "ping", ts: now });
    }
  }, GAME.HEARTBEAT_MS);
}

function onHostData(
  net: NetState,
  c: DataConnection,
  d: NetMessage,
  handlers: NetHandlers
) {
  c.__lastSeen = Date.now();
  const idx = net.conns.indexOf(c);
  switch (d.t) {
    case "hello": {
      // Resolve this connection to an existing seat by connection first, then stable player ID.
      let seatIdx = idx;
      const isRejoin = seatIdx < 0 && net.roster.some((p, i) => i > 0 && p.playerId === d.playerId);
      if (seatIdx < 0) {
        const priorSeat = net.roster.findIndex(
          (p, i) => i > 0 && p.playerId === d.playerId && !net.conns[i]
        );
        const vacantSeat = net.roster.findIndex(
          (_p, i) => i > 0 && i < net.conns.length && !net.conns[i]
        );
        seatIdx = priorSeat >= 0 ? priorSeat : vacantSeat >= 0 ? vacantSeat : net.roster.length;
        if (seatIdx >= GAME.MAX_PLAYERS) {
          safeSend(c, { t: "lobbyText", text: "Room is full." });
          try { c.close(); } catch (_) { /* ignore */ }
          return;
        }
        net.conns[seatIdx] = c;
        if (net.roster[seatIdx]) {
          net.roster[seatIdx].name = d.name;
          net.roster[seatIdx].playerId = d.playerId;
          if (d.charId !== null) net.roster[seatIdx].charId = d.charId;
        } else {
          net.roster[seatIdx] = {
            name: d.name,
            playerId: d.playerId,
            charId: d.charId,
            ready: false,
          };
        }
      } else if (net.roster[seatIdx]) {
        net.roster[seatIdx].name = d.name;
        if (d.charId !== null) net.roster[seatIdx].charId = d.charId;
      }

      safeSend(c, {
        t: "welcome",
        idx: seatIdx,
        roster: net.roster,
        code: net.roomCode || "",
        goal: net.goal,
      });
      net.lobbyChat.slice(-GAME.CHAT_TAIL).forEach((m) => safeSend(c, { t: "chat", msg: m }));
      if (net.started && net.currentState) {
        safeSend(c, { t: "start", s: net.currentState, idx: seatIdx });
        if (isRejoin) handlers.onRejoin?.(seatIdx);
      }
      broadcastRoster(net);
      break;
    }
    case "charPick": {
      if (idx >= 0 && net.roster[idx]) {
        net.roster[idx].charId = d.charId;
        broadcastRoster(net);
      }
      break;
    }
    case "chat": {
      net.lobbyChat.push(d.msg);
      if (net.lobbyChat.length > GAME.CHAT_TAIL * 2) {
        net.lobbyChat = net.lobbyChat.slice(-GAME.CHAT_TAIL);
      }
      broadcastChat(net, d.msg);
      break;
    }
    case "input": {
      if (idx >= 0) handlers.onInput?.(d.input, idx);
      break;
    }
    case "shoot": {
      if (idx >= 0) handlers.onShoot?.(d, idx);
      break;
    }
    case "ability": {
      if (idx >= 0) handlers.onAbility?.(d.ts, idx);
      break;
    }
    case "switchWeapon": {
      if (idx >= 0) handlers.onSwitchWeapon?.(d.weapon, idx);
      break;
    }
    case "capture": {
      if (idx >= 0) handlers.onCapture?.(d.nodeId, d.start, idx);
      break;
    }
    case "pong": {
      if (idx >= 0) handlers.onPong?.(idx, d.ts);
      break;
    }
    case "goodbye": {
      onHostClose(net, c, handlers);
      break;
    }
  }
}

function onHostClose(
  net: NetState,
  c: DataConnection,
  handlers: NetHandlers
) {
  const idx = net.conns.indexOf(c);
  if (idx < 0) return;
  net.conns[idx] = null;
  if (net.roster[idx]) {
    net.roster[idx].ready = false;
  }
  handlers.onGoodbye?.(idx);
  broadcastRoster(net);
}

function broadcastRoster(net: NetState) {
  for (let i = 0; i < net.conns.length; i++) {
    safeSend(net.conns[i], {
      t: "roster",
      roster: net.roster,
      goal: net.goal,
      chat: net.lobbyChat.slice(-GAME.CHAT_TAIL),
    });
  }
}

function broadcastChat(net: NetState, msg: ChatEntry) {
  for (let i = 0; i < net.conns.length; i++) {
    safeSend(net.conns[i], { t: "chat", msg });
  }
}

export function hostBroadcast(
  net: NetState,
  msg: NetMessage,
  excludeIdx: number = -1
) {
  if (msg.t === "state" && net.currentState) {
    net.currentState = { ...net.currentState, ...msg.s } as GameState;
  }
  for (let i = 0; i < net.conns.length; i++) {
    if (i === excludeIdx) continue;
    safeSend(net.conns[i], msg);
  }
}

export function hostSendTo(net: NetState, idx: number, msg: NetMessage) {
  if (idx === net.myIdx) return;
  safeSend(net.conns[idx] || null, msg);
}

export function hostSetGoal(net: NetState, goal: number) {
  net.goal = goal;
  broadcastRoster(net);
}

export function hostSetChar(net: NetState, idx: number, charId: string | null) {
  if (net.roster[idx]) {
    net.roster[idx].charId = charId;
    broadcastRoster(net);
  }
}

export function hostBroadcastStart(net: NetState, s: GameState) {
  net.started = true;
  net.currentState = s;
  for (let i = 0; i < net.conns.length; i++) {
    if (i === net.myIdx) continue;
    safeSend(net.conns[i], { t: "start", s, idx: i });
  }
}

// ============ GUEST ============

export function guestJoin(
  net: NetState,
  name: string,
  code: string,
  handlers: NetHandlers
): NetState {
  net.role = "guest";
  net.myName = name;
  net.roomCode = matchBuzzword(code);
  net.roomLabel = codeLabel(net.roomCode);
  guestOpenPeer(net, handlers);
  return net;
}

function guestOpenPeer(net: NetState, handlers: NetHandlers) {
  if (!net.roomCode) {
    handlers.onFatal?.("No room code provided.");
    return;
  }
  const old = net.peer;
  if (old && !old.destroyed) {
    try { old.destroy(); } catch (_) { /* ignore */ }
  }

  const peer = new Peer(PEER_OPTIONS);
  net.peer = peer;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let connecting = false;
  let initialAttempt = true;

  const stopHeartbeat = () => {
    if (net.hbTimer) {
      clearInterval(net.hbTimer);
      net.hbTimer = null;
    }
  };

  const scheduleRetry = (message: string) => {
    if (net.peer !== peer || peer.destroyed || retryTimer) return;
    handlers.onStatus?.(message, true);
    const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
    attempt = Math.min(attempt + 1, 3);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (net.peer !== peer || peer.destroyed) return;
      if (peer.disconnected) {
        try { peer.reconnect(); } catch (_) { scheduleRetry("Reconnecting to the signalling server…"); }
        return; // the peer's next open event will retry the data connection
      }
      connectToHost();
    }, delay);
  };

  const connectToHost = () => {
    if (net.peer !== peer || peer.destroyed || peer.disconnected || connecting) return;
    const existing = net.conns[0];
    if (existing?.open) return;
    connecting = true;
    handlers.onStatus?.(attempt ? "Reconnecting to the host…" : "Contacting the host…");
    const c = peer.connect(PFX + net.roomCode, { reliable: true });
    net.conns = [c];
    let opened = false;
    let attemptTimeout: ReturnType<typeof setTimeout> | null = null;

    const clearAttemptTimeout = () => {
      if (attemptTimeout) {
        clearTimeout(attemptTimeout);
        attemptTimeout = null;
      }
    };

    c.on("open", () => {
      if (net.peer !== peer || net.conns[0] !== c) {
        try { c.close(); } catch (_) { /* ignore */ }
        return;
      }
      opened = true;
      connecting = false;
      attempt = 0;
      initialAttempt = false;
      clearAttemptTimeout();
      c.__lastSeen = Date.now();
      handlers.onStatus?.("Connected to host.");
      c.on("data", (d) => {
        try { onGuestData(net, d as NetMessage, handlers); }
        catch (err) { console.error("Invalid network message from host", err); }
      });
      c.on("close", () => {
        clearAttemptTimeout();
        if (net.conns[0] === c) {
          net.conns[0] = null;
          connecting = false;
          stopHeartbeat();
          scheduleRetry("Connection lost — trying to reconnect…");
        }
      });
      c.on("error", () => {
        clearAttemptTimeout();
        if (net.conns[0] === c) {
          connecting = false;
          stopHeartbeat();
          scheduleRetry("Connection error — trying to reconnect…");
        }
      });
      safeSend(c, {
        t: "hello",
        name: net.myName,
        charId: null,
        playerId: net.playerId,
      });

      if (net.hbTimer) clearInterval(net.hbTimer);
      net.hbTimer = setInterval(() => {
        if (net.peer !== peer || net.conns[0] !== c) return;
        const now = Date.now();
        if (!c.open || now - (c.__lastSeen || now) > GAME.CONN_TIMEOUT_MS) {
          try { c.close(); } catch (_) { /* ignore */ }
          if (net.conns[0] === c) {
            net.conns[0] = null;
            connecting = false;
            stopHeartbeat();
            scheduleRetry("Host heartbeat timed out — reconnecting…");
          }
          return;
        }
        safeSend(c, { t: "ping", ts: now });
      }, GAME.HEARTBEAT_MS);
    });

    c.on("error", () => {
      if (opened) return;
      clearAttemptTimeout();
      if (net.conns[0] === c) net.conns[0] = null;
      connecting = false;
      stopHeartbeat();
      scheduleRetry("Could not establish a connection — retrying…");
    });

    attemptTimeout = setTimeout(() => {
      if (opened || net.peer !== peer || net.conns[0] !== c) return;
      try { c.close(); } catch (_) { /* ignore */ }
      net.conns[0] = null;
      connecting = false;
      stopHeartbeat();
      scheduleRetry("Connection timed out — retrying…");
    }, 12000);
  };

  peer.on("open", () => {
    if (net.peer === peer) connectToHost();
  });
  peer.on("disconnected", () => {
    if (net.peer !== peer || peer.destroyed) return;
    scheduleRetry("Signalling connection lost — reconnecting…");
  });
  peer.on("error", (e: { type?: string }) => {
    if (net.peer !== peer) return;
    const ty = e?.type;
    if (ty === "peer-unavailable") {
      if (initialAttempt && !net.started) {
        handlers.onFatal?.("That room does not exist (or the host has closed it). Check the buzzword.");
      } else {
        scheduleRetry("Host not reachable right now — retrying…");
      }
      return;
    }
    if (ty === "network" || ty === "socket-error" || ty === "socket-closed" || ty === "server-error") {
      scheduleRetry("Signalling hiccup — reconnecting…");
      return;
    }
    handlers.onStatus?.(`Network error: ${ty || "unknown"}`, true);
  });
}
function onGuestData(
  net: NetState,
  d: NetMessage,
  handlers: NetHandlers
) {
  const c = net.conns[0];
  if (c) c.__lastSeen = Date.now();
  switch (d.t) {
    case "welcome":
      net.myIdx = d.idx;
      net.roster = d.roster;
      net.goal = d.goal;
      handlers.onRoster?.(d.roster, net.lobbyChat);
      break;
    case "roster":
      net.roster = d.roster;
      net.goal = d.goal;
      net.lobbyChat = d.chat;
      handlers.onRoster?.(d.roster, d.chat);
      break;
    case "charPick":
      handlers.onCharPick?.(d.idx, d.charId);
      break;
    case "chat":
      net.lobbyChat.push(d.msg);
      handlers.onChat?.(d.msg);
      break;
    case "lobbyText":
      handlers.onLobbyText?.(d.text);
      break;
    case "start":
      net.started = true;
      handlers.onStart?.(d.s, d.idx);
      break;
    case "state":
      handlers.onState?.(d.s);
      break;
    case "ping":
      safeSend(c, { t: "pong", ts: d.ts });
      break;
    case "reload":
      handlers.onReload?.();
      break;
    default:
      // ignore unknown
      break;
  }
}

export function guestSend(net: NetState, msg: NetMessage) {
  if (net.role !== "guest") return;
  const c = net.conns[0];
  safeSend(c, msg);
}

export function closeNet(net: NetState) {
  if (net.hbTimer) {
    clearInterval(net.hbTimer);
    net.hbTimer = null;
  }
  net.conns.forEach((c) => {
    if (c && c.open) {
      try {
        c.send({ t: "goodbye" } as NetMessage);
      } catch (_) {
        // ignore
      }
      try {
        c.close();
      } catch (_) {
        // ignore
      }
    }
  });
  if (net.peer && !net.peer.destroyed) {
    try {
      net.peer.destroy();
    } catch (_) {
      // ignore
    }
  }
  net.peer = null;
  net.conns = [];
  net.role = null;
}
