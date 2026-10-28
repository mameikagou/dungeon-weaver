# 调试接口与 Tabbit 会话复用

## 浏览器入口

开发构建暴露 `window.__DEBUG__`，接口实现见 `src/debug.ts`。生产构建通过构建期条件排除入口。调试、普通输入和无头模拟共用真实 Simulation，对局状态仅保存在内存中。

| 方法 | 实际行为 |
| --- | --- |
| step(frames) | 暂停自动更新，保留测试输入，精确推进 N 个基础 tick，刷新画面和 HUD 后返回状态，保持暂停。 |
| getState() | 返回独立 JSON 数据副本；包含玩家、当前房间所有敌人与所有弹幕。 |
| teleport(roomX, roomY) | 加载房间并进入出生点，清空敌人、弹幕、危险区域与动作状态，保留祝福和生命；roomX 为 0～5，roomY 为 0。 |
| grantBoon(id) | 按真实规则获得祝福，遵循一层上限，暂停并刷新界面。 |
| spawnEnemy(id, x, z) | 在可通行位置创建敌人，返回 {entityId, state}；类型为 charger、bomber、guard、warden。 |
| reset({seed, roomId}) | 创建独立测试对局，暂停并显示战斗画面。 |
| setInput(input) | 规范化移动与瞄准输入并保持暂停。 |
| pause() / resume() | 控制自动更新并清空累计真实时间；暂停不遮挡调试画面。恢复时释放测试输入。 |

方法目前同步返回状态，外部也可以使用 await 调用。参数错误在变更前报告。frames 必须为 0～3600 的整数，step(0) 可以同步画面；长模拟分段执行或走 CLI。

房间 ID：moss-hall、ember-vault、shield-court、crossroads、crown-gate、warden-sanctum；独立训练场为 training-room。祝福 ID：split-shot、trail、bounce、dash-shot、ricochet、reset-dash。

坐标采用房间局部 X-Z 地面坐标，范围来自 20×15 房间网格。墙内或边界外的位置不可生成敌人。实体 ID 在各自对象池内单调递增，实体类型和 ID 共同识别对象。

## 精确步进与状态

tick 每次基础更新增加 1。combatTick 在实际战斗更新时增加，顿帧和奖励界面冻结战斗。step(60) 总是增加 60 个基础 tick，渲染和 HUD 同步不会额外推进游戏。

状态包含 seed、rng、paused、phase、房间、tick、combatTick、simulationTimeSeconds、顿帧剩余值、冲刺状态、祝福、金币和伤害统计。

player、enemies、projectiles 提供 entityId、x/z、vx/vz、hp、life、flash、bounce 与 damage 等池字段。敌人额外返回 type、action、朝向、动作剩余时间、攻击序号及 enraged；投射物 kind 为 0 普通弹、1 蓄力弹、2 敌方弹。zones 返回落点与轨迹的坐标、半径、生效和消失时间；room 返回当前波次和下一波倒计时。chargeTicks、empoweredTicks、rewardChoices 供观察蓄力、强化时效及合法奖励。

数组按 ID 排序，覆盖当前房间全部活动实体。状态供观察和比较使用，完整对局恢复需要另行实现。

削韧状态包含 `poise`、`maxPoise`、`poiseRecoveryTicks`；投射物的 `poiseDamage` 表示命中削韧。敌人 `action` 可为 `stance-broken` 或 `riposte`，`timer` 为失衡剩余战斗帧。顶层 `staggerTicks` 表示玩家硬直，`riposte` 包含 `ticksRemaining`、`targetId` 和 `readyTargetId`，`stanceBreaks`、`ripostes` 为本局累计次数。`zones.owner` 记录落弹来源的敌人 ID，玩家轨迹使用 0。

复现处决：训练场在 `(12, 7.5)` 创建 charger，向右连续射击到 `action === 'stance-broken'`，松开攻击并向目标移动到 `riposte.readyTargetId` 非零，然后重新按下攻击。逐帧检查第 24 个战斗帧扣血、第 48 帧完成动作。`step()` 推进基础 tick，遇到命中顿帧时应读取 `combatTick` 计算动作经过时间。完整行为回归见 `tests/poise.test.ts`。

```js
await page.evaluate(() => {
  const debug = window.__DEBUG__;
  debug.reset({ seed: 42, roomId: 'training-room' });
  debug.grantBoon('split-shot');
  debug.spawnEnemy('charger', 14.5, 7.5);
  debug.setInput({
    moveX: 0, moveZ: 0, aimX: 1, aimZ: 0,
    attack: true, dash: false, charge: false,
  });
  return debug.step(12);
});
return await page.screenshot({ fullPage: false });
```

attack 支持持续按下，dash 只响应按下边沿；charge 按住蓄力，松开发射。键盘 E 和鼠标右键均绑定 charge，本机 Tabbit 右键手势未向页面传递按下事件，因此自动输入检查使用真实 E 键。截图使用 Tabbit 返回的实际文件路径。调试暂停与玩家暂停菜单分别处理，便于查看战斗现场。

## 复用 Tabbit 会话

整个调试工作使用同一个 task 名 `dungeon-weaver`。已有会话直接发送后续 nodejs；每次代码使用新的 request ID。已有页面先获取并复用，HMR 后等待接口就绪。不要为每次截图或步进重新创建 task、浏览器或标签页。

首次需要获取已有页面时：

```sh
tabbit-cli create --task dungeon-weaver
```

查看 inventory 后，记录游戏页面的实际 tab ID。后续命令同时携带相同 task 和该 tab ID，保持对已有页面的明确选择。长时间编辑代码后，先核对 inventory；会话所有权过期时重新获取同一页面或已观察到的 group ID。

仓库提供可重复运行的浏览器验收脚本。先启动开发服务并生成同场景的 Bun 状态：

```sh
mkdir -p artifacts
bun tests/scenario.ts > artifacts/expected-state.json
bun run sim --state > artifacts/expected-journey.json
tabbit-cli nodejs --task dungeon-weaver --tab "$GAME_TAB" --request-id gameplay-check < scripts/tabbit-check.js
```

GAME_TAB 填入 inventory 中实际观察到的游戏 tab ID。脚本要求该页面已打开 http://localhost:4173 。它逐字段比较浏览器与 Bun 的训练场景和六房 Bot 对局，检查 180 帧与两次 90 帧相等、暂停保持状态、真实奖励卡片点击、键盘移动与冲刺、鼠标射击及 E 键蓄力，并通过真实鼠标事件检查破韧后的近身处决与奖励结算。执行期间不要修改项目文件，Vite 的热更新可能重置对局。再次执行时更换 request ID，继续复用 task 和 tab。

所有调试和截图读取结束后调用一次：

```sh
tabbit-cli finish --task dungeon-weaver
```

该命令释放控制并保留页面，便于直接接手试玩。不要在连续调试命令之间调用 finish。

## 无头模拟与配置检查

```sh
bun run sim --seed=42 --boons=split-shot,bounce --ticks=36000
bun run check:data
bun test
```

Bot 使用正式输入和奖励接口，按距离、地形、预告区域和敌人动作移动、射击与闪避，接近卫兵诱导挥击。报告输出胜负、tick、生命、击杀、伤害、承伤、DPS、弹幕容量拒绝数与实际耗时；达到 tick 上限仍未结束时标记 incomplete。它用于规则验证，操作手感由实际试玩判断。

check:data 逐项报告内容问题。新增武器或祝福时，使用真实内容配置验证伤害、有限触发次数、对象回收和 UI 更新。
