/* Santa's Rules page */
(async function () {
  'use strict';
  const { esc } = SS;
  const cfg = await SS.loadConfig();
  const s = cfg.settings;
  const me = await SS.session();
  SS.setTitle(s, 'Santa’s Rules');
  SS.renderNav(s, { active: 'rules', loggedIn: Boolean(me) });
  SS.initFx(s);

  SS.$('#main').innerHTML = `
    <section class="section">
      <div class="narrow">
        <div class="section-head">
          <span class="eyebrow">${esc(s.event_title)}</span>
          <h1 style="font-size:clamp(2rem,5vw,3rem)">${esc(s.rules_title)}</h1>
          <p>${esc(s.rules_intro)}</p>
        </div>
        <div class="rules-list">
          ${(s.rules || []).map((r, i) => `
            <div class="card rule hover-lift">
              <div class="rule-icon">${esc(r.icon || '⭐')}</div>
              <div><div class="rule-num">RULE ${String(i + 1).padStart(2, '0')}</div><p>${esc(r.text)}</p></div>
            </div>`).join('')}
        </div>
        <div class="card card-gold budget-band" style="margin-top:30px">
          <span class="eyebrow">Approved gift budget</span>
          <div class="budget-amount">🎁 ${esc(cfg.budgetLabel)}</div>
          <p class="muted">${esc(s.budget_note)}</p>
        </div>
        <div class="center" style="margin-top:30px">
          <a class="btn btn-primary btn-lg btn-glow" href="${me ? '/app' : '/login?mode=signup'}">I’m ready – let’s go! 🎄</a>
        </div>
      </div>
    </section>`;
  SS.$('#footer').innerHTML = SS.footerHtml(s);
})();
