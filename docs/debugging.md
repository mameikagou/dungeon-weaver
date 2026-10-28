# 调试与验证接口

本文是待实现的接口契约。目标是让开发者和自动化工具直接构造真实战斗场景、精确推进时间、读取状态并检查画面。

## 接入方式

开发构建在游戏初始化完成后暴露 `window.__GAME_DEBUG__`。Tabbit 或 Playwright 通过 `page.evaluate()` 调用，复用浏览器现成的控制通道。

调试 API 调用游戏核心的真实创建、更新、加成与房间加载函数。普通游玩、浏览器调试和无头模拟共享这些函数。

常规发布构建不暴露此全局对象。开发入口使用构建期条件动态加载调试模块；发布验证检查页面上的对象不存在。调试场景使用内存存档，避免改动玩家正常进度。

## 必需接口

```ts
interface GameDebug {
  step(frames: number): Promise<GameState>;
  getState(): GameState;
  teleport(roomX: number, roomY: number): Promise<GameState>;
  grantBoon(id: string): Promise<GameState>;
  spawnEnemy(id: string, x: number, z: number): Promise<SpawnResult>;
}

interface SpawnResult {
  entityId: string;
  state: GameState;
}
```

| 接口 | 约定 |
| --- | --- |
| `step(frames)` | 暂停自动更新，清空自动循环尚未消费的真实时间，精确执行 N 个基础 tick；完成表现同步后返回状态，保持暂停。 |
| `getState()` | 返回调用时的独立 JSON 数据副本；读取不推进时间，不暴露 Mesh、DOM 或内部可变引用。 |
| `teleport(roomX, roomY)` | 参数是地牢房间网格坐标，区别于世界坐标。暂停后复用房间加载过程，将玩家放入目标房间的安全出生点；等待加载与表现完成。 |
| `grantBoon(id)` | 暂停后按正常获得祝福的规则增加一个层数，并更新属性及 UI；遵循唯一性和层数上限。 |
| `spawnEnemy(id, x, z)` | `id` 是敌人类型，X-Z 是当前房间局部地面坐标。暂停后创建真实敌人和碰撞体，返回新实体 ID 及状态。 |

`frames` 必须是 0～3600 的整数，长模拟由 CLI 执行或分段调用。`step(0)` 只暂停并同步画面。未知 ID、非法位置或不存在的房间返回带原因的错误，验证参数后才修改状态。

变更请求按顺序执行，重复发起的并发变更返回 busy 错误。房间加载期间 `getState()` 返回最近一次完整状态，`ready: false`；资源加载失败给出明确错误并保留可解释的状态。

## 测试所需的辅助接口

```ts
interface DebugInput {
  moveX: number;
  moveZ: number;
  aimX: number;
  aimZ: number;
  attack: boolean;
  dash: boolean;
}

interface DebugSession {
  pause(): Promise<GameState>;
  resume(): Promise<GameState>;
  reset(options: { seed: number; roomId: string }): Promise<GameState>;
  setInput(input: DebugInput): Promise<GameState>;
}

type GameDebugApi = GameDebug & DebugSession;

declare global {
  interface Window {
    __GAME_DEBUG__?: GameDebugApi;
  }
}

export {};
```

上述辅助方法也放在同一个 `__GAME_DEBUG__` 对象上。`reset` 使用真实房间和敌人配置，创建独立测试对局、清空输入、重新设置随机状态，并等待资源就绪。`setInput` 经过与键盘、鼠标相同的输入规范化流程；移动向量长度上限为 1，瞄准向量需有限且非零。

`attack` 按武器规则处理持续按下；`dash` 通过按下边沿触发一次。测试显式设置和释放输入。`resume` 解除调试暂停并清空累计真实时间，游戏菜单的暂停状态仍然生效。

## 状态结构

```ts
interface Position {
  x: number;
  z: number;
}

interface ActorState {
  entityId: string;
  kind: string;
  position: Position;
  velocity: Position;
  hp: number;
  maxHp: number;
  action: string;
  actionTicksRemaining: number;
  invulnerableTicksRemaining: number;
  statuses: Array<{ id: string; ticksRemaining: number; stacks: number }>;
}

interface ProjectileState {
  entityId: string;
  kind: string;
  ownerId: string;
  position: Position;
  velocity: Position;
  radius: number;
  damage: number;
  ticksRemaining: number;
  pierceRemaining: number;
  bounceRemaining: number;
}

interface GameState {
  ready: boolean;
  paused: boolean;
  phase: "playing" | "reward" | "dead" | "won";
  seed: number;
  tick: number;
  combatTick: number;
  fixedDeltaSeconds: number;
  simulationTimeSeconds: number;
  timeScale: number;
  hitstopTicksRemaining: number;
  room: { id: string; roomX: number; roomY: number; cleared: boolean };
  player: ActorState;
  boons: Array<{ id: string; stacks: number }>;
  enemies: ActorState[];
  projectiles: ProjectileState[];
  rng: { dungeon: number[]; combat: number[] };
}
```

`enemies` 和 `projectiles` 包含当前活动房间全部实体，按实体 ID 稳定排序，不按视野裁剪。位置采用当前房间局部 X-Z 坐标，单位与物理世界一致。实体 ID 来自单调递增计数器。

状态是可观测数据，包含定位问题所需字段；完整存档和物理世界恢复另用其适用的序列化能力。

## 步进的精确定义

每次基础 tick 对应 1/60 秒。`step(60)` 将 `tick` 精确增加 60，无论屏幕刷新率和机器速度如何。顿帧倒计时仍消耗基础 tick，`combatTick` 在实际战斗更新时递增；慢动作时按缩放时间累计推进。

步进必须等待核心更新、物理更新、产生的事件和画面同步完成。同步画面只读取当前状态，不能附带执行额外战斗 tick。Promise 返回后，立即截图与 `getState()` 应对应同一状态。

测试暂停后等待真实时间，tick、生命值和投射物位置应保持不变。输入、核心冷却、动画判定及物理更新不能由另一个自动循环继续推进。

Playwright 时钟可以用于 UI 定时器测试，精确游戏步进以本接口返回的 tick 为准。

## 浏览器调用示例

以下示例用于接口实现后；场景和内容 ID 由实际配置目录提供。

```ts
await page.goto(devUrl);
await page.waitForFunction(() => window.__GAME_DEBUG__?.getState().ready);

const before = await page.evaluate(async () => {
  const debug = window.__GAME_DEBUG__;
  if (!debug) throw new Error("游戏调试接口尚未就绪");
  await debug.reset({ seed: 42, roomId: "training-room" });
  await debug.grantBoon("split-shot");
  await debug.spawnEnemy("melee", 4, 0);
  await debug.setInput({
    moveX: 0, moveZ: 0, aimX: 1, aimZ: 0,
    attack: true, dash: false,
  });
  return debug.getState();
});

const after = await page.evaluate(() => {
  const debug = window.__GAME_DEBUG__;
  if (!debug) throw new Error("游戏调试接口尚未就绪");
  return debug.step(60);
});
expect(after.tick).toBe(before.tick + 60);
await page.screenshot({ path: "artifacts/split-shot.png" });
```

Tabbit 使用相同的页面求值代码，截图按安装版 skill 的返回路径读取。直接操作键盘和点击的浏览器流程也要覆盖，验证真实输入和 UI 连接。

## 无头模拟 CLI

计划提供的命令：

```sh
npm run sim -- --weapon=bow --boons=split-shot,bounce --room=training-room --seed=42
```

CLI 在 Node.js 中初始化与浏览器相同的核心和二维碰撞世界，加载真实内容配置。简单 Bot 通过正式输入接口移动、瞄准、攻击和闪避，运行至胜利、死亡或明确的 tick 上限。

输出结构化战报：场景、种子、武器、祝福、结果、基础 tick、战斗时间、实际耗时、伤害、承伤、击杀、DPS 和错误详情。DPS 使用战斗时间；实际耗时用于性能测量。超时记录为未完成，异常记录为错误。

多场模拟逐场保存结果。运行速度、峰值内存和 Bot 胜率需实测；Bot 的结果不能替代真人对操作手感的判断。

## 配置与画面验证

计划提供 `npm run check:data`：使用 Zod 校验字段及取值，检查武器、效果、敌人、祝福和房间之间的引用；检查地图行宽、符号、出生点与门的可达性。逐项汇总错误，包含文件和字段位置，完整列出本次发现的问题。

画面检查固定场景、种子、输入、摄像机、视口、资源加载状态和模拟 tick，覆盖 HUD、奖励菜单、受击、冲刺残影和 Boss 预警。保留截图、差异图与短录制，由可见性、遮挡、预警清晰度及实际状态判断问题。

测试检查行为：伤害是否正确、穿透与反弹是否按次数执行、冲刺期间是否按规则免伤、击杀是否开门、奖励是否只发一次、地图是否可通行。所有场景运行真实核心；测试断言按字段表达。

## 第一间房的验收

1. `reset` 后能读取玩家、敌人和投射物的结构化状态。
2. `step(0)` 保持暂停，`step(60)` 精确增加 60 个基础 tick。
3. `step(60)` 与分两次 `step(30)` 在相同输入下得到相同的玩法状态。
4. 浏览器与无头运行使用相同场景和输入，逐字段核对战斗结果。
5. `teleport`、`grantBoon`、`spawnEnemy` 可直接建立测试现场，行为与正式游戏函数一致。
6. 真实键盘、鼠标输入能完成一次攻击和闪避，UI 正确反映状态。
7. 截图与返回状态对应同一 tick，发布构建中没有调试全局对象。
