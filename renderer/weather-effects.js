(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PomeWeatherEffects = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // CSS-pixel units per second; counts are per card, never per frame.
  const SPECS = {
    drizzle: [14, 40, 70], 'rain-light': [22, 55, 70], 'rain-mid': [42, 80, 100], 'rain-heavy': [72, 110, 130],
    'snow-light': [16, 25, 35], 'snow-mid': [30, 30, 45], 'snow-heavy': [48, 40, 55],
    hail: [30, 100, 160], dust: [14, 20, 40], wind: [7, 45, 55], 'wind-strong': [12, 85, 95],
  };
  function scene(family, width, height, random = Math.random) {
    const particles = [];
    const add = (kind, count, low, high) => {
      for (let i = 0; i < count; i++) {
        const speed = low + random() * (high - low);
        const horizontal = kind === 'dust' || kind.startsWith('wind');
        const snow = kind.startsWith('snow');
        const angle = family === 'rain-wind' ? -25 : kind === 'drizzle' ? -4 : -15;
        const p = { kind, x: random() * width, y: random() * height, speed,
          vx: horizontal ? speed * (kind === 'dust' && random() > .5 ? -1 : 1) : snow || kind === 'hail' ? 0 : Math.tan(angle * Math.PI / 180) * speed,
          vy: horizontal ? 0 : speed, phase: random() * Math.PI * 2, amplitude: 6 + random() * 8,
          period: 2 + random() * 2, radius: snow ? .8 + random() * (family === 'snow-heavy' ? 2.2 : 1.5) : 1.5 + random() * 1.2,
          length: kind === 'drizzle' ? 3 + random() * 3 : 7 + random() * 7 };
        particles.push(p);
      }
    };
    if (family === 'sleet') { add('rain-light', 22, 55, 70); add('snow-light', 12, 25, 35); }
    else if (family === 'thunder') add('rain-mid', ...SPECS['rain-mid']);
    else if (family === 'rain-wind') { add('rain-mid', ...SPECS['rain-mid']); add('wind', 6, 50, 60); }
    else if (SPECS[family]) add(family, ...SPECS[family]);
    return { family, width, height, particles, time: 0, nextFlash: 4 + random() * 4, flashAt: -1, flash: 0, random };
  }
  function step(s, dt) {
    s.time += dt;
    for (const p of s.particles) {
      // Snow swings sinusoidally (6–14 px / 2–4 seconds), without accumulating
      // frame-rate-dependent drift. Other particles have constant velocities.
      const swing = p.kind.startsWith('snow') ? p.amplitude * (Math.sin(s.time * Math.PI * 2 / p.period + p.phase)
        - Math.sin((s.time - dt) * Math.PI * 2 / p.period + p.phase)) : 0;
      p.x += p.vx * dt + swing; p.y += p.vy * dt;
      if (p.y > s.height + 16) { p.y = -16; p.x = s.random() * s.width; }
      if (p.x > s.width + 40) { p.x = -40; if (!p.vy) p.y = s.random() * s.height; }
      if (p.x < -40) { p.x = s.width + 40; if (!p.vy) p.y = s.random() * s.height; }
    }
    // One restrained 140ms flash every 4–8 seconds: never a flashing loop.
    if (s.family === 'thunder' && s.time >= s.nextFlash) {
      s.flashAt = s.time; s.nextFlash = s.time + 4 + s.random() * 4;
    }
    const elapsed = s.time - s.flashAt;
    s.flash = s.flashAt >= 0 && elapsed < .14 ? .22 * Math.sin(elapsed / .14 * Math.PI) : 0;
  }
  function draw(ctx, s) {
    const { width: w, height: h } = s;
    ctx.clearRect(0, 0, w, h);
    if (['fog', 'haze', 'dust'].includes(s.family)) {
      // Ease-in-out breathing, fog 7s / haze 8s, 18–32% opacity; horizontal
      // movement is just ±2% over 12s. Haze is brown, independent of white fog.
      const breath = .18 + .14 * (.5 - .5 * Math.cos(s.time * Math.PI * 2 / (s.family === 'haze' ? 8 : 7)));
      const x = w * (.5 + .02 * Math.sin(s.time * Math.PI * 2 / 12));
      const color = s.family === 'fog' ? '210,220,230' : s.family === 'haze' ? '180,160,120' : '180,145,95';
      const g = ctx.createRadialGradient(x, h * .4, 0, x, h * .4, Math.max(w * .65, h * .7));
      g.addColorStop(0, `rgba(${color},${breath})`); g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    for (const p of s.particles) {
      ctx.beginPath(); ctx.lineWidth = .9;
      if (p.kind.startsWith('snow')) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
        g.addColorStop(0, 'rgba(235,245,255,.5)'); g.addColorStop(1, 'rgba(235,245,255,0)');
        ctx.fillStyle = g; ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'hail') {
        ctx.fillStyle = 'rgba(220,235,255,.55)'; ctx.roundRect(p.x, p.y, p.radius * 1.4, p.radius * 1.4, 1); ctx.fill();
      } else if (p.kind.startsWith('wind')) {
        const alpha = .25 * Math.max(0, Math.sin(Math.PI * Math.max(0, Math.min(1, p.x / w))));
        ctx.strokeStyle = `rgba(220,235,245,${alpha})`;
        ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(p.x + 14, p.y - 4, p.x + 30, p.y); ctx.stroke();
      } else if (p.kind === 'dust') {
        ctx.strokeStyle = 'rgba(205,175,120,.28)'; ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 5, p.y); ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(215,235,255,.25)'; ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx / p.speed * p.length, p.y - p.length); ctx.stroke();
      }
    }
    if (s.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${s.flash})`; ctx.fillRect(0, 0, w, h); }
  }
  function create(tile, isVisible) {
    let canvas, state, raf = 0, last = null, config = { family: 'none', enabled: false, size: 'mini' };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    function stop() {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0; last = null; canvas?.remove(); canvas = null; state = null;
    }
    function resize() {
      if (!canvas) return;
      const width = tile.clientWidth, height = tile.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * dpr)); canvas.height = Math.max(1, Math.round(height * dpr));
      state = scene(config.family, width, height);
    }
    function frame(timestamp) {
      raf = 0;
      if (!isVisible() || document.hidden || media.matches) { stop(); return; }
      const dt = last === null ? 0 : Math.min(.05, Math.max(0, (timestamp - last) / 1000)); last = timestamp;
      step(state, dt);
      const ctx = canvas.getContext('2d');
      if (!ctx) { stop(); return; }
      ctx.setTransform(canvas.width / Math.max(1, state.width), 0, 0, canvas.height / Math.max(1, state.height), 0, 0);
      draw(ctx, state); raf = window.requestAnimationFrame(frame);
    }
    function sync(next = config) {
      const changed = config.family !== next.family || config.size !== next.size;
      config = { ...next };
      const active = config.enabled && ['medium', 'large'].includes(config.size) && config.family !== 'none'
        && !document.hidden && !media.matches && isVisible();
      if (!active || changed || (canvas && !canvas.isConnected)) stop();
      if (!active || canvas) return;
      canvas = document.createElement('canvas'); canvas.className = 'wx-fx'; canvas.setAttribute('aria-hidden', 'true');
      tile.querySelector('.sun-sky')?.after(canvas); resize(); raf = window.requestAnimationFrame(frame);
    }
    const observer = new ResizeObserver(resize); observer.observe(tile);
    const motionChanged = () => sync();
    media.addEventListener('change', motionChanged);
    return { sync, stop, inspect: () => ({ active: Boolean(raf), family: config.family,
      count: state?.particles.length || 0, time: state?.time || 0, flash: state?.flash || 0 }),
    destroy() { stop(); observer.disconnect(); media.removeEventListener('change', motionChanged); } };
  }
  return { SPECS, scene, step, draw, create };
});
