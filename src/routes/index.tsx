import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fruit Catcher — A fun game for kids" },
      { name: "description", content: "Move the basket to catch falling fruit and dodge bombs. A bright, playful arcade game for kids aged 6-10." },
      { property: "og:title", content: "Fruit Catcher" },
      { property: "og:description", content: "Catch falling fruit, dodge bombs, beat your high score!" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:wght@600;800&display=swap" },
    ],
  }),
  component: Game,
});

type Item = {
  id: number;
  x: number; // 0..1 fraction of width
  y: number; // px from top
  vy: number;
  kind: "fruit" | "bomb";
  emoji: string;
  rot: number;
  vr: number;
};

const FRUITS = ["🍎", "🍌", "🍓", "🍇", "🍊", "🍉", "🍑", "🥝", "🍒", "🥭"];
const BOMB = "💣";

function Game() {
  const fieldRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [basketX, setBasketX] = useState(0.5);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [lives, setLives] = useState(3);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [combo, setCombo] = useState(0);
  const [pops, setPops] = useState<{ id: number; x: number; y: number; text: string; color: string }[]>([]);

  const stateRef = useRef({ items: [] as Item[], basketX: 0.5, lives: 3, score: 0, combo: 0, running: false, lastSpawn: 0, spawnEvery: 900, elapsed: 0 });

  useEffect(() => {
    const b = Number(localStorage.getItem("fruit-catcher-best") || 0);
    if (b) setBest(b);
  }, []);

  // pointer / touch / keyboard control
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("pointermove", onPointer);
      el.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const start = useCallback(() => {
    stateRef.current = { items: [], basketX: 0.5, lives: 3, score: 0, combo: 0, running: true, lastSpawn: 0, spawnEvery: 900, elapsed: 0 };
    setItems([]); setLives(3); setScore(0); setCombo(0); setGameOver(false); setRunning(true);
  }, []);

  // main loop
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let idc = 1;

    const tick = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      const s = stateRef.current;
      s.elapsed += dt;
      s.spawnEvery = Math.max(380, 900 - s.elapsed / 30);

      const el = fieldRef.current;
      const H = el ? el.clientHeight : 600;
      const W = el ? el.clientWidth : 400;

      // spawn
      s.lastSpawn += dt;
      if (s.lastSpawn >= s.spawnEvery) {
        s.lastSpawn = 0;
        const isBomb = Math.random() < Math.min(0.28, 0.08 + s.elapsed / 60000);
        s.items.push({
          id: idc++,
          x: 0.08 + Math.random() * 0.84,
          y: -40,
          vy: 0.12 + Math.random() * 0.08 + s.elapsed / 80000,
          kind: isBomb ? "bomb" : "fruit",
          emoji: isBomb ? BOMB : FRUITS[Math.floor(Math.random() * FRUITS.length)],
          rot: Math.random() * 360,
          vr: (Math.random() - 0.5) * 0.4,
        });
      }

      // update
      const basketPx = s.basketX * W;
      const basketY = H - 90;
      const catchRadius = 60;
      const remaining: Item[] = [];
      const newPops: typeof pops = [];
      for (const it of s.items) {
        it.y += it.vy * dt;
        it.rot += it.vr * dt;
        const ix = it.x * W;
        if (it.y > basketY - 20 && it.y < basketY + 30 && Math.abs(ix - basketPx) < catchRadius) {
          if (it.kind === "fruit") {
            s.combo += 1;
            const gain = 10 + Math.min(40, s.combo * 2);
            s.score += gain;
            newPops.push({ id: idc++, x: ix, y: basketY - 10, text: `+${gain}`, color: "var(--grass)" });
          } else {
            s.lives -= 1; s.combo = 0;
            newPops.push({ id: idc++, x: ix, y: basketY - 10, text: "💥", color: "var(--destructive)" });
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
      if (newPops.length) {
        setPops((p) => [...p, ...newPops]);
        setTimeout(() => setPops((p) => p.filter((x) => !newPops.find((n) => n.id === x.id))), 700);
      }

      if (s.lives <= 0) {
        s.running = false;
        setRunning(false);
        setGameOver(true);
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

  return (
    <main className="min-h-[100dvh] flex flex-col items-center p-3 sm:p-6">
      <header className="w-full max-w-md flex items-center justify-between mb-3">
        <h1 className="text-3xl sm:text-4xl tracking-tight text-foreground drop-shadow-sm">
          🧺 Fruit Catcher
        </h1>
        <div className="text-right">
          <div className="text-xs uppercase text-muted-foreground font-bold">Best</div>
          <div className="text-2xl font-display font-bold text-primary">{best}</div>
        </div>
      </header>

      <div className="w-full max-w-md flex items-center justify-between gap-3 mb-2">
        <div className="bg-card rounded-2xl px-4 py-2 shadow-md flex items-center gap-2">
          <span className="text-xl">⭐</span>
          <span className="font-display text-2xl font-bold">{score}</span>
        </div>
        <div className="bg-card rounded-2xl px-4 py-2 shadow-md flex items-center gap-1 text-2xl">
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i} className={i < lives ? "" : "opacity-20 grayscale"}>❤️</span>
          ))}
        </div>
        {combo > 2 && (
          <div className="bg-accent text-accent-foreground rounded-2xl px-3 py-2 shadow-md font-display font-bold animate-pulse">
            🔥 x{combo}
          </div>
        )}
      </div>

      <div
        ref={fieldRef}
        className="relative w-full max-w-md flex-1 min-h-[60vh] rounded-3xl overflow-hidden shadow-2xl border-4 border-white/60"
        style={{
          background:
            "radial-gradient(circle at 80% 15%, var(--sun) 0 60px, transparent 61px), linear-gradient(180deg, var(--sky), oklch(0.93 0.06 200))",
        }}
      >
        {/* clouds */}
        <div className="absolute top-6 left-4 text-4xl opacity-80 select-none">☁️</div>
        <div className="absolute top-16 right-16 text-3xl opacity-70 select-none">☁️</div>

        {/* falling items */}
        {items.map((it) => (
          <div
            key={it.id}
            className="absolute text-4xl will-change-transform pointer-events-none"
            style={{
              left: `${it.x * 100}%`,
              top: `${it.y}px`,
              transform: `translate(-50%, -50%) rotate(${it.rot}deg)`,
              filter: it.kind === "bomb" ? "drop-shadow(0 0 6px rgba(255,80,80,.6))" : "drop-shadow(0 4px 4px rgba(0,0,0,.15))",
            }}
          >
            {it.emoji}
          </div>
        ))}

        {/* score pops */}
        {pops.map((p) => (
          <div
            key={p.id}
            className="absolute font-display font-bold text-xl pointer-events-none animate-[float_0.7s_ease-out_forwards]"
            style={{ left: p.x, top: p.y, color: p.color, transform: "translate(-50%, -50%)" }}
          >
            {p.text}
          </div>
        ))}

        {/* ground */}
        <div className="absolute bottom-0 left-0 right-0 h-16" style={{ background: "linear-gradient(180deg, transparent, var(--grass))" }} />

        {/* basket */}
        <div
          className="absolute text-6xl pointer-events-none transition-transform"
          style={{
            left: `${basketX * 100}%`,
            bottom: "30px",
            transform: "translateX(-50%)",
            filter: "drop-shadow(0 6px 6px rgba(0,0,0,.25))",
          }}
        >
          🧺
        </div>

        {/* overlays */}
        {!running && !gameOver && (
          <Overlay>
            <h2 className="text-4xl mb-2">Ready?</h2>
            <p className="text-muted-foreground mb-5 text-center px-6">
              Move the basket to catch fruit. <br /> Avoid the 💣 bombs!
            </p>
            <BigButton onClick={start}>▶ Play</BigButton>
            <p className="text-xs text-muted-foreground mt-4">Drag, tap, or use ← → arrows</p>
          </Overlay>
        )}
        {gameOver && (
          <Overlay>
            <h2 className="text-4xl mb-1">Game Over</h2>
            <p className="text-lg mb-1">Score: <span className="font-bold text-primary">{score}</span></p>
            <p className="text-sm text-muted-foreground mb-5">Best: {best}</p>
            <BigButton onClick={start}>↻ Play Again</BigButton>
          </Overlay>
        )}
      </div>

      <p className="text-xs text-muted-foreground mt-3 text-center max-w-md">
        Tip: hold a long streak without dropping fruit to score combo bonuses 🔥
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
