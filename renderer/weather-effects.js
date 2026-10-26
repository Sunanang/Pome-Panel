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
    hail: [30, 100, 160], dust: [14, 20, 40], wind: [10, 50, 80], 'wind-strong': [16, 80, 125],
  };
  function windParticle(kind, width, height, low, high, random) {
    const strong = kind === 'wind-strong';
    return { kind, speed: low + random() * (high - low), low, high,
      x: 0, y: height * (.20 + random() * .56),
      length: Math.min(width * .52, 55 + random() * 120),
      breadth: (strong ? 24 : 18) + random() * 24,
      amplitude: 6 + random() * 14, period: 3.5 + random() * 4,
      phase: random() * Math.PI * 2, gustPeriod: 4 + random() * 4,
      gustPhase: random() * Math.PI * 2, gustAmount: .12 + random() * .30,
      drift: (random() - .5) * 5, tilt: (random() - .5) * .08,
      opacity: (strong ? .12 : .08) + random() * .06,
      enterAt: random() * .10, exitAt: .76 + random() * .24,
      flowSeed: random() * 1000, textureSeed: random() * 1000, texture: null };
  }
  function hash(i, seed) { const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return v - Math.floor(v); }
  function noise(t, seed) {
    const i = Math.floor(t), f = smooth(t-i);
    return hash(i,seed)*(1-f)+hash(i+1,seed)*f;
  }
  function noiseSlope(t, seed) {
    const i = Math.floor(t), f = t-i;
    return (hash(i+1,seed)-hash(i,seed))*6*f*(1-f);
  }
  function windOffset(p, time) {
    return p.amplitude * (noise(time/p.period+p.phase,p.flowSeed)
      + .45*noise(time/(p.period*1.7)+p.phase,p.flowSeed+7));
  }
  function windTexture(p, ctx) {
    // Soft, broken filaments, with no outline or fixed curl silhouette. Noise
    // only builds a cached alpha texture; frames only transform the bitmap.
    const width = 192, height = 80;
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width,height)
      : ctx.canvas.ownerDocument.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const brush = canvas.getContext('2d');
    if (!brush) return null;
    const pixels = brush.createImageData(width,height), seed = p.textureSeed;
    for (let x=0;x<width;x++) {
      const u = x/(width-1), taper = Math.pow(Math.sin(Math.PI*u),.9);
      const center = .46 + .23*(noise(u*3,seed)-.5);
      const spread = .045 + .065*noise(u*4,seed+3);
      const secondary = .59 + .16*(noise(u*4,seed+4)-.5);
      const density = smooth((noise(u*6,seed+5)-.18)/.70);
      for (let y=0;y<height;y++) {
        const v = y/(height-1);
        const main = Math.exp(-.5*Math.pow((v-center)/spread,2));
        const faint = .28*Math.exp(-.5*Math.pow((v-secondary)/(.04+spread*.45),2));
        const edge = smooth(v/.18)*smooth((1-v)/.18);
        const alpha = Math.min(.70,(main+faint)*density*taper*edge);
        const index = (y*width+x)*4;
        pixels.data[index] = 205; pixels.data[index+1] = 226; pixels.data[index+2] = 235;
        pixels.data[index+3] = Math.round(alpha*255);
      }
    }
    brush.putImageData(pixels,0,0);
    return canvas;
  }
  function smooth(value) { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); }
  function scene(family, width, height, random = Math.random) {
    const particles = [];
    const add = (kind, count, low, high) => {
      for (let i = 0; i < count; i++) {
        if (kind.startsWith('wind')) {
          const p = windParticle(kind, width, height, low, high, random);
          p.x = random() * (width + p.length) - p.length / 2;
          particles.push(p); continue;
        }
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
    else if (family === 'rain-wind') { add('rain-mid', ...SPECS['rain-mid']); add('wind', 6, 50, 80); }
    else if (SPECS[family]) add(family, ...SPECS[family]);
    return { family, width, height, particles, time: 0, nextFlash: 4 + random() * 4, flashAt: -1, flash: 0, random };
  }
  function step(s, dt) {
    s.time += dt;
    for (const p of s.particles) {
      if (p.kind.startsWith('wind')) {
        // One prevailing direction, independently seeded smooth deviations.
        // Integrate offsets as differences so 30/60/120Hz follow the same path.
        const omega = Math.PI * 2 / p.gustPeriod;
        p.x += p.speed * (dt + p.gustAmount / omega * (Math.sin(s.time * omega + p.gustPhase)
          - Math.sin((s.time - dt) * omega + p.gustPhase)));
        p.y += p.drift*dt + windOffset(p,s.time)-windOffset(p,s.time-dt);
        if (p.x > s.width + p.length / 2 + 12 || p.y < -p.breadth || p.y > s.height+p.breadth) {
          Object.assign(p, windParticle(p.kind, s.width, s.height, p.low, p.high, s.random));
          p.x = -p.length / 2 - 12;
        }
        continue;
      }
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
      if (!p.kind.startsWith('wind')) { ctx.beginPath(); ctx.lineWidth = .9; }
      if (p.kind.startsWith('snow')) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
        g.addColorStop(0, 'rgba(235,245,255,.5)'); g.addColorStop(1, 'rgba(235,245,255,0)');
        ctx.fillStyle = g; ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'hail') {
        ctx.fillStyle = 'rgba(220,235,255,.55)'; ctx.roundRect(p.x, p.y, p.radius * 1.4, p.radius * 1.4, 1); ctx.fill();
      } else if (p.kind.startsWith('wind')) {
        if (!p.texture) p.texture = windTexture(p, ctx);
        if (!p.texture) continue;
        const progress = Math.max(0, Math.min(1, (p.x + p.length / 2) / (w + p.length)));
        const fade = smooth((progress-p.enterAt)/.16)*smooth((p.exitAt-progress)/.26);
        ctx.save(); ctx.translate(p.x, p.y);
        const vx = p.speed*(1+p.gustAmount*Math.cos(s.time*Math.PI*2/p.gustPeriod+p.gustPhase));
        const vy = p.drift+p.amplitude/p.period*noiseSlope(s.time/p.period+p.phase,p.flowSeed)
          +p.amplitude*.45/(p.period*1.7)*noiseSlope(s.time/(p.period*1.7)+p.phase,p.flowSeed+7);
        ctx.rotate(Math.atan2(vy,vx)+p.tilt);
        ctx.globalAlpha = p.opacity*fade*smooth(s.time/.8)*(s.family==='rain-wind'?.55:1)
          *(.55+.45*noise(s.time/2.5+p.phase,p.flowSeed+11));
        const length = p.length*(.92+.14*noise(s.time/3+p.phase,p.flowSeed+13));
        const breadth = p.breadth*(.85+progress*.4);
        ctx.drawImage(p.texture,-length/2,-breadth/2,length,breadth);
        ctx.restore();
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
