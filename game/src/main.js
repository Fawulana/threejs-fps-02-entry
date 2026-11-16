// DUSTLINE — boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. ?shot=start|play|buy|end with &seed=N stages a deterministic frame,
// renders it twice, freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeRng } from './rng.js';
import { createAudio } from './audio.js';
import { createTactics } from './tactics.js';
import { buildMap } from './map.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { createWeapon, WEAPONS } from './weapons.js';
import { createBots } from './bots.js';
import { createCombat } from './combat.js';
import { createGrenades } from './grenades.js';
import { createMinimap } from './minimap.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = makeRng(seed);

// A load error must be visible to a headless play-test, not just the console.
window.addEventListener('error', (event) => {
  const el = document.createElement('div');
  el.id = 'game-error';
  el.textContent = String(event.message || event.error);
  document.body.appendChild(el);
});

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1c2637');
scene.fog = new THREE.Fog(new THREE.Color('#1c2637'), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const audio = createAudio();
const world = buildMap(scene);
const hud = createHud();
const player = createPlayer(world.colliders);
const weapon = createWeapon(camera);
const input = createInput(renderer.domElement, onLockChange);
const bots = createBots(scene, world, rng);
const body = player.state;

// The tactics director is created after the grenades (it throws through them) but
// rounds need its hook from the start, so the binding is late and guarded.
let tactics = null;
const rounds = createRounds({
  hud,
  audio,
  player: body,
  resetPlayer: (x, z, yaw) => player.reset(x, z, yaw),
  bots,
  weapon,
  world,
  combatBlast: (x, z) => combat.blastAt(x, z),
  onRoundPlanned: (round, site, carrier, scoreV, scoreE) => {
    if (tactics) tactics.planRound(round, site, carrier, scoreV, scoreE);
  },
});

// The bomb the carrier wears: a blinking charge, visible on the carrier's back
// while carried and on the ground once planted.
const bombMesh = new THREE.Group();
const bombBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.2, 0.24),
  new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2e33'), roughness: 0.5, metalness: 0.5 }),
);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 6),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.danger) }),
);
bombLight.position.set(0, 0.14, 0);
bombMesh.add(bombBody, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

// Sight runs through one wrapper: walls and smoke clouds both block it, so bot
// perception, flash checks and the minimap's enemy dots all agree on visibility.
let grenades = null;
function hasSight(x1, y1, z1, x2, y2, z2) {
  if (grenades && grenades.blocksSight(x1, y1, z1, x2, y2, z2)) return false;
  return combat.hasLOS(x1, y1, z1, x2, y2, z2);
}

// The context the bots read every step: the player, the bomb, line of sight, and
// the callbacks that let them shoot, plant and defuse. Built once, read live.
const bombView = { state: 'none', site: 'A', x: 0, z: 0 };
const botCtx = {
  time: 0,
  player: body,
  playerSpeed: 0,
  bomb: bombView,
  hasLOS: hasSight,
  isBlinded: (bot) => grenades !== null && grenades.isBlinded(bot),
  moveBody: (pos, vel, wx, wz, speed, dt) => player.moveBody(pos, vel, wx, wz, speed, dt),
  botShot: (bot, tx, ty, tz, error, def) => combat.botShot(bot, tx, ty, tz, error, def),
  onBotKilled: (bot, killer, killerName) => onBotKilled(bot, killer, killerName),
  onPlantProgress: (bot, channel) => rounds.onPlantProgress(bot, channel),
  onDefuseProgress: (bot, channel) => rounds.onDefuseProgress(bot, channel),
};

const combat = createCombat(scene, world, rng, {
  bots,
  player: body,
  damageBot: (bot, amount, killer, killerName) => damageBot(bot, amount, killer, killerName),
  damagePlayer: (amount, from) => damagePlayer(amount, from),
  onBotShot: (dist) => { if (dist < 16) audio.shot('rifle'); else audio.distantShot(); },
  onGrenadeThrow: () => audio.grenadePin(),
  onExplosion: (p) => {
    audio.explosion();
    if (p) bots.hearNoise(p.x, p.z, 30, 'vanguard', elapsed);
  },
});

grenades = createGrenades(scene, world, {
  player: body,
  bots,
  hasLOS: hasSight,
  onPin: () => audio.grenadePin(),
  onPop: () => { audio.shot('sniper'); audio.flashRing(); },
  onHiss: () => audio.smokeHiss(),
  onNoise: (x, z, radius) => bots.hearNoise(x, z, radius, 'vanguard', elapsed),
  onPlayerFlash: (strength) => { flashLevel = Math.max(flashLevel, strength); },
});

const minimap = createMinimap(document.getElementById('minimap'), world, {
  player: body,
  bots,
  bomb: bombView,
  smoke: grenades.clouds,
  seesEnemy: (bot) => {
    // An enemy dot appears only while the player has a live line of sight to them.
    if (!body.alive) return false;
    const dx = bot.pos.x - body.position.x;
    const dz = bot.pos.z - body.position.z;
    if (dx * dx + dz * dz > 35 * 35) return false;
    return hasSight(body.position.x, body.position.y + body.eye, body.position.z, bot.pos.x, bot.pos.y + 1.2, bot.pos.z);
  },
});

const cameraDir = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const rightV = new THREE.Vector3();
const upV = new THREE.Vector3(0, 1, 0);

let elapsed = 0;
let frozen = false;
let started = false;
let buyOpen = false;
let boardShown = false;
let flashLevel = 0;
let mapTimer = 0;
let prevPhase = 'menu';
let accumulator = 0;
let lastTime = performance.now();
const damageLog = [];

// Match stats for the Tab scoreboard: kills and deaths per name, reset each match.
const stats = new Map();
function statFor(name) {
  let s = stats.get(name);
  if (!s) {
    s = { kills: 0, deaths: 0 };
    stats.set(name, s);
  }
  return s;
}
function recordKill(killerName, victimName) {
  if (killerName) statFor(killerName).kills += 1;
  statFor(victimName).deaths += 1;
}

function refreshBoard() {
  const rows = (team, extra) => {
    const list = bots.list.filter((b) => b.team === team).map((b) => ({
      name: b.name, kills: statFor(b.name).kills, deaths: statFor(b.name).deaths, role: b.role || '',
    }));
    return extra ? [extra, ...list] : list;
  };
  const you = { name: 'You', kills: statFor('You').kills, deaths: statFor('You').deaths, role: 'player' };
  hud.setScoreboard(rows('vanguard', you), rows('ember'), rounds.state.history);
}

tactics = createTactics({
  bots,
  world,
  rng,
  hooks: {
    now: () => elapsed,
    onCallout: (text, team) => hud.callout(text, team),
    throwFlash: (from, dir, team) => grenades.throwFlash(new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(dir.x, dir.y, dir.z).normalize(), team),
    throwSmoke: (from, dir, team) => grenades.throwSmoke(new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(dir.x, dir.y, dir.z).normalize(), team),
  },
});

function damageBot(bot, amount, killer, killerName) {
  const killed = bots.damage(bot, amount, killer, killerName, botCtx);
  if (killer === 'player') {
    hud.hitMarker(killed, killed ? 260 : 90);
    audio.hit(killed);
    if (killed) {
      rounds.onKill('ember', true);
      hud.killfeed(`You ▸ ${bot.name}`, false);
      recordKill('You', bot.name);
    }
  }
  return killed;
}

function damagePlayer(amount, from) {
  if (!body.alive) return;
  damageLog.push({
    t: Math.round(elapsed * 100) / 100,
    amount,
    from: from ? [Math.round(from.x * 10) / 10, Math.round(from.y * 10) / 10, Math.round(from.z * 10) / 10] : null,
    bots: bots.list.map((b) => `${b.name}:${b.state}:${b.target ? b.target.kind : '-'}`),
  });
  if (damageLog.length > 50) damageLog.shift();
  const wasAlive = body.alive;
  player.damage(amount);
  hud.damageFlash();
  audio.hurt();
  hud.setHealth(body.health, body.armor);
  if (wasAlive && !body.alive) statFor('You').deaths += 1;
  if (!body.alive) {
    rounds.onPlayerDeath();
    hud.banner('YOU ARE DOWN', 'Your squad fights on — you return next round', 3200);
    if (document.pointerLockElement) document.exitPointerLock();
    hud.showOverlay('dead', null);
  }
}

function onBotKilled(bot, killer, killerName) {
  if (killer === 'player') return; // damageBot already reported it
  hud.killfeed(`${killerName || 'Ember'} ▸ ${bot.name}`, false);
  recordKill(killerName || 'Ember', bot.name);
  if (bot.team === 'vanguard' && killer === 'bot') {
    // A teammate falling to Ember fire.
  }
  if (bot.carrier && rounds.state.bomb === 'carried') {
    // The bomb drops with its carrier: the next living Ember bot picks it up.
    const next = bots.list.find((b) => b.team === 'ember' && b.alive);
    if (next) next.carrier = true;
    else rounds.state.bomb = 'none';
  }
}

function syncCamera() {
  if (!body.alive && rounds.state.phase === 'live') {
    // Spectate the first living teammate from just behind their shoulder.
    const mate = bots.list.find((b) => b.team === 'vanguard' && b.alive);
    if (mate) {
      camera.position.set(mate.pos.x, mate.pos.y + 1.7, mate.pos.z);
      camera.rotation.set(-0.12, mate.yaw + Math.PI, 0, 'YXZ');
      return;
    }
  }
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

const BASE_FOV = 74;
let currentFov = BASE_FOV;
function updateOptics() {
  // Aiming narrows the field of view by the weapon's zoom factor — the sniper's
  // 3.2x scope is a real scope, with its overlay ring and the view model hidden.
  const aiming = input.state.aiming && body.alive && rounds.state.phase !== 'menu';
  const def = weapon.def();
  const scoped = aiming && def.id === 'sniper';
  const targetFov = aiming ? BASE_FOV / def.zoom : BASE_FOV;
  currentFov += (targetFov - currentFov) * 0.35;
  if (Math.abs(currentFov - camera.fov) > 0.05) {
    camera.fov = currentFov;
    camera.updateProjectionMatrix();
  }
  hud.setScope(scoped);
  weapon.setModelHidden(scoped);
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shootPlayer() {
  const def = weapon.def();
  if (!weapon.takeRound()) {
    audio.dryFire();
    weapon.reload();
    return;
  }
  camera.getWorldDirection(cameraDir);
  rightV.crossVectors(cameraDir, upV).normalize();
  muzzle.copy(camera.position)
    .addScaledVector(cameraDir, 0.5)
    .addScaledVector(rightV, 0.24)
    .addScaledVector(upV, -0.15);
  const spread = weapon.spread(player.groundSpeed(), body.crouching, !body.onGround) * (input.state.aiming ? 0.45 : 1);
  const results = combat.shootPlayer(camera.position, cameraDir, def, spread, muzzle);
  let hitHead = false;
  for (const r of results) if (r.head) hitHead = true;
  if (hitHead) hud.hitMarker(false, 90);
  weapon.pullTrigger();
  audio.shot(def.id);
  bots.hearNoise(body.position.x, body.position.z, 20, 'vanguard', elapsed);
  player.recoil(0.009 + def.kick * 0.4 + rng.next() * 0.004, (rng.next() * 2 - 1) * 0.004);
  hud.setAmmo(weapon.ammo[weapon.state.current].mag, weapon.ammo[weapon.state.current].reserve);
  hud.setCrosshairSpread(4 + spread * 900);
}

function toggleBuy(open) {
  if (rounds.state.phase !== 'buy' && open) return;
  buyOpen = open;
  if (open) {
    hud.showBuy(true, rounds.state.money, ownedSet());
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    hud.showBuy(false, 0, new Set());
    if (started && body.alive && !shot) input.requestLock();
  }
}

function ownedSet() {
  const owned = new Set();
  for (const id of Object.keys(WEAPONS)) if (weapon.owned(id)) owned.add(id);
  if (rounds.state.hasKit) owned.add('kit');
  return owned;
}

function onPlayClick() {
  audio.resume();
  if (rounds.state.phase === 'menu') {
    rounds.startMatch();
    started = true;
    hud.hideOverlay();
    input.requestLock();
  } else if (rounds.state.phase === 'matchEnd') {
    rounds.startMatch();
    hud.hideOverlay();
    input.requestLock();
  } else {
    hud.hideOverlay();
    if (body.alive) input.requestLock();
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (buyOpen) toggleBuy(false);
  } else if (rounds.state.phase !== 'menu' && rounds.state.phase !== 'matchEnd' && !buyOpen) {
    if (body.alive) hud.showOverlay('paused', null);
    else hud.showOverlay('dead', null);
  }
}

hud.onPlay(onPlayClick);
hud.onBuy((id) => {
  if (id === 'grenade') rounds.tryBuyGrenade();
  else if (id === 'flash') rounds.tryBuyFlash();
  else if (id === 'smoke') rounds.tryBuySmoke();
  else if (id === 'kit') rounds.tryBuyKit();
  else if (id === 'armor') rounds.tryBuyArmor();
  else rounds.tryBuy(id);
  hud.showBuy(true, rounds.state.money, ownedSet());
});
document.getElementById('buy-close').addEventListener('click', () => toggleBuy(false));

function throwFromHand(kind) {
  // One throw path for all three grenade types; the HUD counts all three.
  if (rounds.state.phase !== 'live' || !body.alive) return;
  const ws = weapon.state;
  if (kind === 'frag' && ws.grenades <= 0) return;
  if (kind === 'flash' && ws.flashes <= 0) return;
  if (kind === 'smoke' && ws.smokes <= 0) return;
  camera.getWorldDirection(cameraDir);
  if (kind === 'frag') {
    ws.grenades -= 1;
    combat.throwGrenade(camera.position, cameraDir);
  } else if (kind === 'flash') {
    ws.flashes -= 1;
    grenades.throwFlash(camera.position, cameraDir);
  } else {
    ws.smokes -= 1;
    grenades.throwSmoke(camera.position, cameraDir);
  }
  hud.setGrenades(ws.grenades, ws.flashes, ws.smokes);
}

function handlePressed(pressed) {
  for (const code of pressed) {
    if (code === 'KeyR') weapon.reload();
    if (code === 'KeyB') toggleBuy(!buyOpen);
    if (code === 'KeyG') throwFromHand('frag');
    if (code === 'KeyF') throwFromHand('flash');
    if (code === 'KeyH') throwFromHand('smoke');
    if (code.startsWith('Digit')) {
      const slot = ['pistol', 'rifle', 'smg', 'shotgun', 'sniper'][Number(code.slice(5)) - 1];
      if (slot && weapon.owned(slot) && rounds.state.phase !== 'menu') {
        if (weapon.switchTo(slot)) {
          hud.setWeapon(WEAPONS[slot].name);
          hud.setAmmo(weapon.ammo[slot].mag, weapon.ammo[slot].reserve);
        }
      }
    }
  }
}

function step(dt) {
  elapsed += dt;
  botCtx.time = elapsed;
  botCtx.playerSpeed = player.groundSpeed();
  bombView.state = rounds.state.bomb;
  bombView.site = rounds.state.bombSite;
  bombView.x = rounds.state.bombX;
  bombView.z = rounds.state.bombZ;
  const phase = rounds.state.phase;

  if (phase === 'buy' || phase === 'live') {
    if (body.alive) player.step(dt, input.state.keys, input.state.aiming);
    weapon.step(dt, input.state.aiming, player.groundSpeed());
    // The crosshair tracks the live spread every step, so moving, jumping and
    // sustained fire visibly widen it before the next shot, not after.
    hud.setCrosshairSpread(4 + weapon.spread(player.groundSpeed(), body.crouching, !body.onGround) * (input.state.aiming ? 0.45 : 1) * 900);
  }
  if (phase === 'live') {
    bots.step(dt, botCtx);
    if (tactics) tactics.update(dt, rounds.state.bomb);
  }
  combat.step(dt);
  grenades.step(dt);
  rounds.step(dt);
  world.tick(dt, elapsed);

  // Entering a buy phase starts a fresh round: lingering smoke and live
  // canisters are cleared, the flash white-out never carries over, the drums
  // restock, and a new match resets the scoreboard stats.
  if (rounds.state.phase === 'buy' && prevPhase !== 'buy') {
    grenades.clear();
    combat.resetBarrels();
    if (prevPhase === 'menu' || prevPhase === 'matchEnd') stats.clear();
  }
  prevPhase = rounds.state.phase;

  // The flashbang white-out fades over a couple of seconds of simulation time.
  if (flashLevel > 0) {
    flashLevel = Math.max(0, flashLevel - dt * 0.45);
    hud.setFlashLevel(flashLevel);
  }

  // The minimap refreshes four times a second from the simulation, never per frame.
  mapTimer += dt;
  if (mapTimer >= 0.25) {
    mapTimer = 0;
    minimap.draw();
    if (input.state.keys.has('Tab')) refreshBoard();
  }

  // The bomb mesh follows its carrier, then sits on the ground once planted.
  if (rounds.state.bomb === 'carried') {
    const carrier = bots.list.find((b) => b.carrier && b.alive);
    if (carrier) {
      bombMesh.visible = true;
      bombMesh.position.set(carrier.pos.x - Math.sin(carrier.yaw) * 0.2, carrier.pos.y + 1.15, carrier.pos.z - Math.cos(carrier.yaw) * 0.2);
      bombMesh.rotation.y = carrier.yaw;
    } else {
      bombMesh.visible = false;
    }
  } else if (rounds.state.bomb === 'planted') {
    bombMesh.visible = true;
    bombMesh.position.set(rounds.state.bombX, 0.55, rounds.state.bombZ);
    bombMesh.rotation.y = 0;
  } else {
    bombMesh.visible = false;
  }
  bombLight.material.color.setHex(Math.floor(elapsed * 2) % 2 === 0 ? 0xe5484d : 0x551111);

  // Defuse: hold E beside the planted bomb.
  rounds.playerDefuse(dt, input.state.keys.has('KeyE'));
  const nearBomb = rounds.state.bomb === 'planted' && body.alive
    && Math.hypot(body.position.x - rounds.state.bombX, body.position.z - rounds.state.bombZ) < 2.6;
  hud.setInteract(nearBomb, 'Hold E to defuse');
  hud.setAlive(bots.aliveCount('vanguard') + (body.alive ? 1 : 0), bots.aliveCount('ember'));
  hud.setHealth(body.health, body.armor);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (rounds.state.phase !== 'menu') player.look(look.x, look.y);
    handlePressed(input.takePressed());
    if (input.state.firing && weapon.ready() && (rounds.state.phase === 'live' || rounds.state.phase === 'buy')) {
      if (weapon.def().auto || !input.state.firingHeld) shootPlayer();
    }
    input.state.firingHeld = input.state.firing;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    // The board fills the instant Tab is pressed, then refreshes with the minimap.
    const tabDown = input.state.keys.has('Tab') && started && rounds.state.phase !== 'menu';
    hud.showScoreboard(tabDown);
    if (tabDown && !boardShown) refreshBoard();
    boardShown = tabDown;
    syncCamera();
    updateOptics();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function stageBot(bot, x, z, yaw) {
  bot.pos.set(x, 0, z);
  bot.yaw = yaw;
  bot.group.position.copy(bot.pos);
  bot.group.rotation.set(0, yaw, 0);
  bot.state = 'patrol';
  bot.path = [];
  bot.target = null;
}

function runShot(name) {
  hud.hideOverlay();
  started = true;
  rounds.startMatch();
  if (name === 'start') {
    // A high dusk vista across the yard: mid lane, both sites, lamps, the whole map.
    body.position.set(14, 5.5, 15);
    aimAt(new THREE.Vector3(-6, 0.5, -10));
    settle(10);
    hud.showOverlay('start', null);
  } else if (name === 'buy') {
    body.position.set(0, 0, 13);
    body.yaw = 0;
    body.pitch = 0;
    rounds.state.money = 4200;
    hud.setMoney(4200);
    weapon.state.grenades = 1;
    weapon.state.flashes = 1;
    weapon.state.smokes = 1;
    settle(10);
    hud.showBuy(true, 4200, ownedSet());
  } else if (name === 'play' || name === 'end') {
    // Skip the buy phase: the round is live, the player stands on the mid overlook
    // deck with the north approaches, the bots and the yard in view.
    rounds.state.phase = 'live';
    rounds.state.timer = 87;
    hud.setTimer(87, 'live');
    hud.showBuyHint(false);
    body.position.set(0, 1.7, -6.8);
    body.yaw = 0;
    body.pitch = 0;
    const ember = bots.list.filter((b) => b.team === 'ember');
    const vang = bots.list.filter((b) => b.team === 'vanguard');
    stageBot(ember[0], -2, -11, Math.PI);
    stageBot(ember[1], 2.5, -12, Math.PI);
    stageBot(ember[2], 5.5, -9.5, Math.PI * 0.75);
    stageBot(vang[0], -4, -8.5, 0);
    stageBot(vang[1], -6, -10, 0);
    settle(24);
    if (name === 'play') {
      // A smoke grenade blooms ahead first, so the frame shows the cloud, the
      // minimap, the bots and the tracer together; then one aimed shot.
      weapon.state.grenades = 1;
      weapon.state.flashes = 1;
      weapon.state.smokes = 1;
      grenades.throwSmoke(new THREE.Vector3(0, 3.3, -6.8), new THREE.Vector3(0, -0.95, -0.3).normalize());
      settle(78);
      // Re-stage the bots after the smoke blooms: the live simulation moved them
      // while the cloud formed, and the shot wants them back in the lane.
      stageBot(ember[0], -2, -11, Math.PI);
      stageBot(ember[1], 2.5, -12, Math.PI);
      stageBot(ember[2], 5.5, -9.5, Math.PI * 0.75);
      stageBot(vang[0], -4, -8.5, 0);
      stageBot(vang[1], -6, -10, 0);
      settle(2);
      // Aim slightly left/high of the chest: the ray leaves the muzzle offset right
      // and low of the camera. updateMatrixWorld mirrors the render loop: no frame
      // has rendered yet in the staged capture, so world matrices are stale.
      scene.updateMatrixWorld(true);
      aimAt(new THREE.Vector3(5.3, 1.1, -9.7));
      shootPlayer();
      settle(2);
      aimAt(new THREE.Vector3(5.3, 1.1, -9.7));
    } else {
      // Round over: Ember wiped out, Vanguard ahead 3–2, banner up. The score is set
      // to 2 first because the elimination check adds the winning point during settle.
      rounds.state.scoreV = 2;
      rounds.state.scoreE = 2;
      hud.setScore(3, 2);
      for (const bot of ember) {
        bot.alive = false;
        bot.fall = 1;
        bot.group.rotation.x = -1.5;
        bot.group.position.y = -0.15;
        bot.barFg.visible = false;
      }
      hud.banner('VANGUARD WINS THE ROUND', 'Ember team eliminated', 3600000);
      hud.killfeed('You ▸ Ash', true);
      hud.killfeed('Mira ▸ Vex', false);
      settle(6);
    }
  }
  hud.setScore(rounds.state.scoreV, rounds.state.scoreE);
  // The callout names the director's real plan for this round, added last so its
  // fade timer starts at the capture, not before the staging settles.
  if (name === 'play') hud.callout(`EXECUTE — Ember hits Site ${tactics.describe().site}`, 'ember');
  hud.setAmmo(weapon.ammo[weapon.state.current].mag, weapon.ammo[weapon.state.current].reserve);
  hud.setHealth(body.health, body.armor);
  hud.setMoney(rounds.state.money);
  hud.setWeapon(weapon.def().name);
  hud.setGrenades(weapon.state.grenades, weapon.state.flashes, weapon.state.smokes);
  hud.setAlive(bots.aliveCount('vanguard') + (body.alive ? 1 : 0), bots.aliveCount('ember'));
  minimap.draw();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// A small read-only handle for play-testing (and for the finalist review): the live
// phase, the player's state and the bots' positions, nothing that can change the game.
window.__dustline = {
  snapshot() {
    return {
      phase: rounds.state.phase,
      round: rounds.state.round,
      score: [rounds.state.scoreV, rounds.state.scoreE],
      money: rounds.state.money,
      timer: Math.round(rounds.state.timer * 10) / 10,
      bomb: rounds.state.bomb,
      winTarget: rounds.state.winTarget,
      history: rounds.state.history.join(''),
      tactics: tactics ? tactics.describe() : null,
      fov: Math.round(camera.fov * 10) / 10,
      player: {
        x: Math.round(body.position.x * 100) / 100,
        z: Math.round(body.position.z * 100) / 100,
        health: Math.round(body.health),
        alive: body.alive,
        weapon: weapon.state.current,
        mag: weapon.ammo[weapon.state.current].mag,
        frag: weapon.state.grenades,
        flash: weapon.state.flashes,
        smoke: weapon.state.smokes,
        kit: rounds.state.hasKit,
        blind: flashLevel > 0,
      },
      bots: bots.list.map((b) => ({
        name: b.name, team: b.team, alive: b.alive,
        x: Math.round(b.pos.x * 10) / 10, z: Math.round(b.pos.z * 10) / 10,
        state: b.state, health: Math.round(b.health),
        role: b.role, weapon: b.weaponId, armour: Math.round(b.armour),
      })),
      damageLog,
    };
  },
};

hud.showOverlay('start', null);
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
