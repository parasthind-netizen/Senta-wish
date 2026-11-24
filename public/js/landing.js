/* Landing page */
(async function () {
  'use strict';
  const { esc, nl2br } = SS;
  let cfg;
  try {
    [cfg] = await Promise.all([SS.loadConfig()]);
  } catch {
    SS.$('#main').innerHTML = '<div class="loading-screen"><p>Could not reach the North Pole. Please refresh.</p></div>';
    return;
  }
  const s = cfg.settings;
  const me = await SS.session();
  SS.setTitle(s);
  SS.renderNav(s, { active: 'home', loggedIn: Boolean(me) });
  SS.initFx(s);

  const regOpen = s.registration_open && cfg.drawStatus === 'not_started';
  const joinHref = me ? '/app' : '/login?mode=signup';
  const revealHref = me ? '/app#reveal' : '/login?next=reveal';
  const dates = [
    ['📝', 'Registration closes', s.registration_deadline],
    ['🎲', 'The magic draw', s.draw_date],
    ['🎁', 'Gift exchange', s.exchange_date, s.exchange_venue],
    ['🎄', 'Christmas Day', s.christmas_date],
  ].filter((d) => d[2]);

  const statusChip = cfg.drawStatus === 'released'
    ? '<span class="chip chip-green">🎁 Gift boxes are open – unwrap yours!</span>'
    : cfg.drawStatus === 'completed'
      ? '<span class="chip chip-gold">🔒 Names drawn – gift boxes opening soon</span>'
      : regOpen
        ? `<span class="chip chip-green">✅ Registration open${s.registration_deadline ? ` until ${esc(SS.fmtDate(s.registration_deadline, { day: 'numeric', month: 'short' }))}` : ''}</span>`
        : '<span class="chip chip-red">⏸ Registration closed</span>';

  const ornaments = [
    { left: '6%', len: 70, size: 40, c: 'var(--red)', d: '0s' },
    { left: '13%', len: 120, size: 30, c: 'var(--gold)', d: '-1s' },
    { left: '84%', len: 100, size: 36, c: 'var(--green-bright)', d: '-2s' },
    { left: '92%', len: 60, size: 46, c: 'var(--red)', d: '-.5s' },
  ].map((o) => `<div class="ornament" style="left:${o.left};--len:${o.len}px;--size:${o.size}px;--oc:${o.c};animation-delay:${o.d}"><div class="ball"></div></div>`).join('');

  SS.$('#main').innerHTML = `
    <section class="hero ${s.hero_image ? 'has-image' : ''}" ${s.hero_image ? `style="background-image:url('${esc(s.hero_image)}')"` : ''}>
      <div class="ornaments" aria-hidden="true">${ornaments}</div>
      ${SS.treeSvg('left')}${SS.treeSvg('right')}
      <div class="container">
        <div class="hero-presents">${esc(s.company_name)} presents</div>
        <h1 class="hero-title">${SS.titleHtml(s)}</h1>
        <p class="hero-tagline">“${esc(s.tagline)}”</p>
        <div id="countdown"></div>
        <div class="hero-cta">
          <a class="btn btn-primary btn-lg btn-glow" href="${joinHref}">🎅 Join Secret Santa</a>
          <a class="btn btn-gold btn-lg" href="${revealHref}">🎁 Reveal My Secret Santa</a>
        </div>
        <div class="hero-chips">
          ${statusChip}
          <span class="chip chip-gold">🎁 Gift Budget: ${esc(cfg.budgetLabel)}</span>
          ${cfg.participantCount > 0 ? `<span class="chip">🧝 ${cfg.participantCount} ${cfg.participantCount === 1 ? 'elf has' : 'elves have'} joined</span>` : ''}
        </div>
      </div>
    </section>

    <section class="section" id="welcome">
      <div class="container dash-grid">
        <div class="card card-gold">
          <span class="eyebrow">A note from the HR elves</span>
          <h2 style="font-size:clamp(1.5rem,3.5vw,2.1rem)">${esc(s.welcome_heading)}</h2>
          <p class="muted" style="font-size:1.05rem">${nl2br(s.welcome_message)}</p>
          <div class="divider-ornament">❄</div>
          <div class="hero-chips" style="justify-content:flex-start">
            <span class="chip">🔐 Private &amp; secure</span>
            <span class="chip">🎲 Fair random draw</span>
            <span class="chip">🤫 Only your Santa sees your wishes</span>
          </div>
        </div>
        <div class="card">
          <h3 class="card-title"><span class="emoji">📅</span> Key dates</h3>
          <div class="timeline">
            ${dates.map(([icon, title, when, extra]) => `
              <div class="tl-item"><div class="tl-icon">${icon}</div>
                <div><strong>${esc(title)}</strong><span>${esc(SS.fmtDay(when))}${extra ? ` · ${esc(extra)}` : ''}</span></div></div>`).join('')}
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="how">
      <div class="container">
        <div class="section-head">
          <span class="eyebrow">How it works</span>
          <h2>From wish to wonder</h2>
          <p>Your journey from signing in to secretly planning the perfect surprise.</p>
        </div>
        <div class="steps">
          ${(s.how_it_works || []).map((st) => `
            <div class="card step hover-lift"><div class="step-icon">${esc(st.icon)}</div>
              <h3>${esc(st.title)}</h3><p>${esc(st.text)}</p></div>`).join('')}
        </div>
      </div>
    </section>

    <section class="section" id="budget">
      <div class="narrow">
        <div class="card card-gold budget-band">
          <span class="eyebrow">Gift budget</span>
          <div class="budget-amount">🎁 ${esc(cfg.budgetLabel)}</div>
          <p class="muted" style="max-width:520px;margin:0 auto">${esc(s.budget_note)}</p>
        </div>
      </div>
    </section>

    ${cfg.gallery.length ? `
    <section class="section" id="gallery">
      <div class="container">
        <div class="section-head"><span class="eyebrow">Memories</span><h2>Moments of Christmas cheer</h2></div>
        <div class="gallery">
          ${cfg.gallery.map((g) => `<figure><img src="${esc(g.url)}" alt="${esc(g.caption || 'Secret Santa memory')}" loading="lazy">${g.caption ? `<figcaption>${esc(g.caption)}</figcaption>` : ''}</figure>`).join('')}
        </div>
      </div>
    </section>` : ''}

    <section class="section">
      <div class="narrow center">
        <div class="card">
          <div style="font-size:2.6rem">🎅</div>
          <h2>${esc(s.rules_title)}</h2>
          <p class="muted">${esc(s.rules_intro)}</p>
          <a class="btn btn-ghost" href="/rules">Read Santa’s Rules →</a>
        </div>
      </div>
    </section>`;

  SS.countdown(SS.$('#countdown'), s.christmas_date, { label: s.countdown_label });
  SS.$('#footer').innerHTML = SS.footerHtml(s);
})();
