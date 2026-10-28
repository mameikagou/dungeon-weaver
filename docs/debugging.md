# 调试接口与 Tabbit 会话复用

## 浏览器入口

开发构建暴露 `window.__DEBUG__`，接口实现见 `src/debug.ts`。生产构建通过构建期条件排除入口。调试、普通输入和无头模拟共用真实 Simulation，对局状态仅保存在内存中。

| 方法 | 实际行为 |
| --- | --- |
| step(frames) | 暂停自动更新，保留测试输入，精确推进 N 个基础 tick，刷新画面和 HUD 后返回状态，保持暂停。 |
| getState() | 返回独立 JSON 数据副本；包含玩家、当前房间所有敌人与所有弹幕。 |
| teleport(roomX, roomY) | 加载房间并进入出生点，清空当前敌人与弹幕，保留祝福和生命；当前支持 (0,0) 与 (1,0)。 |
| grantBoon(id) | 按真实规则获得祝福，遵循一层上限，暂停并刷新界面。 |
| spawnEnemy(id, x, z) | 在当前房间地面位置创建敌人，返回 {entityId, state}；当前类型为 melee。 |
| reset({seed, roomId}) | 创建独立测试对局，暂停并显示战斗画面。 |
| setInput(input) | 规范化移动与瞄准输入并保持暂停。 |
| pause() / resume() | 控制自动更新并清空累计真实时间；暂停不遮挡调试画面。恢复时释放测试输入。 |

方法目前同步返回状态，外部也可以使用 await 调用。参数错误在变更前报告。frames 必须为 0～3600 的整数，step(0) 可以同步画面；长模拟分段执行或走 CLI。

房间 ID：moss-hall、ember-vault、training-room。祝福 ID：split-shot、bounce、leech、rush、power。

坐标采用房间局部 X-Z 地面坐标，范围来自 20×15 房间网格。墙内或边界外的位置不可生成敌人。实体 ID 在各自对象池内单调递增，实体类型和 ID 共同识别对象。

## 精确步进与状态

tick 每次基础更新增加 1。combatTick 在实际战斗更新时增加，顿帧和奖励界面冻结战斗。step(60) 总是增加 60 个基础 tick，渲染和 HUD 同步不会额外推进游戏。

状态包含 seed、rng、paused、phase、房间、tick、combatTick、simulationTimeSeconds、顿帧剩余值、冲刺状态、祝福、金币和伤害统计。

player、enemies、projectiles 提供 entityId、x/z、vx/vz、hp、life、flash、bounce 与 damage 等池字段。数组按 ID 排序，覆盖当前房间全部活动对象。状态供观察和比较使用，完整对局恢复需要另行实现。

```js
await page.evaluate(() => {
  const debug = window.__DEBUG__;
  debug.reset({ seed: 42, roomId: 'training-room' });
  debug.grantBoon('split-shot');
  debug.spawnEnemy('melee', 14.5, 7.5);
  debug.setInput({
    moveX: 0, moveZ: 0, aimX: 1, aimZ: 0,
    attack: true, dash: false,
  });
  return debug.step(12);
});
return await page.screenshot({ fullPage: false });
```

attack 支持持续按下，dash 只响应按下边沿。截图使用 Tabbit 返回的实际文件路径。调试暂停与玩家暂停菜单分别处理，便于查看战斗现场。

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
tabbit-cli nodejs --task dungeon-weaver --tab "$GAME_TAB" --request-id gameplay-check < scripts/tabbit-check.js
```

GAME_TAB 填入 inventory 中实际观察到的游戏 tab ID。脚本要求该页面已打开 http://localhost:4173 。它逐字段比较浏览器与 Bun 的真实场景，检查 60 帧与两次 30 帧相等、暂停保持状态、真实奖励卡片点击、键盘移动与冲刺、鼠标射击。再次执行时更换 request ID，继续复用 task 和 tab。

所有调试和截图读取结束后调用一次：

```sh
tabbit-cli finish --task dungeon-weaver
```

该命令释放控制并保留页面，便于直接接手试玩。不要在连续调试命令之间调用 finish。

## 无头模拟与配置检查

```sh
bun run sim --seed=42 --boons=split-shot,bounce --ticks=7200
bun run check:data
bun test
```

Bot 使用正式输入和奖励接口，当前采用原地瞄准射击策略。报告输出胜负、tick、生命、击杀、伤害、承伤、DPS、弹幕容量拒绝数与实际耗时；达到 tick 上限仍未结束时标记 incomplete。它用于规则验证，操作手感由实际试玩判断。

check:data 逐项报告内容问题。新增武器或祝福时，使用真实内容配置验证伤害、有限触发次数、对象回收和 UI 更新。
