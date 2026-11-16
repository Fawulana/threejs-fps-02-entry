// Tactics director: picks Ember's strategy, assigns roles, runs executes, fakes and
// retakes, and runs bot economy (credits/streaks/eco). Steers bots only through
// fields bots.js honours, so no bot breaks its own perception rules.
const STRATEGIES = ['rush', 'split', 'fake', 'default'];
const EXECUTE_AT = { rush: 3, split: 8, fake: 6, default: 14 };

export function createTactics({ bots, world, rng, hooks }) {
  let strategy = 'default';
  let site = 'A';
  let liveTime = 0;
  let executed = false;
  let faked = false;
  let retakeStage = 0; // 0 idle, 1 grouping, 2 pushing
  let retakeAt = 0;
  let stagePoint = null;
  let prevScoreV = 0;
  let prevScoreE = 0;
  let streakV = 0;
  let streakE = 0;
  const credits = new Map();

  function nodeNear(x, z) {
    const node = world.nodes[world.nearestNode(x, z)];
    return { x: node.x, z: node.z };
  }

  function sitePoint(key, dx, dz) {
    const s = world.sites[key];
    return nodeNear(s.x + dx, s.z + dz);
  }

  function economy(bot, round, wonLast, streak) {
    // Credits mirror the player's rewards; two straight losses force an eco round.
    const had = credits.get(bot) ?? 800;
    const now = Math.min(16000, had + (round === 1 ? 0 : wonLast ? 3250 : 1900 + Math.min(3, streak) * 500));
    credits.set(bot, now);
    const eco = streak >= 2 && now < 3500;
    let weaponId = 'pistol';
    let armour = 0;
    if (!eco && round >= 3 && now >= 2700) { weaponId = 'rifle'; armour = round >= 4 ? 100 : 50; }
    else if (!eco && now >= 1500) { weaponId = 'smg'; armour = 50; }
    if (bot.team === 'ember' && bot.index === 3 && !eco && round >= 4 && now >= 4750) weaponId = 'sniper';
    bot.weaponId = weaponId;
    bot.armour = armour;
    bot.utility = eco
      ? { flash: 0, smoke: 0 }
      : { flash: bot.role === 'support' || bot.role === 'entry' ? 1 : 0, smoke: bot.role === 'support' ? 1 : 0 };
    return { weaponId, armour, eco };
  }

  function planRound(round, sitePick, carrier, scoreV, scoreE) {
    site = sitePick;
    liveTime = 0;
    executed = false;
    faked = false;
    retakeStage = 0;
    stagePoint = null;
    // Streaks are read off the scoreboard: whoever scored since the last plan won.
    if (scoreE > prevScoreE) { streakE += 1; streakV = 0; } else if (scoreV > prevScoreV) { streakV += 1; streakE = 0; }
    prevScoreV = scoreV;
    prevScoreE = scoreE;
    strategy = round === 1 ? 'default' : rng.pick(STRATEGIES);
    const other = site === 'A' ? 'B' : 'A';
    const ember = bots.list.filter((b) => b.team === 'ember');
    const vang = bots.list.filter((b) => b.team === 'vanguard');
    const roles = ['entry', 'support', 'lurk', 'support'];
    let ri = 0;
    for (const bot of ember) {
      bot.role = bot === carrier ? 'carrier' : roles[ri++ % roles.length];
      economy(bot, round, scoreE > 0 && streakE > 0, streakE);
    }
    const vRoles = ['anchorA', 'anchorB', 'roamer', 'rotator'];
    vang.forEach((bot, i) => {
      bot.role = vRoles[i % vRoles.length];
      economy(bot, round, scoreV > 0 && streakV > 0, streakV);
    });
    // Staging: Ember gathers on its approach lanes and holds until the execute
    // clock fires; the lurker starts toward the far lane for the split/fake.
    const holdUntil = hooks.now() + 12 + EXECUTE_AT[strategy];
    for (const bot of ember) {
      bot.holdUntil = holdUntil;
      if (strategy === 'fake') bot.assignedGoal = sitePoint(other, 0, 5);
      else if (bot.role === 'lurk') bot.assignedGoal = sitePoint(other, 0, 6);
      else if (bot.role === 'carrier') bot.assignedGoal = sitePoint(site, 0, 6);
      else bot.assignedGoal = sitePoint(site, bot.role === 'entry' ? -3 : 3, 5);
    }
    for (const bot of vang) {
      bot.holdUntil = 0;
      bot.assignedGoal = null;
    }
  }

  function throwUtility(bot, kind, tx, tz) {
    if (!bot.alive || !bot.utility || bot.utility[kind] <= 0) return;
    bot.utility[kind] -= 1;
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const from = { x: bot.pos.x, y: bot.pos.y + 1.5, z: bot.pos.z };
    const dir = { x: dx / len, y: 0.45, z: dz / len };
    if (kind === 'smoke') hooks.throwSmoke(from, dir, bot.team);
    else hooks.throwFlash(from, dir, bot.team);
  }

  function execute() {
    executed = true;
    const ember = bots.list.filter((b) => b.team === 'ember' && b.alive);
    const s = world.sites[site];
    for (const bot of ember) {
      bot.holdUntil = 0;
      bot.assignedGoal = sitePoint(site, bot.role === 'entry' ? -2 : bot.role === 'lurk' ? 4 : 0, bot.role === 'carrier' ? 0 : 2);
    }
    const support = ember.find((b) => b.role === 'support');
    const entry = ember.find((b) => b.role === 'entry');
    if (support) throwUtility(support, 'smoke', s.x, s.z + 3);
    if (entry) throwUtility(entry, 'flash', s.x, s.z);
    hooks.onCallout(`EXECUTE — Ember hits Site ${site}`, 'ember');
  }

  function rotateFake() {
    faked = true;
    const s = world.sites[site];
    for (const bot of bots.list) {
      if (bot.team !== 'ember' || !bot.alive) continue;
      bot.holdUntil = 0;
      bot.assignedGoal = sitePoint(site, 0, 3);
    }
    hooks.onCallout(`FAKE — Ember rotates to Site ${site}`, 'ember');
  }

  function startRetake() {
    retakeStage = 1;
    retakeAt = hooks.now();
    const s = world.sites[site];
    stagePoint = nodeNear(s.x * 0.45, (s.z + 15) / 2);
    for (const bot of bots.list) {
      if (bot.team !== 'vanguard' || !bot.alive) continue;
      bot.assignedGoal = stagePoint;
      bot.holdUntil = hooks.now() + 3.5;
    }
    hooks.onCallout('RETAKE — Vanguard grouping up', 'vanguard');
  }

  function pushRetake() {
    retakeStage = 2;
    const s = world.sites[site];
    let flasher = null;
    let best = Infinity;
    for (const bot of bots.list) {
      if (bot.team !== 'vanguard' || !bot.alive) continue;
      bot.holdUntil = 0;
      bot.assignedGoal = sitePoint(site, 0, 1);
      const d = Math.hypot(bot.pos.x - s.x, bot.pos.z - s.z);
      if (d < best) { best = d; flasher = bot; }
    }
    if (flasher) {
      flasher.utility = flasher.utility || { flash: 0, smoke: 0 };
      flasher.utility.flash = Math.max(1, flasher.utility.flash);
      throwUtility(flasher, 'flash', s.x, s.z);
    }
    hooks.onCallout(`RETAKE — pushing Site ${site}`, 'vanguard');
  }

  function update(dt, bombState) {
    liveTime += dt;
    if (bombState === 'carried' || bombState === 'none') {
      if (!executed && liveTime >= EXECUTE_AT[strategy]) execute();
      if (strategy === 'fake' && executed && !faked && liveTime >= 16) rotateFake();
      // The carrier's death re-plans the push: the new carrier inherits the site goal.
      const carrier = bots.list.find((b) => b.carrier && b.alive);
      if (carrier && carrier.role !== 'carrier') {
        carrier.role = 'carrier';
        carrier.assignedGoal = sitePoint(site, 0, 0);
      }
    }
    if (bombState === 'planted' && retakeStage === 0) startRetake();
    if (retakeStage === 1 && stagePoint) {
      const grouped = bots.list.filter((b) => b.team === 'vanguard' && b.alive
        && Math.hypot(b.pos.x - stagePoint.x, b.pos.z - stagePoint.z) < 6).length;
      if (grouped >= 2 || hooks.now() - retakeAt > 6) pushRetake();
    }
  }

  return {
    planRound,
    update,
    describe() {
      return {
        strategy,
        site,
        roles: bots.list.map((b) => `${b.name}:${b.role || '-'}:${b.weaponId}${b.armour ? `+${b.armour}` : ''}`),
      };
    },
  };
}
