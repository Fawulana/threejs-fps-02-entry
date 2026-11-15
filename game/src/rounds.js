// Rounds, money and the bomb: the tactical skeleton. A match is first to 8 rounds.
// Each round opens with a 12-second buy phase, then 100 seconds of live play. Ember
// attacks with the bomb — plant it at A or B and it blows in 35 seconds unless Vanguard
// defuses it — and a round also ends when a team is wiped out or the clock runs out.
// Money is earned for kills and for winning or losing rounds, and spent in the buy menu.
import { WEAPONS, GRENADE_PRICE, FLASH_PRICE, SMOKE_PRICE, KIT_PRICE, ARMOR_PRICE } from './weapons.js';

const BUY_SECONDS = 12;
const ROUND_SECONDS = 100;
const BOMB_SECONDS = 35;
const PLANT_SECONDS = 5;
const DEFUSE_SECONDS = 4;
const WIN_ROUNDS = 8;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1900;
const LOSS_STREAK_BONUS = 500;

export function createRounds(hooks) {
  const state = {
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    round: 1,
    scoreV: 0,
    scoreE: 0,
    money: 800,
    timer: BUY_SECONDS,
    lossStreak: 0,
    kills: 0,
    deaths: 0,
    bomb: 'none', // none | carried | planted | exploded | defused
    bombSite: 'A',
    bombX: 0,
    bombZ: 0,
    bombTimer: BOMB_SECONDS,
    plantProgress: 0,
    defuseProgress: 0,
    hasKit: false,
    matchWinner: null,
    roundReason: '',
  };

  function startRound() {
    const { carrier, site } = hooks.bots.spawnRound(state.round);
    state.bombSite = site;
    state.bomb = 'carried';
    state.bombX = 0;
    state.bombZ = 0;
    state.bombTimer = BOMB_SECONDS;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.hasKit = false;
    const [x, z] = hooks.world.spawns.vanguard[0];
    hooks.resetPlayer(x, z, 0);
    hooks.weapon.refill();
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    hooks.hud.setScore(state.scoreV, state.scoreE);
    hooks.hud.setMoney(state.money);
    hooks.hud.setRound(state.round);
    hooks.hud.setBomb('carried', state.bombSite, 0);
    hooks.hud.showBuyHint(true);
    hooks.hud.banner(`ROUND ${state.round}`, `Buy phase — press B to open the shop`, 2400);
  }

  function startMatch() {
    state.round = 1;
    state.scoreV = 0;
    state.scoreE = 0;
    state.money = 800;
    state.lossStreak = 0;
    state.kills = 0;
    state.deaths = 0;
    state.matchWinner = null;
    hooks.weapon.resetLoadout();
    startRound();
  }

  function endRound(winner, reason) {
    if (state.phase !== 'live' && state.phase !== 'buy') return;
    state.phase = 'roundEnd';
    state.timer = 4;
    state.roundReason = reason;
    if (winner === 'vanguard') {
      state.scoreV += 1;
      state.money += WIN_REWARD;
      state.lossStreak = 0;
      hooks.audio.win();
      hooks.hud.banner('VANGUARD WINS THE ROUND', reason, 3600);
    } else {
      state.scoreE += 1;
      state.money += LOSS_REWARD + Math.min(3, state.lossStreak) * LOSS_STREAK_BONUS;
      state.lossStreak += 1;
      hooks.audio.lose();
      hooks.hud.banner('EMBER WINS THE ROUND', reason, 3600);
    }
    hooks.hud.setScore(state.scoreV, state.scoreE);
    hooks.hud.setMoney(state.money);
    hooks.hud.setBomb('none', state.bombSite, 0);
    hooks.hud.setTimer(0, 'live');
    hooks.hud.showBuyHint(false);
  }

  function endMatch() {
    state.phase = 'matchEnd';
    state.matchWinner = state.scoreV > state.scoreE ? 'vanguard' : 'ember';
    hooks.hud.showOverlay('match', {
      winner: state.matchWinner,
      scoreV: state.scoreV,
      scoreE: state.scoreE,
      kills: state.kills,
    });
  }

  function onKill(victimTeam, killerIsPlayer) {
    if (killerIsPlayer && victimTeam === 'ember') {
      state.money += KILL_REWARD;
      state.kills += 1;
      hooks.hud.setMoney(state.money);
    }
  }

  function onPlayerDeath() {
    state.deaths += 1;
  }

  function tryBuy(id) {
    if (state.phase !== 'buy') return false;
    const def = WEAPONS[id];
    if (!def || hooks.weapon.owned(id)) return false;
    if (state.money < def.price) {
      hooks.audio.denied();
      return false;
    }
    state.money -= def.price;
    hooks.weapon.buy(id);
    hooks.audio.buy();
    hooks.hud.setMoney(state.money);
    hooks.hud.setWeapon(def.name);
    hooks.hud.setAmmo(hooks.weapon.ammo[id].mag, hooks.weapon.ammo[id].reserve);
    return true;
  }

  function tryBuyGrenade() {
    if (state.phase !== 'buy') return false;
    if (hooks.weapon.state.grenades >= 2 || state.money < GRENADE_PRICE) {
      hooks.audio.denied();
      return false;
    }
    state.money -= GRENADE_PRICE;
    hooks.weapon.state.grenades += 1;
    hooks.audio.buy();
    hooks.hud.setMoney(state.money);
    hooks.hud.setGrenades(hooks.weapon.state.grenades, hooks.weapon.state.flashes, hooks.weapon.state.smokes);
    return true;
  }

  function tryBuyFlash() {
    if (state.phase !== 'buy') return false;
    if (hooks.weapon.state.flashes >= 2 || state.money < FLASH_PRICE) {
      hooks.audio.denied();
      return false;
    }
    state.money -= FLASH_PRICE;
    hooks.weapon.state.flashes += 1;
    hooks.audio.buy();
    hooks.hud.setMoney(state.money);
    hooks.hud.setGrenades(hooks.weapon.state.grenades, hooks.weapon.state.flashes, hooks.weapon.state.smokes);
    return true;
  }

  function tryBuySmoke() {
    if (state.phase !== 'buy') return false;
    if (hooks.weapon.state.smokes >= 2 || state.money < SMOKE_PRICE) {
      hooks.audio.denied();
      return false;
    }
    state.money -= SMOKE_PRICE;
    hooks.weapon.state.smokes += 1;
    hooks.audio.buy();
    hooks.hud.setMoney(state.money);
    hooks.hud.setGrenades(hooks.weapon.state.grenades, hooks.weapon.state.flashes, hooks.weapon.state.smokes);
    return true;
  }

  function tryBuyKit() {
    // The defuse kit halves the player's defuse channel, from 4 seconds to 2 —
    // the difference between a defuse and a detonation on a late retake.
    if (state.phase !== 'buy') return false;
    if (state.hasKit || state.money < KIT_PRICE) {
      hooks.audio.denied();
      return false;
    }
    state.money -= KIT_PRICE;
    state.hasKit = true;
    hooks.audio.buy();
    hooks.hud.setMoney(state.money);
    return true;
  }

  function tryBuyArmor() {
    if (state.phase !== 'buy') return false;
    if (hooks.player.armor >= 100 || state.money < ARMOR_PRICE) {
      hooks.audio.denied();
      return false;
    }
    state.money -= ARMOR_PRICE;
    hooks.player.armor = 100;
    hooks.audio.buy();
    hooks.hud.setMoney(state.money);
    hooks.hud.setHealth(hooks.player.health, hooks.player.armor);
    return true;
  }

  function onPlantProgress(bot, channel) {
    state.plantProgress = channel / PLANT_SECONDS;
    if (channel >= PLANT_SECONDS && state.bomb === 'carried') {
      state.bomb = 'planted';
      state.bombX = bot.pos.x;
      state.bombZ = bot.pos.z;
      state.bombTimer = BOMB_SECONDS;
      hooks.audio.plant();
      hooks.hud.setBomb('planted', state.bombSite, state.bombTimer);
      hooks.hud.banner('BOMB PLANTED', `Site ${state.bombSite} — defuse it before it blows`, 3000);
    }
  }

  function onDefuseProgress(bot, channel) {
    state.defuseProgress = channel / DEFUSE_SECONDS;
    if (channel >= DEFUSE_SECONDS && state.bomb === 'planted') {
      state.bomb = 'defused';
      endRound('vanguard', 'Bomb defused by ' + bot.name);
    }
  }

  // The player holding E beside the bomb defuses it, channelled over 4 seconds —
  // or 2 with the defuse kit bought in the buy menu.
  function playerDefuse(dt, holding) {
    if (state.bomb !== 'planted' || state.phase !== 'live') {
      state.defuseProgress = 0;
      return;
    }
    const seconds = state.hasKit ? DEFUSE_SECONDS / 2 : DEFUSE_SECONDS;
    const d = Math.hypot(hooks.player.position.x - state.bombX, hooks.player.position.z - state.bombZ);
    if (holding && d < 2.6 && hooks.player.alive) {
      state.defuseProgress += dt / seconds;
      hooks.hud.setBomb('planted', state.bombSite, state.bombTimer, state.defuseProgress);
      if (state.defuseProgress >= 1) {
        state.bomb = 'defused';
        endRound('vanguard', 'Bomb defused');
      }
    } else {
      state.defuseProgress = Math.max(0, state.defuseProgress - dt / 2);
      hooks.hud.setBomb('planted', state.bombSite, state.bombTimer, state.defuseProgress);
    }
  }

  function step(dt) {
    if (state.phase === 'buy') {
      state.timer -= dt;
      hooks.hud.setTimer(Math.max(0, state.timer), 'buy');
      if (state.timer <= 0) {
        state.phase = 'live';
        state.timer = ROUND_SECONDS;
        hooks.hud.showBuyHint(false);
        hooks.hud.banner('GO', `Take Site ${state.bombSite} — or hold it`, 1600);
      }
      return;
    }
    if (state.phase === 'live') {
      if (state.bomb === 'planted') {
        state.bombTimer -= dt;
        hooks.hud.setBomb('planted', state.bombSite, Math.max(0, state.bombTimer), state.defuseProgress);
        if (Math.ceil(state.bombTimer) !== Math.ceil(state.bombTimer + dt)) hooks.audio.beep(true);
        if (state.bombTimer <= 0) {
          state.bomb = 'exploded';
          hooks.audio.explosion();
          hooks.combatBlast(state.bombX, state.bombZ);
          endRound('ember', `The bomb blew Site ${state.bombSite}`);
          return;
        }
      } else {
        state.timer -= dt;
        hooks.hud.setTimer(Math.max(0, state.timer), 'live');
        if (state.timer <= 0) {
          endRound('vanguard', 'Time ran out — Ember failed to plant');
          return;
        }
      }
      // Elimination ends the round — unless the bomb is already ticking, in which case
      // the defenders still have to defuse it.
      if (hooks.bots.aliveCount('ember') === 0 && state.bomb !== 'planted') {
        endRound('vanguard', 'Ember team eliminated');
        return;
      }
      if (hooks.bots.aliveCount('vanguard') === 0 && !hooks.player.alive && state.bomb !== 'planted') {
        endRound('ember', 'Vanguard team eliminated');
        return;
      }
      return;
    }
    if (state.phase === 'roundEnd') {
      state.timer -= dt;
      if (state.timer <= 0) {
        if (state.scoreV >= WIN_ROUNDS || state.scoreE >= WIN_ROUNDS) {
          endMatch();
        } else {
          state.round += 1;
          startRound();
        }
      }
    }
  }

  return {
    state,
    startMatch,
    startRound,
    endRound,
    onKill,
    onPlayerDeath,
    tryBuy,
    tryBuyGrenade,
    tryBuyFlash,
    tryBuySmoke,
    tryBuyKit,
    tryBuyArmor,
    onPlantProgress,
    onDefuseProgress,
    playerDefuse,
    step,
  };
}
