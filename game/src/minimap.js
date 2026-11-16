// The tactical minimap: walls, sites and spawns painted once onto an offscreen
// layer; each refresh blits it and draws only what moves. Enemies appear only while
// the player has a live line of sight to them, so the map never reveals what the
// player could not know. Refreshes run four times a second, never per frame.
export function createMinimap(canvas, world, view) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const HALF_X = 25;
  const HALF_Z = 19;

  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  const base = layer.getContext('2d');

  function toX(x) { return ((x + HALF_X) / (HALF_X * 2)) * W; }
  function toY(z) { return ((z + HALF_Z) / (HALF_Z * 2)) * H; }

  function paintBase() {
    base.fillStyle = '#10141a';
    base.fillRect(0, 0, W, H);
    base.fillStyle = '#3a434f';
    for (const wall of world.walls) {
      if (wall.top < 0.6) continue;
      const x0 = toX(wall.minX);
      const y0 = toY(wall.minZ);
      base.fillRect(x0, y0, Math.max(1, toX(wall.maxX) - x0), Math.max(1, toY(wall.maxZ) - y0));
    }
    base.fillStyle = '#2fd4c0';
    base.font = 'bold 13px system-ui, sans-serif';
    base.textAlign = 'center';
    base.textBaseline = 'middle';
    base.fillText('A', toX(world.sites.A.x), toY(world.sites.A.z));
    base.fillStyle = '#f06423';
    base.fillText('B', toX(world.sites.B.x), toY(world.sites.B.z));
    base.fillStyle = '#9aa3ad';
    base.font = '9px system-ui, sans-serif';
    base.fillText('MID', toX(0), toY(2));
  }
  paintBase();

  function dot(x, y, radius, colour) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  return {
    draw() {
      ctx.drawImage(layer, 0, 0);
      for (const cloud of view.smoke) {
        ctx.fillStyle = 'rgba(174, 182, 186, 0.5)';
        ctx.beginPath();
        ctx.arc(toX(cloud.x), toY(cloud.z), (cloud.radius / (HALF_X * 2)) * W, 0, Math.PI * 2);
        ctx.fill();
      }
      const bomb = view.bomb;
      if (bomb.state === 'planted') {
        const bx = toX(bomb.x);
        const by = toY(bomb.z);
        ctx.fillStyle = '#e5484d';
        ctx.beginPath();
        ctx.moveTo(bx, by - 6);
        ctx.lineTo(bx + 5, by);
        ctx.lineTo(bx, by + 6);
        ctx.lineTo(bx - 5, by);
        ctx.closePath();
        ctx.fill();
      }
      for (const bot of view.bots.list) {
        if (!bot.alive) continue;
        if (bot.team === 'vanguard') {
          dot(toX(bot.pos.x), toY(bot.pos.z), 3, '#2fd4c0');
        } else if (view.seesEnemy(bot)) {
          dot(toX(bot.pos.x), toY(bot.pos.z), 3, '#f06423');
        }
      }
      // The player: a white arrow rotated to the facing yaw.
      const p = view.player;
      const px = toX(p.position.x);
      const py = toY(p.position.z);
      const heading = Math.atan2(-Math.sin(p.yaw), Math.cos(p.yaw));
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(heading);
      ctx.fillStyle = '#ece7db';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 4);
      ctx.lineTo(0, 2);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(236, 231, 219, 0.25)';
      ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    },
  };
}
