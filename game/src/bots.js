// The bots: four Vanguard teammates and five Ember opponents, each a visible body
// with a health bar, a weapon and a job. A state machine — patrol, engage, retreat,
// plant, defuse, hold — runs over the map's waypoint graph, with line-of-sight checks,
// burst fire with real spread, and a memory of where enemies were last seen or heard.
// Ember attacks: one bot carries the bomb to a site and plants it. Vanguard defends,
// then converges to defuse. The tactics director assigns roles and timed orders.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS } from './weapons.js';

const VANGUARD_NAMES = ['Mira', 'Juno', 'Kestrel', 'Bram'];
const EMBER_NAMES = ['Ash', 'Vex', 'Rook', 'Sable', 'Dagger'];
const BOT_SPEED = 3.6;
const RETREAT_SPEED = 4.6;
const SIGHT_RANGE = 42;
const BURST_MIN = 3;
const BURST_MAX = 5;

function healthBarSprite(colour) {
  const material = new THREE.SpriteMaterial({ color: new THREE.Color(colour), depthTest: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.62, 0.07, 1);
  return sprite;
}

function buildBody(team) {
  const colour = team === 'vanguard' ? PALETTE.vanguard : PALETTE.ember;
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const vest = new THREE.MeshStandardMaterial({ color: new THREE.Color(colour), roughness: 0.6, metalness: 0.1 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.18), cloth);
  legL.position.set(-0.12, 0.31, 0);
  const legR = legL.clone();
  legR.position.x = 0.12;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.72, 0.3), vest);
  torso.position.y = 1.0;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), skin);
  head.position.y = 1.52;
  head.userData.part = 'head';
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.36), new THREE.MeshStandardMaterial({ color: new THREE.Color(colour), roughness: 0.5 }));
  band.position.y = 1.58;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), cloth);
  gun.position.set(0.2, 1.12, -0.28);
  // Arms swing with the walk cycle; the pack marks the bomb carrier at a glance.
  const armGeo = new THREE.BoxGeometry(0.11, 0.56, 0.13);
  armGeo.translate(0, -0.28, 0);
  const armL = new THREE.Mesh(armGeo, cloth);
  armL.position.set(-0.33, 1.32, 0);
  const armR = armL.clone();
  armR.position.x = 0.33;
  armR.rotation.x = -0.9;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.44, 0.18), vest);
  pack.position.set(0, 1.05, 0.24);
  pack.visible = false;
  const barBg = healthBarSprite('#111417');
  barBg.position.y = 1.92;
  barBg.scale.set(0.66, 0.09, 1);
  const barFg = healthBarSprite(colour);
  barFg.position.y = 1.92;
  barFg.renderOrder = 2;
  group.add(legL, legR, torso, head, band, gun, barBg, barFg, armL, armR, pack);
  group.traverse((mesh) => {
    if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
  });
  return { group, torso, head, barFg, legL, legR, armL, armR, pack };
}

export function createBots(scene, world, rng) {
  const list = [];
  const hitMeshes = [];

  function makeBot(team, name, index) {
    const body = buildBody(team);
    scene.add(body.group);
    const bot = {
      name, team, index,
      group: body.group, torso: body.torso, head: body.head, barFg: body.barFg,
      legL: body.legL, legR: body.legR, armL: body.armL, armR: body.armR, pack: body.pack,
      pos: new THREE.Vector3(0, 0, 15),
      velocity: new THREE.Vector3(),
      yaw: 0, health: 100, alive: true, armour: 0,
      role: null, utility: { flash: 0, smoke: 0 }, assignedGoal: null, holdUntil: 0,
      state: 'patrol', weaponId: 'smg',
      path: [], pathIndex: 0, goal: null,
      thinkAt: rng.range(0, 0.2), repathAt: 0,
      target: null, lastSeen: null, lastSeenAt: -99,
      burstLeft: 0, nextShotAt: 0, burstGapAt: 0,
      strafeDir: 1, strafeAt: 0,
      carrier: false, channel: 0, channelKind: null,
      fall: 0, heardAt: -99, heardPos: { x: 0, z: 0 }, blindUntil: 0,
      stuckAt: 0, stuckDist: 0, clock: 0,
    };
    body.torso.userData.bot = bot;
    body.head.userData.bot = bot;
    hitMeshes.push(body.torso, body.head);
    return bot;
  }
  VANGUARD_NAMES.forEach((name, i) => list.push(makeBot('vanguard', name, i)));
  EMBER_NAMES.forEach((name, i) => list.push(makeBot('ember', name, i)));

  function resetBot(bot, x, z, yaw, weaponId) {
    bot.pos.set(x, 0, z);
    bot.velocity.set(0, 0, 0);
    bot.yaw = yaw;
    bot.health = 100;
    bot.alive = true;
    bot.armour = 0;
    bot.role = null;
    bot.utility = { flash: 0, smoke: 0 };
    bot.assignedGoal = null;
    bot.holdUntil = 0;
    bot.pack.visible = false;
    bot.state = 'patrol';
    bot.weaponId = weaponId;
    bot.path = [];
    bot.pathIndex = 0;
    bot.goal = null;
    bot.target = null;
    bot.lastSeen = null;
    bot.carrier = false;
    bot.channel = 0;
    bot.channelKind = null;
    bot.fall = 0;
    bot.stuckAt = 0;
    bot.stuckDist = 0;
    bot.blindUntil = 0;
    bot.heardAt = -99;
    bot.group.rotation.set(0, yaw, 0);
    bot.group.position.copy(bot.pos);
    bot.group.visible = true;
    bot.barFg.visible = true;
    bot.barFg.scale.x = 0.62;
  }

  function spawnRound(roundNumber) {
    const emberWeapon = roundNumber >= 3 ? 'rifle' : roundNumber === 2 ? 'smg' : 'pistol';
    const vangWeapon = roundNumber >= 3 ? 'rifle' : roundNumber === 2 ? 'smg' : 'pistol';
    list.forEach((bot) => {
      const spawns = bot.team === 'vanguard' ? world.spawns.vanguard : world.spawns.ember;
      const [x, z] = spawns[bot.index % spawns.length];
      resetBot(bot, x, z, bot.team === 'vanguard' ? Math.PI : 0, bot.team === 'ember' ? emberWeapon : vangWeapon);
    });
    // The bomb goes to a random Ember bot, and the site is picked for the round.
    const ember = list.filter((b) => b.team === 'ember');
    const carrier = rng.pick(ember);
    carrier.carrier = true;
    return { carrier, site: rng.pick(['A', 'B']) };
  }

  function setPath(bot, x, z) {
    bot.path = world.findPath(bot.pos.x, bot.pos.z, x, z);
    bot.pathIndex = 0;
    bot.goal = { x, z };
  }

  function followPath(bot, dt, speed, moveBody) {
    if (!bot.path.length || bot.pathIndex >= bot.path.length) return true;
    const node = world.nodes[bot.path[bot.pathIndex]];
    const dx = node.x - bot.pos.x;
    const dz = node.z - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) {
      bot.pathIndex += 1;
      bot.stuckAt = 0;
      return bot.pathIndex >= bot.path.length;
    }
    // Stuck against something the graph did not foresee: after 1.5 s without closing
    // on the node, re-plan from wherever the bot actually is.
    if (!bot.stuckAt) {
      bot.stuckAt = bot.clock;
      bot.stuckDist = dist;
    } else if (bot.clock - bot.stuckAt > 1.5) {
      if (dist > bot.stuckDist - 0.2 && bot.goal) setPath(bot, bot.goal.x, bot.goal.z);
      bot.stuckAt = 0;
    }
    const nx = dx / dist;
    const nz = dz / dist;
    bot.yaw = Math.atan2(nx, nz);
    moveBody(bot.pos, bot.velocity, nx, nz, speed, dt);
    return false;
  }

  function visibleEnemy(bot, ctx) {
    // Nearest living enemy with line of sight, or null. A flash-blinded bot sees
    // nothing; smoke blocks sight through ctx.hasLOS.
    if (ctx.isBlinded && ctx.isBlinded(bot)) return null;
    const eyeY = bot.pos.y + 1.45;
    const facingX = Math.sin(bot.yaw);
    const facingZ = Math.cos(bot.yaw);
    let best = null;
    let bestDist = SIGHT_RANGE;
    for (let i = 0; i <= list.length; i += 1) {
      let kind;
      let ref;
      let ex;
      let ey;
      let ez;
      if (i === 0) {
        // The player fights for Vanguard, so only Ember bots count the player as
        // an enemy; Vanguard bots must never target (or shoot) their teammate.
        if (bot.team !== 'ember' || !ctx.player.alive) continue;
        kind = 'player';
        ref = ctx.player;
        ex = ctx.player.position.x;
        ey = ctx.player.position.y + 1.2;
        ez = ctx.player.position.z;
      } else {
        const other = list[i - 1];
        if (other.team === bot.team || !other.alive) continue;
        kind = 'bot';
        ref = other;
        ex = other.pos.x;
        ey = other.pos.y + 1.2;
        ez = other.pos.z;
      }
      const dx = ex - bot.pos.x;
      const dy = ey - eyeY;
      const dz = ez - bot.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > bestDist) continue;
      // Must be roughly in front, unless the bot was just alerted from behind.
      const dot = (dx * facingX + dz * facingZ) / (dist || 1);
      if (dot < -0.15 && ctx.time - bot.heardAt > 1) continue;
      if (!ctx.hasLOS(bot.pos.x, eyeY, bot.pos.z, ex, ey, ez)) continue;
      best = { kind, ref, x: ex, y: ey, z: ez };
      bestDist = dist;
    }
    return best;
  }

  function hearNoise(x, z, radius, sourceTeam, time) {
    // Gunfire and explosions carry: bots of the other team within earshot turn
    // toward the sound and remember the spot to investigate.
    for (const bot of list) {
      if (!bot.alive || bot.team === sourceTeam) continue;
      if (Math.hypot(bot.pos.x - x, bot.pos.z - z) > radius) continue;
      bot.heardAt = time;
      bot.heardPos.x = x;
      bot.heardPos.z = z;
    }
  }

  function damage(bot, amount, killer, killerName, ctx) {
    if (!bot.alive) return false;
    // Bought armour absorbs half of every hit until it breaks, as the player's does.
    if (bot.armour > 0) {
      const absorbed = Math.min(bot.armour, amount * 0.5);
      bot.armour -= absorbed;
      amount -= absorbed;
    }
    bot.health -= amount;
    bot.barFg.scale.x = Math.max(0.02, 0.62 * (bot.health / 100));
    bot.barFg.material.color.setHex(bot.health > 50 ? 0x7fd08a : bot.health > 25 ? 0xf0a830 : 0xe5484d);
    if (bot.health > 0) {
      // Being shot makes a bot turn toward the shooter and remember the spot.
      bot.heardAt = ctx.time;
      if (killer === 'player') {
        bot.heardPos.x = ctx.player.position.x;
        bot.heardPos.z = ctx.player.position.z;
      }
      return false;
    }
    bot.alive = false;
    bot.fall = 0;
    bot.channel = 0;
    bot.channelKind = null;
    bot.barFg.visible = false;
    ctx.onBotKilled(bot, killer, killerName);
    return true;
  }

  function stepBot(bot, dt, ctx) {
    bot.clock = ctx.time;
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.group.rotation.x = -bot.fall * 1.5;
      bot.group.position.y = -bot.fall * 0.15;
      return;
    }
    const bomb = ctx.bomb;
    if (ctx.isBlinded && ctx.isBlinded(bot)) {
      // Flash-blind: hold still, form no new orders and fire nothing until sight
      // returns. The think tick is skipped too, so a blinded bot cannot re-plan
      // around what it cannot see.
      bot.group.position.copy(bot.pos);
      bot.group.rotation.set(0, bot.yaw, 0);
      return;
    }
    // Periodic thinking: re-perceive, re-path, pick a job.
    if (ctx.time >= bot.thinkAt) {
      bot.thinkAt = ctx.time + 0.18 + rng.range(0, 0.06);
      const seen = visibleEnemy(bot, ctx);
      if (seen) {
        bot.target = seen;
        bot.lastSeen = { x: seen.x, y: seen.y, z: seen.z, kind: seen.kind, ref: seen.ref };
        bot.lastSeenAt = ctx.time;
      } else if (bot.target && ctx.time - bot.lastSeenAt > 3) {
        bot.target = null;
      }
      // A dead target is dropped at once, not after the three-second memory.
      if (bot.target) {
        const dead = bot.target.kind === 'player' ? !ctx.player.alive : !bot.target.ref.alive;
        if (dead) bot.target = null;
      }
      // Director's orders: a reached assigned goal is done, and a bot held for a
      // timed execute walks to staging but picks no other job until the hold
      // releases — unless it sees an enemy, which overrides all.
      if (bot.assignedGoal && Math.hypot(bot.pos.x - bot.assignedGoal.x, bot.pos.z - bot.assignedGoal.z) < 1.2) {
        bot.assignedGoal = null;
      }
      const holding = ctx.time < bot.holdUntil && !bot.target;
      if (holding && bot.assignedGoal && !bot.path.length) setPath(bot, bot.assignedGoal.x, bot.assignedGoal.z);
      if (!holding) {
      // Job selection.
      if (bot.health < 30 && bot.state !== 'retreat') {
        bot.state = 'retreat';
        const home = bot.team === 'vanguard' ? world.spawns.vanguard[0] : world.spawns.ember[0];
        setPath(bot, home[0] + rng.range(-2, 2), home[1] + rng.range(-2, 2));
      } else if (bot.team === 'ember' && bot.carrier && bomb.state === 'carried') {
        const site = world.sites[bomb.site];
        if (Math.hypot(bot.pos.x - site.x, bot.pos.z - site.z) < 2.6) {
          bot.state = 'plant';
        } else if (bot.state !== 'plant') {
          bot.state = 'patrol';
          if (ctx.time >= bot.repathAt) {
            bot.repathAt = ctx.time + 1.5;
            setPath(bot, site.x, site.z);
          }
        }
      } else if (bot.team === 'ember' && bomb.state === 'planted') {
        bot.state = 'hold';
        if (ctx.time >= bot.repathAt) {
          bot.repathAt = ctx.time + 2;
          if (bot.assignedGoal) setPath(bot, bot.assignedGoal.x, bot.assignedGoal.z);
          else {
            const site = world.sites[bomb.site];
            setPath(bot, site.x + rng.range(-4, 4), site.z + rng.range(-3, 3));
          }
        }
      } else if (bot.team === 'ember') {
        bot.state = 'patrol';
        if (ctx.time >= bot.repathAt) {
          bot.repathAt = ctx.time + 1.5;
          if (bot.assignedGoal) setPath(bot, bot.assignedGoal.x, bot.assignedGoal.z);
          else {
            const carrier = list.find((b) => b.carrier && b.alive);
            if (carrier) setPath(bot, carrier.pos.x + rng.range(-3, 3), carrier.pos.z + rng.range(-3, 3));
            else {
              const site = world.sites[bomb.site];
              setPath(bot, site.x + rng.range(-4, 4), site.z + rng.range(-4, 4));
            }
          }
        }
      } else if (bomb.state === 'planted') {
        // Vanguard converges on the planted bomb; the closest bot defuses, found
        // with one linear scan instead of a filter-and-sort every think tick.
        const site = world.sites[bomb.site];
        const dist = Math.hypot(bot.pos.x - bomb.x, bot.pos.z - bomb.z);
        let closest = null;
        let closestDist = Infinity;
        for (const mate of list) {
          if (mate.team !== 'vanguard' || !mate.alive) continue;
          const mateDist = Math.hypot(mate.pos.x - bomb.x, mate.pos.z - bomb.z);
          if (mateDist < closestDist) { closestDist = mateDist; closest = mate; }
        }
        if (closest === bot && dist < 2.4 && !bot.target) bot.state = 'defuse';
        else {
          bot.state = 'patrol';
          if (ctx.time >= bot.repathAt) {
            bot.repathAt = ctx.time + 1.2;
            if (bot.assignedGoal) setPath(bot, bot.assignedGoal.x, bot.assignedGoal.z);
            else setPath(bot, site.x + rng.range(-3, 3), site.z + rng.range(-3, 3));
          }
        }
      } else {
        // Vanguard holds: two at each site, one roaming mid.
        bot.state = 'patrol';
        if (ctx.time >= bot.repathAt) {
          bot.repathAt = ctx.time + 2;
          if (bot.assignedGoal) setPath(bot, bot.assignedGoal.x, bot.assignedGoal.z);
          else {
            const siteKey = bot.index % 2 === 0 ? 'A' : 'B';
            const site = world.sites[siteKey];
            if (bot.index === 3) setPath(bot, rng.range(-3, 3), rng.range(-4, 4));
            else setPath(bot, site.x + rng.range(-3, 3), site.z + rng.range(-2, 4));
          }
        }
      }
      // Lost sight but remembers where: push to the last seen position instead of
      // wandering back to a hold, so a bot that saw you comes looking for you.
      // The bomb carrier is exempt: the objective outranks investigating.
      const carrierOnMission = bot.carrier && bomb.state === 'carried';
      if (!bot.target && bot.lastSeen && ctx.time - bot.lastSeenAt < 6 && bot.state === 'patrol'
        && !carrierOnMission && ctx.time >= bot.repathAt) {
        bot.repathAt = ctx.time + 1.5;
        setPath(bot, bot.lastSeen.x, bot.lastSeen.z);
      }
      // A shot heard nearby pulls a patrolling bot to investigate; fresh sound
      // wins over the older last-seen position, so this runs second.
      if (bot.state === 'patrol' && ctx.time - bot.heardAt < 2.5 && !bot.target && !carrierOnMission) {
        setPath(bot, bot.heardPos.x, bot.heardPos.z);
        bot.heardAt = -99;
      }
      } // end !holding
    }

    // Channels: planting and defusing stand still and count up.
    if (bot.state === 'plant' && bomb.state === 'carried') {
      bot.channel += dt;
      ctx.onPlantProgress(bot, bot.channel);
      return;
    }
    if (bot.state === 'defuse' && bomb.state === 'planted') {
      bot.channel += dt;
      ctx.onDefuseProgress(bot, bot.channel);
      return;
    }
    bot.channel = 0;

    // Engage: face the target, keep a fighting distance, fire in bursts. The aim
    // point is the remembered position (lastSeen), which the bot owns outright.
    if (bot.target && bot.lastSeen && bot.state !== 'retreat') {
      const t = bot.target;
      const tx = bot.lastSeen.x;
      const ty = bot.lastSeen.y;
      const tz = bot.lastSeen.z;
      const dx = tx - bot.pos.x;
      const dz = tz - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      bot.yaw = Math.atan2(dx, dz);
      if (ctx.time >= bot.strafeAt) {
        bot.strafeAt = ctx.time + rng.range(0.5, 1.1);
        bot.strafeDir = rng.chance(0.5) ? 1 : -1;
      }
      // Strafe sideways, close in when far, back off when point-blank.
      let mx = 0;
      let mz = 0;
      const fx = Math.sin(bot.yaw);
      const fz = Math.cos(bot.yaw);
      if (dist > 20) { mx = fx; mz = fz; }
      else if (dist < 5) { mx = -fx; mz = -fz; }
      mx += -fz * bot.strafeDir * 0.7;
      mz += fx * bot.strafeDir * 0.7;
      const len = Math.hypot(mx, mz) || 1;
      ctx.moveBody(bot.pos, bot.velocity, mx / len, mz / len, BOT_SPEED * 0.7, dt);
      // Fire bursts at the chest, sometimes the head, with distance-scaled error.
      if (ctx.time >= bot.nextShotAt) {
        if (bot.burstLeft <= 0) {
          bot.burstLeft = rng.int(BURST_MIN, BURST_MAX);
          bot.nextShotAt = ctx.time + rng.range(0.7, 1.3);
        } else {
          bot.burstLeft -= 1;
          bot.nextShotAt = ctx.time + 0.11;
          const def = WEAPONS[bot.weaponId];
          const aimY = rng.chance(0.18) ? ty + 0.32 : ty;
          const error = 0.03 + dist * 0.0013 + (t.kind === 'player' && ctx.playerSpeed > 3 ? 0.02 : 0);
          ctx.botShot(bot, tx, aimY, tz, error, def);
        }
      }
    } else if (bot.state === 'retreat') {
      followPath(bot, dt, RETREAT_SPEED, ctx.moveBody);
      if (bot.pathIndex >= bot.path.length && bot.health < 30) bot.state = 'patrol';
    } else if (bot.state === 'hold') {
      if (bot.path.length && bot.pathIndex < bot.path.length) followPath(bot, dt, BOT_SPEED * 0.6, ctx.moveBody);
    } else {
      followPath(bot, dt, BOT_SPEED, ctx.moveBody);
    }

    bot.group.position.copy(bot.pos);
    bot.group.rotation.set(0, bot.yaw, 0);
    bot.pack.visible = bot.carrier;
    // Walk cycle: legs and arms swing in opposition, with a small bob, so a
    // moving bot reads as moving and a holding bot stands still.
    const speed = Math.hypot(bot.velocity.x, bot.velocity.z);
    if (speed > 0.5) {
      const phase = ctx.time * 9;
      const swing = Math.sin(phase) * 0.55;
      bot.legL.rotation.x = swing;
      bot.legR.rotation.x = -swing;
      bot.armL.rotation.x = -swing * 0.8;
      bot.armR.rotation.x = -0.9 + swing * 0.3;
      bot.group.position.y = Math.abs(Math.sin(phase)) * 0.04;
    } else {
      bot.legL.rotation.x = 0;
      bot.legR.rotation.x = 0;
      bot.armL.rotation.x = 0;
      bot.armR.rotation.x = -0.9;
      bot.group.position.y = 0;
    }
  }

  return {
    list,
    hitMeshes,
    spawnRound,
    damage,
    hearNoise,
    step(dt, ctx) {
      for (const bot of list) stepBot(bot, dt, ctx);
    },
    aliveCount(team) {
      return list.filter((b) => b.team === team && b.alive).length;
    },
    resetAll() {
      for (const bot of list) {
        bot.group.visible = false;
        bot.alive = false;
      }
    },
  };
}
