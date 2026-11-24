/* HR Admin dashboard (single-page app, hash routing) */
(async function () {
  'use strict';
  const { esc, $, $$ } = SS;
  const root = $('#root');
  const cfg = await SS.loadConfig().catch(() => null);
  const pub = cfg ? cfg.settings : {};
  SS.initFx({ ...pub, lights_enabled: false, snow_density: 'light', music_enabled: false });

  const A = { admin: null, settings: null, placeholders: [], employees: null, slots: 3, view: 'overview', empState: { q: '', filter: 'all', dept: '', selected: new Set() } };
  const isSuper = () => A.admin && A.admin.role === 'super_admin';
  const api = SS.api;
  const toastErr = (e) => SS.toast(e.message || String(e), 'error');

  /* ================================================================ AUTH */
  async function boot() {
    try {
      const r = await api('/api/admin/me');
      A.admin = r.admin; SS.adminCsrf = r.csrf;
      if (A.admin.mustChangePassword) forcePassword(); else shell();
    } catch { renderLogin(); }
  }

  function renderLogin() {
    root.innerHTML = `<div class="login-admin"><div class="card card-gold auth-card">
      <div class="head"><span class="big-emoji">🧝</span><h1>HR Elf Control Room</h1>
        <p class="muted" style="margin:0">${esc(pub.event_title || 'Secret Santa')} · Admin access only</p></div>
      <div id="err"></div>
      <form id="lf" novalidate>
        <div class="field"><label for="ae">Admin email</label><input id="ae" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="ap">Password</label><input id="ap" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Enter the workshop 🔐</button>
      </form>
      <p class="muted center" style="font-size:.85rem;margin:16px 0 0"><a href="/">← Back to the employee site</a></p></div></div>`;
    $('#ae').focus();
    $('#lf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('[type=submit]');
      SS.busy(btn, true);
      try {
        const r = await api('/api/admin/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
        A.admin = r.admin; SS.adminCsrf = r.csrf;
        if (A.admin.mustChangePassword) forcePassword(); else shell();
      } catch (err) {
        $('#err').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
        SS.busy(btn, false);
      }
    });
  }

  function passwordFormHtml(force) {
    return `${force ? '<div class="alert warn">🔑 Please replace your temporary password before continuing.</div>' : ''}
      <form id="pwf" novalidate>
        <div class="field"><label>Current password</label><input type="password" name="current" autocomplete="current-password" required></div>
        <div class="field"><label>New password</label><input type="password" name="next" autocomplete="new-password" required><span class="hint">At least 8 characters with a letter and a number.</span></div>
        <div class="field"><label>Confirm new password</label><input type="password" name="next2" autocomplete="new-password" required></div>
        <div class="form-actions"><button class="btn btn-primary btn-sm" type="submit">Save password</button></div>
      </form>`;
  }

  async function submitPassword(form) {
    const fd = new FormData(form);
    if (fd.get('next') !== fd.get('next2')) throw new Error('The new passwords do not match.');
    await api('/api/admin/password', { method: 'POST', body: { current: fd.get('current'), next: fd.get('next') } });
  }

  function forcePassword() {
    root.innerHTML = `<div class="login-admin"><div class="card card-gold auth-card"><div class="head"><span class="big-emoji">🔑</span><h1>Set your password</h1></div>
      ${passwordFormHtml(true)}</div></div>`;
    $('#pwf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await submitPassword(e.target); A.admin.mustChangePassword = false; SS.toast('Password updated. Welcome, chief elf!', 'success'); shell(); }
      catch (err) { toastErr(err); }
    });
  }

  /* =============================================================== SHELL */
  const NAV = [
    ['Dashboard', [['overview', '📊', 'Overview']]],
    ['People', [['employees', '👥', 'Employees'], ['import', '📥', 'Import & Photos'], ['participation', '📝', 'Registrations & Reminders']]],
    ['Secret Santa', [['draw', '🎲', 'Draw Engine'], ['notifications', '✉️', 'Notification Log']]],
    ['Customize', [['branding', '🎨', 'Branding & Text'], ['schedule', '📅', 'Dates & Budget'], ['content', '📜', 'Steps & Rules'],
      ['messages', '💬', 'Employee Messages'], ['theme', '✨', 'Theme & Effects'], ['gallery', '🖼️', 'Photo Gallery'], ['music', '🎵', 'Background Music'],
      ['email', '📧', 'Email & Templates'], ['security', '🔐', 'Access & Login']]],
    ['Governance', [['admins', '🧑‍💼', 'HR Admins'], ['audit', '📋', 'Audit Log'], ['override', '🚨', 'Emergency Override']]],
  ];
  const TITLES = Object.fromEntries(NAV.flatMap(([, items]) => items.map(([k, i, l]) => [k, `${i} ${l}`])));

  function shell() {
    root.innerHTML = `<div class="admin-layout">
      <aside class="sidebar" id="sidebar">
        <a class="brand" href="/" target="_blank" rel="noopener">${SS.brandHtml(pub)}</a>
        ${NAV.map(([group, items]) => `<div class="side-group">${esc(group)}</div>${items
          .filter(([k]) => k !== 'admins' || isSuper())
          .map(([k, i, l]) => `<button class="side-link" data-view="${k}"><span class="i">${i}</span>${esc(l)}</button>`).join('')}`).join('')}
        <div class="side-foot">
          <div class="avatar" style="--s:38px">${esc(SS.initials(A.admin.name))}</div>
          <div class="who"><strong>${esc(A.admin.name)}</strong><span>${A.admin.role === 'super_admin' ? 'Super admin' : 'HR admin'}</span></div>
          <button class="icon-btn" id="acct" title="My account" aria-label="My account">⚙️</button>
          <button class="icon-btn" id="logout" title="Sign out" aria-label="Sign out">⏻</button>
        </div>
      </aside>
      <main class="admin-main">
        <header class="topbar">
          <button class="icon-btn burger" id="burger" aria-label="Menu">☰</button>
          <h1 id="viewTitle"></h1>
          <a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener">View site ↗</a>
        </header>
        <div id="view"></div>
      </main></div>`;
    $$('.side-link').forEach((b) => b.addEventListener('click', () => { location.hash = `#/${b.dataset.view}`; $('#sidebar').classList.remove('open'); }));
    $('#burger').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }).catch(() => {}); location.reload(); });
    $('#acct').addEventListener('click', () => SS.modal({
      title: 'My account',
      html: `<p class="muted">${esc(A.admin.name)} · ${esc(A.admin.email)}</p>${passwordFormHtml(false)}`,
      onOpen: (m, close) => m.querySelector('#pwf').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await submitPassword(e.target); SS.toast('Password updated.', 'success'); close(); } catch (err) { toastErr(err); }
      }),
    }));
    window.addEventListener('hashchange', route);
    route();
  }

  function route() {
    const v = (location.hash.match(/^#\/([a-z]+)/) || [])[1] || 'overview';
    A.view = VIEWS[v] ? v : 'overview';
    $$('.side-link').forEach((b) => b.classList.toggle('active', b.dataset.view === A.view));
    $('#viewTitle').textContent = TITLES[A.view] || '';
    const view = $('#view');
    view.innerHTML = '<div class="loading-screen"><div><span class="big">🧝</span></div></div>';
    Promise.resolve(VIEWS[A.view](view)).catch((err) => {
      if (err.status === 401) { location.reload(); return; }
      view.innerHTML = `<div class="alert danger">⚠️ ${esc(err.message)}</div>`;
    });
  }

  /* ================================================== SETTINGS HELPERS */
  async function ensureSettings(force = false) {
    if (!A.settings || force) {
      const r = await api('/api/admin/settings');
      A.settings = r.settings; A.placeholders = r.placeholders;
    }
    return A.settings;
  }

  function fieldHtml(f) {
    const v = A.settings[f.key];
    const id = `f_${f.key}`;
    const hint = f.help ? `<span class="hint">${esc(f.help)}</span>` : '';
    const wide = f.wide ? 'wide' : '';
    switch (f.type) {
      case 'textarea':
        return `<div class="field ${wide || 'wide'}"><label for="${id}">${esc(f.label)}</label><textarea id="${id}" data-key="${f.key}" rows="${f.rows || 4}">${esc(v ?? '')}</textarea>${hint}</div>`;
      case 'bool':
        return `<div class="switch-row wide"><div class="txt"><strong>${esc(f.label)}</strong>${f.help ? `<span>${esc(f.help)}</span>` : ''}</div>
          <label class="switch"><input type="checkbox" data-key="${f.key}" data-type="bool" ${v ? 'checked' : ''} aria-label="${esc(f.label)}"><span class="track"></span></label></div>`;
      case 'select':
        return `<div class="field ${wide}"><label for="${id}">${esc(f.label)}</label><select id="${id}" data-key="${f.key}">
          ${f.options.map(([val, lbl]) => `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(lbl)}</option>`).join('')}</select>${hint}</div>`;
      case 'color':
        return `<div class="field ${wide}"><label for="${id}">${esc(f.label)}</label><div class="color-field">
          <input type="color" id="${id}" data-key="${f.key}" data-type="color" value="${esc(v)}"><input type="text" data-mirror="${f.key}" value="${esc(v)}" maxlength="7"></div>${hint}</div>`;
      case 'number':
        return `<div class="field ${wide}"><label for="${id}">${esc(f.label)}</label><input id="${id}" type="number" data-key="${f.key}" data-type="number" value="${esc(v ?? '')}" min="${f.min ?? ''}" max="${f.max ?? ''}">${hint}</div>`;
      case 'datetime':
        return `<div class="field ${wide}"><label for="${id}">${esc(f.label)}</label><input id="${id}" type="datetime-local" data-key="${f.key}" value="${esc(v || '')}">${hint}</div>`;
      case 'password':
        return `<div class="field ${wide}"><label for="${id}">${esc(f.label)}</label><input id="${id}" type="password" data-key="${f.key}" value="" placeholder="${v ? '•••••••• (saved – leave blank to keep)' : ''}" autocomplete="new-password">${hint}</div>`;
      case 'list':
        return `<div class="field wide"><label>${esc(f.label)}</label>${hint}<div class="list-editor" data-list-key="${f.key}">
          ${(v || []).map((item) => listRowHtml(f, item)).join('')}</div>
          <div><button type="button" class="btn btn-ghost btn-xs" data-add-row="${f.key}">＋ Add ${esc(f.itemLabel || 'item')}</button></div></div>`;
      default:
        return `<div class="field ${wide}"><label for="${id}">${esc(f.label)}</label><input id="${id}" type="text" data-key="${f.key}" value="${esc(v ?? '')}" maxlength="${f.max || 300}" placeholder="${esc(f.placeholder || '')}">${hint}</div>`;
    }
  }

  function listRowHtml(f, item = {}) {
    const cols = f.fields;
    return `<div class="le-row ${cols.length === 3 ? 'three' : ''}">
      ${cols.map((c) => (c.textarea
        ? `<textarea data-f="${c.name}" rows="2" placeholder="${esc(c.ph || '')}">${esc(item[c.name] || '')}</textarea>`
        : `<input data-f="${c.name}" value="${esc(item[c.name] || '')}" placeholder="${esc(c.ph || '')}" maxlength="${c.max || 200}">`)).join('')}
      <div class="le-btns"><button type="button" class="icon-btn" data-move="-1" title="Move up">↑</button>
        <button type="button" class="icon-btn" data-move="1" title="Move down">↓</button>
        <button type="button" class="icon-btn" data-remove title="Remove">✕</button></div></div>`;
  }

  function settingsPanel({ id, title, intro, fields, saveLabel = 'Save changes', extra = '' }) {
    return `<div class="panel" data-settings="${id}">
      <div class="panel-head"><h2>${title}</h2></div>
      ${intro ? `<p class="muted" style="margin-top:-6px">${esc(intro)}</p>` : ''}
      <div class="form-grid">${fields.map(fieldHtml).join('')}</div>${extra}
      <div class="form-actions"><button class="btn btn-primary btn-sm" data-save>💾 ${esc(saveLabel)}</button></div></div>`;
  }

  function collectSettings(panel) {
    const out = {};
    $$('[data-key]', panel).forEach((el) => {
      const k = el.dataset.key;
      if (el.dataset.type === 'bool') out[k] = el.checked;
      else if (el.dataset.type === 'number') out[k] = el.value === '' ? null : Number(el.value);
      else if (el.type === 'password') { if (el.value) out[k] = el.value; }
      else out[k] = el.value;
    });
    $$('[data-list-key]', panel).forEach((list) => {
      out[list.dataset.listKey] = $$('.le-row', list).map((row) => Object.fromEntries($$('[data-f]', row).map((i) => [i.dataset.f, i.value])));
    });
    return out;
  }

  function bindSettingsPanels(view, fieldsById, after) {
    $$('[data-settings]', view).forEach((panel) => {
      const fields = fieldsById[panel.dataset.settings] || [];
      panel.addEventListener('click', (e) => {
        const add = e.target.closest('[data-add-row]');
        if (add) {
          const f = fields.find((x) => x.key === add.dataset.addRow);
          $(`[data-list-key="${f.key}"]`, panel).insertAdjacentHTML('beforeend', listRowHtml(f));
          return;
        }
        const row = e.target.closest('.le-row');
        if (row && e.target.closest('[data-remove]')) { row.remove(); return; }
        const mv = e.target.closest('[data-move]');
        if (row && mv) {
          if (mv.dataset.move === '-1' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
          if (mv.dataset.move === '1' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
        }
      });
      $$('input[type=color]', panel).forEach((c) => {
        const mirror = $(`[data-mirror="${c.dataset.key}"]`, panel);
        c.addEventListener('input', () => { mirror.value = c.value; });
        mirror.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(mirror.value)) c.value = mirror.value; c.dispatchEvent(new Event('change')); });
      });
      const save = $('[data-save]', panel);
      save.addEventListener('click', async () => {
        SS.busy(save, true, ' Saving…');
        try {
          const r = await api('/api/admin/settings', { method: 'PUT', body: collectSettings(panel) });
          A.settings = r.settings;
          SS.toast('Saved! The site is updated.', 'success');
          if (after) after(r.settings);
        } catch (err) { toastErr(err); } finally { SS.busy(save, false); }
      });
    });
  }

  /* ============================================================ VIEWS */
  const VIEWS = {};

  /* ------------------------------------------------------- overview */
  VIEWS.overview = async (view) => {
    const o = await api('/api/admin/overview');
    const c = o.counts;
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const drawLabel = { not_started: ['⏳', 'Not started yet'], completed: ['🔒', 'Drawn – boxes sealed'], released: ['🎁', 'Released to employees'] }[o.draw.status];
    const checklist = [
      [c.employees > 0, 'Add employees to the directory', 'import'],
      [o.emailConfigured, 'Connect company email (SMTP) for notifications', 'email'],
      [o.registrationOpen || o.draw.status !== 'not_started', 'Open registrations', 'participation'],
      [c.registered > 0, 'Employees register & add their 3 wishes', 'participation'],
      [o.draw.status !== 'not_started', 'Run the Secret Santa draw', 'draw'],
      [o.draw.status === 'released', 'Release gift boxes to employees', 'draw'],
    ];
    view.innerHTML = `
      ${o.override ? `<div class="alert danger">🚨 <div><strong>Emergency override active</strong> – ${esc(o.override.adminName)} can view confidential data until ${esc(SS.fmtDate(o.override.expiresAt, { timeStyle: 'short' }))}. Reason: “${esc(o.override.reason)}”</div></div>` : ''}
      <div class="grid grid-4" style="margin-bottom:18px">
        ${stat('👥', 'Active employees', c.employees, `${c.inactive} inactive`)}
        ${stat('🔐', 'Accounts activated', c.accounts, `${pct(c.accounts, c.employees)}% of employees`)}
        ${stat('📝', 'Registered', c.registered, `${pct(c.registered, c.employees)}% participation`, 'accent-green')}
        ${stat('🎁', 'Wish lists complete', c.wishesComplete, `${c.wishesMissing} still missing`, 'accent-gold')}
      </div>
      <div class="grid grid-2">
        <div>
          <div class="panel">
            <div class="panel-head"><h2>🎲 Draw status</h2><a class="btn btn-ghost btn-xs" href="#/draw">Open draw engine →</a></div>
            <div style="display:flex;gap:16px;align-items:center">
              <div style="font-size:2.6rem">${drawLabel[0]}</div>
              <div><div style="font-weight:600;font-size:1.1rem">${drawLabel[1]}</div>
                <div class="muted" style="font-size:.9rem">${o.draw.status === 'not_started'
                  ? `${o.preview.eligibleCount} eligible now · draw date ${esc(SS.fmtDate(o.dates.drawDate))}`
                  : `${o.draw.participantCount} participants · ${o.draw.revealedCount} unwrapped`}</div></div>
            </div>
            ${o.draw.status === 'released' ? `<div style="margin-top:14px"><div class="progress gold"><span style="width:${pct(o.draw.revealedCount, o.draw.participantCount)}%"></span></div>
              <div class="muted" style="font-size:.82rem;margin-top:6px">${pct(o.draw.revealedCount, o.draw.participantCount)}% of Santas have unwrapped their box</div></div>` : ''}
          </div>
          <div class="panel">
            <h2>📈 Participation</h2>
            ${bar('Registered', c.registered, c.employees)}
            ${bar('Wishes complete', c.wishesComplete, c.registered || 0)}
            ${bar('Accounts activated', c.accounts, c.employees)}
            <div class="form-actions" style="justify-content:flex-start">
              <span class="tag ${o.registrationOpen ? 'ok' : 'bad'}">${o.registrationOpen ? '● Registration open' : '● Registration closed'}</span>
              <span class="tag warn">🎁 ${esc(o.budget)}</span>
              <span class="tag ${o.emailConfigured ? 'ok' : 'dim'}">✉️ Email ${o.emailConfigured ? 'connected' : 'not configured'}</span>
            </div>
          </div>
          <div class="panel">
            <h2>🏢 Departments</h2>
            ${o.departments.length ? o.departments.slice(0, 12).map((d) => bar(d.department, d.registered, d.total)).join('') : '<p class="muted">No employees yet.</p>'}
          </div>
        </div>
        <div>
          <div class="panel">
            <h2>✅ Setup checklist</h2>
            ${checklist.map(([ok, label, link]) => `<div class="activity"><span>${ok ? '✅' : '⬜'}</span><a href="#/${link}" style="color:${ok ? 'var(--muted)' : '#fff'}">${esc(label)}</a></div>`).join('')}
          </div>
          <div class="panel">
            <h2>📅 Key dates</h2>
            ${[['📝 Registration deadline', o.dates.registrationDeadline], ['🎲 Draw date', o.dates.drawDate], ['🎁 Gift exchange', o.dates.exchangeDate], ['🎄 Countdown target', o.dates.christmasDate]]
              .map(([l, d]) => `<div class="activity"><span>${l}</span><span class="when">${esc(SS.fmtDate(d))}</span></div>`).join('')}
            <div class="form-actions"><a class="btn btn-ghost btn-xs" href="#/schedule">Edit dates →</a></div>
          </div>
          <div class="panel">
            <div class="panel-head"><h2>🕑 Recent activity</h2><a class="btn btn-ghost btn-xs" href="#/audit">Full audit log →</a></div>
            ${o.recentActivity.length ? o.recentActivity.map((a) => `<div class="activity"><span>${esc(a.action)}</span><span class="muted" style="font-size:.82rem">${esc((a.actor_label || '').replace(/<.*>/, ''))}</span><span class="when">${esc(SS.timeAgo(a.created_at))}</span></div>`).join('') : '<p class="muted">Nothing yet.</p>'}
          </div>
        </div>
      </div>`;
  };

  function stat(ic, k, v, s, cls = '') {
    return `<div class="stat ${cls}"><span class="ic">${ic}</span><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`;
  }
  function bar(name, n, total) {
    const p = total ? Math.round((n / total) * 100) : 0;
    return `<div class="bar-row"><span class="name" title="${esc(name)}">${esc(name)}</span><div class="progress"><span style="width:${p}%"></span></div><span class="num">${n}/${total}</span></div>`;
  }

  /* ------------------------------------------------------ employees */
  async function loadEmployees() {
    const r = await api('/api/admin/employees');
    A.employees = r.employees; A.slots = r.wishSlots;
    return A.employees;
  }

  const EMP_FILTERS = [
    ['all', 'All employees'], ['registered', 'Registered'], ['not_registered', 'Not registered'], ['no_account', 'Account not activated'],
    ['wishes_missing', 'Registered – wishes missing'], ['wishes_complete', 'Wishes complete'], ['in_draw', 'In the draw'],
    ['not_unwrapped', 'In draw – not unwrapped'], ['inactive', 'Inactive'],
  ];

  function filterEmployees() {
    const { q, filter, dept } = A.empState;
    const needle = q.trim().toLowerCase();
    return A.employees.filter((e) => {
      if (dept && e.department !== dept) return false;
      if (needle && ![e.fullName, e.email, e.employeeCode, e.department, e.designation].join(' ').toLowerCase().includes(needle)) return false;
      switch (filter) {
        case 'registered': return e.registered;
        case 'not_registered': return e.active && !e.registered;
        case 'no_account': return e.active && !e.hasAccount;
        case 'wishes_missing': return e.registered && e.wishCount < A.slots;
        case 'wishes_complete': return e.wishCount >= A.slots;
        case 'in_draw': return e.inDraw;
        case 'not_unwrapped': return e.inDraw && !e.unwrapped;
        case 'inactive': return !e.active;
        default: return true;
      }
    });
  }

  function empRow(e) {
    const sel = A.empState.selected.has(e.id);
    return `<tr data-id="${e.id}">
      <td><input type="checkbox" data-sel ${sel ? 'checked' : ''} aria-label="Select ${esc(e.fullName)}"></td>
      <td><div class="person">${SS.avatar(e.fullName, e.photo, 38)}<div><strong>${esc(e.fullName)}</strong><span>${esc(e.email)}</span></div></div></td>
      <td><span class="code-pill">${esc(e.employeeCode)}</span></td>
      <td>${esc(e.department)}<div class="muted" style="font-size:.8rem">${esc(e.designation)}</div></td>
      <td>${!e.active ? '<span class="tag dim">Inactive</span>' : e.hasAccount ? '<span class="tag ok">Activated</span>' : '<span class="tag dim">Not yet</span>'}</td>
      <td>${e.registered ? '<span class="tag ok">✓ Joined</span>' : '<span class="tag bad">Not joined</span>'}</td>
      <td>${e.wishCount >= A.slots ? `<span class="tag ok">${e.wishCount}/${A.slots}</span>` : e.wishCount ? `<span class="tag warn">${e.wishCount}/${A.slots}</span>` : '<span class="tag dim">0/3</span>'}</td>
      <td>${e.inDraw ? (e.unwrapped ? '<span class="tag ok">🎁 Unwrapped</span>' : '<span class="tag warn">In draw</span>') : '<span class="tag dim">—</span>'}</td>
      <td><div class="actions"><button class="btn btn-ghost btn-xs" data-edit>Manage</button></div></td></tr>`;
  }

  VIEWS.employees = async (view) => {
    await loadEmployees();
    const depts = [...new Set(A.employees.map((e) => e.department).filter(Boolean))].sort();
    const st = A.empState;
    view.innerHTML = `<p class="view-intro">Your Techsara employee directory. Only active employees listed here can activate an account and join Secret Santa. Wish list <em>status</em> is shown – never the wishes themselves.</p>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search name, email, ID…" value="${esc(st.q)}">
        <select id="filter">${EMP_FILTERS.map(([v, l]) => `<option value="${v}" ${st.filter === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="dept"><option value="">All departments</option>${depts.map((d) => `<option ${st.dept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
        <span class="spacer"></span>
        <a class="btn btn-ghost btn-sm" href="/api/admin/export/participants.csv">⬇ Export CSV</a>
        <a class="btn btn-ghost btn-sm" href="#/import">📥 Import</a>
        <button class="btn btn-primary btn-sm" id="addEmp">＋ Add employee</button>
      </div>
      <div id="bulk"></div>
      <div class="table-wrap"><table class="t"><thead><tr>
        <th><input type="checkbox" id="selAll" aria-label="Select all"></th><th>Employee</th><th>ID</th><th>Department</th><th>Account</th><th>Secret Santa</th><th>Wishes</th><th>Draw</th><th></th>
      </tr></thead><tbody id="rows"></tbody></table></div>
      <p class="muted" id="countLine" style="font-size:.85rem;margin-top:10px"></p>`;

    const paint = () => {
      const list = filterEmployees();
      $('#rows').innerHTML = list.length ? list.map(empRow).join('') : '<tr><td colspan="9"><div class="empty"><span class="big">🧝</span>No employees match.</div></td></tr>';
      $('#countLine').textContent = `${list.length} of ${A.employees.length} employees shown`;
      const n = st.selected.size;
      $('#bulk').innerHTML = n ? `<div class="bulkbar"><strong>${n} selected</strong>
        <button class="btn btn-ghost btn-xs" data-bulk="activate">Activate</button>
        <button class="btn btn-ghost btn-xs" data-bulk="deactivate">Deactivate</button>
        <button class="btn btn-danger btn-xs" data-bulk="delete">Delete</button>
        <button class="btn btn-ghost btn-xs" data-bulk="clear">Clear selection</button></div>` : '';
      $('#selAll').checked = list.length > 0 && list.every((e) => st.selected.has(e.id));
    };
    paint();

    $('#q').addEventListener('input', (e) => { st.q = e.target.value; paint(); });
    $('#filter').addEventListener('change', (e) => { st.filter = e.target.value; paint(); });
    $('#dept').addEventListener('change', (e) => { st.dept = e.target.value; paint(); });
    $('#addEmp').addEventListener('click', () => employeeModal(null, depts));
    $('#selAll').addEventListener('change', (e) => { filterEmployees().forEach((x) => (e.target.checked ? st.selected.add(x.id) : st.selected.delete(x.id))); paint(); });
    $('#rows').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = Number(tr.dataset.id);
      if (e.target.matches('[data-sel]')) { if (e.target.checked) st.selected.add(id); else st.selected.delete(id); paint(); return; }
      if (e.target.closest('[data-edit]')) employeeModal(A.employees.find((x) => x.id === id), depts);
    });
    $('#bulk').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-bulk]');
      if (!b) return;
      if (b.dataset.bulk === 'clear') { st.selected.clear(); paint(); return; }
      const ids = [...st.selected];
      if (b.dataset.bulk === 'delete' && !(await SS.confirm({ title: `Delete ${ids.length} employees?`, message: 'This permanently removes them, their account, registration and wish list. Employees in a finalized draw are skipped.', confirmText: 'Delete', danger: true }))) return;
      try {
        const r = await api('/api/admin/employees/bulk', { method: 'POST', body: { ids, action: b.dataset.bulk } });
        SS.toast(`Done for ${r.done} employee(s)${r.skipped.length ? ` · ${r.skipped.length} skipped` : ''}.`, 'success');
        st.selected.clear(); await loadEmployees(); paint();
      } catch (err) { toastErr(err); }
    });
    A.repaintEmployees = async () => { await loadEmployees(); if (A.view === 'employees') paint(); };
  };

  function employeeModal(emp, depts = []) {
    const isNew = !emp;
    const e = emp || { active: true };
    SS.modal({
      title: isNew ? 'Add employee' : `Manage ${e.fullName}`,
      wide: !isNew,
      html: `
        ${isNew ? '' : `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-bottom:18px">
          <div id="empAvatar">${SS.avatar(e.fullName, e.photo, 84)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <label class="btn btn-ghost btn-sm" style="cursor:pointer">📷 Upload photo<input type="file" id="empPhoto" accept="image/png,image/jpeg,image/webp,image/gif" class="sr-only"></label>
            ${e.photo ? '<button class="btn btn-ghost btn-sm" id="empPhotoDel">Remove photo</button>' : ''}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-left:auto">
            <span class="tag ${e.hasAccount ? 'ok' : 'dim'}">${e.hasAccount ? 'Account activated' : 'Not activated'}</span>
            <span class="tag ${e.registered ? 'ok' : 'bad'}">${e.registered ? 'Registered' : 'Not registered'}</span>
            <span class="tag ${e.wishCount >= A.slots ? 'ok' : 'warn'}">Wishes ${e.wishCount}/${A.slots}</span>
          </div></div>`}
        <form id="empForm" novalidate><div class="form-grid">
          <div class="field"><label>Full name</label><input name="fullName" required maxlength="120" value="${esc(e.fullName || '')}"></div>
          <div class="field"><label>Employee ID</label><input name="employeeCode" required maxlength="60" value="${esc(e.employeeCode || '')}"></div>
          <div class="field wide"><label>Official email</label><input name="email" type="email" required maxlength="254" value="${esc(e.email || '')}"></div>
          <div class="field"><label>Department / team</label><input name="department" list="deptList" maxlength="120" value="${esc(e.department || '')}">
            <datalist id="deptList">${depts.map((d) => `<option value="${esc(d)}">`).join('')}</datalist></div>
          <div class="field"><label>Designation</label><input name="designation" maxlength="120" value="${esc(e.designation || '')}"></div>
          <div class="field"><label>Location</label><input name="location" maxlength="120" value="${esc(e.location || '')}"></div>
          <div class="switch-row wide"><div class="txt"><strong>Active</strong><span>Inactive employees cannot sign in or join.</span></div>
            <label class="switch"><input type="checkbox" name="active" ${e.active ? 'checked' : ''}><span class="track"></span></label></div>
        </div>
        <div class="form-actions"><button type="button" class="btn btn-ghost btn-sm" data-close>Cancel</button><button class="btn btn-primary btn-sm" type="submit">${isNew ? 'Add employee' : 'Save changes'}</button></div></form>
        ${isNew ? '' : `<div class="panel" style="margin-top:20px"><h3>⚙️ Actions</h3><div style="display:flex;gap:8px;flex-wrap:wrap">
          ${e.registered ? '<button class="btn btn-ghost btn-sm" data-act="unregister">Remove from Secret Santa</button>' : '<button class="btn btn-ghost btn-sm" data-act="register">Add to Secret Santa</button>'}
          ${e.hasAccount ? '<button class="btn btn-ghost btn-sm" data-act="reset">Reset login (re-activate)</button>' : ''}
          <button class="btn btn-danger btn-sm" data-act="delete">Delete employee</button></div>
          <p class="muted" style="font-size:.82rem;margin:10px 0 0">“Reset login” removes their password so they can activate again with email + Employee ID. Wishes are kept.</p></div>`}`,
      onOpen: (m, close) => {
        $('#empForm', m).addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const fd = new FormData(ev.target);
          const body = Object.fromEntries(['fullName', 'employeeCode', 'email', 'department', 'designation', 'location'].map((k) => [k, fd.get(k)]));
          body.active = Boolean(fd.get('active'));
          try {
            if (isNew) await api('/api/admin/employees', { method: 'POST', body });
            else await api(`/api/admin/employees/${e.id}`, { method: 'PUT', body });
            SS.toast(isNew ? 'Employee added 🎄' : 'Saved.', 'success'); close(); A.repaintEmployees && A.repaintEmployees();
          } catch (err) { toastErr(err); }
        });
        if (isNew) return;
        const photo = $('#empPhoto', m);
        photo.addEventListener('change', async () => {
          if (!photo.files[0]) return;
          const fd = new FormData(); fd.append('photo', photo.files[0]);
          try { const r = await api(`/api/admin/employees/${e.id}/photo`, { method: 'POST', form: fd }); e.photo = r.photo; $('#empAvatar', m).innerHTML = SS.avatar(e.fullName, r.photo, 84); SS.toast('Photo uploaded.', 'success'); A.repaintEmployees(); }
          catch (err) { toastErr(err); }
        });
        const del = $('#empPhotoDel', m);
        if (del) del.addEventListener('click', async () => {
          try { await api(`/api/admin/employees/${e.id}/photo`, { method: 'DELETE' }); $('#empAvatar', m).innerHTML = SS.avatar(e.fullName, null, 84); del.remove(); A.repaintEmployees(); }
          catch (err) { toastErr(err); }
        });
        $$('[data-act]', m).forEach((b) => b.addEventListener('click', async () => {
          const act = b.dataset.act;
          try {
            if (act === 'register') await api(`/api/admin/employees/${e.id}/registration`, { method: 'POST' });
            if (act === 'unregister') await api(`/api/admin/employees/${e.id}/registration`, { method: 'DELETE' });
            if (act === 'reset') {
              if (!(await SS.confirm({ title: 'Reset login?', message: `${e.fullName} will need to activate their account again.`, confirmText: 'Reset login' }))) return;
              await api(`/api/admin/employees/${e.id}/reset-login`, { method: 'POST' });
            }
            if (act === 'delete') {
              if (!(await SS.confirm({ title: `Delete ${e.fullName}?`, message: 'This permanently removes the employee, their account, registration, wishes and notifications.', confirmText: 'Delete', danger: true }))) return;
              await api(`/api/admin/employees/${e.id}`, { method: 'DELETE' });
            }
            SS.toast('Done.', 'success'); close(); A.repaintEmployees();
          } catch (err) { toastErr(err); }
        }));
      },
    });
  }

  /* --------------------------------------------------------- import */
  VIEWS.import = async (view) => {
    view.innerHTML = `<p class="view-intro">Bring the whole Techsara team in at once. Upload a CSV or Excel sheet with columns like <strong>Employee ID, Full Name, Email, Department, Designation, Location, Active</strong>. You’ll see a preview before anything is saved.</p>
      <div class="grid grid-2">
        <div class="panel">
          <div class="panel-head"><h2>📥 Import employees</h2><a class="btn btn-ghost btn-xs" href="/api/admin/employees/template.csv">⬇ Download template</a></div>
          <label class="dropzone" id="dz"><span class="big">📄</span><strong>Choose a .csv, .xlsx or .xls file</strong><br><span class="muted">or drop it here</span>
            <input type="file" id="sheet" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" class="sr-only"></label>
          <label class="check" style="margin-top:14px"><input type="checkbox" id="updExisting" checked> <span>Update existing employees (matched by Employee ID)</span></label>
        </div>
        <div class="panel">
          <h2>📸 Bulk upload employee photos</h2>
          <p class="muted" style="font-size:.92rem">Name each photo after the <strong>Employee ID</strong> or <strong>email</strong> – e.g. <span class="code-pill">TS1024.jpg</span>. PNG, JPG, WEBP or GIF, max 5 MB each. You can also upload photos one by one from <a href="#/employees">Employees</a>.</p>
          <label class="dropzone"><span class="big">🖼️</span><strong>Choose photos</strong><br><span class="muted">select many at once</span>
            <input type="file" id="photos" multiple accept="image/png,image/jpeg,image/webp,image/gif" class="sr-only"></label>
          <div id="photoResults" style="margin-top:12px"></div>
        </div>
      </div>
      <div id="preview" style="margin-top:18px"></div>`;

    let rows = [];
    const sheet = $('#sheet');
    const dz = $('#dz');
    ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('drag')));
    dz.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) previewFile(e.dataTransfer.files[0]); });
    sheet.addEventListener('change', () => sheet.files[0] && previewFile(sheet.files[0]));

    async function previewFile(file) {
      const fd = new FormData(); fd.append('file', file);
      $('#preview').innerHTML = '<div class="panel"><div class="empty"><span class="big">🧝</span>Reading your file…</div></div>';
      try {
        const r = await api('/api/admin/employees/import/preview', { method: 'POST', form: fd });
        rows = r.rows;
        const sm = r.summary;
        $('#preview').innerHTML = `<div class="panel">
          <div class="panel-head"><h2>🔎 Preview · ${esc(file.name)}</h2>
            <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="tag ok">${sm.create} new</span><span class="tag warn">${sm.update} updates</span><span class="tag bad">${sm.invalid} with errors</span></div></div>
          <div class="table-wrap" style="max-height:440px;overflow:auto"><table class="t"><thead><tr><th>Row</th><th>Employee ID</th><th>Name</th><th>Email</th><th>Department</th><th>Designation</th><th>Result</th></tr></thead>
          <tbody>${rows.map((x) => `<tr class="${x.errors.length ? 'row-error' : ''}"><td>${x.line}</td><td class="code-pill">${esc(x.employee_code)}</td><td>${esc(x.full_name)}</td><td>${esc(x.email)}</td><td>${esc(x.department)}</td><td>${esc(x.designation)}</td>
            <td>${x.errors.length ? `<span class="tag bad">${esc(x.errors.join('; '))}</span>` : x.action === 'update' ? '<span class="tag warn">Update</span>' : '<span class="tag ok">New</span>'}${x.active ? '' : ' <span class="tag dim">inactive</span>'}</td></tr>`).join('')}</tbody></table></div>
          <div class="form-actions">${sm.invalid ? `<span class="muted" style="font-size:.88rem">Rows with errors will be skipped.</span>` : ''}
            <button class="btn btn-primary" id="doImport" ${sm.create + sm.update === 0 ? 'disabled' : ''}>Import ${sm.create + sm.update} employees 🎄</button></div></div>`;
        $('#doImport').addEventListener('click', async (e) => {
          SS.busy(e.target, true, ' Importing…');
          try {
            const res = await api('/api/admin/employees/import', { method: 'POST', body: { rows, updateExisting: $('#updExisting').checked } });
            $('#preview').innerHTML = `<div class="alert ok">🎉 Import finished – ${res.created} created, ${res.updated} updated, ${res.skipped} skipped. <a href="#/employees" style="margin-left:auto">View employees →</a></div>`;
            SS.toast('Employees imported!', 'success');
          } catch (err) { toastErr(err); SS.busy(e.target, false); }
        });
      } catch (err) {
        $('#preview').innerHTML = `<div class="alert danger">⚠️ ${esc(err.message)}</div>`;
      } finally { sheet.value = ''; }
    }

    $('#photos').addEventListener('change', async (e) => {
      const files = [...e.target.files];
      const out = $('#photoResults');
      const results = [];
      for (let i = 0; i < files.length; i += 10) {
        out.innerHTML = `<div class="muted">Uploading ${Math.min(i + 10, files.length)} of ${files.length}…</div>`;
        const fd = new FormData();
        files.slice(i, i + 10).forEach((f) => fd.append('photos', f));
        try { const r = await api('/api/admin/employees/photos/bulk', { method: 'POST', form: fd }); results.push(...r.results); }
        catch (err) { results.push({ file: `batch ${i / 10 + 1}`, ok: false, reason: err.message }); }
      }
      const ok = results.filter((r) => r.ok).length;
      out.innerHTML = `<div class="alert ${ok === results.length ? 'ok' : 'warn'}">${ok} of ${results.length} photos matched &amp; uploaded.</div>
        ${results.filter((r) => !r.ok).map((r) => `<div class="activity"><span>⚠️ ${esc(r.file)}</span><span class="when">${esc(r.reason)}</span></div>`).join('')}`;
      e.target.value = '';
    });
  };

  /* -------------------------------------------------- participation */
  /** Emails exactly as recipients get them, rendered in a sandboxed frame (no scripts can run in it). */
  function showEmailPreview(items, note = '') {
    const unknownCodes = [...new Set(items.flatMap((p) => `${p.subject} ${p.body}`.match(/:[a-z0-9_+-]+:/gi) || []))];
    SS.modal({
      title: '👁 Email preview',
      wide: true,
      html: `${note ? `<p class="muted" style="margin-top:-6px">${note}</p>` : ''}
        ${unknownCodes.length ? `<div class="alert warn"><div>⚠️ These emoji codes aren’t recognised and will show as plain text: <strong>${esc(unknownCodes.join(' '))}</strong> – replace them with real emoji (on Windows press Win + . to pick one).</div></div>` : ''}
        ${items.map((p, i) => `<div class="mail-preview">
          ${p.label ? `<h4>${esc(p.label)}</h4>` : ''}
          <div class="mail-meta"><div><span>To</span>${esc(p.recipient)}${p.count > 1 ? ` <em class="muted">– example; all ${p.count} people get it with their own name</em>` : ''}</div>
            <div><span>Subject</span><strong>${esc(p.subject)}</strong></div></div>
          <iframe class="mail-frame" sandbox="allow-same-origin" data-i="${i}" title="Email preview"></iframe></div>`).join('')}
        <div class="modal-actions"><button class="btn btn-ghost btn-sm" data-close>Close</button></div>`,
      onOpen: (m) => $$('.mail-frame', m).forEach((f) => {
        f.addEventListener('load', () => { try { f.style.height = `${f.contentDocument.documentElement.scrollHeight + 4}px`; } catch { /* keep the default height */ } });
        f.srcdoc = items[Number(f.dataset.i)].html;
      }),
    });
  }

  const AUDIENCES = [
    ['pending_any', 'Anyone not finished (not registered or wishes incomplete)'], ['not_registered', 'Not registered yet'],
    ['no_account', 'Account not activated'], ['incomplete_wishes', 'Registered but wishes incomplete'], ['registered', 'All registered participants'],
    ['not_unwrapped', 'Haven’t unwrapped their assignment'], ['everyone', 'Every active employee'],
  ];

  VIEWS.participation = async (view) => {
    const [s, aud] = await Promise.all([ensureSettings(true), api('/api/admin/reminders/audiences'), loadEmployees()]);
    const emps = A.employees.filter((e) => e.active);
    const notReg = emps.filter((e) => !e.registered);
    const missing = emps.filter((e) => e.registered && e.wishCount < A.slots);
    const drawn = A.employees.some((e) => e.inDraw);
    view.innerHTML = `
      <div class="grid grid-2">
        <div class="panel">
          <h2>🚪 Registration control</h2>
          <div class="switch-row"><div class="txt"><strong>Registrations are ${s.registration_open ? '<span style="color:#9ff0c1">OPEN</span>' : '<span style="color:#ffb3bd">CLOSED</span>'}</strong>
            <span>Employees can join Secret Santa only while this is on. It closes automatically when the draw runs${s.auto_close_registration ? ' and at the deadline' : ''}.</span></div>
            <label class="switch"><input type="checkbox" id="regToggle" ${s.registration_open ? 'checked' : ''} ${drawn ? 'disabled' : ''}><span class="track"></span></label></div>
          <div class="activity"><span>📝 Deadline</span><span class="when">${esc(SS.fmtDate(s.registration_deadline))}</span></div>
          <div class="activity"><span>🎲 Draw date</span><span class="when">${esc(SS.fmtDate(s.draw_date))}</span></div>
          <div class="form-actions"><a class="btn btn-ghost btn-xs" href="#/schedule">Change dates →</a><a class="btn btn-ghost btn-xs" href="/api/admin/export/participants.csv">⬇ Export status CSV</a></div>
        </div>
        <div class="panel">
          <h2>📣 Send a reminder</h2>
          ${aud.emailConfigured ? '' : '<div class="alert warn">✉️ Email isn’t configured, so reminders will appear only as in-app notifications. <a href="#/email">Set up email →</a></div>'}
          <div class="field"><label for="aud">Who should receive it?</label>
            <select id="aud">${AUDIENCES.map(([k, l]) => `<option value="${k}">${esc(l)} (${aud.counts[k]})</option>`).join('')}</select></div>
          <div class="field"><label for="msg">Custom message <span class="muted">(optional – leave empty to use the “Deadline reminder” template)</span></label>
            <div class="placeholder-chips">${A.placeholders.filter((p) => p !== 'message' && p !== 'code').map((p) => `<code data-tag="{{${esc(p)}}}" title="Click to insert">{{${esc(p)}}}</code>`).join('')}</div>
            <textarea id="msg" rows="7" maxlength="3000" placeholder="e.g. Only 2 days left to add your wishes – the elves are waiting! 🎄"></textarea>
            <p class="muted" style="font-size:.82rem;margin:6px 0 0">Click a tag to insert it – {{first_name}} becomes each person’s own first name. Your message goes inside the “Custom reminder wrapper” template (Email &amp; Templates), which adds the subject, greeting and site link. Use <strong>Preview</strong> to see the exact email.</p></div>
          <div class="form-actions"><button class="btn btn-ghost btn-sm" id="preview">👁 Preview</button><button class="btn btn-ghost btn-sm" id="testMe">📨 Send test to me</button><button class="btn btn-primary btn-sm" id="send">📨 Send reminder</button></div>
        </div>
      </div>
      <div class="grid grid-2" style="margin-top:18px">
        ${peopleList('🙋 Not registered yet', notReg, 'notreg')}
        ${peopleList('✍️ Registered – wishes incomplete', missing, 'missing', (e) => `${e.wishCount}/${A.slots}`)}
      </div>`;

    $('#regToggle').addEventListener('change', async (e) => {
      try {
        await api('/api/admin/settings', { method: 'PUT', body: { registration_open: e.target.checked } });
        SS.toast(e.target.checked ? 'Registrations are open! 🎄' : 'Registrations closed.', 'success');
        route();
      } catch (err) { e.target.checked = !e.target.checked; toastErr(err); }
    });
    const reminderTpl = () => ($('#msg').value.trim() ? 'custom_reminder' : 'deadline_reminder');
    $$('[data-tag]', view).forEach((c) => c.addEventListener('click', () => {
      const area = $('#msg');
      const pos = area.selectionStart ?? area.value.length;
      area.value = area.value.slice(0, pos) + c.dataset.tag + area.value.slice(area.selectionEnd ?? pos);
      area.focus();
    }));
    $('#preview').addEventListener('click', async (e) => {
      SS.busy(e.target, true);
      try {
        const p = await api('/api/admin/email/preview', { method: 'POST', body: { template: reminderTpl(), message: $('#msg').value, audience: $('#aud').value } });
        showEmailPreview([p], aud.emailConfigured ? '' : 'Email isn’t set up yet, so this would only appear as an in-app notification.');
      } catch (err) { toastErr(err); } finally { SS.busy(e.target, false); }
    });
    $('#testMe').addEventListener('click', async (e) => {
      SS.busy(e.target, true, ' Sending…');
      try {
        const r = await api('/api/admin/email/test', { method: 'POST', body: { template: reminderTpl(), message: $('#msg').value } });
        SS.toast(`Test sent to ${r.to} – check your inbox.`, 'success');
      } catch (err) { toastErr(err); } finally { SS.busy(e.target, false); }
    });
    $('#send').addEventListener('click', async (e) => {
      const audience = $('#aud').value;
      const n = aud.counts[audience];
      if (!n) { SS.toast('Nobody matches this audience right now.', 'error'); return; }
      if (!(await SS.confirm({ title: `Send to ${n} employee${n === 1 ? '' : 's'}?`, message: 'They will get an in-app notification and an email (if email is configured).', confirmText: 'Send' }))) return;
      SS.busy(e.target, true, ' Sending…');
      try { const r = await api('/api/admin/reminders', { method: 'POST', body: { audience, message: $('#msg').value } }); SS.toast(`Reminder queued for ${r.count} employees 🎅`, 'success'); $('#msg').value = ''; }
      catch (err) { toastErr(err); } finally { SS.busy(e.target, false); }
    });
    $$('[data-copy]', view).forEach((b) => b.addEventListener('click', async () => {
      const list = b.dataset.copy === 'notreg' ? notReg : missing;
      try { await navigator.clipboard.writeText(list.map((x) => x.email).join('; ')); SS.toast(`${list.length} emails copied.`, 'success'); }
      catch { SS.toast('Copy failed – your browser blocked clipboard access.', 'error'); }
    }));
  };

  function peopleList(title, list, key, extra) {
    return `<div class="panel"><div class="panel-head"><h2>${title} <span class="tag dim">${list.length}</span></h2>
      ${list.length ? `<button class="btn btn-ghost btn-xs" data-copy="${key}">📋 Copy emails</button>` : ''}</div>
      <div style="max-height:360px;overflow:auto">${list.length ? list.map((e) => `<div class="activity"><div class="person" style="display:flex;gap:10px;align-items:center">${SS.avatar(e.fullName, e.photo, 30)}<div><div>${esc(e.fullName)}</div><div class="muted" style="font-size:.8rem">${esc(e.department || e.email)}</div></div></div><span class="when">${extra ? esc(extra(e)) : esc(e.employeeCode)}</span></div>`).join('') : '<div class="empty"><span class="big">🎉</span>Nobody – great job!</div>'}</div></div>`;
  }

  /* ----------------------------------------------------------- draw */
  const DRAW_FIELDS = [
    { key: 'draw_mode', label: 'Draw style', type: 'select', wide: true, options: [['random', 'Fully random (any valid pairing)'], ['chain', 'Single gift chain (A→B→C→…→A)']], help: 'Both guarantee nobody draws themselves and everyone gives & receives exactly once.' },
    { key: 'draw_by_location', label: 'Match within the same location', type: 'bool', help: 'Each person gets a colleague from their own office location only (e.g. Noida with Noida, Ahmedabad with Ahmedabad), using the Location on the Employees page. Each location needs at least 2 participants.' },
    { key: 'avoid_mutual_pairs', label: 'Avoid mutual pairs', type: 'bool', help: 'Prevents A→B and B→A at the same time (random style only).' },
    { key: 'require_complete_wishes', label: 'Require all 3 wishes', type: 'bool', help: 'Only registered employees with 3 wishes are included in the draw.' },
    { key: 'release_on_draw', label: 'Open gift boxes immediately', type: 'bool', help: 'If off, the names are drawn and sealed – you release the boxes later with one click (great for a live reveal moment).' },
  ];

  VIEWS.draw = async (view) => {
    await ensureSettings(true);
    const d = await api('/api/admin/draw');
    const st = d.draw.status;
    const p = d.preview;
    const locProblems = p.byLocation ? p.problems : [];
    const blocked = p.eligibleCount < 3 || locProblems.length > 0;
    const locations = p.byLocation && p.locations.length
      ? `<p class="muted" style="margin:4px 0 8px">📍 Location-wise draw – everyone is matched only within their own location:</p>
         <div class="loc-groups">${p.locations.map((l) => `<span class="tag ${l.count < 2 ? 'bad' : 'ok'}">${esc(l.name)} · ${l.count}</span>`).join('')}</div>`
      : '';
    const hero = st === 'not_started'
      ? `<span class="big">🎲</span><h2>Ready when you are</h2><p class="muted">${p.eligibleCount} eligible participant${p.eligibleCount === 1 ? '' : 's'} · ${p.registeredCount} registered${p.excludedCount ? ` · <strong style="color:var(--gold-soft)">${p.excludedCount} excluded (wishes incomplete)</strong>` : ''}</p>
         ${locations}
         ${locProblems.length ? `<div class="alert warn" style="text-align:left"><div>${locProblems.map((x) => `⚠️ ${esc(x)}`).join('<br>')}</div></div>` : ''}
         <button class="btn btn-primary btn-lg btn-glow" id="runDraw" ${blocked ? 'disabled' : ''}>🎅 Run the Secret Santa draw</button>
         ${p.eligibleCount < 3 ? '<p class="muted" style="margin-top:10px">At least 3 eligible participants are needed.</p>' : ''}`
      : st === 'completed'
        ? `<span class="big">🔒</span><h2>Names drawn &amp; sealed</h2><p class="muted">${d.draw.participantCount} gift boxes are sealed. Employees can’t open them until you release.</p>
           <button class="btn btn-gold btn-lg btn-glow" id="release">🎁 Release gift boxes now</button>`
        : `<span class="big">🎁</span><h2>Gift boxes are open!</h2><p class="muted">${d.draw.revealedCount} of ${d.draw.participantCount} Santas have unwrapped their assignment.</p>
           <div style="max-width:420px;margin:0 auto"><div class="progress gold"><span style="width:${Math.round((d.draw.revealedCount / d.draw.participantCount) * 100)}%"></span></div></div>`;
    view.innerHTML = `
      <p class="view-intro">The draw runs on the server with a cryptographically secure shuffle and is verified before saving: nobody gets themselves, everyone gives exactly one gift and receives exactly one. Pairs are encrypted in the database and are <strong>not visible to admins</strong>.</p>
      <div class="grid grid-2">
        <div>
          <div class="panel draw-hero">${hero}</div>
          ${st !== 'not_started' ? `<div class="panel">
            <h2>♻️ Reset the draw</h2>
            <p class="muted" style="font-size:.92rem">Only for genuine emergencies (e.g. someone left the company). All assignments are destroyed, every Santa loses their assignment, and the reset is permanently logged. ${isSuper() ? '' : '<strong>Only a super admin can reset.</strong>'}</p>
            ${isSuper() ? '<button class="btn btn-danger btn-sm" id="reset">Reset draw…</button>' : ''}</div>` : ''}
        </div>
        <div>
          ${settingsPanel({ id: 'drawcfg', title: '⚙️ Draw settings', fields: DRAW_FIELDS, intro: st !== 'not_started' ? 'Changes apply to the next draw.' : '' })}
        </div>
      </div>
      <div class="panel" style="margin-top:18px"><h2>🗂️ Draw history</h2>
        ${d.history.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>Status</th><th>Style</th><th>Participants</th><th>Run by</th><th>When</th><th>Reset</th></tr></thead><tbody>
          ${d.history.map((h) => `<tr><td>${h.id}</td><td>${h.status === 'active' ? '<span class="tag ok">Active</span>' : '<span class="tag dim">Reset</span>'}</td><td>${esc(h.mode)}</td><td>${h.participant_count}</td><td>${esc(h.created_by_name || '')}</td><td>${esc(SS.fmtDate(h.created_at))}</td>
            <td>${h.reset_at ? `${esc(SS.fmtDate(h.reset_at))} by ${esc(h.reset_by_name || '')}<div class="muted" style="font-size:.8rem">${esc(h.reset_reason || '')}</div>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No draws yet.</p>'}</div>`;

    bindSettingsPanels(view, { drawcfg: DRAW_FIELDS }, () => route());
    const run = $('#runDraw');
    if (run) run.addEventListener('click', () => SS.modal({
      title: '🎅 Run the Secret Santa draw',
      html: `<p>This will randomly pair <strong>${p.eligibleCount}</strong> participants${p.byLocation ? ` <strong>within their own location</strong> (${p.locations.length} location${p.locations.length === 1 ? '' : 's'})` : ''}, close registrations and lock all wish lists.</p>
        ${p.excludedCount ? `<div class="alert warn">⚠️ ${p.excludedCount} registered employee(s) will be left out because their wishes are incomplete.</div>` : ''}
        <p class="muted">Gift boxes will ${A.settings.release_on_draw ? '<strong>open immediately</strong> and everyone is notified' : 'stay <strong>sealed</strong> until you release them'}.</p>
        <div class="field"><label>Type <strong>DRAW</strong> to confirm</label><input id="confirmDraw" autocomplete="off"></div>
        <div class="modal-actions"><button class="btn btn-ghost btn-sm" data-close>Cancel</button><button class="btn btn-primary btn-sm" id="goDraw">Draw names ✨</button></div>`,
      onOpen: (m, close) => $('#goDraw', m).addEventListener('click', async (e) => {
        SS.busy(e.target, true, ' Drawing…');
        try {
          const r = await api('/api/admin/draw/run', { method: 'POST', body: { confirm: $('#confirmDraw', m).value } });
          close(); SS.confetti(); SS.toast(`The elves paired ${r.participants} Santas! 🎄`, 'success');
          SS.config.drawStatus = r.released ? 'released' : 'completed';
          route();
        } catch (err) { toastErr(err); SS.busy(e.target, false); }
      }),
    }));
    const rel = $('#release');
    if (rel) rel.addEventListener('click', async () => {
      if (!(await SS.confirm({ title: 'Release all gift boxes?', message: 'Every participant will be notified and can unwrap their assignment.', confirmText: 'Release 🎁' }))) return;
      try { const r = await api('/api/admin/draw/release', { method: 'POST' }); SS.confetti(); SS.toast(`${r.participants} gift boxes released!`, 'success'); SS.config.drawStatus = 'released'; route(); }
      catch (err) { toastErr(err); }
    });
    const reset = $('#reset');
    if (reset) reset.addEventListener('click', () => SS.modal({
      title: '♻️ Reset the draw',
      html: `<div class="alert danger">This destroys all ${d.draw.participantCount} assignments. Employees who already unwrapped will lose their assignment. This cannot be undone.</div>
        <div class="field"><label>Reason (recorded in the audit log)</label><textarea id="rr" rows="3" maxlength="500"></textarea></div>
        <div class="field"><label>Your admin password</label><input id="rp" type="password" autocomplete="current-password"></div>
        <div class="field"><label>Type <strong>RESET</strong> to confirm</label><input id="rc" autocomplete="off"></div>
        <div class="modal-actions"><button class="btn btn-ghost btn-sm" data-close>Cancel</button><button class="btn btn-danger btn-sm" id="goReset">Reset draw</button></div>`,
      onOpen: (m, close) => $('#goReset', m).addEventListener('click', async () => {
        try {
          await api('/api/admin/draw/reset', { method: 'POST', body: { reason: $('#rr', m).value, password: $('#rp', m).value, confirm: $('#rc', m).value } });
          close(); SS.toast('Draw reset. Re-open registrations or run a new draw when ready.', 'success'); SS.config.drawStatus = 'not_started'; route();
        } catch (err) { toastErr(err); }
      }),
    }));
  };

  /* ------------------------------------------------- notifications */
  VIEWS.notifications = async (view) => {
    const { notifications } = await api('/api/admin/notifications');
    const label = { sent: ['ok', 'Emailed'], not_configured: ['dim', 'In-app only'], failed: ['bad', 'Email failed'], pending: ['warn', 'Sending…'] };
    view.innerHTML = `<p class="view-intro">Every notification sent to employees (latest 300). Messages never contain wish lists or assignments.</p>
      <div class="toolbar"><input type="search" id="nq" placeholder="Search…"><span class="spacer"></span><a class="btn btn-ghost btn-sm" href="#/participation">📣 Send a reminder</a></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>When</th><th>Recipient</th><th>Type</th><th>Subject</th><th>Delivery</th></tr></thead><tbody id="nrows"></tbody></table></div>`;
    const paint = (q = '') => {
      const list = notifications.filter((n) => !q || [n.full_name, n.email, n.type, n.title].join(' ').toLowerCase().includes(q.toLowerCase()));
      $('#nrows').innerHTML = list.length ? list.map((n) => {
        const [cls, txt] = label[n.email_status] || ['dim', n.email_status];
        return `<tr><td style="white-space:nowrap">${esc(SS.fmtDate(n.created_at))}</td><td>${esc(n.full_name)}<div class="muted" style="font-size:.8rem">${esc(n.email)}</div></td>
          <td><span class="code-pill">${esc(n.type)}</span></td><td>${esc(n.title)}</td><td><span class="tag ${cls}" title="${esc(n.email_error || '')}">${esc(txt)}</span>${n.read_at ? ' <span class="tag dim">read</span>' : ''}</td></tr>`;
      }).join('') : '<tr><td colspan="5"><div class="empty"><span class="big">📭</span>No notifications yet.</div></td></tr>';
    };
    paint();
    $('#nq').addEventListener('input', (e) => paint(e.target.value));
  };

  /* ------------------------------------------------------ branding */
  const BRANDING_FIELDS = [
    { key: 'company_name', label: 'Company name' }, { key: 'company_short', label: 'Short name', help: 'Used in the nav: “<short> Secret Santa”.' },
    { key: 'event_title', label: 'Event title (main heading)', wide: true }, { key: 'title_emoji_left', label: 'Emoji before title', max: 16 },
    { key: 'title_emoji_right', label: 'Emoji after title', max: 16 }, { key: 'tagline', label: 'Tagline', wide: true },
    { key: 'welcome_heading', label: 'Welcome heading', wide: true }, { key: 'welcome_message', label: 'Welcome message', type: 'textarea', rows: 5 },
    { key: 'slogan', label: 'Footer slogan', wide: true }, { key: 'footer_text', label: 'Footer small print', wide: true },
  ];
  const IMAGE_SLOTS = [
    ['logo', 'Company logo', 'Shown in the navigation bar, the admin sidebar and at the top of every email. A transparent PNG works best.'],
    ['hero_image', 'Landing page hero background', 'A wide festive photo (e.g. 1920×1080). It is darkened automatically so text stays readable.'],
  ];

  /** Small PNG copy of an image for emails (fits 520×168 = 2× the email display size). Null if it fails. */
  async function emailSizedPng(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      let w = img.naturalWidth; let h = img.naturalHeight;
      if (!w || !h) return null;
      const scale = Math.min(520 / w, 168 / h, 1);
      const tw = Math.max(1, Math.round(w * scale)); const th = Math.max(1, Math.round(h * scale));
      const draw = (src, cw, ch) => {
        const c = document.createElement('canvas'); c.width = cw; c.height = ch;
        const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, cw, ch);
        return c;
      };
      let src = img; // halve step by step so big logos shrink smoothly
      while (w / 2 >= tw && h / 2 >= th) { w = Math.round(w / 2); h = Math.round(h / 2); src = draw(src, w, h); }
      const out = draw(src, tw, th);
      return await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    } catch { return null; } finally { URL.revokeObjectURL(url); }
  }

  VIEWS.branding = async (view) => {
    await ensureSettings(true);
    const s = A.settings;
    view.innerHTML = `<p class="view-intro">Change every word and image on the site. Changes are live the moment you save.</p>
      <div class="grid grid-2">
        <div>${settingsPanel({ id: 'brand', title: '🏷️ Names & headline text', fields: BRANDING_FIELDS })}</div>
        <div class="panel"><h2>🖼️ Logo &amp; images</h2>
          ${IMAGE_SLOTS.map(([slot, label, help]) => `<div class="image-slot">
            <div class="preview">${s[slot] ? `<img src="${esc(s[slot])}" alt="">` : 'No image'}</div>
            <div class="meta"><strong>${esc(label)}</strong><span>${esc(help)}</span>
              <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
                <label class="btn btn-ghost btn-xs" style="cursor:pointer">⬆ Upload<input type="file" data-slot="${slot}" accept="image/png,image/jpeg,image/webp,image/gif" class="sr-only"></label>
                ${s[slot] ? `<button class="btn btn-ghost btn-xs" data-remove-slot="${slot}">Remove</button>` : ''}</div></div></div>`).join('')}
          <p class="muted" style="font-size:.85rem">Want a photo wall of past celebrations? Use <a href="#/gallery">Photo Gallery</a>.</p>
        </div>
      </div>`;
    bindSettingsPanels(view, { brand: BRANDING_FIELDS });
    $$('[data-slot]', view).forEach((input) => input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const fd = new FormData(); fd.append('image', file);
      if (input.dataset.slot === 'logo') {
        const small = await emailSizedPng(file);
        if (small) fd.append('email_image', small, 'logo-email.png');
      }
      try { await api(`/api/admin/branding/${input.dataset.slot}`, { method: 'POST', form: fd }); SS.toast('Image uploaded!', 'success'); route(); }
      catch (err) { toastErr(err); }
    }));
    $$('[data-remove-slot]', view).forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/api/admin/branding/${b.dataset.removeSlot}`, { method: 'DELETE' }); route(); } catch (err) { toastErr(err); }
    }));
  };

  /* ------------------------------------------------------ schedule */
  const DATE_FIELDS = [
    { key: 'registration_deadline', label: 'Registration deadline', type: 'datetime' },
    { key: 'draw_date', label: 'Draw date', type: 'datetime', help: 'Shown to employees. You still run the draw manually.' },
    { key: 'exchange_date', label: 'Gift exchange date', type: 'datetime' },
    { key: 'exchange_venue', label: 'Gift exchange venue' },
    { key: 'christmas_date', label: 'Countdown target', type: 'datetime', help: 'The big countdown on the landing page.' },
    { key: 'countdown_label', label: 'Countdown label' },
    { key: 'timezone_label', label: 'Time zone label', help: 'Appended to dates in emails, e.g. IST.' },
    { key: 'auto_close_registration', label: 'Close registrations automatically at the deadline', type: 'bool' },
  ];
  const BUDGET_FIELDS = [
    { key: 'currency_symbol', label: 'Currency symbol', max: 8 },
    { key: 'budget_min', label: 'Minimum budget', type: 'number', min: 0 },
    { key: 'budget_max', label: 'Maximum budget', type: 'number', min: 0 },
    { key: 'budget_note', label: 'Budget note', type: 'textarea', rows: 3 },
  ];
  VIEWS.schedule = async (view) => {
    await ensureSettings(true);
    view.innerHTML = `<div class="grid grid-2">
      ${settingsPanel({ id: 'dates', title: '📅 Event dates', fields: DATE_FIELDS })}
      ${settingsPanel({ id: 'budget', title: '💰 Gift budget', fields: BUDGET_FIELDS, intro: 'Visible to every participant on the landing page, rules page, dashboard and reveal card.' })}</div>`;
    bindSettingsPanels(view, { dates: DATE_FIELDS, budget: BUDGET_FIELDS });
  };

  /* ------------------------------------------------------- content */
  const STEP_FIELDS = [{ key: 'how_it_works', label: 'Steps (shown on the landing page)', type: 'list', itemLabel: 'step', fields: [{ name: 'icon', ph: '🎁', max: 16 }, { name: 'title', ph: 'Title', max: 100 }, { name: 'text', ph: 'Description', textarea: true }] }];
  const RULE_FIELDS = [
    { key: 'rules_title', label: 'Rules page title' }, { key: 'rules_intro', label: 'Intro line' },
    { key: 'rules', label: 'Rules', type: 'list', itemLabel: 'rule', fields: [{ name: 'icon', ph: '⭐', max: 16 }, { name: 'text', ph: 'Rule text', textarea: true }] },
  ];
  VIEWS.content = async (view) => {
    await ensureSettings(true);
    view.innerHTML = `<p class="view-intro">Edit the “How it works” journey and Santa’s Rules. Use ↑ ↓ to reorder. Tip: press <kbd>Win</kbd>+<kbd>.</kbd> to insert emoji.</p>
      ${settingsPanel({ id: 'steps', title: '🧭 How it works', fields: STEP_FIELDS })}
      ${settingsPanel({ id: 'rules', title: '🎅 Santa’s Rules', fields: RULE_FIELDS })}`;
    bindSettingsPanels(view, { steps: STEP_FIELDS, rules: RULE_FIELDS });
  };

  /* ------------------------------------------------------ messages */
  const MSG_FIELDS = [
    { key: 'join_message', label: 'Join card message', wide: true },
    { key: 'wishes_intro', label: 'Wish form intro', type: 'textarea', rows: 2 },
    { key: 'wish_examples', label: 'Wish placeholder examples (comma separated)', wide: true },
    { key: 'wish_saved_message', label: 'Message after saving wishes', type: 'textarea', rows: 2 },
    { key: 'waiting_message', label: 'Gift box – before the draw', type: 'textarea', rows: 2 },
    { key: 'locked_message', label: 'Gift box – drawn but sealed', type: 'textarea', rows: 2 },
    { key: 'reveal_button_text', label: 'Unwrap button text' },
    { key: 'reveal_heading', label: 'Reveal heading' },
    { key: 'reveal_mission', label: 'Reveal mission line', wide: true },
  ];
  VIEWS.messages = async (view) => {
    await ensureSettings(true);
    view.innerHTML = `<p class="view-intro">Every line employees see on their dashboard and during the big reveal.</p>${settingsPanel({ id: 'msgs', title: '💬 Employee messages', fields: MSG_FIELDS })}`;
    bindSettingsPanels(view, { msgs: MSG_FIELDS });
  };

  /* --------------------------------------------------------- theme */
  const THEME_FIELDS = [
    { key: 'theme_midnight', label: 'Background (midnight)', type: 'color' }, { key: 'theme_red', label: 'Primary (Christmas red)', type: 'color' },
    { key: 'theme_green', label: 'Secondary (forest green)', type: 'color' }, { key: 'theme_gold', label: 'Accent (gold)', type: 'color' },
    { key: 'snow_enabled', label: 'Falling snow', type: 'bool' },
    { key: 'snow_density', label: 'Snow density', type: 'select', options: [['light', 'Light flurry'], ['medium', 'Gentle snowfall'], ['heavy', 'Blizzard']] },
    { key: 'lights_enabled', label: 'Twinkling Christmas lights', type: 'bool' },
  ];
  const PRESETS = [
    ['Classic Techsara', { theme_midnight: '#0a1630', theme_red: '#c8102e', theme_green: '#1d7a4f', theme_gold: '#e9b949' }],
    ['Royal Velvet', { theme_midnight: '#1a0b2e', theme_red: '#b3123b', theme_green: '#0f6b5c', theme_gold: '#f0c060' }],
    ['Frosted Pine', { theme_midnight: '#06202a', theme_red: '#d6334a', theme_green: '#2e8b57', theme_gold: '#d9e3f0' }],
    ['Candy Cane', { theme_midnight: '#2a0b12', theme_red: '#e0233c', theme_green: '#18794e', theme_gold: '#ffd8a8' }],
  ];
  VIEWS.theme = async (view) => {
    await ensureSettings(true);
    view.innerHTML = `<p class="view-intro">Pick colours and effects. The admin panel previews your colours live as you choose them.</p>
      <div class="panel"><h2>🎨 Quick presets</h2><div style="display:flex;gap:10px;flex-wrap:wrap">
        ${PRESETS.map(([n, c], i) => `<button class="btn btn-ghost btn-sm" data-preset="${i}"><span style="display:inline-flex;gap:3px">${Object.values(c).map((x) => `<span style="width:14px;height:14px;border-radius:50%;background:${x};display:inline-block"></span>`).join('')}</span>${esc(n)}</button>`).join('')}
      </div></div>
      ${settingsPanel({ id: 'theme', title: '✨ Colours & effects', fields: THEME_FIELDS })}`;
    bindSettingsPanels(view, { theme: THEME_FIELDS });
    const preview = () => {
      const t = {};
      $$('input[type=color]', view).forEach((c) => { t[c.dataset.key] = c.value; });
      SS.applyTheme(t);
    };
    $$('input[type=color]', view).forEach((c) => { c.addEventListener('input', preview); c.addEventListener('change', preview); });
    $$('[data-preset]', view).forEach((b) => b.addEventListener('click', () => {
      const colors = PRESETS[Number(b.dataset.preset)][1];
      for (const [k, v] of Object.entries(colors)) {
        const c = $(`input[type=color][data-key="${k}"]`, view);
        c.value = v; $(`[data-mirror="${k}"]`, view).value = v;
      }
      preview();
      SS.toast('Preset applied – press “Save changes” to publish it.');
    }));
  };

  /* ------------------------------------------------------- gallery */
  VIEWS.gallery = async (view) => {
    const { items } = await api('/api/admin/gallery');
    view.innerHTML = `<p class="view-intro">Photos from past celebrations, team moments or festive decorations. They appear in a “Memories” section on the landing page (public), so only upload photos everyone is happy to share.</p>
      <div class="panel"><div class="panel-head"><h2>🖼️ Gallery (${items.length})</h2>
        <label class="btn btn-primary btn-sm" style="cursor:pointer">⬆ Add photos<input type="file" id="gUp" multiple accept="image/png,image/jpeg,image/webp,image/gif" class="sr-only"></label></div>
        ${items.length ? `<div class="gallery-admin">${items.map((g) => `<div class="gi" data-id="${g.id}"><img src="${esc(g.url)}" alt="">
          <div class="gi-body"><input value="${esc(g.caption)}" placeholder="Caption" data-caption maxlength="200"><button class="icon-btn" data-save-cap title="Save caption">💾</button><button class="icon-btn" data-del title="Delete">🗑</button></div></div>`).join('')}</div>`
          : '<div class="empty"><span class="big">📷</span>No photos yet – the landing page hides the gallery until you add some.</div>'}</div>`;
    $('#gUp').addEventListener('change', async (e) => {
      for (const f of e.target.files) {
        const fd = new FormData(); fd.append('image', f);
        try { await api('/api/admin/gallery', { method: 'POST', form: fd }); } catch (err) { toastErr(err); }
      }
      SS.toast('Photos added!', 'success'); route();
    });
    view.addEventListener('click', async (e) => {
      const gi = e.target.closest('.gi');
      if (!gi) return;
      const id = gi.dataset.id;
      try {
        if (e.target.closest('[data-save-cap]')) { await api(`/api/admin/gallery/${id}`, { method: 'PUT', body: { caption: $('[data-caption]', gi).value } }); SS.toast('Caption saved.', 'success'); }
        if (e.target.closest('[data-del]')) { if (await SS.confirm({ title: 'Delete photo?', message: 'It will be removed from the landing page.', confirmText: 'Delete', danger: true })) { await api(`/api/admin/gallery/${id}`, { method: 'DELETE' }); gi.remove(); } }
      } catch (err) { toastErr(err); }
    });
  };

  /* --------------------------------------------------------- music */
  const MUSIC_FIELDS = [
    { key: 'music_enabled', label: 'Play background music', type: 'bool', help: 'On the landing, rules, sign-in and employee dashboard pages (never in this admin panel).' },
    { key: 'music_volume', label: 'Volume (%)', type: 'number', min: 1, max: 100, help: '30–40 is a pleasant background level.' },
    { key: 'music_shuffle', label: 'Shuffle the playlist', type: 'bool', help: 'Off = play in the order below, then start again from the top.' },
  ];
  VIEWS.music = async (view) => {
    await ensureSettings(true);
    const { items } = await api('/api/admin/music');
    view.innerHTML = `<p class="view-intro">Upload festive songs that play softly in the background while employees use the site.
        Browsers only allow sound after a visitor clicks or taps the page, so the music starts on their first click if it can't start straight away.
        Everyone gets a 🎵 button (bottom-left) to mute it, and the site remembers their choice.</p>
      ${settingsPanel({ id: 'music', title: '🎚️ Playback', fields: MUSIC_FIELDS })}
      <div class="panel"><div class="panel-head"><h2>🎵 Playlist (${items.length})</h2>
        <label class="btn btn-primary btn-sm" style="cursor:pointer" id="mUpLabel">⬆ Add songs<input type="file" id="mUp" multiple
          accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/wav,audio/x-wav,.mp3,.m4a,.ogg,.wav" class="sr-only"></label></div>
        <p class="muted" style="margin-top:-6px;font-size:.88rem">MP3, M4A, OGG or WAV · up to 20 MB each (MP3 recommended). Only use music the company has the right to play – e.g. royalty-free tracks.</p>
        ${items.length ? `<div class="track-list">${items.map((t, i) => `<div class="track" data-id="${t.id}">
            <span class="track-no">${i + 1}</span>
            <input value="${esc(t.title)}" data-title maxlength="120" aria-label="Song title">
            <audio controls preload="none" src="${esc(t.url)}"></audio>
            <div class="track-btns">
              <button class="icon-btn" data-save-title title="Save title">💾</button>
              <button class="icon-btn" data-move="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="icon-btn" data-move="1" title="Move down" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="icon-btn" data-del title="Delete">🗑</button></div></div>`).join('')}</div>`
          : '<div class="empty"><span class="big">🎶</span>No songs yet – add some and they will start playing on the site.</div>'}</div>`;
    bindSettingsPanels(view, { music: MUSIC_FIELDS });

    $('#mUp').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      const label = $('#mUpLabel');
      let added = 0;
      for (const [i, f] of files.entries()) {
        label.firstChild.textContent = `⏳ Uploading ${i + 1}/${files.length}…`;
        const fd = new FormData();
        fd.append('title', f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim());
        fd.append('audio', f);
        try { await api('/api/admin/music', { method: 'POST', form: fd }); added += 1; } catch (err) { toastErr(err); }
      }
      if (added) SS.toast(`${added} song${added === 1 ? '' : 's'} added!`, 'success');
      route();
    });

    view.addEventListener('click', async (e) => {
      const row = e.target.closest('.track');
      if (!row) return;
      const id = Number(row.dataset.id);
      try {
        if (e.target.closest('[data-save-title]')) {
          await api(`/api/admin/music/${id}`, { method: 'PUT', body: { title: $('[data-title]', row).value } });
          SS.toast('Title saved.', 'success');
        }
        const mv = e.target.closest('[data-move]');
        if (mv) {
          const ids = $$('.track', view).map((r) => Number(r.dataset.id));
          const from = ids.indexOf(id); const to = from + Number(mv.dataset.move);
          if (to < 0 || to >= ids.length) return;
          [ids[from], ids[to]] = [ids[to], ids[from]];
          await api('/api/admin/music/order', { method: 'PUT', body: { ids } });
          route();
        }
        if (e.target.closest('[data-del]')) {
          const title = $('[data-title]', row).value;
          if (await SS.confirm({ title: 'Delete song?', message: `“${title}” will be removed from the playlist.`, confirmText: 'Delete', danger: true })) {
            await api(`/api/admin/music/${id}`, { method: 'DELETE' });
            route();
          }
        }
      } catch (err) { toastErr(err); }
    });
  };

  /* --------------------------------------------------------- email */
  const SMTP_FIELDS = [
    { key: 'email_enabled', label: 'Send email notifications', type: 'bool', help: 'When off, notifications appear only inside the employee dashboard.' },
    { key: 'smtp_host', label: 'SMTP host', placeholder: 'smtp.office365.com' },
    { key: 'smtp_port', label: 'SMTP port', type: 'number', min: 1, max: 65535 },
    { key: 'smtp_user', label: 'SMTP username', placeholder: 'santa@techsarasolutions.com' },
    { key: 'smtp_pass', label: 'SMTP password / app password', type: 'password' },
    { key: 'smtp_secure', label: 'Use SSL/TLS from the start (port 465)', type: 'bool', help: 'Leave off for port 587 (STARTTLS).' },
    { key: 'smtp_from', label: '“From” address', wide: true, placeholder: 'Techsara Secret Santa <santa@techsarasolutions.com>' },
    { key: 'site_url', label: 'Public site URL (used in email links)', wide: true, placeholder: 'https://santa.techsarasolutions.com' },
  ];
  const AUTO_FIELDS = [
    { key: 'auto_reminder_enabled', label: 'Automatic deadline reminder', type: 'bool', help: 'Sends the “Deadline reminder” once to anyone not finished, shortly before the registration deadline.' },
    { key: 'reminder_hours_before', label: 'Hours before the deadline', type: 'number', min: 1, max: 720 },
  ];
  const EMAIL_SCRIPT_FONTS = ['Great Vibes', 'Parisienne', 'Alex Brush', 'Allura', 'Pinyon Script', 'Dancing Script', 'Satisfy', 'Cookie'];
  const LOOK_FIELDS = [
    { key: 'email_card_color', label: 'Card colour', type: 'color', help: 'Default #262f7e – the logo blue.' },
    { key: 'email_bg_color', label: 'Background around the card', type: 'color' },
    { key: 'email_accent_color', label: 'Accent – border, lines, links', type: 'color', help: 'Default #e9b949 – the logo gold.' },
    { key: 'email_heading_font', label: 'Subject line font', type: 'select', options: EMAIL_SCRIPT_FONTS.map((f) => [f, f]) },
    { key: 'email_body_font', label: 'Message font', type: 'select', options: [['serif', 'Elegant serif (Cormorant Garamond)'], ['script', 'Script – same as the subject line'], ['sans', 'Clean (Segoe UI)']], help: 'The “Hi Name,” greeting is always in the script font.' },
    { key: 'email_decorations', label: 'Pine branches in the top corners', type: 'bool' },
  ];
  const TEMPLATE_NAMES = {
    registration_confirmation: 'Registration confirmation', wishlist_submitted: 'Wish list submitted', deadline_reminder: 'Deadline reminder',
    draw_completed: 'Draw completed (boxes sealed)', assignment_available: 'Assignment available', custom_reminder: 'Custom reminder wrapper', otp: 'One-time code (OTP)',
  };
  VIEWS.email = async (view) => {
    await ensureSettings(true);
    const t = A.settings.templates;
    view.innerHTML = `<div class="grid grid-2">
      <div>${settingsPanel({ id: 'smtp', title: '📧 Company email (SMTP)', fields: SMTP_FIELDS, intro: 'Works with Microsoft 365, Google Workspace, Amazon SES or any SMTP relay.' })}
        <div class="panel"><h2>🧪 Send a test email</h2>
          <div class="field"><label for="testTpl">What to send</label><select id="testTpl">
            <option value="connection">Quick connection check</option>
            ${Object.entries(TEMPLATE_NAMES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
            <option value="all">📬 All templates (${Object.keys(TEMPLATE_NAMES).length} emails)</option></select></div>
          <div class="field"><label for="testTo">Send to</label><input type="email" id="testTo" placeholder="${esc(A.admin.email)}"></div>
          <div id="testTags"></div>
          <div class="form-actions"><button class="btn btn-ghost btn-sm" id="testPreview">👁 Preview</button><button class="btn btn-primary btn-sm" id="testBtn">📨 Send test</button></div></div>
        ${settingsPanel({ id: 'look', title: '🎨 Email look', fields: LOOK_FIELDS, saveLabel: 'Save look',
          intro: 'Colours match the Techsara logo. Gmail and Outlook don’t load custom fonts, so they show a similar script font installed on the phone or computer; Apple Mail and iPhone Mail show the exact font.',
          extra: '<div class="form-actions" style="justify-content:flex-start;margin-bottom:-8px"><button class="btn btn-ghost btn-sm" id="lookPreview">👁 Preview the look</button></div>' })}
        ${settingsPanel({ id: 'auto', title: '⏰ Automatic reminders', fields: AUTO_FIELDS })}</div>
      <div class="panel" id="tplPanel"><div class="panel-head"><h2>✍️ Notification templates</h2><button class="btn btn-ghost btn-xs" id="tplReset">Restore defaults</button></div>
        <p class="muted" style="font-size:.88rem;margin-top:-6px">Click a placeholder to copy it. Templates must never include wish or assignment details – they go to inboxes.</p>
        <div class="placeholder-chips">${A.placeholders.map((p) => `<code data-ph="{{${esc(p)}}}">{{${esc(p)}}}</code>`).join('')}</div>
        <div class="field"><label for="tplSel">Template</label><select id="tplSel">${Object.entries(TEMPLATE_NAMES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label for="tplSubj">Subject</label><input id="tplSubj" maxlength="200"></div>
        <div class="field"><label for="tplBody">Message</label><textarea id="tplBody" rows="11" maxlength="5000"></textarea></div>
        <div class="form-actions"><button class="btn btn-primary btn-sm" id="tplSave">💾 Save template</button></div></div></div>`;
    bindSettingsPanels(view, { smtp: SMTP_FIELDS, auto: AUTO_FIELDS, look: LOOK_FIELDS });
    $('#lookPreview').addEventListener('click', async (e) => {
      SS.busy(e.target, true);
      try {
        const p = await api('/api/admin/email/preview', { method: 'POST', body: { template: 'wishlist_submitted' } });
        showEmailPreview([p], 'Shows the saved look – press “Save look” first if you changed something.');
      } catch (err) { toastErr(err); } finally { SS.busy(e.target, false); }
    });
    const load = () => { const x = t[$('#tplSel').value]; $('#tplSubj').value = x.subject; $('#tplBody').value = x.body; };
    load();
    $('#tplSel').addEventListener('change', load);
    $('#tplSave').addEventListener('click', async () => {
      const key = $('#tplSel').value;
      try {
        const r = await api('/api/admin/settings', { method: 'PUT', body: { templates: { [key]: { subject: $('#tplSubj').value, body: $('#tplBody').value } } } });
        A.settings = r.settings; Object.assign(t, r.settings.templates); SS.toast('Template saved.', 'success');
        paintTags(); // the saved text may use different tags
      } catch (err) { toastErr(err); }
    });
    $('#tplReset').addEventListener('click', async () => {
      if (!(await SS.confirm({ title: 'Restore default templates?', message: 'All notification templates go back to the original festive wording.', confirmText: 'Restore' }))) return;
      try { await api('/api/admin/settings/reset-templates', { method: 'POST' }); SS.toast('Templates restored.', 'success'); route(); } catch (err) { toastErr(err); }
    });
    $$('[data-ph]', view).forEach((c) => c.addEventListener('click', () => {
      const area = $('#tplBody');
      const pos = area.selectionStart ?? area.value.length;
      area.value = area.value.slice(0, pos) + c.dataset.ph + area.value.slice(area.selectionEnd ?? pos);
      area.focus();
    }));
    // Test emails: which tags the chosen template uses and the sample value each one gets
    let sample = {};
    const tagsIn = (keys) => [...new Set(keys.flatMap((k) => `${t[k].subject} ${t[k].body}`.match(/\{\{\s*[a-z_]+\s*\}\}/gi) || [])
      .map((m) => m.replace(/[{}\s]/g, '')))];
    const paintTags = () => {
      const v = $('#testTpl').value;
      $('#testPreview').disabled = v === 'connection';
      if (v === 'connection') { $('#testTags').innerHTML = '<p class="muted" style="font-size:.85rem">A short plain email that checks the SMTP settings work.</p>'; return; }
      const tags = tagsIn(v === 'all' ? Object.keys(TEMPLATE_NAMES) : [v]);
      $('#testTags').innerHTML = `<p class="muted" style="font-size:.85rem;margin:0 0 8px">Looks exactly like the real email (the <strong>saved</strong> template${v === 'all' ? 's' : ''}), with “[Test]” before the subject. The name is the employee’s if you send to their email, otherwise yours. Tags used:</p>
        ${tags.length ? `<div class="tag-values">${tags.map((k) => `<code>{{${esc(k)}}}</code><span>${k in sample
          ? (String(sample[k]) ? esc(sample[k]) : '<em class="muted">(empty – fill it in on its settings page)</em>')
          : '<strong style="color:var(--gold-soft)">⚠️ not a known tag – it will be blank</strong>'}</span>`).join('')}</div>` : '<p class="muted" style="font-size:.85rem">This template uses no tags.</p>'}`;
    };
    const loadSample = async () => {
      try { sample = (await api(`/api/admin/email/sample?to=${encodeURIComponent($('#testTo').value.trim())}`)).values; } catch { sample = {}; }
      paintTags();
    };
    $('#testTpl').addEventListener('change', paintTags);
    $('#testTo').addEventListener('change', loadSample);
    loadSample();
    $('#testPreview').addEventListener('click', async (e) => {
      const v = $('#testTpl').value;
      const keys = v === 'all' ? Object.keys(TEMPLATE_NAMES) : [v];
      SS.busy(e.target, true);
      try {
        const list = await Promise.all(keys.map((k) => api('/api/admin/email/preview', { method: 'POST', body: { template: k, to: $('#testTo').value.trim() } })));
        showEmailPreview(list.map((p, i) => ({ ...p, label: keys.length > 1 ? TEMPLATE_NAMES[keys[i]] : '' })));
      } catch (err) { toastErr(err); } finally { SS.busy(e.target, false); }
    });
    $('#testBtn').addEventListener('click', async (e) => {
      SS.busy(e.target, true, ' Sending…');
      try {
        const r = await api('/api/admin/email/test', { method: 'POST', body: { to: $('#testTo').value, template: $('#testTpl').value } });
        SS.toast(r.sent > 1 ? `${r.sent} test emails sent to ${r.to}! Check the inbox.` : `Test email sent to ${r.to}! Check the inbox.`, 'success');
      } catch (err) { toastErr(err); } finally { SS.busy(e.target, false); }
    });
  };

  /* ------------------------------------------------------ security */
  const SEC_FIELDS = [
    { key: 'allowed_email_domains', label: 'Allowed email domains', wide: true, help: 'Comma separated, e.g. techsarasolutions.com. Only these emails can activate or be imported. Leave empty to allow any.' },
    { key: 'login_method', label: 'Employee sign-in method', type: 'select', options: [['both', 'Password or one-time email code'], ['password', 'Password only'], ['otp', 'One-time email code only']] },
    { key: 'require_email_otp_signup', label: 'Email a 6-digit code at sign-up', type: 'bool', help: 'Off = employees sign up with just their official email + a password. On = they must also enter a code sent to their mailbox, which proves they own it (needs email configured).' },
    { key: 'signup_require_employee_id', label: 'Also ask for Employee ID at sign-up', type: 'bool', help: 'Adds a second check: the email and Employee ID must match the same directory entry.' },
    { key: 'allow_employee_photo_upload', label: 'Employees can upload their own profile photo', type: 'bool' },
  ];
  VIEWS.security = async (view) => {
    await ensureSettings(true);
    view.innerHTML = `<div class="alert info">🔐 Privacy is enforced on the server: employees can only ever read their own wishes and – after release – their one recipient’s. Wishes and assignments are encrypted at rest. Admins never see them without a logged emergency override.</div>
      ${settingsPanel({ id: 'sec', title: '🔐 Access & login', fields: SEC_FIELDS })}`;
    bindSettingsPanels(view, { sec: SEC_FIELDS });
  };

  /* -------------------------------------------------------- admins */
  VIEWS.admins = async (view) => {
    if (!isSuper()) { view.innerHTML = '<div class="alert warn">Only super admins can manage HR admins.</div>'; return; }
    const { admins } = await api('/api/admin/admins');
    view.innerHTML = `<p class="view-intro"><strong>HR admins</strong> manage employees, settings, reminders and the draw. <strong>Super admins</strong> can also manage admins, reset the draw and use the emergency override.</p>
      <div class="toolbar"><span class="spacer"></span><button class="btn btn-primary btn-sm" id="addAdmin">＋ Add admin</button></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Admin</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>
      ${admins.map((a) => `<tr data-id="${a.id}"><td><div class="person">${SS.avatar(a.name, null, 34)}<div><strong>${esc(a.name)}</strong><span>${esc(a.email)}</span></div></div></td>
        <td>${a.role === 'super_admin' ? '<span class="tag warn">Super admin</span>' : '<span class="tag dim">HR admin</span>'}</td>
        <td>${a.active ? '<span class="tag ok">Active</span>' : '<span class="tag bad">Disabled</span>'}</td>
        <td>${a.lastLoginAt ? esc(SS.timeAgo(a.lastLoginAt)) : '—'}</td>
        <td><div class="actions"><button class="btn btn-ghost btn-xs" data-edit-admin>Edit</button></div></td></tr>`).join('')}</tbody></table></div>`;
    const modal = (a) => SS.modal({
      title: a ? `Edit ${a.name}` : 'Add HR admin',
      html: `<form id="af" novalidate><div class="form-grid">
        <div class="field"><label>Name</label><input name="name" value="${esc(a ? a.name : '')}" required></div>
        <div class="field"><label>Email</label><input name="email" type="email" value="${esc(a ? a.email : '')}" ${a ? 'disabled' : 'required'}></div>
        <div class="field"><label>Role</label><select name="role"><option value="hr_admin">HR admin</option><option value="super_admin" ${a && a.role === 'super_admin' ? 'selected' : ''}>Super admin</option></select></div>
        <div class="field"><label>${a ? 'New temporary password (optional)' : 'Temporary password'}</label><input name="password" type="password" autocomplete="new-password"><span class="hint">They must change it at first sign-in.</span></div>
        ${a ? `<div class="switch-row wide"><div class="txt"><strong>Active</strong></div><label class="switch"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}><span class="track"></span></label></div>` : ''}
        </div><div class="form-actions"><button type="button" class="btn btn-ghost btn-sm" data-close>Cancel</button><button class="btn btn-primary btn-sm">Save</button></div></form>`,
      onOpen: (m, close) => $('#af', m).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          if (a) await api(`/api/admin/admins/${a.id}`, { method: 'PUT', body: { name: fd.get('name'), role: fd.get('role'), active: Boolean(fd.get('active')), password: fd.get('password') || undefined } });
          else await api('/api/admin/admins', { method: 'POST', body: { name: fd.get('name'), email: fd.get('email'), role: fd.get('role'), password: fd.get('password') } });
          close(); SS.toast('Saved.', 'success'); route();
        } catch (err) { toastErr(err); }
      }),
    });
    $('#addAdmin').addEventListener('click', () => modal(null));
    $$('[data-edit-admin]', view).forEach((b) => b.addEventListener('click', () => modal(admins.find((x) => x.id === Number(b.closest('tr').dataset.id)))));
  };

  /* --------------------------------------------------------- audit */
  VIEWS.audit = async (view) => {
    const { logs } = await api('/api/admin/audit?limit=1000');
    view.innerHTML = `<p class="view-intro">A permanent record of sign-ins, changes, draws, resets, reminders and every emergency-override access. Wish content and assignment pairs are never written here.</p>
      <div class="toolbar"><input type="search" id="aq" placeholder="Filter by action, person, IP…"><span class="spacer"></span></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Details</th><th>IP</th></tr></thead><tbody id="arows"></tbody></table></div>`;
    const paint = (q = '') => {
      const list = logs.filter((l) => !q || [l.actor_label, l.action, l.details, l.ip].join(' ').toLowerCase().includes(q.toLowerCase()));
      $('#arows').innerHTML = list.map((l) => `<tr><td style="white-space:nowrap">${esc(SS.fmtDate(l.created_at))}</td><td>${esc(l.actor_label || l.actor_type)}</td>
        <td><span class="tag ${/override|reset|delete|failed/.test(l.action) ? 'bad' : /draw|released/.test(l.action) ? 'warn' : 'dim'}">${esc(l.action)}</span></td>
        <td class="muted" style="font-size:.82rem;max-width:380px;overflow-wrap:anywhere">${esc(l.details || '')}</td><td class="muted" style="font-size:.8rem">${esc(l.ip || '')}</td></tr>`).join('')
        || '<tr><td colspan="5"><div class="empty">No entries.</div></td></tr>';
    };
    paint();
    $('#aq').addEventListener('input', (e) => paint(e.target.value));
  };

  /* ------------------------------------------------------ override */
  VIEWS.override = async (view) => {
    const o = await api('/api/admin/override');
    if (!o.isSuperAdmin) {
      view.innerHTML = `<div class="alert info">🔒 Admins cannot see wish lists or Secret Santa assignments. In a genuine emergency, a <strong>super admin</strong> can open a 15-minute, fully logged override window from this page.</div>
        ${o.any ? `<div class="alert danger">🚨 An override is currently active for ${esc(o.any.adminName)} until ${esc(SS.fmtDate(o.any.expiresAt, { timeStyle: 'short' }))}. Reason: “${esc(o.any.reason)}”</div>` : ''}`;
      return;
    }
    if (!o.mine) {
      view.innerHTML = `<div class="alert danger">🚨 <div><strong>Emergency use only.</strong> This reveals confidential Secret Santa data. Your name, the reason and every page you view are permanently recorded in the audit log and visible to all admins.</div></div>
        ${o.any ? `<div class="alert warn">An override is already active for ${esc(o.any.adminName)}.</div>` : ''}
        <div class="panel" style="max-width:620px"><h2>Open a 15-minute override window</h2>
          <div class="field"><label for="or">What is the emergency?</label><textarea id="or" rows="3" maxlength="500" placeholder="e.g. Employee TS1024 left the company – need to identify their recipient to arrange a replacement gift."></textarea></div>
          <div class="field"><label for="op">Confirm your password</label><input id="op" type="password" autocomplete="current-password"></div>
          <div class="form-actions"><button class="btn btn-danger" id="openOv">Enable emergency override</button></div></div>`;
      $('#openOv').addEventListener('click', async () => {
        try { await api('/api/admin/override', { method: 'POST', body: { reason: $('#or').value, password: $('#op').value } }); route(); } catch (err) { toastErr(err); }
      });
      return;
    }
    let rows = [];
    try { rows = (await api('/api/admin/override/assignments')).assignments; } catch (err) { toastErr(err); }
    view.innerHTML = `<div class="alert danger">🚨 <div><strong>Override active</strong> until ${esc(SS.fmtDate(o.mine.expiresAt, { timeStyle: 'medium' }))}. Reason: “${esc(o.mine.reason)}”. Every view is logged.</div>
        <button class="btn btn-ghost btn-sm" id="endOv" style="margin-left:auto">End override now</button></div>
      <div class="toolbar"><input type="search" id="ovq" placeholder="Search a name or ID…"></div>
      ${rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Secret Santa (giver)</th><th></th><th>Recipient</th><th>Unwrapped</th></tr></thead><tbody id="ovrows"></tbody></table></div>` : '<div class="panel"><p class="muted">There is no active draw, so there are no assignments.</p></div>'}`;
    $('#endOv').addEventListener('click', async () => { await api('/api/admin/override/end', { method: 'POST' }); SS.toast('Override ended.', 'success'); route(); });
    const person = (p) => (p ? `<strong>${esc(p.name)}</strong> <span class="code-pill">${esc(p.code)}</span><div class="muted" style="font-size:.8rem">${esc(p.department)} · <button class="text-link" data-wishes="${p.id}">view wishes</button></div>` : '—');
    const paint = (q = '') => {
      const tb = $('#ovrows');
      if (!tb) return;
      const list = rows.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
      tb.innerHTML = list.map((r) => `<tr><td>${person(r.giver)}</td><td>🎁 →</td><td>${person(r.receiver)}</td><td>${r.revealedAt ? `<span class="tag ok">${esc(SS.timeAgo(r.revealedAt))}</span>` : '<span class="tag dim">No</span>'}</td></tr>`).join('');
    };
    paint();
    $('#ovq').addEventListener('input', (e) => paint(e.target.value));
    view.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-wishes]');
      if (!b) return;
      try {
        const r = await api(`/api/admin/override/wishes/${b.dataset.wishes}`);
        SS.modal({ title: `Wishes of ${r.employee.fullName}`, html: r.wishes.filter((w) => w.name).map((w, i) => `<div class="activity"><strong>${i + 1}. ${esc(w.name)}</strong><span class="muted">${esc(w.description)}</span></div>`).join('') || '<p class="muted">No wishes.</p>' });
      } catch (err) { toastErr(err); }
    });
  };

  boot();
})();
