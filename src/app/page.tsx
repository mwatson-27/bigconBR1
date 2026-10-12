"use client";

import { useEffect, useRef, useState } from "react";
import { SetupScreen } from "@/components/bigcon/SetupScreen";
import { GameCanvas } from "@/components/bigcon/GameCanvas";
import {
  createNet,
  hostCreate,
  guestJoin,
  hostSetChar,
  hostSetGoal,
  type NetState,
  type NetHandlers,
} from "@/lib/bigcon/network";
import { GAME, matchBuzzword, codeLabel } from "@/lib/bigcon/constants";

type Session =
  | { kind: "setup" }
  | {
      kind: "playing";
      role: "host" | "guest" | "practice";
      myName: string;
      roomCode: string;
      charId: string | null;
      goal: number;
    };

export default function Home() {
  const [session, setSession] = useState<Session>({ kind: "setup" });
  const [roster, setRoster] = useState<
    { name: string; playerId: string; charId: string | null; ready: boolean }[]
  >([]);
  const [myIdx, setMyIdx] = useState<number>(0);
  const [netStatus, setNetStatus] = useState<string>("");
  const [netStatusErr, setNetStatusErr] = useState<boolean>(false);
  const [chat, setChat] = useState<
    { ts: number; idx: number; name: string; text: string }[]
  >([]);
  const [goal, setGoal] = useState<number>(GAME.GOAL_DEF);
  const [myCharId, setMyCharId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string>("");
  const [roomLabel, setRoomLabel] = useState<string>("");

  // Single persistent net state across setup — useRef for a mutable singleton
  const netRef = useRef<NetState>(createNet());

  // Network handlers (used only during setup phase)
  const handlers: NetHandlers = {
    onStatus: (msg, isErr) => {
      setNetStatus(msg);
      setNetStatusErr(!!isErr);
    },
    onRoster: (r, c) => {
      setRoster(r);
      setChat(c);
    },
    onChat: (m) => setChat((prev) => [...prev, m].slice(-30)),
    onLobbyText: (text) => {
      setNetStatus(text);
      setNetStatusErr(true);
    },
    onCharPick: () => {
      // handled via roster update
    },
    onFatal: (msg) => {
      setNetStatus(msg);
      setNetStatusErr(true);
    },
    // In-game handlers — wired by GameCanvas via its own net instance.
    // For the setup phase we ignore these.
    onStart: () => {},
    onState: () => {},
    onInput: () => {},
    onShoot: () => {},
    onAbility: () => {},
    onSwitchWeapon: () => {},
    onCapture: () => {},
    onReload: () => {},
    onGoodbye: () => {},
    onPong: () => {},
  };

  useEffect(() => {
    // Set window title
    document.title = "THE BIG CON — FPS BATTLE ROYALE";
  }, []);

  function handleHost(name: string, charId: string | null) {
    const net = netRef.current;
    hostCreate(net, name, handlers);
    setMyIdx(0);
    setRoster(net.roster);
    setRoomCode(net.roomCode || "");
    setRoomLabel(net.roomLabel || "");
    if (charId) {
      hostSetChar(net, 0, charId);
      setMyCharId(charId);
    }
    setNetStatus(
      `Room created — seats up to ${GAME.MAX_PLAYERS}. Waiting for co-conspirators…`
    );
  }

  function handleJoin(name: string, code: string, charId: string | null) {
    const net = netRef.current;
    guestJoin(net, name, code, handlers);
    setMyCharId(charId);
    setNetStatus("Contacting the host…");
  }

  function handlePickChar(charId: string | null) {
    const net = netRef.current;
    if (net.role === "host") {
      hostSetChar(net, net.myIdx, charId);
      setMyCharId(charId);
      setRoster([...net.roster]);
    } else {
      // Re-hello with new char
      const c = net.conns[0];
      if (c && c.open) {
        c.send({
          t: "hello",
          name: net.myName,
          charId,
          playerId: net.playerId,
        });
      }
      setMyCharId(charId);
    }
  }

  function handleSetGoal(g: number) {
    const net = netRef.current;
    if (net.role === "host") {
      hostSetGoal(net, g);
      setGoal(g);
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
      net.lobbyChat.push(msg);
      if (net.lobbyChat.length > GAME.CHAT_TAIL * 2) {
        net.lobbyChat = net.lobbyChat.slice(-GAME.CHAT_TAIL);
      }
      net.conns.forEach((c) => {
        if (c && c.open) {
          try {
            c.send({ t: "chat", msg });
          } catch (_) {
            // ignore
          }
        }
      });
      setChat([...net.lobbyChat].slice(-30));
    } else {
      const c = net.conns[0];
      if (c && c.open) {
        try {
          c.send({ t: "chat", msg });
        } catch (_) {
          // ignore
        }
      }
    }
  }

  function handleStart() {
    const net = netRef.current;
    if (net.role !== "host") return;
    if (net.roster.length < GAME.MIN_PLAYERS) return;
    if (!net.roster[net.myIdx]?.charId) return;
    // Switch to playing phase — GameCanvas takes over networking via its own net.
    setSession({
      kind: "playing",
      role: "host",
      myName: net.myName,
      roomCode: net.roomCode || "",
      charId: net.roster[net.myIdx].charId,
      goal: net.goal,
    });
  }

  function handlePractice(name: string, charId: string | null, goal: number) {
    setSession({
      kind: "playing",
      role: "practice",
      myName: name,
      roomCode: "",
      charId,
      goal,
    });
  }

  // Watch for net updates — roster may change as guests arrive
  useEffect(() => {
    const iv = setInterval(() => {
      const net = netRef.current;
      if (net.role === "host") {
        if (net.roster !== roster) {
          setRoster([...net.roster]);
        }
      }
      // Update room code label in case it changed (regeneration)
      if (net.roomCode && net.roomCode !== roomCode) {
        setRoomCode(net.roomCode);
        setRoomLabel(net.roomLabel || codeLabel(net.roomCode));
      }
    }, 800);
    return () => clearInterval(iv);
  }, [roster, roomCode]);

  if (session.kind === "playing") {
    return (
      <GameCanvas
        role={session.role}
        myName={session.myName}
        roomCode={session.roomCode}
        charId={session.charId}
        initialGoal={session.goal}
        onExit={() => {
          // Full reload to reset state cleanly
          window.location.reload();
        }}
      />
    );
  }

  return (
    <SetupScreen
      onHost={handleHost}
      onJoin={handleJoin}
      onSetGoal={handleSetGoal}
      netStatus={netStatus}
      netStatusErr={netStatusErr}
      roster={roster}
      myIdx={myIdx}
      roomCode={roomCode || null}
      roomLabel={roomLabel || null}
      goal={goal}
      chat={chat}
      onSendChat={handleSendChat}
      onStart={handleStart}
      canStart={
        roster.length >= GAME.MIN_PLAYERS &&
        !!roster[myIdx]?.charId
      }
      myCharId={myCharId}
      onPickChar={handlePickChar}
      onPractice={handlePractice}
    />
  );
}
