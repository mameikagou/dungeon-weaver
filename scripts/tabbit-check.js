// 通过已获取页面的 Tabbit nodejs 会话执行本文件。
globalThis.controlStage = '步进一致性';
await page.mouse.up();
await page.mouse.up({ button: 'right' });
await page.keyboard.up('d');
await page.keyboard.up('Space');
await page.keyboard.up('e');
await page.waitForFunction(() => window.__DEBUG__?.getState().ready);
const checks = await page.evaluate(async () => {
  const debug = window.__DEBUG__;
  const expected = await fetch('/artifacts/expected-state.json').then((response) => {
    if (!response.ok) throw new Error('先运行 bun tests/scenario.ts 生成无头状态');
    return response.json();
  });
  function setup() {
    debug.reset({ seed: 42, roomId: 'training-room' });
    debug.equipWeapon('focus');
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
  try {
    debug.step(-1);
  } catch {
    rejected = true;
  }
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
  window.__DEBUG__.equipWeapon('focus');
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
await page.waitForFunction(() => window.__DEBUG__.getState().projectiles.some((bullet) => bullet.kind === 1));
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
globalThis.controlStage = '削韧与处决';
const broken = await page.evaluate(() => {
  const debug = window.__DEBUG__;
  debug.reset({ seed: 42, roomId: 'training-room' });
  debug.equipWeapon('focus');
  debug.spawnEnemy('charger', 12, 7.5);
  const input = { moveX: 0, moveZ: 0, aimX: 1, aimZ: 0, attack: true, dash: false, charge: false };
  debug.setInput(input);
  for (let tick = 0; tick < 120 && debug.getState().enemies[0]?.action !== 'stance-broken'; tick++) debug.step(1);
  const broken = debug.getState();
  debug.setInput({ ...input, attack: false, moveX: 1 });
  for (let tick = 0; tick < 60 && !debug.getState().riposte.readyTargetId; tick++) debug.step(1);
  debug.setInput({ ...input, attack: false });
  const releasedAt = debug.getState().combatTick;
  for (let tick = 0; tick < 10 && debug.getState().combatTick === releasedAt; tick++) debug.step(1);
  return broken;
});
expect(broken.enemies[0].poise).toBe(0);
expect(broken.enemies[0].action).toBe('stance-broken');
await expect(page.locator('.combat-hint')).toContainText('左键处决');
await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.5);
// 页面保持暂停，真实鼠标事件写入输入后，精确推进一帧捕获动作开始。
await page.mouse.down();
const execution = await page.evaluate(() => window.__DEBUG__.step(1));
await page.mouse.up();
expect(execution.ripostes).toBe(1);
expect(execution.riposte.ticksRemaining).toBe(47);
await expect(page.locator('.combat-hint')).toContainText('致命处决');
const completed = await page.evaluate(() => {
  const debug = window.__DEBUG__;
  const end = debug.getState().combatTick + 47;
  for (let tick = 0; tick < 100 && debug.getState().combatTick < end; tick++) debug.step(1);
  return debug.getState();
});
expect(completed.phase).toBe('reward');
expect(completed.riposte.ticksRemaining).toBe(0);
expect(completed.kills).toBe(1);
expect(completed.damageDealt).toBe(100);
globalThis.controlStage = '大剑连段与精力';
await page.evaluate(() => window.__DEBUG__.reset({ seed: 42, roomId: 'training-room' }));
await page.mouse.down();
const slash = await page.evaluate(() => window.__DEBUG__.step(1));
expect(slash.weapon).toBe('greatsword');
expect(slash.swing.move).toBe(0);
expect(slash.stamina).toBe(86);
const combo = await page.evaluate(() => window.__DEBUG__.step(55));
expect(combo.swing.move).toBe(2);
expect(combo.stamina).toBe(48);
await page.mouse.up();
await page.evaluate(() => window.__DEBUG__.step(40));
await page.keyboard.down('e');
const charge = await page.evaluate(() => window.__DEBUG__.step(60));
expect(charge.chargeTicks).toBe(60);
await page.keyboard.up('e');
const heavy = await page.evaluate(() => window.__DEBUG__.step(1));
expect(heavy.swing.move).toBe(3);
expect(heavy.swing.damage).toBe(150);
expect(heavy.stamina).toBe(20);
await expect(page.getByRole('meter', { name: '精力' })).toHaveAttribute('aria-valuenow', '20');
await page.evaluate(() => window.__DEBUG__.step(50));
await page.keyboard.press('q');
expect((await page.evaluate(() => window.__DEBUG__.getState())).weapon).toBe('focus');
await page.keyboard.press('q');
expect((await page.evaluate(() => window.__DEBUG__.getState())).weapon).toBe('greatsword');
return {
  browserMatchesBun: true,
  splitStepMatches: true,
  pausedStateFrozen: true,
  rewardClick: rewarded.room.id,
  keyboardMoved: true,
  keyboardDashed: true,
  mouseFired: true,
  keyboardCharged: inputState.projectiles.some((bullet) => bullet.kind === 1),
  fullJourneyMatchesBun: true,
  kills: journey.actual.kills,
  journeyTicks: journey.actual.tick,
  stanceBreak: true,
  mouseRiposte: true,
  executionCompleted: true,
  mouseSwordCombo: true,
  keyboardHeavySlash: true,
  staminaHud: true,
  keyboardWeaponSwitch: true,
};
