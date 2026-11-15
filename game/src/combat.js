// Combat: hitscan shooting with headshots, tracers, impact marks and muzzle flashes,
// plus arcing frag grenades. One raycaster is reused for every shot and every line of
// sight check, and the tracer and impact pools are allocated once — no new objects are
// made in a hot loop. Damage is applied through the hooks main.js wires in, so this
// module never decides who wins a round.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_COUNT = 16;
const IMPACT_COUNT = 10;
const GRENADE_RADIUS = 6.5;
const GRENADE_FUSE = 1.8;

export function createCombat(scene, world, rng, hooks) {
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const hitNormal = new THREE.Vector3();
  const markTarget = new THREE.Vector3();
  const nextPos = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // The player's hitbox: an invisible box the raycaster can hit, kept on the player.
  const playerHitbox = new THREE.Mesh(
    new THREE.BoxGeometry(0.68, 1.72, 0.68),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  playerHitbox.userData.player = true;
  scene.add(playerHitbox);

  // The raycast target list is built once: the world's shootables, the bots' hit
  // meshes and the player's hitbox never change after setup, so resolving a shot
  // must not concatenate a fresh array for every bullet.
  const targets = world.shootables.concat(hooks.bots.hitMeshes, [playerHitbox]);

  // Tracer pool: stretched additive boxes, one per shot, fading in 80 ms.
  const tracers = [];
  const tracerGeo = new THREE.BoxGeometry(0.025, 0.025, 1);
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerIndex = 0;

  // Impact pool: a bright spark that fades fast, and a dark mark left on the surface.
  const impacts = [];
  const sparkGeo = new THREE.SphereGeometry(0.07, 8, 6);
  const markGeo = new THREE.CircleGeometry(0.09, 12);
  for (let i = 0; i < IMPACT_COUNT; i += 1) {
    const spark = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    spark.visible = false;
    scene.add(spark);
    const mark = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#0a0c0e'), transparent: true, opacity: 0, depthWrite: false }));
    mark.visible = false;
    scene.add(mark);
    impacts.push({ spark, mark, life: 0 });
  }
  let impactIndex = 0;

  // Bot muzzle flashes: small additive planes, one per bot, shown for 50 ms.
  const botFlashes = new Map();
  function botFlash(bot) {
    let flash = botFlashes.get(bot);
    if (!flash) {
      flash = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 0.3),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
      );
      flash.visible = false;
      scene.add(flash);
      botFlashes.set(bot, { mesh: flash, life: 0 });
    }
    return botFlashes.get(bot);
  }

  const grenades = [];
  const midV = new THREE.Vector3();
  const lookV = new THREE.Vector3();
  const grenadeGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3f45'), roughness: 0.5, metalness: 0.6 });
  const blastLight = new THREE.PointLight(new THREE.Color('#ffb36b'), 0, 14, 1.6);
  scene.add(blastLight);
  const blastSphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffcf7a'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  blastSphere.visible = false;
  scene.add(blastSphere);
  let blastLife = 0;

  function showTracer(from, to) {
    const tracer = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_COUNT;
    const mid = midV.copy(from).add(to).multiplyScalar(0.5);
    tracer.mesh.position.copy(mid);
    tracer.mesh.lookAt(to);
    tracer.mesh.scale.set(1, 1, from.distanceTo(to));
    tracer.mesh.visible = true;
    tracer.life = 0.08;
    tracer.mesh.material.opacity = 0.85;
  }

  function showImpact(point, normal) {
    const impact = impacts[impactIndex];
    impactIndex = (impactIndex + 1) % IMPACT_COUNT;
    impact.spark.position.copy(point);
    impact.spark.visible = true;
    impact.mark.position.copy(point).addScaledVector(normal, 0.01);
    markTarget.copy(point).add(normal);
    impact.mark.lookAt(markTarget);
    impact.mark.visible = true;
    impact.life = 4;
    impact.spark.material.opacity = 1;
    impact.mark.material.opacity = 0.55;
  }

  function resolveShot(from, dir, def, shooterTeam, maxDist, shooterName) {
    raycaster.set(from, dir);
    raycaster.far = maxDist;
    const hit = raycaster.intersectObjects(targets, false)[0];
    const end = hit ? hit.point : tmp.copy(from).addScaledVector(dir, maxDist);
    showTracer(from, end);
    if (!hit) return { hit: false };
    // The hit point and normal are read straight off the intersection and copied
    // into scratch storage where they are needed; nothing here clones a vector.
    hitNormal.copy(hit.face ? hit.face.normal : up);
    if (hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      if (!bot.alive || bot.team === shooterTeam) return { hit: true, blocked: true };
      const dist = hit.distance;
      const falloff = Math.max(0.55, 1 - dist / (def.range * 2));
      const head = hit.object.userData.part === 'head';
      const amount = Math.round(def.damage * (head ? def.headMult : 1) * falloff);
      const killed = hooks.damageBot(bot, amount, shooterTeam === 'player' ? 'player' : 'bot', shooterName);
      showImpact(hit.point, hitNormal);
      return { hit: true, bot, head, amount, killed };
    }
    if (hit.object.userData.player) {
      // Only Ember fire can hurt the player: a Vanguard bot's stray round and the
      // player's own muzzle can never register on their own hitbox.
      if (shooterTeam !== 'ember') return { hit: true, blocked: true };
      if (!hooks.player.alive) return { hit: true, blocked: true };
      const dist = hit.distance;
      const falloff = Math.max(0.55, 1 - dist / (def.range * 2));
      const head = hit.point.y > hooks.player.position.y + 1.35;
      const amount = Math.round(def.damage * (head ? def.headMult : 1) * falloff);
      hooks.damagePlayer(amount, from);
      showImpact(hit.point, hitNormal);
      return { hit: true, player: true, head, amount };
    }
    showImpact(hit.point, hitNormal);
    return { hit: true, wall: true };
  }

  function shootPlayer(from, dir, def, spread, muzzle) {
    const results = [];
    for (let p = 0; p < def.pellets; p += 1) {
      direction.copy(dir);
      direction.x += (rng.next() * 2 - 1) * spread;
      direction.y += (rng.next() * 2 - 1) * spread;
      direction.z += (rng.next() * 2 - 1) * spread;
      direction.normalize();
      origin.copy(muzzle || from);
      results.push(resolveShot(origin, direction, def, 'player', def.range, 'You'));
    }
    return results;
  }

  function botShot(bot, tx, ty, tz, error, def) {
    origin.set(bot.pos.x, bot.pos.y + 1.45, bot.pos.z);
    const fx = Math.sin(bot.yaw);
    const fz = Math.cos(bot.yaw);
    origin.addScaledVector(tmp.set(fx, 0, fz), 0.4);
    direction.set(tx - origin.x, ty - origin.y, tz - origin.z).normalize();
    direction.x += (rng.next() * 2 - 1) * error;
    direction.y += (rng.next() * 2 - 1) * error;
    direction.z += (rng.next() * 2 - 1) * error;
    direction.normalize();
    const flash = botFlash(bot);
    flash.mesh.position.copy(origin);
    flash.mesh.lookAt(lookV.copy(origin).add(direction));
    flash.mesh.visible = true;
    flash.life = 0.05;
    const dist = Math.hypot(tx - bot.pos.x, tz - bot.pos.z);
    hooks.onBotShot(dist);
    return resolveShot(origin, direction, def, bot.team, def.range, bot.name);
  }

  function throwGrenade(from, dir) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.position.copy(from);
    mesh.castShadow = true;
    scene.add(mesh);
    grenades.push({
      mesh,
      velocity: new THREE.Vector3(dir.x * 13, dir.y * 13 + 3.2, dir.z * 13),
      fuse: GRENADE_FUSE,
    });
    hooks.onGrenadeThrow();
  }

  function explode(grenade) {
    const p = grenade.mesh.position;
    scene.remove(grenade.mesh);
    blastSphere.position.copy(p);
    blastSphere.visible = true;
    blastSphere.scale.setScalar(0.5);
    blastLight.position.copy(p);
    blastLight.intensity = 60;
    blastLife = 0.35;
    hooks.onExplosion(p);
    // Damage falls off with distance; the thrower is not spared.
    for (const bot of hooks.bots.list) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.pos.x - p.x, bot.pos.z - p.z);
      if (d < GRENADE_RADIUS) hooks.damageBot(bot, Math.round(95 * (1 - d / GRENADE_RADIUS) + 10), 'player', 'You');
    }
    if (hooks.player.alive) {
      const d = Math.hypot(hooks.player.position.x - p.x, hooks.player.position.z - p.z);
      if (d < GRENADE_RADIUS) hooks.damagePlayer(Math.round(95 * (1 - d / GRENADE_RADIUS) + 10), p);
    }
  }

  function stepGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.velocity.y -= 13 * dt;
      const next = nextPos.copy(g.mesh.position).addScaledVector(g.velocity, dt);
      // Bounce off the world: test the next position against every collider.
      let bounced = false;
      for (const box of world.colliders) {
        if (next.x > box.min.x - 0.1 && next.x < box.max.x + 0.1
          && next.y > box.min.y - 0.1 && next.y < box.max.y + 0.1
          && next.z > box.min.z - 0.1 && next.z < box.max.z + 0.1) {
          const dxMin = Math.min(Math.abs(next.x - box.min.x), Math.abs(next.x - box.max.x));
          const dyMin = Math.min(Math.abs(next.y - box.min.y), Math.abs(next.y - box.max.y));
          const dzMin = Math.min(Math.abs(next.z - box.min.z), Math.abs(next.z - box.max.z));
          if (dxMin <= dyMin && dxMin <= dzMin) g.velocity.x *= -0.45;
          else if (dyMin <= dzMin) g.velocity.y *= -0.45;
          else g.velocity.z *= -0.45;
          bounced = true;
          break;
        }
      }
      if (!bounced) g.mesh.position.copy(next);
      else g.velocity.multiplyScalar(0.8);
      if (g.fuse <= 0) {
        explode(g);
        grenades.splice(i, 1);
      }
    }
    if (blastLife > 0) {
      blastLife -= dt;
      blastSphere.scale.setScalar(0.5 + (0.35 - blastLife) * 18);
      blastSphere.material.opacity = Math.max(0, blastLife / 0.35) * 0.8;
      blastLight.intensity = Math.max(0, blastLife / 0.35) * 60;
      if (blastLife <= 0) blastSphere.visible = false;
    }
  }

  function hasLOS(x1, y1, z1, x2, y2, z2) {
    origin.set(x1, y1, z1);
    direction.set(x2 - x1, y2 - y1, z2 - z1);
    const dist = direction.length();
    direction.normalize();
    raycaster.set(origin, direction);
    raycaster.far = dist;
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit || hit.distance >= dist - 0.15;
  }

  function blastAt(x, z, y = 1) {
    blastSphere.position.set(x, y, z);
    blastSphere.visible = true;
    blastSphere.scale.setScalar(0.5);
    blastLight.position.set(x, y, z);
    blastLight.intensity = 60;
    blastLife = 0.35;
  }

  return {
    shootPlayer,
    botShot,
    throwGrenade,
    blastAt,
    hasLOS,
    playerHitbox,
    step(dt) {
      stepGrenades(dt);
      for (const tracer of tracers) {
        if (tracer.life > 0) {
          tracer.life -= dt;
          tracer.mesh.material.opacity = Math.max(0, tracer.life / 0.08) * 0.85;
          if (tracer.life <= 0) tracer.mesh.visible = false;
        }
      }
      for (const impact of impacts) {
        if (impact.life > 0) {
          impact.life -= dt;
          impact.spark.material.opacity = Math.max(0, Math.min(1, impact.life)) * 0.9;
          if (impact.life <= 0.2) impact.spark.visible = false;
          impact.mark.material.opacity = Math.max(0, Math.min(0.55, impact.life * 0.14));
          if (impact.life <= 0) impact.mark.visible = false;
        }
      }
      for (const flash of botFlashes.values()) {
        if (flash.life > 0) {
          flash.life -= dt;
          if (flash.life <= 0) flash.mesh.visible = false;
        }
      }
      if (hooks.player.alive) {
        playerHitbox.position.set(hooks.player.position.x, hooks.player.position.y + 0.86, hooks.player.position.z);
      }
    },
  };
}
