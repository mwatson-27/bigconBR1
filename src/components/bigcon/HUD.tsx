"use client";

import { useEffect, useRef, useState } from "react";
import type { GameState } from "@/lib/bigcon/types";
import { MOODS, WEAPONS, NODES, GAME, charById, CHAR_URL } from "@/lib/bigcon/constants";
import type { MoodKey, WeaponId } from "@/lib/bigcon/constants";

type Props = {
  state: GameState;
  myIdx: number;
  killfeed: { killerIdx: number; victimIdx: number; weapon: string; ts: number }[];
  weapon: WeaponId;
  captureNodeId: string | null;
  captureProgress: number;
  damageFlash: boolean;
  hitMarker: { color: string; ts: number } | null;
  pickupToast: { text: string; color: string; ts: number } | null;
  showScoreboard: boolean;
};

export function HUD(props: Props) {
  const { state, myIdx } = props;
  const me = state.players[myIdx];
  const aliveCount = state.players.filter((p) => p.alive).length;
  const mood = MOODS[state.mood as MoodKey];
  const myOwned = NODES.filter((n) => state.owner[n.id] === myIdx);
  const heldTypes = new Set(myOwned.map((n) => n.type));

  // Hit marker auto-clear
  useEffect(() => {
    if (props.hitMarker) {
      const t = setTimeout(() => {}, 400);
      return () => clearTimeout(t);
    }
  }, [props.hitMarker]);

  if (!me) return null;

  const isDead = !me.alive;
  const w = WEAPONS.find((x) => x.id === props.weapon)!;
  const wIdx = WEAPONS.findIndex((x) => x.id === props.weapon);
  const canUseW = (() => {
    if (w.requires) {
      return myOwned.some((n) => n.type === w.requires);
    }
    return true;
  })();
  const weaponLockedReason = !canUseW
    ? `Requires a ${w.requires} node`
    : w.costIntel > me.intel
    ? `Need ${w.costIntel} Intel`
    : w.costMoney > me.money
    ? `Need $${w.costMoney}`
    : null;

  return (
    <>
      {/* Mood tint */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: mood.tint,
          pointerEvents: "none",
          zIndex: 5,
        }}
      />

      {/* Damage flash */}
      {props.damageFlash && (
        <div className="bc-damage-flash" key={Date.now()} />
      )}

      {/* Crosshair */}
      {!isDead && <div className="bc-crosshair" />}

      {/* Hit marker */}
      {props.hitMarker && (
        <div
          key={props.hitMarker.ts}
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: props.hitMarker.color,
            fontSize: 28,
            fontWeight: 900,
            pointerEvents: "none",
            zIndex: 50,
            textShadow: "0 0 4px #000, 0 2px 0 #000",
            animation: "bc-hitmarker 0.4s ease-out forwards",
          }}
        >
          ✕
        </div>
      )}

      {/* Pickup toast */}
      {props.pickupToast && (
        <div
          key={props.pickupToast.ts}
          style={{
            position: "fixed",
            top: "52%",
            left: "50%",
            transform: "translate(-50%, 0)",
            color: props.pickupToast.color,
            fontSize: 18,
            fontWeight: 900,
            pointerEvents: "none",
            zIndex: 50,
            textShadow: "0 0 4px #000",
            animation: "bc-fxrise 1.4s ease-out forwards",
          }}
        >
          {props.pickupToast.text}
        </div>
      )}

      {/* Top-left: stats */}
      <div className="bc-hud tl" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="bc-stat money">
          <div>
            <div className="lab">MONEY</div>
            <div className="val">${Math.floor(me.money)}</div>
          </div>
          <div style={{ fontSize: 11, color: "#9ad" }}>/ {state.goal}</div>
        </div>
        <div className="bc-stat intel">
          <div>
            <div className="lab">INTEL</div>
            <div className="val">{me.intel}</div>
          </div>
        </div>
        <div className="bc-stat cortisol">
          <div>
            <div className="lab">CORTISOL</div>
            <div className="val">
              {me.cortisol}/{me.cortisolCap}
            </div>
          </div>
        </div>
      </div>

      {/* Top-right: alive count + mood + zone stage */}
      <div className="bc-hud tr" style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
        <div className="bc-stat alive">
          <div>
            <div className="lab">ALIVE</div>
            <div className="val">{aliveCount}</div>
          </div>
        </div>
        <div className="bc-moodstrip" style={{ pointerEvents: "none" }}>
          <div className="mdot" style={{ background: mood.color }} />
          <span style={{ color: mood.color, fontWeight: 800 }}>{mood.label}</span>
        </div>
        <div className="bc-moodstrip" style={{ pointerEvents: "none", marginTop: -2 }}>
          <span className="mwire">{state.wire}</span>
        </div>
        <div className="bc-moodstrip" style={{ pointerEvents: "none", marginTop: -2 }}>
          <span style={{ color: state.zonePhase === "SHRINKING" ? "#ff6b5e" : "#9ad", fontWeight: 800 }}>
            {state.zonePhase === "SHRINKING"
              ? `CRACKDOWN ${state.zoneStage} — TIGHTENING`
              : `PERIMETER HOLDS · ${Math.round(state.zoneRadius)}m`}
          </span>
        </div>
      </div>

      {/* Killfeed */}
      <div className="bc-killfeed">
        {props.killfeed.slice(-5).map((k, i) => {
          const killer = k.killerIdx >= 0 ? state.players[k.killerIdx]?.name : "REGULATORS";
          const victim = state.players[k.victimIdx]?.name || "unknown";
          return (
            <div className="kf" key={i}>
              <b>{killer}</b> <span style={{ color: "#9ad" }}>·{k.weapon}·</span>{" "}
              <span className="vic">{victim}</span>
            </div>
          );
        })}
      </div>

      {/* Bottom-left: held nodes summary */}
      <div className="bc-hud bl">
        <div className="bc-panel" style={{ padding: "8px 11px", fontSize: 11, minWidth: 200 }}>
          <div style={{ fontSize: 9, letterSpacing: 3, color: "#9ad", fontWeight: 800 }}>HELD NODES ({myOwned.length})</div>
          <div style={{ marginTop: 4, lineHeight: 1.5 }}>
            {myOwned.length === 0 && (
              <span style={{ color: "#666", fontStyle: "italic" }}>capture nodes by standing inside</span>
            )}
            {myOwned.slice(0, 6).map((n) => (
              <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    background: typeColor(n.type),
                    flex: "0 0 8px",
                  }}
                />
                <span style={{ fontSize: 10.5, color: "#cde" }}>{n.name.join(" ")}</span>
              </div>
            ))}
            {myOwned.length > 6 && (
              <div style={{ fontSize: 10, color: "#9ad", marginTop: 2 }}>+{myOwned.length - 6} more</div>
            )}
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: "#9ad" }}>
            {heldTypes.size}/7 sectors diversified
          </div>
        </div>
      </div>

      {/* Bottom-right: minimap */}
      <div className="bc-hud br">
        <Minimap state={state} myIdx={myIdx} />
      </div>

      {/* Bottom-center: weapon wheel */}
      <div className="bc-hud bc">
        <div className="bc-weaponwheel">
          {WEAPONS.map((wd, i) => {
            const owned = myOwned.some((n) => n.type === wd.requires);
            const active = i === wIdx;
            const locked = wd.requires && !owned;
            return (
              <div
                key={wd.id}
                className={`bc-weaponslot${active ? " active" : ""}`}
                style={locked && !active ? { opacity: 0.42 } : undefined}
              >
                <span className="wk">{i + 1}{locked ? " 🔒" : ""}</span>
                <span className="wn">{wd.name}</span>
                <span style={{ fontSize: 9, color: active ? "rgba(255,255,255,0.7)" : "#9ad" }}>
                  {wd.costIntel > 0 ? `${wd.costIntel}🛈` : wd.costMoney > 0 ? `$${wd.costMoney}` : "FREE"}
                </span>
              </div>
            );
          })}
        </div>
        {weaponLockedReason && (
          <div
            style={{
              marginTop: 6,
              background: "rgba(0,0,0,0.78)",
              border: "1px solid #ff6b5e",
              padding: "4px 10px",
              fontSize: 11,
              color: "#ff6b5e",
              letterSpacing: 1,
              fontWeight: 700,
            }}
          >
            {weaponLockedReason}
          </div>
        )}
      </div>

      {/* Top-center: capture progress */}
      {props.captureNodeId && (
        <div className="bc-hud tc">
          <div className="bc-panel" style={{ padding: "10px 14px", minWidth: 220, textAlign: "center" }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: "#9ad" }}>SEIZING</div>
            <div className="bc-serif" style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>
              {NODES.find((n) => n.id === props.captureNodeId)?.name.join(" ")}
            </div>
            <div
              style={{
                marginTop: 6,
                background: "#000",
                height: 6,
                border: "1px solid #168388",
                position: "relative",
              }}
            >
              <div
                style={{
                  background: "#168388",
                  height: "100%",
                  width: `${Math.min(100, props.captureProgress * 100)}%`,
                  transition: "width 0.1s linear",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Scoreboard overlay */}
      {props.showScoreboard && <Scoreboard state={state} myIdx={myIdx} />}

      {/* Death overlay */}
      {isDead && !state.over && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.78)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 70,
            pointerEvents: "auto",
          }}
        >
          <div className="bc-card" style={{ padding: "28px 36px", textAlign: "center" }}>
            <div className="bc-serif" style={{ fontSize: 32, fontWeight: 900, color: "#ff6b5e", letterSpacing: 3 }}>
              REGULATORS RAIDED YOU
            </div>
            <div style={{ fontSize: 13, color: "burlywood", fontStyle: "italic", marginTop: 6 }}>
              The con is over for {me.name}. You placed #{me.rank}.
            </div>
            <div style={{ fontSize: 12, color: "#9ad", marginTop: 10 }}>
              Watch the rest of the con unfold.
            </div>
          </div>
        </div>
      )}

      {/* Win overlay */}
      {state.over && (
        <EndCard state={state} myIdx={myIdx} />
      )}
    </>
  );
}

function typeColor(t: string): string {
  switch (t) {
    case "BANK": return "#1f3a5f";
    case "REGULATOR": return "#4a5a66";
    case "CHART": return "#2d4a3a";
    case "WILD": return "#5a2a4a";
    case "CORPORATE": return "#2a3a5a";
    case "COMMODITY": return "#4a3a1f";
    case "MEDIA": return "#5a1f3a";
    default: return "#333";
  }
}

function Minimap({ state, myIdx }: { state: GameState; myIdx: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const size = 168;
    c.width = size;
    c.height = size;
    // Background
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    // World->minimap scale
    const ws = GAME.WORLD_SIZE;
    const scale = size / ws;
    const toMap = (x: number, z: number): [number, number] => [
      (x + ws / 2) * scale,
      (z + ws / 2) * scale,
    ];
    // Nodes (small dots colored by owner)
    for (const n of NODES) {
      const [mx, my] = toMap(n.pos[0], n.pos[2]);
      const owner = state.owner[n.id];
      const color = owner != null ? state.players[owner]?.color || "#888" : "#444";
      ctx.fillStyle = color;
      ctx.fillRect(mx - 2, my - 2, 4, 4);
    }
    // Zone
    const [zx, zy] = toMap(state.zoneCenter[0], state.zoneCenter[1]);
    ctx.strokeStyle = "#ff6b5e";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(zx, zy, state.zoneRadius * scale, 0, Math.PI * 2);
    ctx.stroke();
    if (state.zonePhase === "SHRINKING") {
      const [tx, ty] = toMap(state.zoneTargetCenter[0], state.zoneTargetCenter[1]);
      ctx.strokeStyle = "rgba(255,169,77,0.5)";
      ctx.beginPath();
      ctx.arc(tx, ty, state.zoneTargetRadius * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Players
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      if (!p.alive) continue;
      if (i === myIdx) {
        // Self — arrow
        const [mx, my] = toMap(p.pos[0], p.pos[2]);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(mx + Math.sin(p.yaw) * 5, my - Math.cos(p.yaw) * 5);
        ctx.lineTo(mx - Math.sin(p.yaw) * 3, my + Math.cos(p.yaw) * 3);
        ctx.lineTo(mx + Math.cos(p.yaw) * 3, my + Math.sin(p.yaw) * 3);
        ctx.closePath();
        ctx.fill();
      } else {
        // Cloaked players invisible on minimap (unless we are Calvin)
        const me = state.players[myIdx];
        const isCloaked = p.cloakedUntil > Date.now();
        const isCalvin = me?.charId === "calvinathanasius";
        if (isCloaked && !isCalvin) continue;
        const [mx, my] = toMap(p.pos[0], p.pos[2]);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [state, myIdx]);
  return (
    <div className="bc-minimap">
      <canvas ref={canvasRef} />
    </div>
  );
}

function Scoreboard({ state, myIdx }: { state: GameState; myIdx: number }) {
  const sorted = [...state.players].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return b.money - a.money;
  });
  return (
    <div className="bc-scoreboard">
      <div className="bc-card" style={{ minWidth: 520, maxWidth: 720, padding: 20 }}>
        <div
          className="bc-serif"
          style={{
            fontSize: 22,
            fontWeight: 900,
            letterSpacing: 3,
            background: "#168388",
            color: "#fff",
            padding: "8px 14px",
            marginBottom: 14,
            textAlign: "center",
          }}
        >
          THE BOOK — TAB TO CLOSE
        </div>
        {sorted.map((p) => (
          <div
            key={p.idx}
            className={`row${p.alive ? "" : " dead"}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "8px 12px",
              background: "#000",
              border: `1px solid ${p.idx === myIdx ? "#168388" : "#333"}`,
              marginBottom: 6,
            }}
          >
            <div className="pdot" style={{ background: p.color, width: 12, height: 12, borderRadius: "50%" }} />
            {p.charId && (
              <img
                src={CHAR_URL + (charById(p.charId)?.file || "")}
                className="pface"
                alt=""
                style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", border: `2px solid ${p.color}` }}
              />
            )}
            <div className="pname" style={{ fontWeight: 800, flex: 1 }}>
              {p.name}
              {p.idx === myIdx && <span style={{ color: "#168388", marginLeft: 6, fontSize: 11 }}>YOU</span>}
              {!p.alive && <span style={{ color: "#ff6b5e", marginLeft: 6, fontSize: 11 }}>RAIDED #{p.rank}</span>}
            </div>
            <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: "#7fe08d" }}>${Math.floor(p.money)}</div>
            <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: "#55c1ff" }}>{p.intel}🛈</div>
            <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: "#ffa94d" }}>{p.cortisol}🔥</div>
            <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: "#f5c542" }}>{p.kills}⚔</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EndCard({ state, myIdx }: { state: GameState; myIdx: number }) {
  const winner = state.winnerIdx >= 0 ? state.players[state.winnerIdx] : null;
  const isMe = state.winnerIdx === myIdx;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.86)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        pointerEvents: "auto",
      }}
    >
      <div className="bc-card bc-endcard" style={{ minWidth: 480, maxWidth: 640, padding: "28px 36px" }}>
        <div className="etitle" style={{ color: isMe ? "#f5c542" : "#aqua" }}>
          {isMe ? "YOU WIN" : "CON COMPLETE"}
        </div>
        {winner && (
          <>
            <div className="ewinname">{winner.name}</div>
            <div style={{ fontSize: 14, color: "burlywood", fontStyle: "italic", marginBottom: 10 }}>
              {state.winReason}
            </div>
            <div style={{ background: "#000", border: "1px solid #168388", padding: 12, fontSize: 12.5, lineHeight: 1.6, textAlign: "left" }}>
              <div style={{ color: "#9ad", fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>FINAL BOOK</div>
              {[...state.players]
                .sort((a, b) => (a.alive === b.alive ? b.money - a.money : a.alive ? -1 : 1))
                .map((p) => (
                  <div key={p.idx} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
                    <span style={{ width: 8, height: 8, background: p.color, borderRadius: "50%" }} />
                    <span style={{ fontWeight: 800, flex: 1 }}>
                      {p.name}
                      {p.idx === myIdx && <span style={{ color: "#168388", marginLeft: 6 }}>YOU</span>}
                    </span>
                    <span style={{ color: "#7fe08d" }}>${Math.floor(p.money)}</span>
                    <span style={{ color: "#f5c542" }}>{p.kills}⚔</span>
                    {!p.alive && <span style={{ color: "#ff6b5e", fontSize: 11 }}>#{p.rank}</span>}
                    {p.idx === state.winnerIdx && <span style={{ color: "#f5c542", fontWeight: 800 }}>★ WIN</span>}
                  </div>
                ))}
            </div>
            <button
              className="bc-btn primary"
              style={{ marginTop: 14, width: "100%" }}
              onClick={() => window.location.reload()}
            >
              BACK TO LOBBY
            </button>
          </>
        )}
      </div>
    </div>
  );
}
