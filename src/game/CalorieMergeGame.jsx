import { useEffect, useRef, useState, useCallback } from "react";
import Matter from "matter-js";
import { FOOD_STAGES, MAX_STAGE_ID, DAILY_CALORIE_REFERENCE, stageById, randomDropStageId } from "./foodConfig.js";

const FIELD = { width: 320, height: 460, wallThickness: 14 };
const DROP_Y = 50;
const GAME_OVER_LINE_Y = 104;
const GAME_OVER_GRACE_MS = 1500;
// newly spawned/merged bodies are ignored by the game-over check for a beat,
// so a piece still free-falling through the drop zone (low speed right after
// spawn, before gravity has ramped it up) doesn't read as "at rest" above the line
const SPAWN_GRACE_MS = 900;
const DROP_COOLDOWN_MS = 350;
const RICE_PRESS_BONUS = 200; // 〆のライス

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export default function CalorieMergeGame() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const worldRef = useRef(null);
  const runningRef = useRef(false);
  const dropXRef = useRef(FIELD.width / 2);
  const nextStageIdRef = useRef(randomDropStageId());
  const canDropRef = useRef(true);
  const dangerSinceRef = useRef(null);
  const mergeQueueRef = useRef([]);
  const bodySeqRef = useRef(1);
  const gameOverRef = useRef(false);

  const [score, setScore] = useState(0);
  const [highestStageId, setHighestStageId] = useState(1);
  const [nextStageId, setNextStageId] = useState(nextStageIdRef.current);
  const [gameOver, setGameOver] = useState(false);
  const [legendReached, setLegendReached] = useState(false);
  const [legendBanner, setLegendBanner] = useState(false);
  const [shake, setShake] = useState(false);
  const [resetTick, setResetTick] = useState(0);

  const setNextStage = useCallback((id) => {
    nextStageIdRef.current = id;
    setNextStageId(id);
  }, []);

  const spawnFood = useCallback((stageId, x, y) => {
    const stage = stageById(stageId);
    const body = Matter.Bodies.circle(x, y, stage.radius, {
      restitution: 0.15,
      friction: 0.5,
      frictionAir: 0.001,
      label: "food",
    });
    body.plugin = { stageId, seq: bodySeqRef.current++, merged: false, spawnTime: performance.now() };
    Matter.Composite.add(worldRef.current, body);
    return body;
  }, []);

  const handleMerge = useCallback((stageId) => {
    setScore((s) => s + stageById(stageId).calories);
    setHighestStageId((h) => Math.max(h, stageId));
    const stage = stageById(stageId);
    if (stage.shakeOnSpawn) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
    }
    if (stage.isFinal) {
      setLegendReached(true);
      setLegendBanner(true);
      setTimeout(() => setLegendBanner(false), 1800);
    }
  }, []);

  // Physics + render loop setup. Recreated whenever resetTick changes (retry).
  useEffect(() => {
    const engine = Matter.Engine.create({ gravity: { x: 0, y: 1.05 } });
    engineRef.current = engine;
    worldRef.current = engine.world;

    const { width, height, wallThickness } = FIELD;
    const walls = [
      Matter.Bodies.rectangle(width / 2, height + wallThickness / 2, width + wallThickness * 2, wallThickness, { isStatic: true }),
      Matter.Bodies.rectangle(-wallThickness / 2, height / 2, wallThickness, height * 2, { isStatic: true }),
      Matter.Bodies.rectangle(width + wallThickness / 2, height / 2, wallThickness, height * 2, { isStatic: true }),
    ];
    Matter.Composite.add(engine.world, walls);

    Matter.Events.on(engine, "collisionStart", (event) => {
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        if (bodyA.label !== "food" || bodyB.label !== "food") continue;
        const pa = bodyA.plugin, pb = bodyB.plugin;
        if (!pa || !pb || pa.merged || pb.merged) continue;
        if (pa.stageId !== pb.stageId) continue;
        if (pa.stageId >= MAX_STAGE_ID) continue;
        pa.merged = true;
        pb.merged = true;
        mergeQueueRef.current.push({
          stageId: pa.stageId,
          x: (bodyA.position.x + bodyB.position.x) / 2,
          y: (bodyA.position.y + bodyB.position.y) / 2,
          bodyA,
          bodyB,
        });
      }
    });

    runningRef.current = true;
    gameOverRef.current = false;
    dangerSinceRef.current = null;
    let lastTime = performance.now();
    let rafId;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const tick = (now) => {
      if (!runningRef.current) return;
      const delta = Math.min(now - lastTime, 33);
      lastTime = now;
      Matter.Engine.update(engine, delta);

      // process pending merges outside the collision callback
      if (mergeQueueRef.current.length > 0) {
        const queue = mergeQueueRef.current;
        mergeQueueRef.current = [];
        for (const m of queue) {
          Matter.Composite.remove(engine.world, m.bodyA);
          Matter.Composite.remove(engine.world, m.bodyB);
          const newStageId = m.stageId + 1;
          spawnFood(newStageId, m.x, m.y);
          handleMerge(newStageId);
        }
      }

      // game-over detection: any resting food body poking above the line
      const bodies = Matter.Composite.allBodies(engine.world).filter((b) => b.label === "food");
      const danger = bodies.some((b) => {
        if (now - b.plugin.spawnTime < SPAWN_GRACE_MS) return false;
        const stage = stageById(b.plugin.stageId);
        return b.position.y - stage.radius < GAME_OVER_LINE_Y && b.speed < 0.5;
      });
      if (danger) {
        if (dangerSinceRef.current == null) dangerSinceRef.current = now;
        else if (now - dangerSinceRef.current > GAME_OVER_GRACE_MS) {
          runningRef.current = false;
          gameOverRef.current = true;
          setGameOver(true);
        }
      } else {
        dangerSinceRef.current = null;
      }

      draw(ctx, bodies, dangerSinceRef.current != null);
      rafId = requestAnimationFrame(tick);
    };

    const draw = (ctx, bodies, inDanger) => {
      ctx.clearRect(0, 0, width, height);

      // playfield background
      ctx.fillStyle = "#FBF8EF";
      ctx.fillRect(0, 0, width, height);

      // game-over line
      ctx.save();
      ctx.strokeStyle = inDanger ? "#993C1D" : "#D3CFC1";
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wallThickness, GAME_OVER_LINE_Y);
      ctx.lineTo(width - wallThickness, GAME_OVER_LINE_Y);
      ctx.stroke();
      ctx.restore();

      for (const body of bodies) {
        drawFood(ctx, body);
      }

      // drop preview
      if (runningRef.current && !gameOverRef.current) {
        const previewStage = stageById(nextStageIdRef.current);
        ctx.save();
        ctx.globalAlpha = 0.85;
        drawFoodAt(ctx, previewStage, dropXRef.current, DROP_Y);
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = "#D3CFC1";
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(dropXRef.current, DROP_Y + previewStage.radius);
        ctx.lineTo(dropXRef.current, height - wallThickness);
        ctx.stroke();
        ctx.restore();
      }

      // walls
      ctx.strokeStyle = "#6B5744";
      ctx.lineWidth = wallThickness;
      ctx.strokeRect(wallThickness / 2, -wallThickness, width - wallThickness, height + wallThickness * 2);
    };

    const drawFoodAt = (ctx, stage, x, y) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, stage.radius, 0, Math.PI * 2);
      ctx.fillStyle = stage.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.stroke();

      ctx.font = `${Math.round(stage.radius * 1.05)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(stage.emoji, x, y - (stage.id >= 8 ? stage.radius * 0.12 : 0));

      if (stage.badge) {
        ctx.font = `${Math.round(stage.radius * 0.55)}px sans-serif`;
        ctx.fillText(stage.badge, x + stage.radius * 0.55, y - stage.radius * 0.55);
      }

      if (stage.id >= 8) {
        ctx.font = "10px system-ui, sans-serif";
        ctx.fillStyle = "#3A3527";
        ctx.fillText(stage.name, x, y + stage.radius * 0.62);
      }
      ctx.restore();
    };

    const drawFood = (ctx, body) => {
      const stage = stageById(body.plugin.stageId);
      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      ctx.translate(-body.position.x, -body.position.y);
      drawFoodAt(ctx, stage, body.position.x, body.position.y);
      ctx.restore();
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      runningRef.current = false;
      cancelAnimationFrame(rafId);
      Matter.Events.off(engine);
      Matter.Composite.clear(engine.world, false);
      Matter.Engine.clear(engine);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetTick, spawnFood, handleMerge]);

  const updateDropX = useCallback((clientX) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = FIELD.width / rect.width;
    const x = (clientX - rect.left) * scale;
    const radius = stageById(nextStageIdRef.current).radius;
    dropXRef.current = clamp(x, FIELD.wallThickness + radius, FIELD.width - FIELD.wallThickness - radius);
  }, []);

  const doDrop = useCallback(() => {
    if (gameOverRef.current || !canDropRef.current) return;
    canDropRef.current = false;
    const stageId = nextStageIdRef.current;
    spawnFood(stageId, dropXRef.current, DROP_Y);
    setNextStage(randomDropStageId());
    setTimeout(() => { canDropRef.current = true; }, DROP_COOLDOWN_MS);
  }, [spawnFood, setNextStage]);

  const handlePointerMove = (e) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    updateDropX(clientX);
  };

  const handlePointerDown = (e) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    updateDropX(clientX);
    doDrop();
  };

  const handleRetry = () => {
    setScore(0);
    setHighestStageId(1);
    setLegendReached(false);
    setLegendBanner(false);
    setGameOver(false);
    canDropRef.current = true;
    setNextStage(randomDropStageId());
    setResetTick((t) => t + 1);
  };

  const pressRice = () => setScore((s) => s + RICE_PRESS_BONUS);

  const highestStage = stageById(highestStageId);
  const dayEquivalent = (score / DAILY_CALORIE_REFERENCE).toFixed(1);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "2rem auto" }}>
      <div style={{
        background: "linear-gradient(180deg, #2D4A3E 0%, #1E3A2F 100%)",
        borderRadius: "16px 16px 0 0",
        padding: "1.25rem 1.5rem 1rem",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.15em", color: "#9BC7A0", fontWeight: 500, textTransform: "uppercase" }}>
            CALORIE MERGE GAME
          </p>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: "4px 0 0", color: "#F5F3EC" }}>
            カロリーマージ 〜二郎の頂〜
          </h2>
        </div>
      </div>

      <div style={{ background: "#F5F3EC", borderRadius: "0 0 16px 16px", padding: "1.25rem 1.5rem 1.5rem" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ background: "white", border: "1px solid #E3DFD1", borderRadius: 10, padding: "8px 16px" }}>
            <div style={{ fontSize: 11, color: "#8A8578" }}>累計カロリー</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#D9772E" }}>{score.toLocaleString()} kcal</div>
          </div>
          <div style={{ background: "white", border: "1px solid #E3DFD1", borderRadius: 10, padding: "8px 16px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 11, color: "#8A8578" }}>NEXT</div>
            <div style={{ fontSize: 24 }}>{stageById(nextStageId).emoji}</div>
          </div>
          {legendReached && (
            <button onClick={pressRice}
              style={{
                padding: "10px 16px", borderRadius: 10, border: "1px solid #993C1D",
                background: "#993C1D", color: "white", cursor: "pointer", fontSize: 13, fontWeight: 600,
              }}>
              〆のライス (+{RICE_PRESS_BONUS}kcal)
            </button>
          )}
        </div>

        <div
          style={{
            position: "relative", width: FIELD.width, maxWidth: "100%", margin: "0 auto",
            transform: shake ? "translateX(0)" : undefined,
            animation: shake ? "calorie-merge-shake 0.45s" : undefined,
          }}
        >
          <canvas
            ref={canvasRef}
            width={FIELD.width}
            height={FIELD.height}
            style={{ width: "100%", height: "auto", display: "block", borderRadius: 10, touchAction: "none", cursor: gameOver ? "default" : "pointer" }}
            onMouseMove={handlePointerMove}
            onMouseDown={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchStart={handlePointerDown}
          />

          {legendBanner && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(45,74,62,0.75)", borderRadius: 10, color: "#F5F3EC", textAlign: "center",
              fontSize: 18, fontWeight: 700, padding: 16,
            }}>
              🍜👑 伝説の二郎に到達！！
            </div>
          )}

          {gameOver && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              background: "rgba(30,28,22,0.85)", borderRadius: 10, color: "#F5F3EC", textAlign: "center", padding: 20, gap: 8,
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.05em" }}>GAME OVER</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#D9772E" }}>{score.toLocaleString()} kcal</div>
              <div style={{ fontSize: 13, color: "#D3CFC1" }}>
                成人男性の1日の摂取カロリー(約{DAILY_CALORIE_REFERENCE}kcal)の{dayEquivalent}日分
              </div>
              <div style={{ fontSize: 13, color: "#D3CFC1", marginBottom: 8 }}>
                最高到達: {highestStage.emoji} {highestStage.name}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button onClick={handleRetry}
                  style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "#D9772E", color: "white", cursor: "pointer", fontSize: 14, fontWeight: 500 }}>
                  もう一度遊ぶ
                </button>
              </div>
            </div>
          )}
        </div>

        <p style={{ fontSize: 12, color: "#8A8578", textAlign: "center", marginTop: 12, marginBottom: 0 }}>
          タップ / クリックで食べ物を落として同じ食べ物同士を合体させよう。目指せ「伝説の二郎」。
        </p>
      </div>

      <style>{`
        @keyframes calorie-merge-shake {
          0% { transform: translateX(0); }
          15% { transform: translate(-6px, 2px); }
          30% { transform: translate(6px, -2px); }
          45% { transform: translate(-5px, 1px); }
          60% { transform: translate(5px, -1px); }
          75% { transform: translate(-3px, 1px); }
          100% { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
