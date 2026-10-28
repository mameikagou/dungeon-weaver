// 通过已获取页面的 Tabbit nodejs 会话执行本文件。
globalThis.controlStage = '步进一致性';
await page.mouse.up();
await page.mouse.up({button: 'right'});
await page.keyboard.up('d');
await page.keyboard.up('Space');
await page.keyboard.up('e');
await page.waitForFunction(() => window.__DEBUG__?.getState().ready);
const checks = await page.evaluate(async () => {
  const debug = window.__DEBUG__;
  const expected = await fetch('/artifacts/expected-state.json').then(response => {
    if (!response.ok) throw new Error('先运行 bun tests/scenario.ts 生成无头状态');
    return response.json();
  });
  function setup() {
    debug.reset({ seed: 42, roomId: 'training-room' });
    debug.spawnEnemy('charger', 14.5, 7.5);
    debug.grantBoon('split-shot');
    debug.setInput({ moveX: 0, moveZ: 0, aimX: 1, aimZ: 0, attack: true, dash: false, charge: false });
  }
  setup();
  const whole = debug.step(180);
  setup();
  debug.step(90);
  const split = debug.step(90);
  for (let frame = 0; frame < 10; frame++) await new Promise(requestAnimationFrame);
  const frozen = debug.getState();
  let rejected = false;
  try { debug.step(-1); } catch { rejected = true; }
  return { expected, whole, split, frozen, rejected };
});
expect(checks.whole).toEqual(checks.expected);
expect(checks.split).toEqual(checks.whole);
expect(checks.frozen).toEqual(checks.split);
expect(checks.rejected).toBe(true);
globalThis.controlStage = '奖励选择';
await expect(page.getByRole('heading', { name: '选择你的祝福' })).toBeVisible();
await page.getByRole('button', { name: /回声石/ }).click();
const rewarded = await page.evaluate(() => window.__DEBUG__.pause());
expect(rewarded.room.id).toBe('ember-vault');
expect(rewarded.boons).toContain('bounce');

await page.evaluate(() => {
  window.__DEBUG__.reset({ seed: 42, roomId: 'training-room' });
  window.__DEBUG__.resume();
});
globalThis.controlStage = '键盘移动';
await page.keyboard.down('d');
await page.waitForFunction(() => window.__DEBUG__.getState().player.x > 11);
await page.keyboard.up('d');
globalThis.controlStage = '空格闪避';
await page.keyboard.down('Space');
await page.waitForFunction(() => window.__DEBUG__.getState().dashTicks > 0);
await page.keyboard.up('Space');
const bounds = await page.locator('canvas').boundingBox();
await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.5);
globalThis.controlStage = '左键射击';
await page.mouse.down();
await page.waitForFunction(() => window.__DEBUG__.getState().projectiles.length > 0);
globalThis.controlStage = 'E 键蓄力';
await page.keyboard.down('e');
await page.waitForFunction(() => window.__DEBUG__.getState().chargeTicks === 60);
await page.mouse.up();
globalThis.controlStage = '释放蓄力';
await page.keyboard.up('e');
await page.waitForFunction(() => window.__DEBUG__.getState().projectiles.some(bullet => bullet.kind === 1));
const inputState = await page.evaluate(() => window.__DEBUG__.pause());
expect(inputState.player.x).toBeGreaterThan(11);
expect(inputState.projectiles.length).toBeGreaterThan(0);
globalThis.controlStage = '六房对局一致性';
const journey = await page.evaluate(async () => {
  const { Simulation } = await import('/src/engine/simulation.ts');
  const { driveBot } = await import('/src/engine/bot.ts');
  const simulation = new Simulation(42);
  for (let frame = 0; frame < 36000 && simulation.phase !== 'won' && simulation.phase !== 'dead'; frame++) {
    driveBot(simulation);
    simulation.tick();
  }
  const response = await fetch('/artifacts/expected-journey.json');
  if (!response.ok) throw new Error('先运行 bun run sim --state 生成完整对局状态');
  return { actual: simulation.getState(), expected: await response.json() };
});
expect(journey.actual).toEqual(journey.expected);
expect(journey.actual.phase).toBe('won');
return {
  browserMatchesBun: true, splitStepMatches: true, pausedStateFrozen: true,
  rewardClick: rewarded.room.id, keyboardMoved: true, keyboardDashed: true, mouseFired: true,
  keyboardCharged: inputState.projectiles.some(bullet => bullet.kind === 1),
  fullJourneyMatchesBun: true, kills: journey.actual.kills, journeyTicks: journey.actual.tick,
};
