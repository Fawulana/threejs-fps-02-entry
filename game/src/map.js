// FOUNDRY YARD, the map of DUSTLINE: a 48 x 36 m dusk-lit industrial yard with two
// bomb sites — A FOUNDRY west, B DEPOT east — three lanes (west, mid, east) cut by long
// divider walls, and a Vanguard spawn south against an Ember spawn north. Every box is a
// collider for players and bots and a surface a bullet stops on. Waypoints form a graph:
// nodes are linked only when a straight walk between them clears every wall by 0.55 m,
// and bots path over it with a breadth-first search, so they follow real routes. The
// mid overlook adds verticality — a jumpable gantry deck over the Ember approaches —
// rust-red fuel drums are explosive cover, and a gradient dusk sky, drifting dust and
// chimney smoke keep the yard alive between rounds.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const NODE_POINTS = [
  [0, 15], [-4, 14], [4, 14], [-4, 8], [4, 8], [0, 6],
  [-12, 8], [12, 8], [-4, 0], [4, 0], [0, -2], [-12, 0],
  [12, 0], [-12, -4], [12, -4], [-16, -9], [16, -9], [-18, -12],
  [18, -12], [0, -8.6], [-1, -11], [1, -11], [0, -15],
  [-12, 12], [12, 12], [-4, -4], [4, -4], [-10, -6], [10, -6],
  [-5, -8.6], [5, -8.6],
];
// 19 threads the 0.5 m corridor between the (±4,-10) crates and the deck; 29/30
// flank the deck through the same corridor, or Ember's graph islands.

// [cx, cz, width, depth, height, material] — y is the box centre, so h/2 above the floor.
const BOXES = [
  // Floor and outer walls.
  [0, 0, 49, 37, 0.4, 'floor', -0.2],
  [-24.2, 0, 0.4, 37, 5, 'surface', 2.5],
  [24.2, 0, 0.4, 37, 5, 'surface', 2.5],
  [0, -18.2, 49, 0.4, 5, 'surface', 2.5],
  [0, 18.2, 49, 0.4, 5, 'surface', 2.5],
  // Long divider walls: west and east lanes, with gaps to cross between them.
  [-8, -11, 1, 10, 4.5, 'surface', 2.25],
  [-8, 1, 1, 6, 4.5, 'surface', 2.25],
  [-8, 14, 1, 4, 4.5, 'surface', 2.25],
  [8, -11, 1, 10, 4.5, 'surface', 2.25],
  [8, 1, 1, 6, 4.5, 'surface', 2.25],
  [8, 14, 1, 4, 4.5, 'surface', 2.25],
  // Site front walls: each site is entered through one gap, so holding it matters.
  [-19, -6, 9, 1, 3.5, 'hairline', 1.75],
  [19, -6, 9, 1, 3.5, 'hairline', 1.75],
  // Mid block: a full-height block the centre lane bends around, so neither spawn can
  // see the other down the mid lane.
  [0, 2, 8, 1, 3.5, 'hairline', 1.75],
  // Crates and low cover to crouch behind.
  [-14, 2, 2, 2, 1.2, 'hairline', 0.6],
  [14, 2, 2, 2, 1.2, 'hairline', 0.6],
  [-4, -10, 3, 1.2, 1.1, 'hairline', 0.55],
  [4, -10, 3, 1.2, 1.1, 'hairline', 0.55],
  [0, 8, 2.4, 1.2, 1.1, 'hairline', 0.55],
  [-16, 10, 2, 2, 1.2, 'hairline', 0.6],
  [16, 10, 2, 2, 1.2, 'hairline', 0.6],
  [-2, -14, 1.6, 1.0, 1.0, 'hairline', 0.5],
  [2, -14, 1.6, 1.0, 1.0, 'hairline', 0.5],
  // Shipping containers guarding each site, in the site's own colour.
  [-14, -12, 3, 2, 2.6, 'vanguard', 1.3],
  [14, -12, 3, 2, 2.6, 'ember', 1.3],
  // Pillars and raised site pads (pads are low enough to jump onto).
  [0, -4, 1.2, 1.2, 4.5, 'surface', 2.25],
  [0, 10, 1.2, 1.2, 4.5, 'surface', 2.25],
  [-18, -12, 6, 5, 0.4, 'surface', 0.2],
  [18, -12, 6, 5, 0.4, 'surface', 0.2],
];

function textTexture(text, colour, size = 96) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.clearRect(0, 0, 512, 256);
  g.fillStyle = colour;
  g.font = `700 ${size}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function buildMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: name === 'hairline' || name === 'surface' ? 0.25 : 0.03,
    });
  }
  // Procedural yard floor: concrete panels, expansion joints, oil stains and a
  // faded painted centre line, drawn once onto a canvas texture — no image files.
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = 512;
  floorCanvas.height = 384;
  const fg = floorCanvas.getContext('2d');
  fg.fillStyle = PALETTE.floor;
  fg.fillRect(0, 0, 512, 384);
  fg.strokeStyle = 'rgba(0,0,0,0.35)';
  fg.lineWidth = 2;
  for (let gx = 0; gx <= 512; gx += 64) { fg.beginPath(); fg.moveTo(gx, 0); fg.lineTo(gx, 384); fg.stroke(); }
  for (let gz = 0; gz <= 384; gz += 64) { fg.beginPath(); fg.moveTo(0, gz); fg.lineTo(512, gz); fg.stroke(); }
  fg.fillStyle = 'rgba(0,0,0,0.18)';
  for (const stain of [[120, 90, 26], [390, 260, 34], [250, 300, 20], [60, 300, 16], [430, 80, 18]]) {
    fg.beginPath(); fg.arc(stain[0], stain[1], stain[2], 0, Math.PI * 2); fg.fill();
  }
  fg.fillStyle = 'rgba(240,168,48,0.45)';
  fg.fillRect(250, 0, 4, 384);
  const floorTexture = new THREE.CanvasTexture(floorCanvas);
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  materials.floor.map = floorTexture;
  const colliders = [];
  const shootables = [];
  const flat = []; // 2D boxes for the nav test: {minX, maxX, minZ, maxZ, top}

  function box(cx, cz, w, d, h, material, cy) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const box3 = new THREE.Box3().setFromObject(mesh);
    colliders.push(box3);
    shootables.push(mesh);
    flat.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, top: cy + h / 2 });
    return mesh;
  }
  for (const entry of BOXES) box(entry[0], entry[1], entry[2], entry[3], entry[4], entry[5], entry[6]);

  // Fuel drums: rust-red explosive drums, low cover that detonates when shot. They
  // register in flat[] before the waypoint graph is built, so nav links route around
  // them like every other box.
  const drumGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 14);
  const drumMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a3b1e'), roughness: 0.6, metalness: 0.3 });
  const barrels = [];
  for (const drum of [[-10.5, 4.5], [10.5, 4.5], [-16, 4], [16, 4], [6.5, -6]]) {
    const mesh = new THREE.Mesh(drumGeo, drumMat);
    mesh.position.set(drum[0], 0.55, drum[1]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const collider = new THREE.Box3(
      new THREE.Vector3(drum[0] - 0.45, 0, drum[1] - 0.45),
      new THREE.Vector3(drum[0] + 0.45, 1.1, drum[1] + 0.45),
    );
    colliders.push(collider);
    shootables.push(mesh);
    barrels.push({ mesh, collider, min: collider.min.clone(), max: collider.max.clone() });
    flat.push({ minX: drum[0] - 0.45, maxX: drum[0] + 0.45, minZ: drum[1] - 0.45, maxZ: drum[1] + 0.45, top: 1.1 });
  }
  // The overlook: a raised gantry deck over the north half of mid, reached by two
  // jumpable crate steps (0.6 m, 1.2 m, then the 1.7 m deck — each inside the jump
  // height). A perch with sightlines down both Ember approaches and no cover of its
  // own. Bots path around its footprint, so the perch is the player's alone.
  box(0, -4.9, 1.6, 1.2, 0.6, 'hairline', 0.3);
  box(0, -5.9, 1.6, 1.0, 1.2, 'hairline', 0.6);
  box(0, -6.8, 5, 2, 0.3, 'surface', 1.55);
  const deckLegMat = materials.hairline;
  for (const lx of [-2.2, 2.2]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.4, 0.3), deckLegMat);
    leg.position.set(lx, 0.7, -6.8);
    leg.castShadow = true;
    group.add(leg);
  }

  // Stacked crates guarding the south crossings: two high, so they block sight as
  // well as movement.
  box(-6, 10, 1.4, 1.4, 1.1, 'hairline', 0.55);
  box(-6, 10, 1.2, 1.2, 1.0, 'surface', 1.6);
  box(6, 10, 1.4, 1.4, 1.1, 'hairline', 0.55);
  box(6, 10, 1.2, 1.2, 1.0, 'surface', 1.6);

  // Distant yard silhouettes beyond the walls — silos, a crane mast and an overhead
  // gantry beam. Visual only: they sit outside the playable box, carry no colliders
  // and never enter the nav test, so they cannot trap a bot.
  const silhouette = new THREE.MeshStandardMaterial({ color: new THREE.Color('#141a22'), roughness: 1 });
  const siloGeo = new THREE.CylinderGeometry(2.2, 2.2, 11, 16);
  for (const silo of [[-31, -20], [29, -24], [-33, 8]]) {
    const mesh = new THREE.Mesh(siloGeo, silhouette);
    mesh.position.set(silo[0], 5.5, silo[1]);
    group.add(mesh);
  }
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1.4, 16, 1.4), silhouette);
  mast.position.set(30, 8, 10);
  group.add(mast);
  const jib = new THREE.Mesh(new THREE.BoxGeometry(16, 1, 1), silhouette);
  jib.position.set(24, 15.5, 10);
  group.add(jib);
  const gantry = new THREE.Mesh(new THREE.BoxGeometry(50, 0.8, 1.6), silhouette);
  gantry.position.set(0, 6.4, -16.5);
  group.add(gantry);

  // Site letters: big painted A and B floating over each site, plus yard signage.
  function sign(text, colour, x, y, z, w = 6, h = 3) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: textTexture(text, colour), transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }
  sign('A', PALETTE.vanguard, -18, 4.6, -16.5, 4, 2);
  sign('B', PALETTE.ember, 18, 4.6, -16.5, 4, 2);
  // The planes face +z (south) by default, so they read correctly from the mid and
  // the spawns; rotating them would mirror the text.
  sign('FOUNDRY', PALETTE.muted, -19, 3.2, -6.4, 8, 4);
  sign('DEPOT', PALETTE.muted, 19, 3.2, -6.4, 8, 4);
  sign('MID', PALETTE.accent, 0, 4.2, 1.4, 3, 1.5);

  // Site floor markers: glowing rings where the bomb is planted.
  function siteRing(x, z, colour) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.45, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colour), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.43, z);
    group.add(ring);
    return ring;
  }
  siteRing(-18, -11, PALETTE.vanguard);
  siteRing(18, -11, PALETTE.ember);

  // Dusk lighting: a low warm sun with shadows, a cool sky fill, sodium lamps over the lanes.
  const sky = new THREE.HemisphereLight(new THREE.Color('#9db4d4'), new THREE.Color('#4a5568'), 2.0);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb36b'), 3.4);
  sun.position.set(-14, 18, 12);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5a6f8f'), 1.3);
  fill.position.set(10, 12, -14);
  scene.add(fill);
  const south = new THREE.DirectionalLight(new THREE.Color('#7a8ba8'), 0.7);
  south.position.set(-6, 10, 16);
  scene.add(south);
  const lamps = [
    [0, 4.6, 6, '#f0a830'],
    [-18, 4.6, -11, '#2fd4c0'],
    [18, 4.6, -11, '#f06423'],
    [0, 4.6, -14, '#f0a830'],
  ];
  let flickerLamp = null;
  for (const [x, y, z, colour] of lamps) {
    const lamp = new THREE.PointLight(new THREE.Color(colour), 22, 16, 1.8);
    lamp.position.set(x, y, z);
    scene.add(lamp);
    if (!flickerLamp) flickerLamp = lamp;
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colour) }),
    );
    bulb.position.set(x, y, z);
    group.add(bulb);
  }

  // Dusk sky: a gradient dome (amber horizon to deep blue) that fog never touches.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4;
  skyCanvas.height = 256;
  const sg = skyCanvas.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#0b1220');
  grad.addColorStop(0.55, '#1c2637');
  grad.addColorStop(0.78, '#7a5232');
  grad.addColorStop(1, '#c77e3a');
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 4, 256);
  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(120, 24, 12),
    new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, fog: false }),
  );
  scene.add(skyDome);

  // Drifting dust in the lamplight, and smoke rising from the foundry chimney.
  // Both animate in tick().
  const dustCount = 240;
  const dustPos = new Float32Array(dustCount * 3);
  let dustSeed = 12345;
  const dustRand = () => {
    dustSeed = (dustSeed * 1103515245 + 12345) & 0x7fffffff;
    return dustSeed / 0x7fffffff;
  };
  for (let i = 0; i < dustCount; i += 1) {
    dustPos[i * 3] = (dustRand() * 2 - 1) * 24;
    dustPos[i * 3 + 1] = dustRand() * 5 + 0.3;
    dustPos[i * 3 + 2] = (dustRand() * 2 - 1) * 18;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: new THREE.Color('#ffd9a0'), size: 0.06, transparent: true, opacity: 0.4,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  scene.add(dust);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 9, 12), silhouette);
  chimney.position.set(-27, 4.5, -8);
  group.add(chimney);
  const smokePuffs = [];
  const smokeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#5a636e'), transparent: true, opacity: 0.28, depthWrite: false });
  for (let i = 0; i < 6; i += 1) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), smokeMat);
    puff.position.set(-27, 9 + i, -8);
    puff.scale.setScalar(0.8 + i * 0.35);
    group.add(puff);
    smokePuffs.push(puff);
  }

  function tick(dt, elapsed) {
    dust.rotation.y += dt * 0.006;
    dust.position.y = Math.sin(elapsed * 0.12) * 0.25;
    if (flickerLamp) flickerLamp.intensity = 22 + Math.sin(elapsed * 13.7) * 1.6 + Math.sin(elapsed * 31.3) * 1.1;
    for (let i = 0; i < smokePuffs.length; i += 1) {
      const puff = smokePuffs[i];
      puff.position.y += dt * 0.55;
      puff.position.x += dt * 0.35;
      if (puff.position.y > 15) {
        puff.position.set(-27, 9, -8);
        puff.scale.setScalar(0.8);
      } else {
        puff.scale.setScalar(Math.min(3, puff.scale.x + dt * 0.25));
      }
    }
  }

  // Waypoint graph: link two nodes when the walk between them clears every solid box.
  const nodes = NODE_POINTS.map(([x, z], i) => ({ x, z, links: [], index: i }));
  function segmentBlocked(ax, az, bx, bz, pad) {
    for (const b of flat) {
      if (b.top < 0.6) continue; // low pads are stepped over, not walked around
      const minX = b.minX - pad;
      const maxX = b.maxX + pad;
      const minZ = b.minZ - pad;
      const maxZ = b.maxZ + pad;
      // Slab test of the 2D segment against the expanded box.
      const dx = bx - ax;
      const dz = bz - az;
      let t0 = 0;
      let t1 = 1;
      const axes = [
        [dx, minX - ax, maxX - ax],
        [dz, minZ - az, maxZ - az],
      ];
      let blocked = true;
      for (const [d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-9) {
          if (lo > 0 || hi < 0) { blocked = false; break; }
        } else {
          let a = lo / d;
          let c = hi / d;
          if (a > c) { const tmp = a; a = c; c = tmp; }
          t0 = Math.max(t0, a);
          t1 = Math.min(t1, c);
          if (t0 > t1) { blocked = false; break; }
        }
      }
      if (blocked && t0 <= t1) return true;
    }
    return false;
  }
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist > 15 || segmentBlocked(a.x, a.z, b.x, b.z, 0.55)) continue;
      a.links.push(j);
      b.links.push(i);
    }
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (const node of nodes) {
      const d = (node.x - x) * (node.x - x) + (node.z - z) * (node.z - z);
      if (d < bestDist) { bestDist = d; best = node.index; }
    }
    return best;
  }

  // Breadth-first search over the waypoint graph; returns node indices from start to goal.
  function findPath(fromX, fromZ, toX, toZ) {
    const start = nearestNode(fromX, fromZ);
    const goal = nearestNode(toX, toZ);
    if (start === goal) return [goal];
    const prev = new Array(nodes.length).fill(-1);
    const queue = [start];
    prev[start] = start;
    while (queue.length) {
      const current = queue.shift();
      if (current === goal) break;
      for (const next of nodes[current].links) {
        if (prev[next] === -1) {
          prev[next] = current;
          queue.push(next);
        }
      }
    }
    if (prev[goal] === -1) return [goal];
    // The path starts at the bot's nearest node, which the bot walks to first: the
    // legs after it are the graph's own validated edges, so the bot never cuts a
    // corner through a wall on its way to the first waypoint.
    const path = [];
    let at = goal;
    while (at !== start) {
      path.push(at);
      at = prev[at];
    }
    path.push(start);
    path.reverse();
    return path;
  }

  return {
    colliders,
    shootables,
    barrels,
    walls: flat,
    group,
    nodes,
    nearestNode,
    findPath,
    tick,
    spawns: {
      vanguard: [[0, 15], [-3, 15], [3, 15], [-5, 13], [5, 13]],
      ember: [[0, -15], [-3, -15], [3, -15], [-5, -13], [5, -13]],
    },
    sites: {
      A: { name: 'A FOUNDRY', x: -18, z: -11, ringX: -18, ringZ: -11 },
      B: { name: 'B DEPOT', x: 18, z: -11, ringX: 18, ringZ: -11 },
    },
  };
}
