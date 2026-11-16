// The DOM HUD: health, armour, ammo, money, timer, score, team counts, kill feed,
// callouts, scoreboard, banners, the damage flash, the buy menu and the overlay
// panels. It never touches the simulation; main.js pushes numbers in.
import { WEAPONS, GRENADE_PRICE, FLASH_PRICE, SMOKE_PRICE, KIT_PRICE, ARMOR_PRICE } from './weapons.js';

const BUY_ITEMS = [
  { id: 'rifle', label: 'VK-47 Longshot', desc: 'Auto rifle · 30 rounds · high damage' },
  { id: 'smg', label: 'Hornet-9', desc: 'Fast SMG · 32 rounds · close quarters' },
  { id: 'shotgun', label: 'Breacher-12', desc: 'Pump shotgun · 8 pellets · devastating up close' },
  { id: 'sniper', label: 'Longbow .50', desc: 'Bolt sniper · one-shot body · scope on right-click' },
  { id: 'grenade', label: 'Frag grenade', desc: 'Arcing explosive · 6.5 m blast · G to throw' },
  { id: 'flash', label: 'Flashbang', desc: 'Blinds anyone facing the pop · F to throw' },
  { id: 'smoke', label: 'Smoke grenade', desc: 'Blocks sight for 14 s · H to throw' },
  { id: 'kit', label: 'Defuse kit', desc: 'Halves your defuse time to 2 seconds' },
  { id: 'armor', label: 'Kevlar vest', desc: 'Absorbs half of every hit' },
];

function priceFor(id) {
  if (id === 'grenade') return GRENADE_PRICE;
  if (id === 'flash') return FLASH_PRICE;
  if (id === 'smoke') return SMOKE_PRICE;
  if (id === 'kit') return KIT_PRICE;
  if (id === 'armor') return ARMOR_PRICE;
  return WEAPONS[id].price;
}

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const overlayStats = $('overlay-stats');
  const play = $('play');
  const buyOverlay = $('buy-overlay');
  const buyGrid = $('buy-grid');
  const buyMoney = $('buy-money');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorNum = $('armor-num');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const moneyValue = $('money-value');
  const grenadeValue = $('grenade-value');
  const timerValue = $('timer-value');
  const scoreV = $('score-v');
  const scoreE = $('score-e');
  const roundNum = $('round-num');
  const aliveV = $('alive-v');
  const aliveE = $('alive-e');
  const killfeed = $('killfeed');
  const bannerEl = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const damageFlash = $('damage-flash');
  const bombStatus = $('bomb-status');
  const buyHint = $('buy-hint');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const defuseBar = $('defuse-bar');
  const defuseFill = $('defuse-fill');
  const interactHint = $('interact-hint');
  const flashWhite = $('flash-white');
  const scopeEl = $('scope');
  const callouts = $('callouts');
  const scoreboard = $('scoreboard');
  const scoreRowsV = $('score-rows-v');
  const scoreRowsE = $('score-rows-e');
  const scoreHistory = $('score-history');
  let scoreboardShown = false;

  let hitTimer = 0;
  let bannerTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastHealth = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastTimer = -1;
  let lastScoreV = -1;
  let lastScoreE = -1;
  let buyHandler = null;

  for (const item of BUY_ITEMS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buy-item';
    button.dataset.buy = item.id;
    const price = priceFor(item.id);
    button.innerHTML = `<b>${item.label}</b><span>$${price.toLocaleString('en-US')}</span><i>${item.desc}</i>`;
    button.addEventListener('click', () => buyHandler && buyHandler(item.id));
    buyGrid.appendChild(button);
  }

  function fmtTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setHealth(health, armor) {
      if (health === lastHealth && armor === lastArmor) return;
      lastHealth = health;
      lastArmor = armor;
      healthFill.style.width = `${Math.max(0, health)}%`;
      healthFill.classList.toggle('low', health <= 30);
      healthNum.textContent = String(Math.ceil(health));
      armorNum.textContent = String(Math.ceil(armor));
    },
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      weaponName.textContent = name;
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value.toLocaleString('en-US')}`;
      buyMoney.textContent = `$${value.toLocaleString('en-US')}`;
    },
    setGrenades(frag, flash, smoke) {
      grenadeValue.textContent = `◉ ${frag}  ✦ ${flash}  ☁ ${smoke}`;
    },
    setFlashLevel(level) {
      flashWhite.style.opacity = level <= 0.01 ? '0' : String(Math.min(1, level));
    },
    setScope(show) {
      scopeEl.hidden = !show;
    },
    setTimer(seconds, phase) {
      const text = fmtTime(seconds);
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
      timerValue.classList.toggle('buy', phase === 'buy');
      timerValue.classList.toggle('urgent', phase === 'live' && seconds <= 10);
    },
    setScore(v, e) {
      if (v === lastScoreV && e === lastScoreE) return;
      lastScoreV = v;
      lastScoreE = e;
      scoreV.textContent = String(v);
      scoreE.textContent = String(e);
    },
    setRound(n) {
      roundNum.textContent = `ROUND ${n}`;
    },
    setAlive(v, e) {
      aliveV.textContent = '●'.repeat(Math.max(0, v));
      aliveE.textContent = '●'.repeat(Math.max(0, e));
    },
    setBomb(state, site, timer, defuseProgress = 0) {
      if (state === 'planted') {
        bombStatus.hidden = false;
        bombStatus.textContent = `BOMB AT ${site} — ${fmtTime(timer)}`;
        bombStatus.classList.add('planted');
        if (defuseProgress > 0) {
          defuseBar.hidden = false;
          defuseFill.style.width = `${Math.round(defuseProgress * 100)}%`;
        } else {
          defuseBar.hidden = true;
        }
      } else if (state === 'carried') {
        bombStatus.hidden = false;
        bombStatus.textContent = `EMBER CARRIES THE BOMB — TARGET: SITE ${site}`;
        bombStatus.classList.remove('planted');
        defuseBar.hidden = true;
      } else {
        bombStatus.hidden = true;
        defuseBar.hidden = true;
      }
    },
    setInteract(show, text) {
      interactHint.hidden = !show;
      if (show) interactHint.textContent = text;
    },
    showBuyHint(show) {
      buyHint.hidden = !show;
    },
    setCrosshairSpread(px) {
      crosshair.style.setProperty('--spread', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageFlash.classList.add('on');
      setTimeout(() => damageFlash.classList.remove('on'), 140);
    },
    killfeed(text, headshot) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text + (headshot ? ' ☠' : '');
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.classList.add('fade'), 4200);
      setTimeout(() => line.remove(), 5200);
    },
    callout(text, team) {
      const line = document.createElement('div');
      line.className = `feed-line callout ${team === 'ember' ? 'e' : 'v'}`;
      line.textContent = text;
      callouts.prepend(line);
      while (callouts.children.length > 4) callouts.removeChild(callouts.lastChild);
      setTimeout(() => line.classList.add('fade'), 4200);
      setTimeout(() => line.remove(), 5200);
    },
    showScoreboard(show) {
      if (show === scoreboardShown) return;
      scoreboardShown = show;
      scoreboard.hidden = !show;
    },
    setScoreboard(rowsV, rowsE, history) {
      // Hold Tab: kills/deaths/role for both teams, plus the round history strip.
      const row = (r) => `<tr><td>${r.name}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.role || ''}</td></tr>`;
      scoreRowsV.innerHTML = rowsV.map(row).join('');
      scoreRowsE.innerHTML = rowsE.map(row).join('');
      scoreHistory.textContent = history.map((h) => (h === 'V' ? '●' : '○')).join(' ') || 'No rounds yet';
      scoreHistory.className = history.length ? '' : 'empty';
    },
    banner(title, sub, ms = 2400) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub || '';
      bannerEl.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => bannerEl.classList.remove('on'), ms);
    },
    showOverlay(mode, data) {
      if (mode === 'start') {
        overlayTitle.textContent = 'DUSTLINE';
        overlayCopy.textContent = 'A round-based tactical shooter in Foundry Yard. Vanguard defends, Ember attacks with the bomb. First to 8 rounds takes the match.';
        overlayStats.textContent = '5 v 5 · bomb at A FOUNDRY or B DEPOT · $800 to start';
        play.textContent = 'Click to play';
      } else if (mode === 'paused') {
        overlayTitle.textContent = 'Paused';
        overlayCopy.textContent = 'The round waits for you.';
        overlayStats.textContent = '';
        play.textContent = 'Click to resume';
      } else if (mode === 'dead') {
        overlayTitle.textContent = 'You are down';
        overlayCopy.textContent = 'Your squad fights on. You return next round.';
        overlayStats.textContent = '';
        play.textContent = 'Watch your squad';
      } else if (mode === 'match') {
        const won = data.winner === 'vanguard';
        overlayTitle.textContent = won ? 'VANGUARD TAKES THE MATCH' : 'EMBER TAKES THE MATCH';
        overlayCopy.textContent = won
          ? `Foundry Yard is yours. Final score ${data.scoreV} — ${data.scoreE}.`
          : `Ember takes Foundry Yard. Final score ${data.scoreV} — ${data.scoreE}.`;
        overlayStats.textContent = `Your kills this match: ${data.kills}`;
        play.textContent = 'Play again';
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    showBuy(show, money, owned) {
      buyOverlay.hidden = !show;
      if (!show) return;
      buyMoney.textContent = `$${money.toLocaleString('en-US')}`;
      for (const button of buyGrid.children) {
        const id = button.dataset.buy;
        const price = priceFor(id);
        const isOwned = owned.has(id);
        button.classList.toggle('owned', isOwned);
        button.disabled = isOwned || money < price;
      }
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyHandler = handler;
    },
  };
}
