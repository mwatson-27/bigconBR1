// PeerJS networking for The Big Con FPS Battle Royale
// Mirrors the host-authoritative model from the original board game:
// the host owns the GameState, guests send inputs, host broadcasts state.

import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import {
  PFX,
  PEER_OPTIONS,
  GAME,
  genCode,
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
  hostOpenPeer(net, handlers);
  startHostHeartbeat(net, handlers);
  return net;
}

function hostOpenPeer(net: NetState, handlers: NetHandlers) {
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
        if (net.peer === peer) hostOpenPeer(net, handlers);
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
      net.roomCode = genCode();
      net.roomLabel = codeLabel(net.roomCode);
      hostOpenPeer(net, handlers);
      return;
    }
    if (ty === "unavailable-id") {
      setTimeout(() => {
        if (net.peer === peer) hostOpenPeer(net, handlers);
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
        if (net.peer === peer) hostOpenPeer(net, handlers);
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
      // New or returning guest
      if (idx < 0) {
        // Seat them
        if (net.roster.length >= GAME.MAX_PLAYERS) {
          safeSend(c, { t: "lobbyText", text: "Room is full." });
          try {
            c.close();
          } catch (_) {
            // ignore
          }
          return;
        }
        const newIdx = net.roster.length;
        net.conns[newIdx] = c;
        net.roster[newIdx] = {
          name: d.name,
          playerId: d.playerId,
          charId: d.charId,
          ready: false,
        };
        safeSend(c, {
          t: "welcome",
          idx: newIdx,
          roster: net.roster,
          code: net.roomCode || "",
          goal: net.goal,
        });
        // Sync chat history
        net.lobbyChat.slice(-GAME.CHAT_TAIL).forEach((m) => safeSend(c, { t: "chat", msg: m }));
        broadcastRoster(net);
      } else {
        // Returning — update name/char
        if (net.roster[idx]) {
          net.roster[idx].name = d.name;
          if (d.charId !== null) net.roster[idx].charId = d.charId;
        }
        safeSend(c, {
          t: "welcome",
          idx,
          roster: net.roster,
          code: net.roomCode || "",
          goal: net.goal,
        });
        broadcastRoster(net);
      }
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
    try {
      old.destroy();
    } catch (_) {
      // ignore
    }
  }
  const peer = new Peer(PEER_OPTIONS);
  net.peer = peer;
  let connected = false;
  peer.on("open", () => {
    handlers.onStatus?.("Contacting the host…");
    const c = peer.connect(PFX + net.roomCode, { reliable: true });
    net.conns = [c];
    c.on("open", () => {
      connected = true;
      c.__lastSeen = Date.now();
      c.on("data", (d) => {
        try {
          onGuestData(net, d as NetMessage, handlers);
        } catch (err) {
          console.error(err);
        }
      });
      c.on("close", () => {
        if (!net.started) {
          handlers.onFatal?.("Host closed the connection.");
        }
      });
      c.on("error", () => {
        if (!connected) {
          handlers.onFatal?.("Could not reach the host — check the buzzword.");
        }
      });
      // Send hello
      safeSend(c, {
        t: "hello",
        name: net.myName,
        charId: null,
        playerId: net.playerId,
      });
      // Start heartbeat
      if (net.hbTimer) clearInterval(net.hbTimer);
      net.hbTimer = setInterval(() => {
        const now = Date.now();
        if (!c.open) return;
        if (now - (c.__lastSeen || now) > GAME.CONN_TIMEOUT_MS) {
          handlers.onFatal?.("Lost connection to the host.");
          try {
            c.close();
          } catch (_) {
            // ignore
          }
          if (net.hbTimer) {
            clearInterval(net.hbTimer);
            net.hbTimer = null;
          }
          return;
        }
        safeSend(c, { t: "ping", ts: now });
      }, GAME.HEARTBEAT_MS);
    });
    // Connection attempt timeout
    setTimeout(() => {
      if (!connected) {
        handlers.onFatal?.(
          "Could not reach the host — check the buzzword and try again."
        );
      }
    }, 12000);
  });
  peer.on("error", (e: { type?: string }) => {
    const ty = e && e.type;
    if (ty === "peer-unavailable") {
      handlers.onFatal?.(
        "That room does not exist (or the host has closed it). Check the buzzword."
      );
      return;
    }
    if (ty === "network" || ty === "socket-error" || ty === "socket-closed") {
      handlers.onStatus?.("Network hiccup — reconnecting…", true);
      try {
        peer.reconnect();
      } catch (_) {
        // ignore
      }
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
