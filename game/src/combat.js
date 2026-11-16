// Combat: hitscan shooting with headshots, wall penetration, explosive drums,
// tracers, impact marks and muzzle flashes, plus arcing frag grenades. One raycaster
// is reused for every shot and line-of-sight check; tracer and impact pools are
// allocated once. Damage goes through the hooks main.js wires in, so this module
// never decides who wins a round.
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
  const segOrigin = new THREE.Vector3();
  const segEnd = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  // Explosive drums: shot, they take damage like a body; emptied, they detonate.
  const barrels = (world.barrels || []).map((b) => {
    const state = { mesh: b.mesh, collider: b.collider, min: b.min.clone(), max: b.max.clone(), hp: 40, dead: false };
    b.mesh.userData.barrel = state;
    return state;
  });

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

  function showBlast(p) {
    blastSphere.position.copy(p);
    blastSphere.visible = true;
    blastSphere.scale.setScalar(0.5);
    blastLight.position.copy(p);
    blastLight.intensity = 60;
    blastLife = 0.35;
  }

  function detonateAt(p, radius, base, shooterTeam, shooterName) {
    // Radial damage with falloff, to bots, the player — and other drums, so a blast
    // beside a second drum chains. The thrower is not spared.
    showBlast(p);
    hooks.onExplosion(p);
    for (const bot of hooks.bots.list) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.pos.x - p.x, bot.pos.z - p.z);
      if (d < radius) hooks.damageBot(bot, Math.round(base * (1 - d / radius) + 10), shooterTeam === 'player' ? 'player' : 'bot', shooterName);
    }
    if (hooks.player.alive) {
      const d = Math.hypot(hooks.player.position.x - p.x, hooks.player.position.z - p.z);
      if (d < radius) hooks.damagePlayer(Math.round(base * (1 - d / radius) + 10), p);
    }
    for (const barrel of barrels) {
      if (barrel.dead) continue;
      const d = Math.hypot(barrel.mesh.position.x - p.x, barrel.mesh.position.z - p.z);
      if (d < radius && d > 0.01) damageBarrel(barrel, 120, shooterTeam, shooterName);
    }
  }

  function damageBarrel(barrel, amount, shooterTeam, shooterName) {
    if (barrel.dead) return;
    barrel.hp -= amount;
    if (barrel.hp > 0) return;
    barrel.dead = true;
    barrel.mesh.visible = false;
    // A spent drum leaves no invisible wall: its collider drops below the floor.
    barrel.collider.min.set(0, -100, 0);
    barrel.collider.max.set(0, -99, 0);
    detonateAt(barrel.mesh.position, 5.5, 90, shooterTeam, shooterName);
  }

  function resolveShot(from, dir, def, shooterTeam, maxDist, shooterName) {
    // A shot walks up to three segments: a spent drum is stepped past, a wall costs
    // penetration budget (0.35 m a wall) and 45% of the damage, and the first body
    // hit ends the walk. Thin cover is concealment, not safety, against a rifle.
    segOrigin.copy(from);
    let remaining = maxDist;
    let penLeft = def.pen || 0;
    let penCount = 0;
    let end = segEnd.copy(from).addScaledVector(dir, maxDist);
    for (let seg = 0; seg < 3; seg += 1) {
      raycaster.set(segOrigin, dir);
      raycaster.far = remaining;
      const hit = raycaster.intersectObjects(targets, false)[0];
      if (!hit) {
        end = segEnd.copy(segOrigin).addScaledVector(dir, remaining);
        break;
      }
      end = hit.point;
      hitNormal.copy(hit.face ? hit.face.normal : up);
      const barrel = hit.object.userData.barrel;
      if (barrel) {
        if (barrel.dead) {
          segOrigin.copy(hit.point).addScaledVector(dir, 0.3);
          remaining -= hit.distance + 0.3;
          continue;
        }
        damageBarrel(barrel, def.damage, shooterTeam, shooterName);
        showImpact(hit.point, hitNormal);
        showTracer(from, end);
        return { hit: true, wall: true, barrel: true };
      }
      if (hit.object.userData.bot) {
        const bot = hit.object.userData.bot;
        if (!bot.alive || bot.team === shooterTeam) {
          showTracer(from, end);
          return { hit: true, blocked: true };
        }
        const dist = from.distanceTo(hit.point);
        const falloff = Math.max(0.55, 1 - dist / (def.range * 2));
        const head = hit.object.userData.part === 'head';
        const amount = Math.round(def.damage * (head ? def.headMult : 1) * falloff * Math.pow(0.55, penCount));
        const killed = hooks.damageBot(bot, amount, shooterTeam === 'player' ? 'player' : 'bot', shooterName);
        showImpact(hit.point, hitNormal);
        showTracer(from, end);
        return { hit: true, bot, head, amount, killed, penetrated: penCount > 0 };
      }
      if (hit.object.userData.player) {
        // Only Ember fire can hurt the player: a Vanguard bot's stray round and the
        // player's own muzzle can never register on their own hitbox.
        if (shooterTeam !== 'ember' || !hooks.player.alive) {
          showTracer(from, end);
          return { hit: true, blocked: true };
        }
        const dist = from.distanceTo(hit.point);
        const falloff = Math.max(0.55, 1 - dist / (def.range * 2));
        const head = hit.point.y > hooks.player.position.y + 1.35;
        const amount = Math.round(def.damage * (head ? def.headMult : 1) * falloff * Math.pow(0.55, penCount));
        hooks.damagePlayer(amount, from);
        showImpact(hit.point, hitNormal);
        showTracer(from, end);
        return { hit: true, player: true, head, amount, penetrated: penCount > 0 };
      }
      showImpact(hit.point, hitNormal);
      if (penLeft >= 0.35 && seg < 2) {
        penLeft -= 0.35;
        penCount += 1;
        segOrigin.copy(hit.point).addScaledVector(dir, 0.25);
        remaining -= hit.distance + 0.25;
        continue;
      }
      break;
    }
    showTracer(from, end);
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
    detonateAt(p, GRENADE_RADIUS, 95, 'player', 'You');
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
    showBlast(tmp.set(x, y, z));
  }

  function resetBarrels() {
    // A new round restocks the yard: every drum is whole, visible and solid again.
    for (const barrel of barrels) {
      barrel.hp = 40;
      barrel.dead = false;
      barrel.mesh.visible = true;
      barrel.collider.min.copy(barrel.min);
      barrel.collider.max.copy(barrel.max);
    }
  }

  return {
    shootPlayer,
    botShot,
    throwGrenade,
    blastAt,
    resetBarrels,
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
