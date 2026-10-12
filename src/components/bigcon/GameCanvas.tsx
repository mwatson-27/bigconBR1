"use client";

import { useEffect, useRef, useState } from "react";
import { FpsEngine } from "@/lib/bigcon/fps";
import { HUD } from "./HUD";
import {
  GAME,
  NODES,
  WEAPONS,
  charById,
  type WeaponId,
} from "@/lib/bigcon/constants";
import type {
  GameState,
  PlayerInput,
  NetMessage,
} from "@/lib/bigcon/types";
import {
  type NetState,
  type NetHandlers,
  hostCreate,
  guestJoin,
  hostBroadcast,
  hostSendTo,
  hostBroadcastStart,
  hostSetChar,
  hostSetGoal,
  closeNet,
  createNet,
} from "@/lib/bigcon/network";
import {
  createInitialState,
  applyInput,
  fireShot,
  tick,
  triggerAbility,
  pubState,
  log as engineLog,
  chat as engineChat,
  setMood,
  resetTickClock,
  type GameState as EngineState,
} from "@/lib/bigcon/engine";
import type { MoodKey } from "@/lib/bigcon/constants";

type Phase = "lobby" | "playing";

type Props = {
  role: "host" | "guest" | "practice";
  myName: string;
  roomCode: string;
  charId: string | null;
  initialGoal: number;
  onExit: () => void;
};

type KillFeedItem = {
  killerIdx: number;
  victimIdx: number;
  weapon: string;
  ts: number;
};

export function GameCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<FpsEngine | null>(null);
  const netRef = useRef<NetState>(createNet());
  const stateRef = useRef<EngineState | null>(null);
  // initEngineRef holds the engine init function so the mount effect can call it
  // without referencing the const before its declaration.
  const initEngineRef = useRef<(s: EngineState, idx: number) => void>(() => {});
  // guestSendRef holds the guest-send helper so callbacks inside initEngine can
  // use it without referencing the const before its declaration.
  const guestSendRef = useRef<(net: NetState, msg: NetMessage) => void>(() => {});
  // startHostTickLoopRef holds the host tick loop starter.
  const startHostTickLoopRef = useRef<() => void>(() => {});
  const [phase, setPhase] = useState<Phase>("lobby");
  const [roster, setRoster] = useState<
    { name: string; playerId: string; charId: string | null; ready: boolean }[]
  >([]);
  const [myIdx, setMyIdx] = useState<number>(0);
  const [netStatus, setNetStatus] = useState<string>("");
  const [netStatusErr, setNetStatusErr] = useState<boolean>(false);
  const [chat, setChat] = useState<
    { ts: number; idx: number; name: string; text: string }[]
  >([]);
  const [goal, setGoal] = useState<number>(props.initialGoal);
  const [myCharId, setMyCharId] = useState<string | null>(props.charId);
  const [roomCode, setRoomCode] = useState<string>("");
  const [roomLabel, setRoomLabel] = useState<string>("");
  const [, forceTick] = useState<number>(0);

  // Game HUD state
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [currentWeapon, setCurrentWeapon] = useState<WeaponId>("LEAK");
  const [captureNodeId, setCaptureNodeId] = useState<string | null>(null);
  const [captureProgress, setCaptureProgress] = useState<number>(0);
  const [damageFlash, setDamageFlash] = useState<boolean>(false);
  const [hitMarker, setHitMarker] = useState<{ color: string; ts: number } | null>(null);
  const [pickupToast, setPickupToast] = useState<{ text: string; color: string; ts: number } | null>(null);
  const [killfeed, setKillfeed] = useState<KillFeedItem[]>([]);
  const [showScoreboard, setShowScoreboard] = useState<boolean>(false);
  const [showPointerHint, setShowPointerHint] = useState<boolean>(true);

  // Set up network on mount
  useEffect(() => {
    const net = netRef.current;
    const handlers: NetHandlers = {
      onStatus: (msg, isErr) => {
        setNetStatus(msg);
        setNetStatusErr(!!isErr);
      },
      onRoster: (r, c) => {
        setRoster(r);
        setChat(c);
      },
      onChat: (m) => {
        setChat((prev) => [...prev, m].slice(-30));
      },
      onStart: (s, idx) => {
        stateRef.current = s;
        setMyIdx(idx);
        setPhase("playing");
        // Initialize engine after canvas mounts
        setTimeout(() => initEngineRef.current(s, idx), 50);
      },
      onState: (partial) => {
        // Guest: merge partial into local state
        if (stateRef.current) {
          const merged = { ...stateRef.current, ...partial } as EngineState;
          // Deep merge nested fields
          if (partial.players) merged.players = partial.players;
          if (partial.projectiles) merged.projectiles = partial.projectiles;
          if (partial.loot) merged.loot = partial.loot;
          if (partial.killFeed) merged.killFeed = partial.killFeed;
          if (partial.log) merged.log = partial.log;
          if (partial.chat) merged.chat = partial.chat;
          if (partial.owner) merged.owner = partial.owner;
          if (partial.capture) merged.capture = partial.capture;
          if (partial.fx) merged.fx = partial.fx;
          stateRef.current = merged;
          setGameState(merged);
          // Apply to engine
          engineRef.current?.applyState(merged);
          // Detect new killfeed entries
          if (partial.killFeed) {
            for (const k of partial.killFeed) {
              if (!killfeed.find((x) => x.ts === k.ts && x.victimIdx === k.victimIdx)) {
                setKillfeed((prev) => [...prev, k].slice(-10));
                // If I'm the killer, show hit marker (already handled by engine onHitMarker)
                // If I'm the victim, show damage flash
                if (k.victimIdx === myIdx) {
                  setDamageFlash(true);
                  setTimeout(() => setDamageFlash(false), 450);
                }
              }
            }
          }
        }
      },
      onInput: (pi, fromIdx) => {
        // Host only: apply guest input
        if (stateRef.current && net.role === "host") {
          applyInput(stateRef.current, fromIdx, pi, 33);
        }
      },
      onShoot: (msg, fromIdx) => {
        // Host only: spawn projectile
        if (stateRef.current && net.role === "host") {
          fireShot(
            stateRef.current,
            fromIdx,
            msg.weapon,
            msg.pos,
            msg.dir
          );
        }
      },
      onAbility: (_ts, fromIdx) => {
        if (stateRef.current && net.role === "host") {
          triggerAbility(stateRef.current, fromIdx);
        }
      },
      onSwitchWeapon: (w, fromIdx) => {
        if (stateRef.current && net.role === "host") {
          if (stateRef.current.players[fromIdx]) {
            stateRef.current.players[fromIdx].weapon = w;
          }
        }
      },
      onCapture: (nodeId, _start, fromIdx) => {
        // Engine handles capture automatically when player is inside radius.
        // We just nudge the capture state.
        if (stateRef.current && net.role === "host") {
          const c = stateRef.current.capture[nodeId];
          if (!c || c.idx !== fromIdx) {
            stateRef.current.capture[nodeId] = { idx: fromIdx, startedAt: Date.now() };
          }
        }
      },
      onLobbyText: (text) => {
        setNetStatus(text);
        setNetStatusErr(true);
      },
      onReload: () => {
        window.location.reload();
      },
      onGoodbye: (fromIdx) => {
        if (stateRef.current && net.role === "host") {
          if (stateRef.current.players[fromIdx]) {
            stateRef.current.players[fromIdx].dc = true;
            if (stateRef.current.players[fromIdx].alive) {
              stateRef.current.players[fromIdx].alive = false;
              stateRef.current.players[fromIdx].diedAt = Date.now();
              engineLog(stateRef.current, `${stateRef.current.players[fromIdx].name} disconnected.`);
            }
          }
        }
      },
      onFatal: (msg) => {
        setNetStatus(msg);
        setNetStatusErr(true);
      },
      onPong: (_fromIdx, _ts) => {
        // heartbeat tracking — handled implicitly
      },
      onCharPick: (_idx, _charId) => {
        // handled via roster update
      },
    };

    if (props.role === "host") {
      hostCreate(net, props.myName, handlers);
      // Defer state updates to after the effect runs — avoids cascading renders.
      queueMicrotask(() => {
        setMyIdx(0);
        setRoster(net.roster);
        setRoomCode(net.roomCode || "");
        setRoomLabel(net.roomLabel || "");
      });
    } else if (props.role === "guest") {
      guestJoin(net, props.myName, props.roomCode, handlers);
    } else {
      // Practice mode — bypass networking, start immediately with bots
      const botCount = 5;
      const rosterForBots = [
        {
          name: props.myName,
          playerId: "host",
          charId: props.charId,
        },
      ];
      const s = createInitialState(rosterForBots, props.initialGoal, botCount);
      stateRef.current = s;
      // Find my own idx in the shuffled roster
      const myPlayer = s.players.find((p) => p.id === "host");
      const idx = myPlayer ? myPlayer.idx : 0;
      queueMicrotask(() => {
        setMyIdx(idx);
        setPhase("playing");
      });
      setTimeout(() => initEngineRef.current(s, idx), 50);
    }

    return () => {
      closeNet(net);
      engineRef.current?.destroy();
    };
  }, []);

  // Engine init — declared as a function expression. We also stash it in a ref
  // inside a separate effect (below) so the mount effect above can call it
  // without referencing the const before its declaration.
  const initEngine = (s: EngineState, idx: number) => {
    if (!canvasRef.current) return;
    if (engineRef.current) return;
    const isHost = props.role === "host" || props.role === "practice";
    const engine = new FpsEngine(canvasRef.current, idx, isHost, {
      sendInput: (input: PlayerInput) => {
        const net = netRef.current;
        if (net.role === "host" || props.role === "practice") {
          // Host or practice: apply locally for prediction
          if (stateRef.current) {
            applyInput(stateRef.current, idx, input, 33);
          }
        } else {
          guestSendRef.current(net, { t: "input", input });
        }
      },
      sendShoot: (weapon, pos, dir) => {
        const net = netRef.current;
        if (net.role === "host" || props.role === "practice") {
          if (stateRef.current) {
            fireShot(stateRef.current, idx, weapon, pos, dir);
          }
        } else {
          guestSendRef.current(net, {
            t: "shoot",
            weapon,
            pos,
            dir,
            ts: Date.now(),
          });
        }
      },
      sendAbility: () => {
        const net = netRef.current;
        if (net.role === "host" || props.role === "practice") {
          if (stateRef.current) triggerAbility(stateRef.current, idx);
        } else {
          guestSendRef.current(net, { t: "ability", ts: Date.now() });
        }
      },
      sendSwitchWeapon: (w) => {
        setCurrentWeapon(w);
        const net = netRef.current;
        if (net.role === "host" || props.role === "practice") {
          if (stateRef.current && stateRef.current.players[idx]) {
            stateRef.current.players[idx].weapon = w;
          }
        } else {
          guestSendRef.current(net, { t: "switchWeapon", weapon: w });
        }
      },
      sendCapture: (nodeId, start) => {
        const net = netRef.current;
        if (net.role !== "host" && props.role !== "practice") {
          guestSendRef.current(net, { t: "capture", nodeId, start });
        }
      },
      onHitMarker: (color) => {
        setHitMarker({ color, ts: Date.now() });
      },
      onDamage: (_fromIdx) => {
        setDamageFlash(true);
        setTimeout(() => setDamageFlash(false), 450);
      },
      onPickup: (label, color) => {
        setPickupToast({ text: label, color, ts: Date.now() });
        setTimeout(() => setPickupToast(null), 1400);
      },
      onKill: (killerName, victimName, weapon) => {
        // Already pushed via onState
        void killerName;
        void victimName;
        void weapon;
      },
      onPointerLockChange: (locked) => {
        setShowPointerHint(!locked);
      },
      onCaptureProgress: (nodeId, progress) => {
        setCaptureNodeId(nodeId);
        setCaptureProgress(progress);
      },
    });
    engineRef.current = engine;
    engine.applyState(s);
    engine.start();
    // If host, start the host tick loop
    if (isHost) {
      resetTickClock();
      startHostTickLoopRef.current();
    }
  };

  // Stash initEngine in a ref so the mount effect (declared above) can call it
  // without tripping the "accessed before declaration" lint rule. This effect
  // runs after every render and keeps the ref pointing at the latest closure.
  useEffect(() => {
    initEngineRef.current = initEngine;
  });

  // Guest send helper — assigned to a ref so callbacks inside initEngine can
  // use it without referencing the const before its declaration.
  const guestSendLocal = (net: NetState, msg: NetMessage) => {
    if (net.role !== "guest") return;
    const c = net.conns[0];
    if (c && c.open) {
      try {
        c.send(msg);
      } catch (e) {
        // ignore
      }
    }
  };
  // Keep the ref in sync.
  useEffect(() => {
    guestSendRef.current = guestSendLocal;
  });

  // Host tick loop — advances simulation and broadcasts state. Assigned to a
  // ref so initEngine (declared above) can call it without referencing the
  // const before its declaration.
  const startHostTickLoop = () => {
    const intervalMs = 50; // 20Hz
    const tickLoop = setInterval(() => {
      const s = stateRef.current;
      const net = netRef.current;
      if (!s) return;
      if (net.role !== "host" && props.role !== "practice") return;
      tick(s);
      // Broadcast state to all guests (host only — practice has no guests)
      if (net.role === "host") {
        const partial = pubState(s);
        hostBroadcast(net, { t: "state", s: partial });
      }
      // Also update local React state for HUD
      setGameState({ ...s });
      // Update local engine state (host engine needs to see the world too)
      engineRef.current?.applyState(s);
    }, intervalMs);
    // Store interval for cleanup — use a ref instead of window.
    tickLoopRef.current = tickLoop;
  };
  // Keep startHostTickLoop ref in sync (must be after declaration).
  useEffect(() => {
    startHostTickLoopRef.current = startHostTickLoop;
  });
  const tickLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup tick loop on unmount
  useEffect(() => {
    return () => {
      if (tickLoopRef.current) clearInterval(tickLoopRef.current);
    };
  }, []);

  // Lobby actions
  function handleHostStart() {
    const net = netRef.current;
    if (net.role !== "host") return;
    if (net.roster.length < GAME.MIN_PLAYERS) return;
    if (!net.roster[net.myIdx]?.charId) return;
    const s = createInitialState(
      net.roster.map((r) => ({
        name: r.name,
        playerId: r.playerId,
        charId: r.charId,
      })),
      net.goal
    );
    stateRef.current = s;
    setMyIdx(net.myIdx);
    setPhase("playing");
    hostBroadcastStart(net, s);
    setTimeout(() => initEngineRef.current(s, net.myIdx), 50);
  }

  function handlePickChar(charId: string | null) {
    const net = netRef.current;
    if (net.role === "host") {
      hostSetChar(net, net.myIdx, charId);
      setMyCharId(charId);
      setRoster([...net.roster]);
    } else {
      // Send hello again with new char
      const c = net.conns[0];
      if (c && c.open) {
        c.send({ t: "hello", name: net.myName, charId, playerId: net.playerId });
      }
      setMyCharId(charId);
    }
  }

  function handleSendChat(text: string) {
    const net = netRef.current;
    const msg = {
      ts: Date.now(),
      idx: net.myIdx,
      name: net.myName,
      text,
    };
    if (net.role === "host") {
      if (stateRef.current) {
        engineChat(stateRef.current, msg);
      } else {
        net.lobbyChat.push(msg);
      }
      hostBroadcast(net, { t: "chat", msg });
      setChat([...net.lobbyChat].slice(-30));
    } else {
      guestSendRef.current(net, { t: "chat", msg });
    }
  }

  function handleSetGoal(g: number) {
    const net = netRef.current;
    if (net.role === "host") {
      hostSetGoal(net, g);
      setGoal(g);
    }
  }

  // Tab to toggle scoreboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Tab") {
        e.preventDefault();
        setShowScoreboard((s) => !s);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Tab") {
        // do nothing on key up — toggle on keydown
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Render
  if (phase === "lobby") {
    return (
      <LobbySetup
        role={props.role}
        myName={props.myName}
        roomCode={roomCode}
        roomLabel={roomLabel}
        roster={roster}
        myIdx={myIdx}
        netStatus={netStatus}
        netStatusErr={netStatusErr}
        goal={goal}
        chat={chat}
        myCharId={myCharId}
        onPickChar={handlePickChar}
        onSendChat={handleSendChat}
        onSetGoal={handleSetGoal}
        onStart={handleHostStart}
        canStart={
          roster.length >= GAME.MIN_PLAYERS &&
          !!roster[myIdx]?.charId
        }
        onExit={props.onExit}
      />
    );
  }

  // Playing
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100vw", height: "100vh" }}
        onClick={() => engineRef.current?.requestPointerLock()}
      />
      {gameState && (
        <HUD
          state={gameState}
          myIdx={myIdx}
          killfeed={killfeed}
          weapon={currentWeapon}
          captureNodeId={captureNodeId}
          captureProgress={captureProgress}
          damageFlash={damageFlash}
          hitMarker={hitMarker}
          pickupToast={pickupToast}
          showScoreboard={showScoreboard}
        />
      )}
      {showPointerHint && gameState && !gameState.over && gameState.players[myIdx]?.alive && (
        <div
          className="bc-ptrhint"
          onClick={() => engineRef.current?.requestPointerLock()}
        >
          CLICK TO LOOK AROUND
          <div className="small">
            WASD move · Mouse look · Left click fire · 1-5 weapon · R ability · E seize · Tab scoreboard
          </div>
        </div>
      )}
    </div>
  );
}

// Inline lobby setup that re-uses the SetupScreen visual identity
function LobbySetup(props: {
  role: "host" | "guest";
  myName: string;
  roomCode: string;
  roomLabel: string;
  roster: { name: string; playerId: string; charId: string | null; ready: boolean }[];
  myIdx: number;
  netStatus: string;
  netStatusErr: boolean;
  goal: number;
  chat: { ts: number; idx: number; name: string; text: string }[];
  myCharId: string | null;
  onPickChar: (id: string | null) => void;
  onSendChat: (text: string) => void;
  onSetGoal: (g: number) => void;
  onStart: () => void;
  canStart: boolean;
  onExit: () => void;
}) {
  // Lazy import to avoid SSR issues
  const [SetupScreenMod, setSetupScreenMod] = useState<{
    SetupScreen: React.ComponentType<unknown>;
  } | null>(null);
  useEffect(() => {
    import("./SetupScreen").then((m) => setSetupScreenMod(m as never));
  }, []);
  if (!SetupScreenMod) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "aqua",
          fontFamily: "Times New Roman, serif",
          fontSize: 22,
          letterSpacing: 3,
        }}
      >
        LOADING THE CON…
      </div>
    );
  }
  return (
    <SetupScreenMod.SetupScreen
      onHost={() => {}}
      onJoin={() => {}}
      onSetGoal={props.onSetGoal}
      netStatus={props.netStatus}
      netStatusErr={props.netStatusErr}
      roster={props.roster}
      myIdx={props.myIdx}
      roomCode={props.roomCode}
      roomLabel={props.roomLabel}
      goal={props.goal}
      chat={props.chat}
      onSendChat={props.onSendChat}
      onStart={props.onStart}
      canStart={props.canStart}
      myCharId={props.myCharId}
      onPickChar={props.onPickChar}
    />
  );
}
