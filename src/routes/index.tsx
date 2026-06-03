import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fruit Catcher — A fun game for kids" },
      { name: "description", content: "Move the basket to catch falling fruit, grab power-ups, beat levels and dodge bombs. A bright arcade game for kids 6-10." },
      { property: "og:title", content: "Fruit Catcher" },
      { property: "og:description", content: "Catch fruit, grab power-ups, level up, beat your high score!" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:wght@600;800&display=swap" },
    ],
  }),
  component: Game,
});

type Kind = "fruit" | "bomb" | "slow" | "magnet" | "life" | "star";
type Item = {
  id: number;
  x: number;
  y: number;
  vy: number;
  vx: number;
  kind: Kind;
  emoji: string;
  rot: number;
  vr: number;
};

const FRUITS = ["🍎", "🍌", "🍓", "🍇", "🍊", "🍉", "🍑", "🥝", "🍒", "🥭"];
const POWER_EMOJI: Record<Exclude<Kind, "fruit" | "bomb">, string> = {
  slow: "⏱️",
  magnet: "🧲",
  life: "❤️",
  star: "⭐",
};

// --- tiny sound engine (WebAudio, no assets needed) ---
type SfxName = "catch" | "bomb" | "power" | "levelup" | "gameover" | "click";
function createSfx() {
  let ctx: AudioContext | null = null;
  let muted = false;
  const ensure = () => {
    if (typeof window === "undefined") return null;
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };
  const tone = (freq: number, dur: number, type: OscillatorType = "sine", gain = 0.15, sweepTo?: number) => {
    const c = ensure();
    if (!c || muted) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, c.currentTime + dur);
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur);
  };
  const play = (name: SfxName) => {
    switch (name) {
      case "catch": tone(660 + Math.random() * 200, 0.12, "triangle", 0.18); break;
      case "bomb": tone(180, 0.35, "sawtooth", 0.25, 60); break;
      case "power":
        tone(523, 0.1, "square", 0.12);
        setTimeout(() => tone(784, 0.14, "square", 0.12), 90);
        break;
      case "levelup":
        tone(523, 0.12, "triangle", 0.18);
        setTimeout(() => tone(659, 0.12, "triangle", 0.18), 110);
        setTimeout(() => tone(988, 0.2, "triangle", 0.2), 230);
        break;
      case "gameover":
        tone(440, 0.18, "sawtooth", 0.2);
        setTimeout(() => tone(330, 0.22, "sawtooth", 0.2), 180);
        setTimeout(() => tone(220, 0.35, "sawtooth", 0.2, 110), 400);
        break;
      case "click": tone(900, 0.06, "square", 0.1); break;
    }
  };
  return {
    play,
    setMuted: (m: boolean) => { muted = m; },
    isMuted: () => muted,
    unlock: () => { ensure(); },
  };
}

type GameState = {
  items: Item[];
  basketX: number;
  lives: number;
  score: number;
  combo: number;
  running: boolean;
  lastSpawn: number;
  spawnEvery: number;
  elapsed: number;
  level: number;
  levelProgress: number; // fruits caught toward next level
  slowUntil: number;
  magnetUntil: number;
};

const fresh = (): GameState => ({
  items: [], basketX: 0.5, lives: 3, score: 0, combo: 0, running: true,
  lastSpawn: 0, spawnEvery: 900, elapsed: 0, level: 1, levelProgress: 0,
  slowUntil: 0, magnetUntil: 0,
});

const LEVEL_GOAL = 15; // fruits per level

function Game() {
  const fieldRef = useRef<HTMLDivElement>(null);
  const sfxRef = useRef<ReturnType<typeof createSfx> | null>(null);
  if (!sfxRef.current && typeof window !== "undefined") sfxRef.current = createSfx();

  const [items, setItems] = useState<Item[]>([]);
  const [basketX, setBasketX] = useState(0.5);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [lives, setLives] = useState(3);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [combo, setCombo] = useState(0);
  const [level, setLevel] = useState(1);
  const [levelProgress, setLevelProgress] = useState(0);
  const [slowLeft, setSlowLeft] = useState(0);
  const [magnetLeft, setMagnetLeft] = useState(0);
  const [muted, setMuted] = useState(false);
  const [levelBanner, setLevelBanner] = useState<string | null>(null);
  const [pops, setPops] = useState<{ id: number; x: number; y: number; text: string; color: string }[]>([]);

  const stateRef = useRef<GameState>(fresh());

  useEffect(() => {
    const b = Number(localStorage.getItem("fruit-catcher-best") || 0);
    if (b) setBest(b);
    const m = localStorage.getItem("fruit-catcher-muted") === "1";
    setMuted(m);
    if (sfxRef.current) sfxRef.current.setMuted(m);
  }, []);

  const toggleMute = () => {
    setMuted((m) => {
      const nm = !m;
      sfxRef.current?.setMuted(nm);
      localStorage.setItem("fruit-catcher-muted", nm ? "1" : "0");
      if (!nm) sfxRef.current?.play("click");
      return nm;
    });
  };

  // controls
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const move = (clientX: number) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      stateRef.current.basketX = x;
      setBasketX(x);
    };
    const onPointer = (e: PointerEvent) => move(e.clientX);
    el.addEventListener("pointermove", onPointer);
    el.addEventListener("pointerdown", onPointer);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        const nx = Math.max(0, stateRef.current.basketX - 0.06);
        stateRef.current.basketX = nx; setBasketX(nx);
      } else if (e.key === "ArrowRight") {
        const nx = Math.min(1, stateRef.current.basketX + 0.06);
        stateRef.current.basketX = nx; setBasketX(nx);
      } else if (e.key.toLowerCase() === "m") {
        toggleMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("pointermove", onPointer);
      el.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(() => {
    sfxRef.current?.unlock();
    sfxRef.current?.play("click");
    stateRef.current = fresh();
    setItems([]); setLives(3); setScore(0); setCombo(0); setGameOver(false);
    setLevel(1); setLevelProgress(0); setSlowLeft(0); setMagnetLeft(0);
    setLevelBanner("Level 1");
    setTimeout(() => setLevelBanner(null), 1200);
    setRunning(true);
  }, []);

  // main loop
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let idc = 1;

    const tick = (now: number) => {
      const rawDt = Math.min(50, now - last);
      last = now;
      const s = stateRef.current;
      s.elapsed += rawDt;

      const slowActive = now < s.slowUntil;
      const magnetActive = now < s.magnetUntil;
      const dt = slowActive ? rawDt * 0.45 : rawDt;

      // level-scaled difficulty
      const levelFactor = 1 + (s.level - 1) * 0.18;
      s.spawnEvery = Math.max(280, (950 - s.elapsed / 28) / levelFactor);

      const el = fieldRef.current;
      const H = el ? el.clientHeight : 600;
      const W = el ? el.clientWidth : 400;

      // spawn
      s.lastSpawn += dt;
      if (s.lastSpawn >= s.spawnEvery) {
        s.lastSpawn = 0;
        const r = Math.random();
        const bombChance = Math.min(0.32, 0.07 + s.elapsed / 55000 + (s.level - 1) * 0.02);
        const powerChance = 0.07;
        let kind: Kind = "fruit";
        let emoji = FRUITS[Math.floor(Math.random() * FRUITS.length)];
        if (r < bombChance) {
          kind = "bomb"; emoji = "💣";
        } else if (r < bombChance + powerChance) {
          const pool: Array<Exclude<Kind, "fruit" | "bomb">> = ["slow", "magnet", "star", "life"];
          // life is rarer
          const pick = Math.random() < 0.15 ? "life" : pool[Math.floor(Math.random() * 3)];
          kind = pick; emoji = POWER_EMOJI[pick];
        }
        s.items.push({
          id: idc++,
          x: 0.08 + Math.random() * 0.84,
          y: -40,
          vy: (0.11 + Math.random() * 0.08 + s.elapsed / 90000) * levelFactor,
          vx: 0,
          kind, emoji,
          rot: Math.random() * 360,
          vr: (Math.random() - 0.5) * 0.4,
        });
      }

      const basketPx = s.basketX * W;
      const basketY = H - 90;
      const catchRadius = 60;
      const remaining: Item[] = [];
      const newPops: typeof pops = [];

      for (const it of s.items) {
        // magnet pulls fruit & power-ups (not bombs)
        if (magnetActive && it.kind !== "bomb") {
          const ix = it.x * W;
          const dx = basketPx - ix;
          const dist = Math.hypot(dx, basketY - it.y);
          if (dist < 220) {
            it.vx = (dx / Math.max(40, dist)) * 0.6;
          }
        }
        if (it.vx) it.x = Math.min(1, Math.max(0, it.x + (it.vx * dt) / W));
        it.y += it.vy * dt;
        it.rot += it.vr * dt;

        const ix = it.x * W;
        if (it.y > basketY - 20 && it.y < basketY + 30 && Math.abs(ix - basketPx) < catchRadius) {
          if (it.kind === "fruit") {
            s.combo += 1;
            const gain = (10 + Math.min(40, s.combo * 2)) * s.level;
            s.score += gain;
            s.levelProgress += 1;
            newPops.push({ id: idc++, x: ix, y: basketY - 10, text: `+${gain}`, color: "var(--grass)" });
            sfxRef.current?.play("catch");
            if (s.levelProgress >= LEVEL_GOAL) {
              s.level += 1;
              s.levelProgress = 0;
              s.score += 100;
              sfxRef.current?.play("levelup");
              setLevelBanner(`Level ${s.level}!`);
              setTimeout(() => setLevelBanner(null), 1200);
            }
          } else if (it.kind === "bomb") {
            s.lives -= 1; s.combo = 0;
            newPops.push({ id: idc++, x: ix, y: basketY - 10, text: "💥", color: "var(--destructive)" });
            sfxRef.current?.play("bomb");
          } else if (it.kind === "slow") {
            s.slowUntil = now + 6000;
            newPops.push({ id: idc++, x: ix, y: basketY - 10, text: "Slow-mo!", color: "var(--primary)" });
            sfxRef.current?.play("power");
          } else if (it.kind === "magnet") {
            s.magnetUntil = now + 6000;
            newPops.push({ id: idc++, x: ix, y: basketY - 10, text: "Magnet!", color: "var(--primary)" });
            sfxRef.current?.play("power");
          } else if (it.kind === "life") {
            s.lives = Math.min(5, s.lives + 1);
            newPops.push({ id: idc++, x: ix, y: basketY - 10, text: "+1 Life", color: "var(--destructive)" });
            sfxRef.current?.play("power");
          } else if (it.kind === "star") {
            const gain = 50 * s.level;
            s.score += gain;
            newPops.push({ id: idc++, x: ix, y: basketY - 10, text: `+${gain} ⭐`, color: "var(--accent)" });
            sfxRef.current?.play("power");
          }
          continue;
        }
        if (it.y > H + 60) {
          if (it.kind === "fruit") { s.combo = 0; }
          continue;
        }
        remaining.push(it);
      }
      s.items = remaining;

      setItems([...s.items]);
      setScore(s.score);
      setLives(s.lives);
      setCombo(s.combo);
      setLevel(s.level);
      setLevelProgress(s.levelProgress);
      setSlowLeft(Math.max(0, s.slowUntil - now));
      setMagnetLeft(Math.max(0, s.magnetUntil - now));

      if (newPops.length) {
        setPops((p) => [...p, ...newPops]);
        setTimeout(() => setPops((p) => p.filter((x) => !newPops.find((n) => n.id === x.id))), 700);
      }

      if (s.lives <= 0) {
        s.running = false;
        setRunning(false);
        setGameOver(true);
        sfxRef.current?.play("gameover");
        setBest((b) => {
          const nb = Math.max(b, s.score);
          localStorage.setItem("fruit-catcher-best", String(nb));
          return nb;
        });
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const progressPct = Math.min(100, (levelProgress / LEVEL_GOAL) * 100);

  return (
    <main className="min-h-[100dvh] flex flex-col items-center p-3 sm:p-6">
      <header className="w-full max-w-md flex items-center justify-between mb-3">
        <h1 className="text-3xl sm:text-4xl tracking-tight text-foreground drop-shadow-sm">
          🧺 Fruit Catcher
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            className="bg-card rounded-full w-10 h-10 shadow-md text-xl active:scale-90 transition-transform"
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <div className="text-right">
            <div className="text-xs uppercase text-muted-foreground font-bold">Best</div>
            <div className="text-2xl font-display font-bold text-primary leading-none">{best}</div>
          </div>
        </div>
      </header>

      <div className="w-full max-w-md flex items-center justify-between gap-2 mb-2">
        <div className="bg-card rounded-2xl px-4 py-2 shadow-md flex items-center gap-2">
          <span className="text-xl">⭐</span>
          <span className="font-display text-2xl font-bold">{score}</span>
        </div>
        <div className="bg-card rounded-2xl px-3 py-2 shadow-md font-display font-bold text-sm">
          Lv {level}
        </div>
        <div className="bg-card rounded-2xl px-4 py-2 shadow-md flex items-center gap-1 text-2xl">
          {Array.from({ length: Math.max(3, lives) }).map((_, i) => (
            <span key={i} className={i < lives ? "" : "opacity-20 grayscale"}>❤️</span>
          ))}
        </div>
      </div>

      {/* level progress bar */}
      <div className="w-full max-w-md h-2 bg-card rounded-full overflow-hidden shadow-inner mb-2">
        <div
          className="h-full bg-gradient-to-r from-secondary to-accent transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* active power-up badges */}
      {(slowLeft > 0 || magnetLeft > 0 || combo > 2) && (
        <div className="w-full max-w-md flex items-center justify-center gap-2 mb-2 flex-wrap">
          {slowLeft > 0 && (
            <div className="bg-primary text-primary-foreground rounded-full px-3 py-1 text-sm font-display font-bold shadow">
              ⏱️ {(slowLeft / 1000).toFixed(1)}s
            </div>
          )}
          {magnetLeft > 0 && (
            <div className="bg-primary text-primary-foreground rounded-full px-3 py-1 text-sm font-display font-bold shadow">
              🧲 {(magnetLeft / 1000).toFixed(1)}s
            </div>
          )}
          {combo > 2 && (
            <div className="bg-accent text-accent-foreground rounded-full px-3 py-1 text-sm font-display font-bold shadow animate-pulse">
              🔥 x{combo}
            </div>
          )}
        </div>
      )}

      <div
        ref={fieldRef}
        className="relative w-full max-w-md flex-1 min-h-[60vh] rounded-3xl overflow-hidden shadow-2xl border-4 border-white/60"
        style={{
          background:
            "radial-gradient(circle at 80% 15%, var(--sun) 0 60px, transparent 61px), linear-gradient(180deg, var(--sky), oklch(0.93 0.06 200))",
        }}
      >
        <div className="absolute top-6 left-4 text-4xl opacity-80 select-none">☁️</div>
        <div className="absolute top-16 right-16 text-3xl opacity-70 select-none">☁️</div>

        {items.map((it) => (
          <div
            key={it.id}
            className="absolute text-4xl will-change-transform pointer-events-none"
            style={{
              left: `${it.x * 100}%`,
              top: `${it.y}px`,
              transform: `translate(-50%, -50%) rotate(${it.rot}deg)`,
              filter:
                it.kind === "bomb"
                  ? "drop-shadow(0 0 6px rgba(255,80,80,.7))"
                  : it.kind !== "fruit"
                  ? "drop-shadow(0 0 8px rgba(255,220,90,.9))"
                  : "drop-shadow(0 4px 4px rgba(0,0,0,.15))",
            }}
          >
            {it.emoji}
          </div>
        ))}

        {pops.map((p) => (
          <div
            key={p.id}
            className="absolute font-display font-bold text-xl pointer-events-none animate-[float_0.7s_ease-out_forwards]"
            style={{ left: p.x, top: p.y, color: p.color, transform: "translate(-50%, -50%)" }}
          >
            {p.text}
          </div>
        ))}

        <div className="absolute bottom-0 left-0 right-0 h-16" style={{ background: "linear-gradient(180deg, transparent, var(--grass))" }} />

        <div
          className="absolute text-6xl pointer-events-none transition-transform"
          style={{
            left: `${basketX * 100}%`,
            bottom: "30px",
            transform: "translateX(-50%)",
            filter: magnetLeft > 0
              ? "drop-shadow(0 0 10px rgba(120,160,255,.9))"
              : "drop-shadow(0 6px 6px rgba(0,0,0,.25))",
          }}
        >
          🧺
        </div>

        {/* slow-mo overlay tint */}
        {slowLeft > 0 && (
          <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(circle at 50% 50%, transparent 40%, rgba(80,120,255,.18))" }} />
        )}

        {levelBanner && (
          <div className="absolute inset-x-0 top-1/3 flex justify-center pointer-events-none">
            <div className="bg-accent text-accent-foreground font-display font-bold text-3xl px-6 py-3 rounded-2xl shadow-xl animate-[float_1.2s_ease-out_forwards]">
              {levelBanner}
            </div>
          </div>
        )}

        {!running && !gameOver && (
          <Overlay>
            <h2 className="text-4xl mb-2">Ready?</h2>
            <p className="text-muted-foreground mb-3 text-center px-6">
              Catch fruit, dodge 💣 bombs, grab power-ups!
            </p>
            <div className="flex gap-3 text-2xl mb-4">
              <span title="Slow-mo">⏱️</span>
              <span title="Magnet">🧲</span>
              <span title="Extra life">❤️</span>
              <span title="Bonus star">⭐</span>
            </div>
            <BigButton onClick={start}>▶ Play</BigButton>
            <p className="text-xs text-muted-foreground mt-4">Drag, tap, or use ← → arrows · M to mute</p>
          </Overlay>
        )}
        {gameOver && (
          <Overlay>
            <h2 className="text-4xl mb-1">Game Over</h2>
            <p className="text-lg mb-1">Score: <span className="font-bold text-primary">{score}</span></p>
            <p className="text-sm text-muted-foreground mb-1">Level reached: {level}</p>
            <p className="text-sm text-muted-foreground mb-5">Best: {best}</p>
            <BigButton onClick={start}>↻ Play Again</BigButton>
          </Overlay>
        )}
      </div>

      <p className="text-xs text-muted-foreground mt-3 text-center max-w-md">
        Catch {LEVEL_GOAL} fruit to level up. Higher levels = more points & more bombs!
      </p>

      <style>{`
        @keyframes float {
          0% { opacity: 1; transform: translate(-50%, -50%) translateY(0); }
          100% { opacity: 0; transform: translate(-50%, -50%) translateY(-40px); }
        }
      `}</style>
    </main>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70 backdrop-blur-sm font-display">
      {children}
    </div>
  );
}

function BigButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="bg-primary text-primary-foreground font-display font-bold text-2xl px-8 py-4 rounded-2xl shadow-lg active:scale-95 transition-transform hover:brightness-110"
    >
      {children}
    </button>
  );
}
