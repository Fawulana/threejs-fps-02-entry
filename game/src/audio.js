// Synthesised sound, no audio files: every effect is an oscillator or a filtered noise
// burst built in WebAudio. The context is created on the first user gesture, so the game
// stays silent (and legal) until the player clicks play. All calls are safe before that.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function noise(when, duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ctx) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(when);
    source.stop(when + duration + 0.02);
  }

  function tone(when, freq, endFreq, duration, gainValue, type = 'sine') {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), when + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  return {
    resume() {
      if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    shot(kind) {
      if (!ensure()) return;
      const t = now();
      // Crack first, then the body of the shot; heavier weapons sit lower and longer.
      const crack = kind === 'sniper' ? 3200 : kind === 'shotgun' ? 1800 : 2600;
      noise(t, kind === 'sniper' ? 0.28 : 0.12, crack, kind === 'sniper' ? 0.9 : 0.55, 'highpass');
      tone(t, kind === 'sniper' ? 160 : 220, 55, kind === 'sniper' ? 0.3 : 0.14, 0.5, 'triangle');
    },
    distantShot() {
      if (!ensure()) return;
      const t = now();
      noise(t, 0.1, 900, 0.16, 'lowpass');
    },
    dryFire() {
      if (!ensure()) return;
      tone(now(), 1400, 900, 0.05, 0.25, 'square');
    },
    reload() {
      if (!ensure()) return;
      const t = now();
      tone(t, 700, 500, 0.05, 0.2, 'square');
      tone(t + 0.35, 900, 600, 0.05, 0.2, 'square');
      tone(t + 0.85, 1100, 800, 0.06, 0.25, 'square');
    },
    hit(kill) {
      if (!ensure()) return;
      const t = now();
      tone(t, kill ? 1320 : 990, kill ? 1320 : 990, kill ? 0.14 : 0.07, 0.3, 'sine');
      if (kill) tone(t + 0.09, 1760, 1760, 0.16, 0.3, 'sine');
    },
    hurt() {
      if (!ensure()) return;
      tone(now(), 180, 90, 0.18, 0.4, 'sawtooth');
    },
    explosion() {
      if (!ensure()) return;
      const t = now();
      noise(t, 1.1, 500, 1.0, 'lowpass');
      tone(t, 90, 28, 0.9, 0.8, 'sine');
      noise(t + 0.05, 0.4, 2400, 0.4, 'bandpass');
    },
    beep(planted) {
      if (!ensure()) return;
      tone(now(), planted ? 1560 : 880, planted ? 1560 : 880, planted ? 0.05 : 0.12, 0.25, 'square');
    },
    plant() {
      if (!ensure()) return;
      const t = now();
      for (let i = 0; i < 3; i += 1) tone(t + i * 0.16, 1180, 1180, 0.08, 0.25, 'square');
    },
    buy() {
      if (!ensure()) return;
      const t = now();
      tone(t, 660, 660, 0.08, 0.25, 'sine');
      tone(t + 0.08, 990, 990, 0.12, 0.25, 'sine');
    },
    denied() {
      if (!ensure()) return;
      tone(now(), 220, 160, 0.16, 0.3, 'square');
    },
    win() {
      if (!ensure()) return;
      const t = now();
      [523, 659, 784].forEach((f, i) => tone(t + i * 0.13, f, f, 0.22, 0.28, 'triangle'));
    },
    lose() {
      if (!ensure()) return;
      const t = now();
      [392, 330, 262].forEach((f, i) => tone(t + i * 0.15, f, f, 0.26, 0.28, 'triangle'));
    },
    grenadePin() {
      if (!ensure()) return;
      tone(now(), 1900, 1200, 0.06, 0.2, 'square');
    },
    flashRing() {
      // The flashbang's aftermath: a high ringing tone that fades over two seconds.
      if (!ensure()) return;
      tone(now(), 3400, 3200, 2.0, 0.16, 'sine');
    },
    smokeHiss() {
      if (!ensure()) return;
      noise(now(), 0.9, 5200, 0.22, 'highpass');
    },
  };
}
