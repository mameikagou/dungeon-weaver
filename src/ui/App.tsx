import { useEffect, useRef, useState } from 'react';
import { Provider, useAtomValue, useStore } from 'jotai';
import { boons } from '../content/boons';
import { GameRuntime } from '../runtime';
import {
  createUiBridge,
  hpAtom,
  goldAtom,
  enemiesAtom,
  boonsAtom,
  roomAtom,
  floorAtom,
  phaseAtom,
  pausedAtom,
  startedAtom,
  mutedAtom,
  computedStatsAtom,
} from './store';

function Vitality() {
  const hp = useAtomValue(hpAtom);
  return (
    <div className="vitality">
      <div className="flex justify-between text-xs tracking-widest">
        <span>生命 · VITALITY</span>
        <span>{hp} / 100</span>
      </div>
      <div className="health-track">
        <div style={{ width: `${hp}%` }} />
      </div>
    </div>
  );
}

function Journey() {
  const room = useAtomValue(roomAtom);
  const floor = useAtomValue(floorAtom);
  const enemies = useAtomValue(enemiesAtom);
  return (
    <div className="text-right">
      <div className="eyebrow">THE MOSSBOUND DESCENT</div>
      <div className="mt-1 text-lg">
        {room} <span className="text-sm text-stone-400">0{floor + 1} / 02</span>
      </div>
      <div className="mt-2 text-xs text-stone-400">
        {enemies ? `游荡者 · ${enemies}` : '房间已净化'}{' '}
        <span className="ml-3 text-emerald-200">{floor === 0 ? '◆ ─ ◇' : '◇ ─ ◆'}</span>
      </div>
    </div>
  );
}

function Inventory() {
  const gold = useAtomValue(goldAtom);
  const ids = useAtomValue(boonsAtom);
  const stats = useAtomValue(computedStatsAtom);
  return (
    <div className="inventory">
      <div className="text-xs text-amber-200">◇ {gold} 碎光</div>
      <div className="flex gap-2">
        {ids.length ? (
          ids.map((id) => {
            const boon = boons.find((boon) => boon.id === id)!;
            return (
              <span className="relic" title={boon.description} key={id}>
                {boon.icon}
              </span>
            );
          })
        ) : (
          <span className="text-xs text-stone-400">祝福尚未降临</span>
        )}
      </div>
      <div className="text-xs text-stone-400">
        灵弹 {stats.damage} × {stats.shots}
      </div>
    </div>
  );
}

function Overlay({ runtime }: { runtime: GameRuntime | null }) {
  const started = useAtomValue(startedAtom);
  const phase = useAtomValue(phaseAtom);
  const paused = useAtomValue(pausedAtom);
  const owned = useAtomValue(boonsAtom);
  if (!runtime || (started && phase === 'playing' && !paused)) return null;
  if (phase === 'reward')
    return (
      <div className="overlay">
        <section className="reward-panel">
          <div className="eyebrow">A GIFT FROM THE DEPTHS</div>
          <h1>选择你的祝福</h1>
          <p>带上一束微光，走向下一间密室。</p>
          <div className="boon-grid">
            {boons
              .filter((boon) => !owned.includes(boon.id))
              .slice(0, 3)
              .map((boon) => (
                <button
                  className="boon-card"
                  key={boon.id}
                  onClick={() => {
                    runtime.simulation.chooseBoon(boon.id);
                    runtime.pause(false);
                  }}
                >
                  <span className="boon-symbol">{boon.icon}</span>
                  <strong>{boon.name}</strong>
                  <span>{boon.description}</span>
                  <small>拾取祝福 ↗</small>
                </button>
              ))}
          </div>
        </section>
      </div>
    );
  let title = '苔光地牢';
  let description = '穿过沉睡的回廊，让微光成为你的武器。';
  let action = '进入地牢';
  if (started) {
    title = '稍作停留';
    description = '深处的微光，正在等待你。';
    action = '继续探索';
  }
  if (phase === 'dead') {
    title = '微光暂熄';
    description = '每一次深入，都会留下新的回响。';
    action = '再次出发';
  }
  if (phase === 'won') {
    title = '地牢重现微光';
    description = '两间密室已经净化。这趟旅程，由你写下。';
    action = '再探索一次';
  }
  return (
    <div className="overlay">
      <section className="welcome">
        <div className="crest">✦</div>
        <div className="eyebrow">DUNGEON WEAVER</div>
        <h1>{title}</h1>
        <p>{description}</p>
        <button
          className="primary"
          onClick={() => {
            if (phase === 'won' || phase === 'dead') runtime.reset();
            runtime.start();
          }}
        >
          {action} <span>→</span>
        </button>
        <div className="instructions">
          <span>
            <kbd>W A S D</kbd> 移动
          </span>
          <span>
            <kbd>鼠标</kbd> 瞄准 / 按住左键攻击
          </span>
          <span>
            <kbd>空格</kbd> 闪避
          </span>
        </div>
      </section>
    </div>
  );
}

function Controls({ runtime }: { runtime: GameRuntime | null }) {
  const store = useStore();
  const muted = useAtomValue(mutedAtom);
  const paused = useAtomValue(pausedAtom);
  return (
    <div className="flex gap-2">
      <button
        className="control"
        onClick={() => {
          if (!runtime) return;
          runtime.audio.muted = !muted;
          store.set(mutedAtom, !muted);
        }}
      >
        {muted ? '开启声音' : '静音'}
      </button>
      <button className="control" onClick={() => runtime?.pause(!paused)}>
        {paused ? '继续' : '暂停'}
      </button>
    </div>
  );
}

function Game() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bridge] = useState(createUiBridge);
  const [runtime, setRuntime] = useState<GameRuntime | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let game: GameRuntime;
    try {
      game = new GameRuntime(canvas.current!, bridge);
    } catch (error) {
      setError(String(error));
      return;
    }
    setRuntime(game);
    let disposed = false;
    let cleanupDebug: (() => void) | undefined;
    if (import.meta.env.DEV)
      void import('../debug').then((module) => {
        if (!disposed) cleanupDebug = module.installDebug(game);
      });
    return () => {
      disposed = true;
      cleanupDebug?.();
      game.dispose();
    };
  }, [bridge]);
  return (
    <Provider store={bridge.store}>
      <main className="game-shell">
        <canvas ref={canvas} aria-label="苔光地牢战斗场景" />
        <header className="hud">
          <div>
            <div className="brand">
              ✦ <span>DUNGEON WEAVER</span>
            </div>
            <Vitality />
          </div>
          <Journey />
        </header>
        <div className="floor-caption">
          <span>01 — THE UNDERGROWTH</span>
          <span>FOLLOW THE LIGHT</span>
        </div>
        <footer className="hud-bottom">
          <Inventory />
          <div className="bottom-right">
            <Controls runtime={runtime} />
            <span className="text-xs text-stone-500">
              WASD 移动 · 左键攻击 · 空格闪避 · ESC 暂停
            </span>
          </div>
        </footer>
        <Overlay runtime={runtime} />
        {error && (
          <div className="overlay">
            <section className="welcome">
              <h1>画面初始化失败</h1>
              <p role="alert">{error}</p>
            </section>
          </div>
        )}
      </main>
    </Provider>
  );
}

export default Game;
