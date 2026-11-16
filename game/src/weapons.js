// The arsenal: five weapons, each with price, damage, magazine, cadence, spread and
// wall-penetration ratings, so the buy menu is a real decision. One state machine
// drives the view model, magazine, reload, muzzle flash and walk bob; main.js owns
// the ray.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 26, headMult: 2.5, mag: 12, reserve: 48,
    fireGap: 0.16, auto: false, reloadTime: 1.3, spreadStill: 0.003, spreadMove: 0.02,
    range: 45, pellets: 1, kick: 0.012, barrel: 0.22, zoom: 1.15, pen: 0.4,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Longshot', price: 2700, damage: 34, headMult: 3, mag: 30, reserve: 90,
    fireGap: 0.1, auto: true, reloadTime: 2.1, spreadStill: 0.0022, spreadMove: 0.028,
    range: 80, pellets: 1, kick: 0.016, barrel: 0.55, zoom: 1.35, pen: 1.4,
  },
  smg: {
    id: 'smg', name: 'Hornet-9', price: 1500, damage: 22, headMult: 2.5, mag: 32, reserve: 128,
    fireGap: 0.068, auto: true, reloadTime: 1.7, spreadStill: 0.004, spreadMove: 0.032,
    range: 40, pellets: 1, kick: 0.01, barrel: 0.34, zoom: 1.2, pen: 0.6,
  },
  shotgun: {
    id: 'shotgun', name: 'Breacher-12', price: 1100, damage: 13, headMult: 2, mag: 6, reserve: 24,
    fireGap: 0.85, auto: false, reloadTime: 2.6, spreadStill: 0.012, spreadMove: 0.03,
    range: 22, pellets: 8, kick: 0.045, barrel: 0.5, zoom: 1.1, pen: 0,
  },
  sniper: {
    id: 'sniper', name: 'Longbow .50', price: 4750, damage: 110, headMult: 2.5, mag: 5, reserve: 15,
    fireGap: 1.35, auto: false, reloadTime: 3.1, spreadStill: 0.0004, spreadMove: 0.05,
    range: 120, pellets: 1, kick: 0.06, barrel: 0.72, zoom: 3.2, pen: 2.6,
  },
};

export const GRENADE_PRICE = 300;
export const FLASH_PRICE = 200;
export const SMOKE_PRICE = 300;
export const KIT_PRICE = 400;
export const ARMOR_PRICE = 650;
const MUZZLE_TIME = 0.06;

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3f45'), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.4 });

  // One view model per weapon, built from boxes; only the active one is shown.
  const models = {};
  function buildModel(def) {
    const model = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.34), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.barrel), grip);
    barrel.position.set(0, 0.025, -0.17 - def.barrel / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.2), grip);
    stock.position.set(0, -0.02, 0.26);
    model.add(receiver, barrel, stock);
    if (def.id === 'shotgun') {
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.16), dark);
      pump.position.set(0, -0.02, -0.32);
      model.add(pump);
    }
    if (def.id === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 12), dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.09, -0.05);
      model.add(scope);
    }
    if (def.id === 'smg') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), dark);
      mag.position.set(0, -0.12, 0.02);
      mag.rotation.x = 0.2;
      model.add(mag);
    }
    model.position.set(0.24, -0.2, -0.42);
    model.visible = false;
    camera.add(model);
    return model;
  }
  for (const def of Object.values(WEAPONS)) models[def.id] = buildModel(def);
  models.pistol.visible = true;

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const ammo = {};
  for (const def of Object.values(WEAPONS)) ammo[def.id] = { mag: def.mag, reserve: def.reserve };
  const ownedSet = new Set(['pistol']);
  const state = {
    current: 'pistol', cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bloom: 0,
    grenades: 0, flashes: 0, smokes: 0, zoomed: false, bobPhase: 0,
  };

  function activeModel() {
    return models[state.current];
  }

  function step(dt, aiming, speed = 0) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    // Bloom from sustained fire bleeds off over ~0.5 s, so burst fire stays
    // accurate and holding the trigger does not.
    state.bloom = Math.max(0, state.bloom - dt * 0.055);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = activeModel();
    const def = WEAPONS[state.current];
    const ads = aiming && state.reloadLeft === 0;
    // Walk bob: the view model sways with the stride; aiming damps it so the
    // sight picture stays readable.
    state.bobPhase += dt * (2 + speed * 1.7);
    const bobAmp = ads ? 0.0015 : Math.min(0.011, speed * 0.0021);
    const bobY = Math.sin(state.bobPhase) * bobAmp;
    const bobX = Math.cos(state.bobPhase * 0.5) * bobAmp * 0.7;
    const targetX = (ads ? 0 : 0.24) + bobX;
    const targetY = (ads ? -0.155 : -0.2) + bobY;
    model.position.x += (targetX - model.position.x) * Math.min(1, dt * 14);
    model.position.y += (targetY - model.position.y) * Math.min(1, dt * 14);
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const slot = ammo[state.current];
        const take = Math.min(def.mag - slot.mag, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
  }

  return {
    state,
    ammo,
    def() {
      return WEAPONS[state.current];
    },
    step,
    ready() {
      const slot = ammo[state.current];
      return slot.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = WEAPONS[state.current].fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = WEAPONS[state.current].kick;
      state.bloom = Math.min(0.032, state.bloom + 0.005 + WEAPONS[state.current].kick * 0.18);
    },
    takeRound() {
      const slot = ammo[state.current];
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[state.current];
      const slot = ammo[state.current];
      if (state.reloadLeft > 0 || slot.mag === def.mag || slot.reserve === 0) return;
      state.reloadLeft = def.reloadTime;
    },
    spread(speed, crouched, airborne) {
      // Still and crouched is accurate; moving, jumping and sustained fire widen
      // the cone, so stopping to aim pays.
      const def = WEAPONS[state.current];
      let value = def.spreadStill + Math.min(1, speed / 5.4) * def.spreadMove + state.bloom;
      if (crouched) value *= 0.7;
      if (airborne) value += 0.02;
      return value;
    },
    switchTo(id) {
      if (!WEAPONS[id] || id === state.current) return false;
      models[state.current].visible = false;
      state.current = id;
      state.cooldown = 0.25;
      state.reloadLeft = 0;
      models[id].visible = true;
      return true;
    },
    setModelHidden(hidden) {
      // Scoped: the view model would fill the scope's circle, so it hides.
      models[state.current].visible = !hidden;
    },
    buy(id) {
      ownedSet.add(id);
      models[state.current].visible = false;
      state.current = id;
      state.cooldown = 0;
      state.reloadLeft = 0;
      const slot = ammo[id];
      slot.mag = WEAPONS[id].mag;
      slot.reserve = WEAPONS[id].reserve;
      models[id].visible = true;
    },
    refill() {
      // A new round tops up the magazines of owned weapons; the pistol is always there.
      for (const id of ownedSet) {
        ammo[id].mag = WEAPONS[id].mag;
        ammo[id].reserve = WEAPONS[id].reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
      state.grenades = 0;
      state.flashes = 0;
      state.smokes = 0;
    },
    owned(id) {
      return ownedSet.has(id);
    },
    resetLoadout() {
      ownedSet.clear();
      ownedSet.add('pistol');
      models[state.current].visible = false;
      state.current = 'pistol';
      models.pistol.visible = true;
      this.refill();
    },
  };
}
