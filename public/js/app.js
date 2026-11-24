/* Employee dashboard */
(async function () {
  'use strict';
  const { esc, nl2br, $ } = SS;
  const cfg = await SS.loadConfig();
  const s = cfg.settings;
  const employee = await SS.session();
  if (!employee) { location.replace(`/login${location.hash === '#reveal' ? '?next=reveal' : ''}`); return; }
  SS.setTitle(s, 'My Dashboard');
  SS.initFx(s);
  $('#footer').innerHTML = SS.footerHtml(s);

  let me = null;
  let editingWishes = false;
  let justSaved = false;

  async function load() {
    me = await SS.api('/api/me');
    render();
  }

  /* --------------------------------------------------------------- nav */
  function renderNav() {
    $('#nav').innerHTML = `<div class="container nav-inner">
      <a class="brand" href="/">${SS.brandHtml(s)}</a>
      <nav class="nav-links" aria-label="Main">
        <a href="/rules" class="hide-sm">Rules</a>
        <button class="icon-btn" id="bell" aria-label="Notifications">🔔${me.unread ? `<span class="badge-dot">${me.unread}</span>` : ''}</button>
        <button class="icon-btn" id="profileBtn" aria-label="My profile" style="padding:0;overflow:hidden">
          ${me.profile.photo ? `<img src="${esc(me.profile.photo)}" alt="" style="width:100%;height:100%;object-fit:cover">` : esc(SS.initials(me.profile.fullName))}
        </button>
      </nav></div>`;
    $('#bell').addEventListener('click', openNotifications);
    $('#profileBtn').addEventListener('click', openProfile);
  }

  /* ------------------------------------------------------------ status */
  function statusCards() {
    const reg = me.registration;
    const wc = me.wishes ? me.wishes.count : 0;
    const a = me.assignment.state;
    const drawLabel = {
      not_registered: ['⏳', 'Waiting for you to join', ''],
      pending: ['🎲', s.draw_date ? `Draw on ${SS.fmtDate(s.draw_date, { day: 'numeric', month: 'short' })}` : 'Draw coming soon', 'waiting'],
      not_included: ['⚠️', 'Not part of this draw', ''],
      locked: ['🔒', 'Names drawn – box sealed', 'waiting'],
      ready: ['🎁', 'Your gift box is ready!', 'done'],
      revealed: ['🎅', 'Assignment unwrapped', 'done'],
    }[a];
    return `<div class="status-grid">
      <div class="card status-card ${reg ? 'done' : ''}"><div class="s-icon">${reg ? '✅' : '📝'}</div>
        <div><div class="s-label">Registration</div><div class="s-value">${reg ? 'Registered' : me.registrationOpen ? 'Not joined yet' : 'Registration closed'}</div></div></div>
      <div class="card status-card ${wc >= me.wishSlots ? 'done' : wc ? 'waiting' : ''}"><div class="s-icon">${wc >= me.wishSlots ? '🎁' : '✍️'}</div>
        <div><div class="s-label">Wish list</div><div class="s-value">${wc >= me.wishSlots ? 'All 3 wishes submitted' : `${wc} of ${me.wishSlots} wishes`}</div></div></div>
      <div class="card status-card ${drawLabel[2]}"><div class="s-icon">${drawLabel[0]}</div>
        <div><div class="s-label">Secret Santa draw</div><div class="s-value">${esc(drawLabel[1])}</div></div></div>
    </div>`;
  }

  /* -------------------------------------------------------------- join */
  function joinCard() {
    if (!me.registrationOpen || me.draw.status !== 'not_started') {
      return `<div class="card"><h2 class="card-title"><span class="emoji">⏸</span> Registrations are closed</h2>
        <p class="muted">Registrations for ${esc(s.event_title)} are closed right now. If you think this is a mistake, please reach out to the HR team.</p></div>`;
    }
    return `<div class="card card-gold" id="join">
      <span class="eyebrow">Step 1 of 2</span>
      <h2 class="card-title"><span class="emoji">🎅</span> Join ${esc(s.event_title)}</h2>
      <p class="muted">${esc(s.join_message)}</p>
      <ul class="muted" style="padding-left:20px;margin:0 0 18px">
        ${(s.rules || []).slice(0, 5).map((r) => `<li>${esc(r.text)}</li>`).join('')}
      </ul>
      <p style="font-size:.9rem"><a href="/rules" target="_blank" rel="noopener">Read all of Santa’s Rules ↗</a></p>
      <label class="check" style="margin-bottom:18px"><input type="checkbox" id="agree"> <span>I agree to Santa’s Rules and promise to keep my assignment a secret 🤫</span></label>
      <button class="btn btn-primary btn-lg btn-glow" id="joinBtn">🎄 Join Secret Santa</button>
    </div>`;
  }

  /* ------------------------------------------------------------ wishes */
  function wishView(w, i) {
    const link = SS.safeUrl(w.link);
    return `<div class="wish-view"><div class="wv-num">${i + 1}</div><div style="min-width:0">
      <h4>${esc(w.name)}</h4>${w.description ? `<p>${esc(w.description)}</p>` : ''}
      <div class="wish-meta">
        ${w.budget ? `<span class="chip chip-gold">💰 ${esc(w.budget)}</span>` : ''}
        ${link ? `<a class="chip" href="${esc(link)}" target="_blank" rel="noopener noreferrer nofollow">🔗 View product ↗</a>` : ''}
      </div></div></div>`;
  }

  function wishesCard() {
    const locked = me.draw.status !== 'not_started';
    const wishes = (me.wishes && me.wishes.wishes) || [];
    const filled = wishes.filter((w) => w.name);
    const examples = String(s.wish_examples || '').split(',').map((x) => x.trim()).filter(Boolean);
    const banner = justSaved ? `<div class="success-banner"><div class="big">🎁✨</div><p style="margin:8px 0 0;font-size:1.05rem">${esc(s.wish_saved_message)}</p></div>` : '';

    if (locked || (filled.length && !editingWishes)) {
      return `<div class="card" id="wishes">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
          <h2 class="card-title" style="margin:0"><span class="emoji">🎁</span> My Christmas Wishes</h2>
          ${locked ? '<span class="chip chip-muted">🔒 Locked after the draw</span>' : '<button class="btn btn-ghost btn-sm" id="editWishes">✏️ Edit wishes</button>'}
        </div>
        ${banner}
        ${filled.length ? filled.map(wishView).join('') : '<div class="empty"><span class="big">🫙</span>No wishes were submitted.</div>'}
        ${!locked && filled.length < me.wishSlots ? `<p class="form-error">You have ${filled.length} of ${me.wishSlots} wishes. Add all ${me.wishSlots} to be included in the draw.</p>` : ''}
        <p class="muted" style="font-size:.88rem;margin:10px 0 0">🔐 Only your Secret Santa will ever see these – and only after the draw.</p>
      </div>`;
    }

    const slot = (i) => {
      const w = wishes[i] || {};
      return `<div class="wish-card"><span class="wish-num">WISH #${i + 1}</span>
        <div class="field" style="margin-top:6px"><label for="w${i}n">Gift name</label>
          <input id="w${i}n" name="name" maxlength="120" value="${esc(w.name || '')}" placeholder="${esc(examples[i] || 'Something you would love')}"></div>
        <div class="field"><label for="w${i}d">Short description <span class="muted">(optional)</span></label>
          <textarea id="w${i}d" name="description" maxlength="500" rows="2" placeholder="Colour, size, brand, flavour…">${esc(w.description || '')}</textarea></div>
        <div class="row">
          <div class="field"><label for="w${i}l">Product link <span class="muted">(optional)</span></label>
            <input id="w${i}l" name="link" type="url" maxlength="500" value="${esc(w.link || '')}" placeholder="https://"></div>
          <div class="field"><label for="w${i}b">Price / budget <span class="muted">(optional)</span></label>
            <input id="w${i}b" name="budget" maxlength="60" value="${esc(w.budget || '')}" placeholder="${esc(s.currency_symbol)}${esc(s.budget_min)}–${esc(s.budget_max)}"></div>
        </div></div>`;
    };
    return `<div class="card card-gold" id="wishes">
      <span class="eyebrow">Step 2 of 2</span>
      <h2 class="card-title"><span class="emoji">🎁</span> Submit Your 3 Christmas Wishes</h2>
      <p class="muted">${esc(s.wishes_intro)} Budget: <strong class="gold">${esc(cfg.budgetLabel)}</strong>.</p>
      <form id="wishForm" novalidate style="margin-top:22px">
        ${[0, 1, 2].map(slot).join('')}
        <div id="wishErr"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button type="submit" class="btn btn-primary btn-lg btn-glow">✨ Save My Christmas Wishes</button>
          ${filled.length ? '<button type="button" class="btn btn-ghost" id="cancelEdit">Cancel</button>' : ''}
        </div>
      </form></div>`;
  }

  /* ------------------------------------------------------------ reveal */
  function giftBoxHtml(state) {
    const cls = state === 'ready' ? 'ready clickable' : 'idle';
    return `<div class="giftbox ${cls}" id="giftbox" ${state === 'ready' ? 'role="button" tabindex="0" aria-label="Unwrap your gift"' : ''}>
      <div class="gb-rays"></div><div class="gb-glow"></div><div class="gb-shadow"></div>
      <div class="gb-body"></div>
      <div class="gb-lid"><div class="gb-bow"><span></span><span></span></div></div>
      <div class="gb-tag">${state === 'ready' ? 'Open me!' : 'Soon…'}</div>
      ${state === 'locked' ? '<div class="gb-lock">🔒</div>' : ''}
    </div>`;
  }

  function recipientHtml(r) {
    return `<div class="recipient">
      <div class="recipient-heading">${esc(s.reveal_heading)}</div>
      ${SS.avatar(r.fullName, r.photo)}
      <div class="recipient-name">${esc(r.fullName)}</div>
      <div class="recipient-dept">${esc([r.department, r.designation].filter(Boolean).join(' · ') || s.company_name)}${r.location ? ` · 📍 ${esc(r.location)}` : ''}</div>
      <div class="recipient-mission">${esc(s.reveal_mission)}</div>
      <div class="recipient-wishes">
        <h3 class="card-title" style="font-size:1.1rem"><span class="emoji">📜</span> Their Christmas wishes</h3>
        ${r.wishes.length ? r.wishes.map(wishView).join('') : '<div class="empty"><span class="big">🎁</span>They didn’t add specific wishes – surprise them with something thoughtful!</div>'}
      </div>
      <div class="hero-chips" style="margin-top:18px">
        <span class="chip chip-gold">🎁 Gift budget: ${esc(cfg.budgetLabel)}</span>
        ${s.exchange_date ? `<span class="chip">📅 Gift exchange: ${esc(SS.fmtDay(s.exchange_date))}</span>` : ''}
        ${s.exchange_venue ? `<span class="chip">📍 ${esc(s.exchange_venue)}</span>` : ''}
      </div>
      ${s.budget_note ? `<p class="muted" style="font-size:.9rem;margin-top:12px">${esc(s.budget_note)}</p>` : ''}
      <div class="secret-note">🤫 Shhh… this is top-secret elf business. Don’t reveal your assignment to anyone!</div>
    </div>`;
  }

  function revealCard() {
    const a = me.assignment;
    let inner;
    if (a.state === 'revealed') {
      inner = recipientHtml(a.recipient);
    } else if (a.state === 'ready') {
      inner = `<div class="reveal-stage">${giftBoxHtml('ready')}</div>
        <div class="suspense-text" id="suspense">Your Secret Santa mission awaits…</div>
        <button class="btn btn-gold btn-lg btn-glow" id="unwrapBtn">🎁 ${esc(s.reveal_button_text)}</button>`;
    } else if (a.state === 'locked') {
      inner = `<div class="reveal-stage">${giftBoxHtml('locked')}</div><p class="muted">${esc(s.locked_message)}</p>`;
    } else if (a.state === 'not_included') {
      inner = `<div class="reveal-stage">${giftBoxHtml('idle')}</div>
        <p class="muted">You weren’t included in this year’s draw (for example, if registration or wishes were incomplete when the names were drawn). Please contact the HR team.</p>`;
    } else {
      inner = `<div class="reveal-stage">${giftBoxHtml('idle')}</div><p class="muted">${esc(s.waiting_message)}</p>
        ${s.draw_date ? `<span class="chip chip-gold">🎲 Draw date: ${esc(SS.fmtDate(s.draw_date))}</span>` : ''}`;
    }
    return `<div class="card card-gold reveal-card" id="reveal">
      <h2 class="card-title" style="justify-content:center"><span class="emoji">🎁</span> Reveal Your Person</h2>
      <div id="revealInner">${inner}</div></div>`;
  }

  async function unwrap() {
    const btn = $('#unwrapBtn');
    const box = $('#giftbox');
    const text = $('#suspense');
    if (!box || box.classList.contains('shaking')) return;
    if (btn) btn.disabled = true;
    box.classList.remove('ready', 'clickable');
    const say = (t) => { text.textContent = t; text.classList.remove('flash'); void text.offsetWidth; text.classList.add('flash'); };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const request = SS.api('/api/assignment/reveal', { method: 'POST' });
    try {
      box.classList.add('shaking'); say('The elves are checking the list…');
      await wait(1300);
      box.classList.add('intense'); say('…checking it twice…');
      await wait(1300);
      const result = await request;
      box.classList.remove('shaking', 'intense'); box.classList.add('open'); say('Ho ho ho! 🎅');
      SS.confetti();
      await wait(1100);
      box.classList.add('gone');
      await wait(550);
      me.assignment = result;
      $('#revealInner').innerHTML = recipientHtml(result.recipient);
      SS.confetti({ count: 140 });
      const statuses = $('.status-grid');
      if (statuses) statuses.outerHTML = statusCards();
    } catch (err) {
      box.classList.remove('shaking', 'intense');
      box.classList.add('ready', 'clickable');
      if (btn) btn.disabled = false;
      say('');
      SS.toast(err.message, 'error');
    }
  }

  /* ------------------------------------------------------------ layout */
  function render() {
    renderNav();
    const p = me.profile;
    const drawStarted = me.draw.status !== 'not_started';
    const left = !me.registration ? joinCard() : wishesCard();
    const avatarCls = s.allow_employee_photo_upload ? 'avatar-edit' : '';
    const avatarInner = p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(SS.initials(p.fullName));
    const aside = `
      <div class="card">
        <h3 class="card-title"><span class="emoji">💰</span> Gift budget</h3>
        <div class="budget-amount" style="font-size:2rem;margin:0 0 6px">${esc(cfg.budgetLabel)}</div>
        <p class="muted" style="margin:0">${esc(s.budget_note)}</p>
      </div>`;

    $('#main').innerHTML = `<div class="container">
      <div class="dash-head">
        <div class="avatar ${avatarCls}" id="avatar" ${s.allow_employee_photo_upload ? 'role="button" tabindex="0" title="Change photo"' : ''}>${avatarInner}</div>
        <div><h1>Ho ho ho, ${esc(p.firstName)}! 🎄</h1>
          <div class="sub">${esc([p.department, p.designation].filter(Boolean).join(' · '))}${p.department || p.designation ? ' · ' : ''}${esc(p.employeeCode)}</div></div>
        <div class="spacer"></div>
        <div class="mini-countdown" id="miniCountdown"></div>
      </div>
      ${statusCards()}
      ${drawStarted
        ? `${revealCard()}<div class="dash-grid" style="margin-top:24px"><div>${me.registration ? wishesCard() : joinCard()}</div><div class="stack">${aside}</div></div>`
        : `<div class="dash-grid"><div>${left}</div><div class="stack">${revealCard()}${aside}</div></div>`}
    </div>`;

    SS.countdown($('#miniCountdown'), s.christmas_date, { label: s.countdown_label, compact: true });
    bind();
    justSaved = false;
  }

  function bind() {
    const joinBtn = $('#joinBtn');
    if (joinBtn) joinBtn.addEventListener('click', async () => {
      if (!$('#agree').checked) { SS.toast('Please tick the box to agree to Santa’s Rules.', 'error'); return; }
      SS.busy(joinBtn, true);
      try {
        await SS.api('/api/registration', { method: 'POST', body: { agree: true } });
        SS.confetti({ count: 120 });
        SS.toast('Welcome aboard, elf! Now add your 3 wishes.', 'success');
        editingWishes = true;
        await load();
        $('#wishes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) { SS.toast(err.message, 'error'); SS.busy(joinBtn, false); }
    });

    const edit = $('#editWishes');
    if (edit) edit.addEventListener('click', () => { editingWishes = true; render(); $('#wishes')?.scrollIntoView({ behavior: 'smooth' }); });
    const cancel = $('#cancelEdit');
    if (cancel) cancel.addEventListener('click', () => { editingWishes = false; render(); });

    const form = $('#wishForm');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const wishes = SS.$$('.wish-card', form).map((card) => ({
        name: card.querySelector('[name=name]').value,
        description: card.querySelector('[name=description]').value,
        link: card.querySelector('[name=link]').value,
        budget: card.querySelector('[name=budget]').value,
      }));
      const count = wishes.filter((w) => w.name.trim()).length;
      $('#wishErr').innerHTML = '';
      if (count === 0) { $('#wishErr').innerHTML = '<div class="form-error">Please add at least one wish – ideally all three!</div>'; return; }
      if (count < me.wishSlots && !(await SS.confirm({ title: 'Only ' + count + ' wish' + (count === 1 ? '' : 'es') + '?', message: `You need all ${me.wishSlots} wishes to be included in the draw. Save what you have for now?`, confirmText: 'Save anyway' }))) return;
      const btn = form.querySelector('[type=submit]');
      SS.busy(btn, true, ' Tucking into Santa’s box…');
      try {
        await SS.api('/api/wishes', { method: 'PUT', body: { wishes } });
        editingWishes = false;
        justSaved = true;
        SS.confetti({ count: 90 });
        await load();
        $('#wishes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        $('#wishErr').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
        SS.busy(btn, false);
      }
    });

    const box = $('#giftbox.clickable');
    if (box) {
      box.addEventListener('click', unwrap);
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); unwrap(); } });
    }
    const unwrapBtn = $('#unwrapBtn');
    if (unwrapBtn) unwrapBtn.addEventListener('click', unwrap);

    const avatar = $('#avatar.avatar-edit');
    if (avatar) {
      avatar.addEventListener('click', openProfile);
      avatar.addEventListener('keydown', (e) => { if (e.key === 'Enter') openProfile(); });
    }
  }

  /* ----------------------------------------------------- notifications */
  async function openNotifications() {
    const back = document.createElement('div');
    back.className = 'drawer-backdrop';
    const drawer = document.createElement('aside');
    drawer.className = 'drawer';
    drawer.setAttribute('aria-label', 'Notifications');
    drawer.innerHTML = `<div class="drawer-head"><h3>🔔 Notifications</h3><button class="icon-btn" aria-label="Close">✕</button></div>
      <div class="drawer-body"><div class="empty"><span class="big">⏳</span></div></div>`;
    const close = () => { back.remove(); drawer.remove(); };
    back.addEventListener('click', close);
    drawer.querySelector('button').addEventListener('click', close);
    document.body.append(back, drawer);
    try {
      const { notifications } = await SS.api('/api/notifications');
      drawer.querySelector('.drawer-body').innerHTML = notifications.length
        ? notifications.map((n) => `<div class="notif ${n.read_at ? '' : 'unread'}"><h4>${esc(n.title)}</h4><p>${esc(n.body)}</p><time>${esc(SS.timeAgo(n.created_at))}</time></div>`).join('')
        : '<div class="empty"><span class="big">📭</span>No notifications yet. The elves will write soon!</div>';
      if (me.unread) {
        await SS.api('/api/notifications/read', { method: 'POST' });
        me.unread = 0;
        renderNav();
      }
    } catch (err) { SS.toast(err.message, 'error'); }
  }

  /* ----------------------------------------------------------- profile */
  function openProfile() {
    const p = me.profile;
    SS.modal({
      title: 'My profile',
      html: `<div style="display:flex;gap:18px;align-items:center;margin-bottom:20px">
          ${SS.avatar(p.fullName, p.photo, 76)}
          <div><strong style="font-size:1.1rem">${esc(p.fullName)}</strong><div class="muted" style="font-size:.9rem">${esc(p.email)}<br>${esc(p.employeeCode)}${p.department ? ` · ${esc(p.department)}` : ''}</div></div>
        </div>
        ${s.allow_employee_photo_upload ? `<div class="field"><label>Profile photo</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <label class="btn btn-ghost btn-sm" style="cursor:pointer">📷 Upload photo<input type="file" id="photoInput" accept="image/png,image/jpeg,image/webp,image/gif" class="sr-only"></label>
            ${p.photo ? '<button class="btn btn-ghost btn-sm" id="removePhoto">Remove</button>' : ''}
          </div><span class="hint">Your photo is only shown to you and to your Secret Santa after they unwrap their box.</span></div>` : ''}
        <form id="pwForm" style="margin-top:18px;border-top:1px solid var(--glass-border);padding-top:18px">
          <div class="label" style="margin-bottom:10px">${me.hasPassword ? 'Change password' : 'Set a password'}</div>
          ${me.hasPassword ? '<div class="field"><input type="password" name="current" placeholder="Current password" autocomplete="current-password"></div>' : ''}
          <div class="field"><input type="password" name="next" placeholder="New password (8+ chars, letter + number)" autocomplete="new-password"></div>
          <button class="btn btn-ghost btn-sm" type="submit">Save password</button>
        </form>
        <div class="modal-actions"><button class="btn btn-danger btn-sm" id="logout">Sign out</button></div>`,
      onOpen: (m, close) => {
        const input = m.querySelector('#photoInput');
        if (input) input.addEventListener('change', async () => {
          if (!input.files[0]) return;
          const fd = new FormData();
          fd.append('photo', input.files[0]);
          try { await SS.api('/api/me/photo', { method: 'POST', form: fd }); SS.toast('Looking festive! Photo updated.', 'success'); close(); await load(); }
          catch (err) { SS.toast(err.message, 'error'); }
        });
        const rm = m.querySelector('#removePhoto');
        if (rm) rm.addEventListener('click', async () => {
          try { await SS.api('/api/me/photo', { method: 'DELETE' }); close(); await load(); } catch (err) { SS.toast(err.message, 'error'); }
        });
        m.querySelector('#pwForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          try {
            await SS.api('/api/me/password', { method: 'POST', body: { current: fd.get('current'), next: fd.get('next') } });
            SS.toast('Password saved.', 'success'); me.hasPassword = true; close();
          } catch (err) { SS.toast(err.message, 'error'); }
        });
        m.querySelector('#logout').addEventListener('click', async () => {
          await SS.api('/api/auth/logout', { method: 'POST' }).catch(() => {});
          location.href = '/';
        });
      },
    });
  }

  try {
    await load();
    if (location.hash === '#reveal') setTimeout(() => $('#reveal')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
  } catch (err) {
    if (err.status === 401) location.replace('/login');
    else $('#main').innerHTML = `<div class="loading-screen"><p>${esc(err.message)}</p></div>`;
  }
})();
