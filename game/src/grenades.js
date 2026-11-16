// Flashbangs and smoke grenades. A flash pops after a short fuse and blinds anyone
// who can see the burst — the player gets a fading white overlay, bots stop perceiving
// and firing until sight returns, and facing away or standing far off softens it.
// Smoke blooms into a drifting cloud that blocks sight for bots and flash checks.
// Both fly as bouncing canisters, are bought in the buy menu, and can be thrown by
// bots on the tactics director's orders (a bot's own team is spared its flash).
import * as THREE from 'three';

const FLASH_FUSE = 1.4;
const FLASH_RADIUS = 22;
const FLASH_MAX_BLIND = 3.2;
const SMOKE_FUSE = 1.1;
const SMOKE_RADIUS = 4.4;
const SMOKE_LIFE = 14;
const GRAVITY = 13;
const THROW_SPEED = 13;

export function createGrenades(scene, world, hooks) {
  const scratch = new THREE.Vector3();
  const scratchB = new THREE.Vector3();
  const burstAt = new THREE.Vector3();
  const toEye = new THREE.Vector3();
  let clock = 0;

  const canGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.16, 10);
  const flashMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c8ccd2'), roughness: 0.4, metalness: 0.7 });
  const smokeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a625f'), roughness: 0.8, metalness: 0.1 });
  const puffGeo = new THREE.SphereGeometry(1, 14, 10);
  const projectiles = [];
  const clouds = [];

  // One reusable pop: a light and an additive sprite that flare and die in 0.25 s.
  const popLight = new THREE.PointLight(new THREE.Color('#ffffff'), 0, 26, 1.4);
  scene.add(popLight);
  const popSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    color: new THREE.Color('#fff6d8'), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  popSprite.scale.set(3.2, 3.2, 1);
  popSprite.visible = false;
  scene.add(popSprite);
  let popLife = 0;

  function launch(kind, from, dir, team = 'player') {
    const mesh = new THREE.Mesh(canGeo, kind === 'flash' ? flashMat : smokeMat);
    mesh.position.copy(from);
    mesh.castShadow = true;
    scene.add(mesh);
    projectiles.push({
      kind,
      team,
      mesh,
      velocity: new THREE.Vector3(dir.x * THROW_SPEED, dir.y * THROW_SPEED + 3.2, dir.z * THROW_SPEED),
      fuse: kind === 'flash' ? FLASH_FUSE : SMOKE_FUSE,
    });
    hooks.onPin();
  }

  function facingFactor(eyeX, eyeY, eyeZ, yaw, bx, by, bz) {
    // 1 when the burst is dead ahead, ~0.25 when it is behind: turning away helps.
    toEye.set(bx - eyeX, by - eyeY, bz - eyeZ).normalize();
    const facingX = -Math.sin(yaw);
    const facingZ = -Math.cos(yaw);
    const dot = toEye.x * facingX + toEye.z * facingZ;
    return 0.25 + 0.75 * Math.max(0, dot);
  }

  function detonateFlash(p) {
    burstAt.copy(p.mesh.position);
    scene.remove(p.mesh);
    popLight.position.copy(burstAt);
    popLight.intensity = 90;
    popSprite.position.copy(burstAt);
    popSprite.visible = true;
    popLife = 0.25;
    hooks.onPop();
    hooks.onNoise(burstAt.x, burstAt.z, 26);

    // The player: line of sight and facing decide the strength of the white-out.
    // A Vanguard bot's flash never blinds its own teammate, the player.
    const eye = hooks.player;
    const pdx = eye.position.x - burstAt.x;
    const pdz = eye.position.z - burstAt.z;
    const pdist = Math.hypot(pdx, pdz);
    if (p.team !== 'vanguard' && eye.alive && pdist < FLASH_RADIUS && hooks.hasLOS(
      burstAt.x, burstAt.y, burstAt.z,
      eye.position.x, eye.position.y + eye.eye, eye.position.z,
    )) {
      const falloff = 1 - pdist / FLASH_RADIUS;
      hooks.onPlayerFlash(Math.min(1, falloff * facingFactor(
        eye.position.x, eye.position.y + eye.eye, eye.position.z, eye.yaw,
        burstAt.x, burstAt.y, burstAt.z,
      ) * 1.4));
    }

    // Bots: a blinded bot keeps its body but loses its eyes until blindUntil passes.
    // A bot's own team is spared — the flash is a team play, not friendly fire.
    for (const bot of hooks.bots.list) {
      if (!bot.alive || bot.team === p.team) continue;
      const dx = bot.pos.x - burstAt.x;
      const dz = bot.pos.z - burstAt.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= FLASH_RADIUS) continue;
      if (!hooks.hasLOS(burstAt.x, burstAt.y, burstAt.z, bot.pos.x, bot.pos.y + 1.45, bot.pos.z)) continue;
      const facing = facingFactor(bot.pos.x, bot.pos.y + 1.45, bot.pos.z, bot.yaw + Math.PI, burstAt.x, burstAt.y, burstAt.z);
      const duration = FLASH_MAX_BLIND * (1 - dist / FLASH_RADIUS) * (0.35 + 0.65 * facing);
      bot.blindUntil = Math.max(bot.blindUntil || 0, clock + Math.max(0.4, duration));
      bot.target = null;
      bot.burstLeft = 0;
    }
  }

  function detonateSmoke(p) {
    burstAt.copy(p.mesh.position);
    scene.remove(p.mesh);
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#aeb6ba'), transparent: true, opacity: 0.82, depthWrite: false,
    });
    const puffs = [];
    const offsets = [[0, 1.1, 0], [1.5, 0.9, 0.6], [-1.4, 1.0, -0.5], [0.5, 1.4, -1.3], [-0.6, 0.8, 1.4], [0, 1.7, 0]];
    for (let i = 0; i < offsets.length; i += 1) {
      const puff = new THREE.Mesh(puffGeo, material);
      puff.position.set(burstAt.x + offsets[i][0], Math.max(0.6, burstAt.y) + offsets[i][1] - 1.1, burstAt.z + offsets[i][2]);
      puff.scale.setScalar(0.3);
      group.add(puff);
      puffs.push(puff);
    }
    scene.add(group);
    clouds.push({ group, material, puffs, x: burstAt.x, z: burstAt.z, radius: 0.6, life: SMOKE_LIFE, age: 0 });
    hooks.onHiss();
  }

  function stepProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
      const p = projectiles[i];
      p.fuse -= dt;
      p.velocity.y -= GRAVITY * dt;
      scratch.copy(p.mesh.position).addScaledVector(p.velocity, dt);
      let bounced = false;
      for (const box of world.colliders) {
        if (scratch.x > box.min.x - 0.1 && scratch.x < box.max.x + 0.1
          && scratch.y > box.min.y - 0.1 && scratch.y < box.max.y + 0.1
          && scratch.z > box.min.z - 0.1 && scratch.z < box.max.z + 0.1) {
          const dxMin = Math.min(Math.abs(scratch.x - box.min.x), Math.abs(scratch.x - box.max.x));
          const dyMin = Math.min(Math.abs(scratch.y - box.min.y), Math.abs(scratch.y - box.max.y));
          const dzMin = Math.min(Math.abs(scratch.z - box.min.z), Math.abs(scratch.z - box.max.z));
          if (dxMin <= dyMin && dxMin <= dzMin) p.velocity.x *= -0.45;
          else if (dyMin <= dzMin) p.velocity.y *= -0.45;
          else p.velocity.z *= -0.45;
          bounced = true;
          break;
        }
      }
      if (!bounced) p.mesh.position.copy(scratch);
      else p.velocity.multiplyScalar(0.8);
      if (p.mesh.position.y < 0.08) {
        p.mesh.position.y = 0.08;
        p.velocity.y = Math.abs(p.velocity.y) * 0.4;
      }
      if (p.fuse <= 0) {
        if (p.kind === 'flash') detonateFlash(p);
        else detonateSmoke(p);
        projectiles.splice(i, 1);
      }
    }
  }

  function stepClouds(dt) {
    for (let i = clouds.length - 1; i >= 0; i -= 1) {
      const cloud = clouds[i];
      cloud.age += dt;
      cloud.life -= dt;
      cloud.radius = Math.min(SMOKE_RADIUS, 0.6 + cloud.age * 3.4);
      const grow = cloud.radius / SMOKE_RADIUS;
      for (const puff of cloud.puffs) {
        puff.scale.setScalar(0.5 + grow * 1.5);
        puff.position.x += Math.sin(clock * 0.7 + puff.position.z) * dt * 0.12;
      }
      cloud.material.opacity = cloud.life < 3 ? 0.82 * (cloud.life / 3) : 0.82;
      if (cloud.life <= 0) {
        scene.remove(cloud.group);
        cloud.material.dispose();
        clouds.splice(i, 1);
      }
    }
  }

  return {
    clouds,
    clear() {
      // A new round starts clean: lingering smoke or a live canister must never
      // carry over from the round before.
      for (const p of projectiles) scene.remove(p.mesh);
      projectiles.length = 0;
      for (const cloud of clouds) {
        scene.remove(cloud.group);
        cloud.material.dispose();
      }
      clouds.length = 0;
      popLife = 0;
      popSprite.visible = false;
      popLight.intensity = 0;
    },
    throwFlash(from, dir, team) { launch('flash', from, dir, team); },
    throwSmoke(from, dir, team) { launch('smoke', from, dir, team); },
    isBlinded(bot) {
      return (bot.blindUntil || 0) > clock;
    },
    blocksSight(x1, y1, z1, x2, y2, z2) {
      // Segment-sphere test against every live cloud: a sight line that passes
      // through smoke is blocked, for bots acquiring targets and for flash checks.
      for (const cloud of clouds) {
        if (cloud.radius < 1.2) continue;
        const cx = cloud.x;
        const cz = cloud.z;
        const cy = 1.2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;
        const lenSq = dx * dx + dy * dy + dz * dz || 1;
        let t = ((cx - x1) * dx + (cy - y1) * dy + (cz - z1) * dz) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const px = x1 + dx * t - cx;
        const py = y1 + dy * t - cy;
        const pz = z1 + dz * t - cz;
        if (px * px + py * py + pz * pz < cloud.radius * cloud.radius) return true;
      }
      return false;
    },
    step(dt) {
      clock += dt;
      stepProjectiles(dt);
      stepClouds(dt);
      if (popLife > 0) {
        popLife -= dt;
        const k = Math.max(0, popLife / 0.25);
        popLight.intensity = 90 * k;
        popSprite.material.opacity = 0.9 * k;
        if (popLife <= 0) {
          popSprite.visible = false;
          popLight.intensity = 0;
        }
      }
    },
  };
}
