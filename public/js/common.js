/* Shared helpers for every page: API client, site config + theme, festive effects, toasts. */
(function () {
  'use strict';

  const SS = (window.SS = {
    config: null,
    csrf: null, // employee CSRF token
    adminCsrf: null, // admin CSRF token
  });

  /* ------------------------------------------------------------ helpers */
  SS.esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  SS.nl2br = (v) => SS.esc(v).replace(/\n/g, '<br>');
  SS.$ = (sel, root = document) => root.querySelector(sel);
  SS.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  SS.initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  SS.safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);
  SS.firstName = (n) => String(n || '').split(/\s+/)[0];

  SS.fmtDate = (v, opts = { dateStyle: 'medium', timeStyle: 'short' }) => {
    if (!v) return 'To be announced';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString('en-IN', opts);
  };
  SS.fmtDay = (v) => SS.fmtDate(v, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  SS.timeAgo = (v) => {
    const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
    return SS.fmtDate(v, { dateStyle: 'medium' });
  };

  SS.avatar = (name, photo, size) => {
    const style = size ? ` style="--s:${size}px"` : '';
    return photo
      ? `<div class="avatar"${style}><img src="${SS.esc(photo)}" alt=""></div>`
      : `<div class="avatar"${style}>${SS.esc(SS.initials(name))}</div>`;
  };

  /* --------------------------------------------------------------- API */
  SS.api = async function api(path, { method = 'GET', body, form } = {}) {
    const headers = {};
    const token = path.startsWith('/api/admin') ? SS.adminCsrf : SS.csrf;
    if (method !== 'GET' && token) headers['X-CSRF-Token'] = token;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await res.json() : await res.text();
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  /* ------------------------------------------------------- site config */
  SS.loadConfig = async function loadConfig() {
    const cfg = await SS.api('/api/public/config');
    SS.config = cfg;
    SS.applyTheme(cfg.settings);
    return cfg;
  };

  SS.applyTheme = function applyTheme(s) {
    const root = document.documentElement.style;
    if (s.theme_midnight) root.setProperty('--midnight', s.theme_midnight);
    if (s.theme_red) root.setProperty('--red', s.theme_red);
    if (s.theme_green) root.setProperty('--green', s.theme_green);
    if (s.theme_gold) root.setProperty('--gold', s.theme_gold);
  };

  SS.brandHtml = function brandHtml(s) {
    const mark = s.logo ? `<img src="${SS.esc(s.logo)}" alt="${SS.esc(s.company_name)} logo">` : '<span class="brand-mark">🎄</span>';
    return `${mark}<span>${SS.esc(s.company_short || s.company_name)} Secret Santa<small>${SS.esc(s.company_name)}</small></span>`;
  };

  SS.titleHtml = function titleHtml(s) {
    return `${s.title_emoji_left ? `<span class="emoji" aria-hidden="true">${SS.esc(s.title_emoji_left)}</span>` : ''}
      <span class="title-text">${SS.esc(s.event_title)}</span>
      ${s.title_emoji_right ? `<span class="emoji" aria-hidden="true">${SS.esc(s.title_emoji_right)}</span>` : ''}`;
  };

  SS.footerHtml = function footerHtml(s) {
    return `<div class="container">
      <div class="brandline">${SS.esc(s.event_title)} ${SS.esc(s.title_emoji_left || '')}</div>
      <div class="slogan">“${SS.esc(s.slogan)}”</div>
      <small>${SS.esc(s.footer_text || '')}</small>
    </div>`;
  };

  SS.setTitle = (s, page) => { document.title = page ? `${page} · ${s.event_title}` : s.event_title; };

  /* ----------------------------------------------------------- toasts */
  SS.toast = function toast(message, type = 'info', ms = 4200) {
    let box = SS.$('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icon = type === 'success' ? '🎁' : type === 'error' ? '⚠️' : '✨';
    el.innerHTML = `<span>${icon}</span><span>${SS.esc(message)}</span>`;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 320); }, ms);
  };

  /* ------------------------------------------------------------ modal */
  SS.modal = function modal({ title, html, wide = false, onOpen }) {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${SS.esc(title)}">
      <div class="modal-head"><h3>${SS.esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <div class="modal-body">${html}</div></div>`;
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    const first = back.querySelector('input, select, textarea');
    if (first) setTimeout(() => first.focus(), 50);
    if (onOpen) onOpen(back.querySelector('.modal'), close);
    return close;
  };

  SS.confirm = function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      let done = false;
      const close = SS.modal({
        title,
        html: `<p class="muted">${SS.nl2br(message)}</p><div class="modal-actions">
          <button class="btn btn-ghost btn-sm" data-close>Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm" data-ok>${SS.esc(confirmText)}</button></div>`,
        onOpen: (m, c) => {
          m.querySelector('[data-ok]').addEventListener('click', () => { done = true; c(); resolve(true); });
          const obs = new MutationObserver(() => { if (!document.body.contains(m)) { obs.disconnect(); if (!done) resolve(false); } });
          obs.observe(document.body, { childList: true });
        },
      });
      return close;
    });
  };

  SS.busy = function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span>${label ? SS.esc(label) : ''}`;
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  };

  /* ---------------------------------------------------------- effects */
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  SS.lights = function lights(container) {
    if (!container) return;
    const colors = ['#ff3b4f', '#ffd257', '#3ddc84', '#4fc3ff', '#ff8a3d', '#f06bff'];
    const count = Math.max(10, Math.min(46, Math.floor(window.innerWidth / 38)));
    container.innerHTML = Array.from({ length: count }, (_, i) =>
      `<span class="bulb" style="--c:${colors[i % colors.length]};--d:${(-Math.random() * 2.2).toFixed(2)}s"></span>`).join('');
  };

  SS.snow = function snow(density = 'medium') {
    if (reduceMotion || SS._snow) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'snow-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    const ctx = canvas.getContext('2d');
    const factor = { light: 0.5, medium: 1, heavy: 1.8 }[density] || 1;
    let flakes = [];
    let w = 0; let h = 0;
    const resize = () => {
      w = canvas.width = window.innerWidth * devicePixelRatio;
      h = canvas.height = window.innerHeight * devicePixelRatio;
      const count = Math.round(Math.min(220, (window.innerWidth * window.innerHeight) / 9000) * factor);
      flakes = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: (Math.random() * 2.2 + 0.6) * devicePixelRatio,
        s: (Math.random() * 0.6 + 0.25) * devicePixelRatio,
        d: Math.random() * Math.PI * 2,
        o: Math.random() * 0.5 + 0.35,
      }));
    };
    resize();
    window.addEventListener('resize', resize);
    let running = true;
    document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) requestAnimationFrame(loop); });
    function loop() {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        f.y += f.s;
        f.d += 0.01;
        f.x += Math.sin(f.d) * 0.4 * devicePixelRatio;
        if (f.y > h + 5) { f.y = -5; f.x = Math.random() * w; }
        ctx.beginPath();
        ctx.fillStyle = `rgba(255,255,255,${f.o})`;
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(loop);
    }
    SS._snow = true;
    requestAnimationFrame(loop);
  };

  SS.confetti = function confetti({ count = 220, duration = 4500 } = {}) {
    const canvas = document.createElement('canvas');
    canvas.id = 'confetti-canvas';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const dpr = devicePixelRatio;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    const css = getComputedStyle(document.documentElement);
    const palette = [css.getPropertyValue('--red'), css.getPropertyValue('--green'), css.getPropertyValue('--gold'), '#ffffff', '#ffd257', '#3ddc84']
      .map((c) => c.trim()).filter(Boolean);
    const cx = canvas.width / 2;
    const cy = canvas.height * 0.45;
    const parts = Array.from({ length: reduceMotion ? 40 : count }, () => {
      const a = Math.random() * Math.PI * 2;
      const v = (Math.random() * 9 + 5) * dpr;
      return {
        x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 7 * dpr,
        w: (Math.random() * 8 + 5) * dpr, h: (Math.random() * 5 + 3) * dpr,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        c: palette[Math.floor(Math.random() * palette.length)], shape: Math.random() < 0.3 ? 'circle' : 'rect',
      };
    });
    const start = performance.now();
    function frame(t) {
      const el = t - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = Math.max(0, 1 - el / duration);
      for (const p of parts) {
        p.vy += 0.22 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
        if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.h / 1.4, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (el < duration) requestAnimationFrame(frame); else canvas.remove();
    }
    requestAnimationFrame(frame);
  };

  SS.countdown = function countdown(el, target, { label, compact = false } = {}) {
    if (!el) return;
    const t = new Date(target).getTime();
    const units = [['days', 'Days'], ['hours', 'Hours'], ['mins', compact ? 'Min' : 'Minutes'], ['secs', compact ? 'Sec' : 'Seconds']];
    el.innerHTML = `<div class="countdown">${label ? `<div class="countdown-label">${SS.esc(label)}</div>` : ''}
      <div class="countdown-grid">${units.map(([k, l]) => `<div class="cd-unit"><span class="cd-num" data-k="${k}">--</span><span class="cd-lbl">${l}</span></div>`).join('')}</div></div>`;
    const nums = Object.fromEntries(units.map(([k]) => [k, el.querySelector(`[data-k=${k}]`)]));
    const tick = () => {
      const diff = t - Date.now();
      if (Number.isNaN(t)) return;
      if (diff <= 0) {
        el.innerHTML = '<div class="countdown"><div class="countdown-done">🎄 Merry Christmas! 🎅</div></div>';
        clearInterval(timer);
        return;
      }
      const v = { days: Math.floor(diff / 864e5), hours: Math.floor(diff / 36e5) % 24, mins: Math.floor(diff / 6e4) % 60, secs: Math.floor(diff / 1e3) % 60 };
      for (const k in v) nums[k].textContent = String(v[k]).padStart(2, '0');
    };
    const timer = setInterval(tick, 1000);
    tick();
  };

  SS.initFx = function initFx(s) {
    if (s.lights_enabled !== false) SS.lights(SS.$('.lights'));
    else { const l = SS.$('.lights'); if (l) l.remove(); }
    if (s.snow_enabled !== false) SS.snow(s.snow_density);
    SS.music(s, SS.config && SS.config.music);
  };

  /* ------------------------------------------------- background music */
  // Plays HR's playlist on the employee-facing pages. Browsers only allow sound once the visitor has
  // interacted with the site, so when autoplay is blocked it starts on the first click / tap / key.
  // The mute choice is remembered per browser; the song + position carry over from page to page.
  SS.music = function music(s, tracks) {
    if (SS._music || !s || !s.music_enabled || !Array.isArray(tracks) || !tracks.length) return;
    SS._music = true;
    const STATE_KEY = 'ss_music_state';
    const MUTE_KEY = 'ss_music_muted';
    const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'];
    const read = (store, key) => { try { return window[store].getItem(key); } catch { return null; } };
    const write = (store, key, v) => { try { window[store].setItem(key, v); } catch { /* storage blocked */ } };
    const signature = tracks.map((t) => t.url).join('|');
    const newOrder = () => {
      const a = tracks.map((_, i) => i);
      if (s.music_shuffle) for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    };

    let saved = null;
    try { saved = JSON.parse(read('sessionStorage', STATE_KEY) || 'null'); } catch { saved = null; }
    const resume = Boolean(saved && saved.sig === signature && Array.isArray(saved.order) && saved.order.length === tracks.length);
    let order = resume ? saved.order : newOrder();
    let pos = resume ? Math.min(Math.max(0, Number(saved.pos) || 0), order.length - 1) : 0;
    const startAt = resume ? Number(saved.time) || 0 : 0;
    let muted = read('localStorage', MUTE_KEY) === '1';
    let failures = 0;
    let pausedByHide = false;
    const volume = Math.min(1, Math.max(0.01, (Number(s.music_volume) || 35) / 100));

    const audio = new Audio();
    audio.preload = 'auto';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'music-btn';
    btn.innerHTML = '<span class="music-icon" aria-hidden="true"></span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="music-hint">Tap anywhere for music 🎶</span>';
    document.body.appendChild(btn);

    const current = () => tracks[order[pos]] || tracks[0];
    const save = () => write('sessionStorage', STATE_KEY, JSON.stringify({ sig: signature, order, pos, time: audio.currentTime || 0 }));
    const paint = () => {
      btn.classList.toggle('playing', !muted && !audio.paused);
      btn.classList.toggle('muted', muted);
      const label = muted ? 'Music is off – click to play' : `Now playing: ${current().title || 'Christmas music'} – click to mute`;
      btn.title = label;
      btn.setAttribute('aria-label', label);
      SS.$('.music-icon', btn).textContent = muted ? '🔇' : '🎵';
    };
    const load = (time = 0) => {
      audio.src = current().url;
      if (time > 0) {
        audio.addEventListener('loadedmetadata', () => {
          try { audio.currentTime = Math.min(time, Math.max(0, (audio.duration || time) - 1)); } catch { /* ignore */ }
        }, { once: true });
      }
    };
    const fadeIn = () => {
      let v = 0;
      const step = () => { v = Math.min(volume, v + volume / 20); audio.volume = v; if (v < volume) setTimeout(step, 60); };
      audio.volume = 0;
      step();
    };
    const play = () => {
      if (muted || document.hidden) return;
      if (!audio.src) load(startAt);
      audio.play().then(() => { failures = 0; }).catch((err) => {
        if (err && err.name === 'NotAllowedError') btn.classList.add('needs-tap'); // autoplay blocked – wait for a gesture
        paint();
      });
    };
    const next = () => {
      pos += 1;
      if (pos >= order.length) { pos = 0; if (s.music_shuffle && order.length > 2) order = newOrder(); }
      load();
      play();
    };
    const onGesture = (e) => { if (!btn.contains(e.target) && audio.paused) play(); };

    let faded = false;
    audio.addEventListener('playing', () => {
      btn.classList.remove('needs-tap');
      GESTURES.forEach((t) => document.removeEventListener(t, onGesture, true));
      if (!faded) { faded = true; fadeIn(); }
      paint();
    });
    audio.addEventListener('pause', paint);
    audio.addEventListener('ended', next);
    audio.addEventListener('error', () => { failures += 1; if (failures < tracks.length) next(); else paint(); });
    let lastSave = 0;
    audio.addEventListener('timeupdate', () => { const n = Date.now(); if (n - lastSave > 2000) { lastSave = n; save(); } });
    window.addEventListener('pagehide', save);
    // Pause while the tab is in the background, carry on when the visitor comes back
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (!audio.paused) { pausedByHide = true; audio.pause(); } save(); }
      else if (pausedByHide) { pausedByHide = false; play(); }
    });
    btn.addEventListener('click', () => {
      if (!muted && audio.paused) { play(); return; } // autoplay was blocked – this click starts the music
      muted = !muted;
      write('localStorage', MUTE_KEY, muted ? '1' : '0');
      if (muted) { audio.pause(); btn.classList.remove('needs-tap'); } else play();
      paint();
    });

    GESTURES.forEach((t) => document.addEventListener(t, onGesture, true));
    paint();
    play();
  };

  /** Standard public-page nav. */
  SS.renderNav = function renderNav(s, { active, loggedIn } = {}) {
    const nav = SS.$('#nav');
    if (!nav) return;
    nav.innerHTML = `<div class="container nav-inner">
      <a class="brand" href="/">${SS.brandHtml(s)}</a>
      <nav class="nav-links" aria-label="Main">
        <a href="/" class="hide-sm ${active === 'home' ? 'active' : ''}">Home</a>
        <a href="/rules" class="${active === 'rules' ? 'active' : ''}">Rules</a>
        ${loggedIn ? '<a href="/app" class="btn btn-gold btn-sm">My Dashboard</a>' : '<a href="/login" class="btn btn-gold btn-sm">Sign in</a>'}
      </nav></div>`;
  };

  SS.session = async function session() {
    try {
      const s = await SS.api('/api/session');
      SS.csrf = s.csrf;
      return s.employee;
    } catch { return null; }
  };

  SS.treeSvg = function treeSvg(cls) {
    return `<svg class="tree-deco ${cls}" viewBox="0 0 200 260" aria-hidden="true">
      <defs><linearGradient id="tg-${cls}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:var(--green-bright)"/><stop offset="1" style="stop-color:var(--green)"/></linearGradient></defs>
      <polygon class="star" points="100,6 107,24 126,24 111,35 117,53 100,42 83,53 89,35 74,24 93,24" style="fill:var(--gold)"/>
      <path d="M100 40 L150 110 L125 110 L170 170 L140 170 L190 235 L10 235 L60 170 L30 170 L75 110 L50 110 Z" fill="url(#tg-${cls})" opacity=".9"/>
      <rect x="88" y="235" width="24" height="22" rx="3" fill="#5b3a1e"/>
      <g>${[[100, 75], [80, 105], [118, 120], [70, 150], [130, 150], [100, 160], [55, 200], [90, 205], [125, 200], [150, 215], [40, 225]].map(([x, y], i) =>
        `<circle class="tw" cx="${x}" cy="${y}" r="5" fill="${['#ff3b4f', '#ffd257', '#4fc3ff', '#ffffff'][i % 4]}"/>`).join('')}</g>
      <path d="M62 140 Q100 160 140 132 M48 188 Q100 210 155 180" style="stroke:var(--gold)" stroke-width="2.5" fill="none" opacity=".8"/>
    </svg>`;
  };
})();
