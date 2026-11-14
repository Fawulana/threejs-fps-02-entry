// FOUNDRY YARD, the map of DUSTLINE: a 48 x 36 m dusk-lit industrial yard with two
// bomb sites — A FOUNDRY west, B DEPOT east — three lanes (west, mid, east) cut by long
// divider walls, and a Vanguard spawn south against an Ember spawn north. Every box is a
// collider for players and bots and a surface a bullet stops on. Waypoints form a graph:
// nodes are linked only when a straight walk between them clears every wall by 0.55 m,
// and bots path over it with a breadth-first search, so they follow real routes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const NODE_POINTS = [
  [0, 15], [-4, 14], [4, 14], [-4, 8], [4, 8], [0, 6],
  [-12, 8], [12, 8], [-4, 0], [4, 0], [0, -2], [-12, 0],
  [12, 0], [-12, -4], [12, -4], [-16, -9], [16, -9], [-18, -12],
  [18, -12], [0, -8], [-1, -11], [1, -11], [0, -15],
  [-12, 12], [12, 12], [-4, -4], [4, -4], [-10, -6], [10, -6],
];

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
  [-2, -14, 1.6, 1.6, 1.0, 'hairline', 0.5],
  [2, -14, 1.6, 1.6, 1.0, 'hairline', 0.5],
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
  for (const [x, y, z, colour] of lamps) {
    const lamp = new THREE.PointLight(new THREE.Color(colour), 22, 16, 1.8);
    lamp.position.set(x, y, z);
    scene.add(lamp);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colour) }),
    );
    bulb.position.set(x, y, z);
    group.add(bulb);
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
    group,
    nodes,
    nearestNode,
    findPath,
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
