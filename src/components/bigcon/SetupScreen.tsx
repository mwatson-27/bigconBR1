"use client";

import { useEffect, useState } from "react";
import {
  CHARS,
  CHAR_URL,
  GAME,
  BUZZWORDS,
  codeSlug,
  matchBuzzword,
  codeLabel,
} from "@/lib/bigcon/constants";

export type SetupResult = {
  role: "host" | "guest";
  name: string;
  code: string;
  charId: string | null;
  goal: number;
};

type Props = {
  onHost: (name: string, charId: string | null) => void;
  onJoin: (name: string, code: string, charId: string | null) => void;
  onSetGoal?: (goal: number) => void;
  netStatus: string;
  netStatusErr: boolean;
  roster: { name: string; playerId: string; charId: string | null; ready: boolean }[];
  myIdx: number;
  roomCode: string | null;
  roomLabel: string | null;
  goal: number;
  chat: { ts: number; idx: number; name: string; text: string }[];
  onSendChat: (text: string) => void;
  onStart: () => void;
  canStart: boolean;
  myCharId: string | null;
  onPickChar: (charId: string | null) => void;
  onPractice?: (name: string, charId: string | null, goal: number) => void;
};

export function SetupScreen(props: Props) {
  const [mode, setMode] = useState<"choose" | "host" | "join" | "practice">("choose");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [goal, setGoal] = useState<number>(GAME.GOAL_DEF);
  const [chatInput, setChatInput] = useState("");

  function clampGoal(v: number): number {
    const n = Math.round(Number(v) || 0);
    if (!n) return GAME.GOAL_DEF;
    return Math.max(GAME.GOAL_MIN, Math.min(GAME.GOAL_MAX, n));
  }

  // Reflect goal changes to parent (host only)
  useEffect(() => {
    if (mode === "host" && props.onSetGoal) {
      props.onSetGoal(clampGoal(goal));
    }
  }, [goal, mode, props.onSetGoal]);

  function handleHost() {
    if (!name.trim()) return;
    props.onHost(name.trim(), props.myCharId);
  }
  function handleJoin() {
    if (!name.trim() || !code.trim()) return;
    const matched = matchBuzzword(code);
    if (!matched) return;
    props.onJoin(name.trim(), matched, props.myCharId);
  }

  function handleSendChat() {
    if (!chatInput.trim()) return;
    props.onSendChat(chatInput.trim());
    setChatInput("");
  }

  // Character grid
  const takenCharIds = new Set<string>();
  props.roster.forEach((r, i) => {
    if (i !== props.myIdx && r.charId) takenCharIds.add(r.charId);
  });

  function pickChar(charId: string) {
    if (takenCharIds.has(charId)) return;
    if (props.myCharId === charId) {
      props.onPickChar(null);
    } else {
      props.onPickChar(charId);
    }
  }

  // Show lobby if we have a room code
  const inLobby = !!props.roomCode;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        padding: "24px",
        background: "#1d201f",
      }}
    >
      <div
        className="bc-card"
        style={{ maxWidth: 760, width: "100%", padding: "28px 32px", marginTop: 28 }}
      >
        <div className="bc-splash-logo">
          <img src="/bigcon/logo.png" alt="THE BIG CON" />
        </div>
        <div
          className="bc-serif"
          style={{
            fontSize: 38,
            fontWeight: 900,
            letterSpacing: 4,
            background: "#168388",
            color: "#fff",
            display: "inline-block",
            padding: "10px 18px",
            margin: "0 0 8px",
          }}
        >
          FPS BATTLE ROYALE
        </div>
        <div
          style={{
            fontSize: 16,
            fontStyle: "italic",
            color: "burlywood",
            margin: "12px 0 6px",
          }}
        >
          Same board. Same cast. Bigger guns.
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.55, color: "#d8d8d8" }}>
          A multiplayer first-person battle royale adaptation of The Big Con.
          Pick a face, drop into the arena, seize nodes for passive income, dodge
          the regulators, and raid your rivals. Last con standing — or first to
          the offshore target — wins.
        </div>

        {!inLobby && mode === "choose" && (
          <div style={{ display: "flex", gap: 10, margin: "18px 0" }}>
            <button className="bc-btn" onClick={() => setMode("host")}>
              HOST
            </button>
            <button className="bc-btn" onClick={() => setMode("join")}>
              JOIN
            </button>
            {props.onPractice && (
              <button
                className="bc-btn"
                onClick={() => setMode("practice")}
                style={{ borderColor: "#f5c542", color: "#f5c542" }}
              >
                SOLO PRACTICE
              </button>
            )}
          </div>
        )}

        {!inLobby && mode === "practice" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "14px 0" }}>
            <input
              className="bc-input"
              placeholder="Your name"
              maxLength={16}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, color: "#9ad" }}>Win target $:</span>
              <input
                className="bc-input"
                type="number"
                min={GAME.GOAL_MIN}
                max={GAME.GOAL_MAX}
                step={5}
                value={goal}
                onChange={(e) => setGoal(Number(e.target.value))}
                style={{ width: 120 }}
              />
            </div>
            <div style={{ fontSize: 11, color: "#9ad" }}>
              Drop in alone against 5 AI bots. Practice moving, shooting, capturing
              nodes, and dodging the regulator perimeter.
            </div>
            <div style={{ fontSize: 10, letterSpacing: 2, color: "#9ad", marginTop: 8, fontWeight: 800 }}>
              PICK A FACE
            </div>
            <div className="bc-chargrid" style={{ margin: "4px 0 8px" }}>
              {CHARS.map((c) => {
                const mine = props.myCharId === c.id;
                return (
                  <div
                    key={c.id}
                    className={`bc-charpick${mine ? " on" : ""}`}
                    onClick={() => props.onPickChar(mine ? null : c.id)}
                  >
                    <img src={CHAR_URL + c.file} alt={c.name} />
                    <div className="cn">{c.name}</div>
                  </div>
                );
              })}
            </div>
            {props.myCharId && (
              <div style={{ background: "#000", border: "1px dashed #168388", padding: "9px 11px", fontSize: 11.5, color: "#d8d8d8", lineHeight: 1.4 }}>
                {(() => {
                  const c = CHARS.find((x) => x.id === props.myCharId);
                  if (!c) return null;
                  return (
                    <>
                      <div style={{ fontWeight: 800, color: "aqua", letterSpacing: 1.5 }}>{c.name.toUpperCase()}</div>
                      <div style={{ color: "burlywood", fontStyle: "italic", margin: "3px 0" }}>passive: {c.passive}</div>
                      <div style={{ color: "#9ad" }}>
                        <b style={{ color: "#f5c542" }}>{c.ability}</b>: {c.abilityDesc}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
            <button
              className="bc-btn primary"
              onClick={() => {
                if (!name.trim() || !props.onPractice) return;
                props.onPractice(name.trim(), props.myCharId, clampGoal(goal));
              }}
              disabled={!name.trim() || !props.myCharId}
              style={{ background: "#f5c542", borderColor: "#000", color: "#000" }}
            >
              DROP IN{props.myCharId ? "" : " (need a face)"}
            </button>
            <button
              className="bc-btn"
              onClick={() => setMode("choose")}
              style={{ marginTop: 4 }}
            >
              ← back
            </button>
          </div>
        )}

        {!inLobby && mode === "host" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "14px 0" }}>
            <input
              className="bc-input"
              placeholder="Your name — e.g. JTPortal"
              maxLength={16}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, color: "#9ad" }}>Win target $:</span>
              <input
                className="bc-input"
                type="number"
                min={GAME.GOAL_MIN}
                max={GAME.GOAL_MAX}
                step={5}
                value={goal}
                onChange={(e) => setGoal(Number(e.target.value))}
                style={{ width: 120 }}
              />
              <span style={{ fontSize: 11, color: "#9ad" }}>
                reach this money AND hold 3+ node types
              </span>
            </div>
            <button
              className="bc-btn primary"
              onClick={handleHost}
              disabled={!name.trim()}
            >
              CREATE ROOM
            </button>
            <button
              className="bc-btn"
              onClick={() => setMode("choose")}
              style={{ marginTop: 4 }}
            >
              ← back
            </button>
          </div>
        )}

        {!inLobby && mode === "join" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "14px 0" }}>
            <input
              className="bc-input"
              placeholder="Your name"
              maxLength={16}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="bc-input code"
              placeholder="BUZZWORD"
              list="buzzwords"
              autoComplete="off"
              maxLength={28}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <datalist id="buzzwords">
              {BUZZWORDS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
            <div style={{ fontSize: 11, color: "#9ad" }}>
              Room codes are jt portal buzzwords — type the one the host read out
              (e.g. NESA, JTPORTAL, BIG BESSENT).
            </div>
            <button
              className="bc-btn primary"
              onClick={handleJoin}
              disabled={!name.trim() || !code.trim()}
            >
              JOIN GAME
            </button>
            <button
              className="bc-btn"
              onClick={() => setMode("choose")}
              style={{ marginTop: 4 }}
            >
              ← back
            </button>
          </div>
        )}

        {inLobby && (
          <LobbyView
            roomCode={props.roomCode || ""}
            roomLabel={props.roomLabel || ""}
            goal={props.goal}
            isHost={mode === "host"}
            roster={props.roster}
            myIdx={props.myIdx}
            chat={props.chat}
            chatInput={chatInput}
            setChatInput={setChatInput}
            onSendChat={handleSendChat}
            onStart={props.onStart}
            canStart={props.canStart}
            myCharId={props.myCharId}
            pickChar={pickChar}
            takenCharIds={takenCharIds}
          />
        )}

        <div
          style={{
            fontSize: 12.5,
            color: props.netStatusErr ? "#ff6b5e" : "aqua",
            fontStyle: "italic",
            minHeight: 18,
            marginTop: 8,
          }}
        >
          {props.netStatus}
        </div>
      </div>

      <div style={{ marginTop: 12, textAlign: "center", maxWidth: 720 }}>
        <button
          onClick={() => {
            const el = document.getElementById("rules-drop");
            if (el) el.style.display = el.style.display === "none" ? "block" : "none";
          }}
          style={{
            background: "none",
            border: "none",
            color: "aqua",
            fontFamily: "inherit",
            fontSize: 13,
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          How to play
        </button>
        <div
          id="rules-drop"
          style={{
            display: "none",
            background: "#111413",
            border: "2px solid #168388",
            padding: "14px 18px",
            marginTop: 8,
            textAlign: "left",
            color: "#d8d8d8",
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          <h4 style={{ color: "aqua", margin: "0 0 6px", letterSpacing: 1.5, fontSize: 12, textTransform: "uppercase" }}>Controls</h4>
          <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
            <li>WASD — move · Shift — sprint · Space — jump</li>
            <li>Mouse — look · Left click — fire · Wheel / 1-5 — switch weapon</li>
            <li>E — seize node (when standing inside a node ring)</li>
            <li>R — character special ability</li>
            <li>Tab — scoreboard · Esc — release mouse</li>
          </ul>
          <h4 style={{ color: "aqua", margin: "8px 0 6px", letterSpacing: 1.5, fontSize: 12, textTransform: "uppercase" }}>Objective</h4>
          <p style={{ margin: "0 0 8px" }}>Reach the money target <i>and</i> hold at least 3 different node types, OR be the last con standing.</p>
          <h4 style={{ color: "aqua", margin: "8px 0 6px", letterSpacing: 1.5, fontSize: 12, textTransform: "uppercase" }}>Cortisol = HP</h4>
          <p style={{ margin: "0 0 8px" }}>Cortisol fills up as rivals leak, audit, tweet and spin you. Hit your cap and the regulators raid you — game over for that life.</p>
          <h4 style={{ color: "aqua", margin: "8px 0 6px", letterSpacing: 1.5, fontSize: 12, textTransform: "uppercase" }}>The Perimeter</h4>
          <p style={{ margin: "0" }}>The red ring is the regulator perimeter. Every minute or so it tightens. Outside = +Cortisol/sec. Stay inside or get raided by the zone.</p>
        </div>
      </div>
    </div>
  );
}

function LobbyView(props: {
  roomCode: string;
  roomLabel: string;
  goal: number;
  isHost: boolean;
  roster: { name: string; playerId: string; charId: string | null; ready: boolean }[];
  myIdx: number;
  chat: { ts: number; idx: number; name: string; text: string }[];
  chatInput: string;
  setChatInput: (s: string) => void;
  onSendChat: () => void;
  onStart: () => void;
  canStart: boolean;
  myCharId: string | null;
  pickChar: (id: string) => void;
  takenCharIds: Set<string>;
}) {
  const [copied, setCopied] = useState(false);
  function copyCode() {
    navigator.clipboard?.writeText(props.roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <>
      <div
        style={{
          background: "#000",
          color: "aqua",
          padding: 12,
          textAlign: "center",
          border: "1px solid #168388",
          margin: "14px 0 0",
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#9ad" }}>ROOM CODE</div>
        <div
          className="bc-serif"
          style={{ fontSize: 26, fontWeight: 900, letterSpacing: 4, wordBreak: "break-word" }}
        >
          {props.roomLabel || props.roomCode}
        </div>
        <button
          onClick={copyCode}
          style={{
            marginTop: 6,
            fontFamily: "inherit",
            fontSize: 11,
            background: "none",
            border: "1px solid #168388",
            color: "#9ad",
            padding: "4px 12px",
            cursor: "pointer",
          }}
        >
          {copied ? "copied!" : "📋 copy code"}
        </button>
      </div>

      <div style={{ margin: "14px 0", padding: "10px 12px", border: "1px solid #168388", background: "#04100f" }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#9ad" }}>WIN TARGET</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: "#f5c542", marginTop: 2 }}>${props.goal}</div>
        <div style={{ fontSize: 11, color: "#9ad", marginTop: 4 }}>
          reach this money AND hold 3+ different node types — OR last con standing
        </div>
      </div>

      <div style={{ margin: "14px 0", padding: "10px 12px", border: "1px solid #168388", background: "#04100f" }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#9ad" }}>THE WIRE — LOBBY CHAT</div>
        <div
          className="bc-scroll"
          style={{ height: 110, overflowY: "auto", fontSize: 11.5, lineHeight: 1.5, color: "#d8d8d8", marginTop: 6 }}
        >
          {props.chat.length === 0 && (
            <div style={{ color: "#666", fontStyle: "italic" }}>talk your book before the con starts…</div>
          )}
          {props.chat.map((m, i) => (
            <div key={i}>
              <b style={{ color: "aqua" }}>{m.name}:</b> {m.text}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input
            className="bc-input"
            placeholder="talk your book…"
            maxLength={140}
            value={props.chatInput}
            onChange={(e) => props.setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") props.onSendChat();
            }}
            style={{ flex: 1, fontSize: 12, padding: "6px 9px" }}
          />
          <button
            onClick={props.onSendChat}
            style={{
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 800,
              border: "1px solid #168388",
              background: "#000",
              color: "#fff",
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            SEND
          </button>
        </div>
      </div>

      <div style={{ fontSize: 10, letterSpacing: 2, color: "#9ad", marginTop: 14, fontWeight: 800 }}>
        PICK A FACE — one player per character
      </div>
      <div className="bc-chargrid" style={{ margin: "8px 0 12px" }}>
        {CHARS.map((c) => {
          const taken = props.takenCharIds.has(c.id);
          const mine = props.myCharId === c.id;
          return (
            <div
              key={c.id}
              className={`bc-charpick${mine ? " on" : ""}${taken ? " taken" : ""}`}
              onClick={() => !taken && props.pickChar(c.id)}
            >
              <img src={CHAR_URL + c.file} alt={c.name} />
              <div className="cn">{c.name}</div>
            </div>
          );
        })}
      </div>
      {props.myCharId && (
        <CharInfo charId={props.myCharId} />
      )}

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: "#9ad", fontWeight: 800, marginBottom: 6 }}>
          ROSTER — {props.roster.length}/{GAME.MAX_PLAYERS}
        </div>
        {props.roster.map((r, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              background: "#000",
              border: `1px solid ${i === props.myIdx ? "#168388" : "#333"}`,
              padding: "8px 12px",
              fontSize: 14,
              marginTop: 6,
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: `hsl(${(i * 47) % 360},70%,55%)`,
              }}
            />
            <span style={{ fontWeight: 800 }}>{r.name}</span>
            {r.charId && (
              <span style={{ fontSize: 11, color: "#9ad", marginLeft: 4 }}>
                · {CHARS.find((c) => c.id === r.charId)?.name}
              </span>
            )}
            {i === props.myIdx && (
              <span style={{ marginLeft: "auto", fontSize: 10, color: "#168388", fontWeight: 800 }}>YOU</span>
            )}
          </div>
        ))}
      </div>

      {props.isHost && (
        <button
          className="bc-btn primary"
          onClick={props.onStart}
          disabled={!props.canStart}
          style={{ marginTop: 12, width: "100%" }}
        >
          {props.canStart
            ? "START THE CON"
            : `Need ${GAME.MIN_PLAYERS} players and a face to start`}
        </button>
      )}
    </>
  );
}

function CharInfo({ charId }: { charId: string }) {
  const c = CHARS.find((x) => x.id === charId);
  if (!c) return null;
  return (
    <div style={{ background: "#000", border: "1px dashed #168388", padding: "9px 11px", fontSize: 11.5, color: "#d8d8d8", lineHeight: 1.4 }}>
      <div style={{ fontWeight: 800, color: "aqua", letterSpacing: 1.5 }}>{c.name.toUpperCase()}</div>
      <div style={{ color: "burlywood", fontStyle: "italic", margin: "3px 0" }}>passive: {c.passive}</div>
      <div style={{ color: "#9ad" }}>
        <b style={{ color: "#f5c542" }}>{c.ability}</b>: {c.abilityDesc}
      </div>
    </div>
  );
}
