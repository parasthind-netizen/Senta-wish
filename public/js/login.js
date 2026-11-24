/* Sign in / first-time activation / OTP / forgot password */
(async function () {
  'use strict';
  const { esc, $ } = SS;
  const cfg = await SS.loadConfig();
  const s = cfg.settings;
  const params = new URLSearchParams(location.search);
  const next = params.get('next') === 'reveal' ? '/app#reveal' : '/app';

  if (await SS.session()) { location.replace(next); return; }

  SS.setTitle(s, 'Sign in');
  SS.renderNav(s, { active: 'login' });
  SS.initFx(s);

  const method = s.login_method; // password | otp | both
  const domains = String(s.allowed_email_domains || '').split(/[\s,;]+/).filter(Boolean).map((d) => '@' + d.replace(/^@/, ''));
  const emailHint = domains.length ? `Use your official ${domains.join(' / ')} email.` : 'Use your official company email.';
  const state = { mode: params.get('mode') === 'signup' ? 'signup' : 'signin', signinVia: method === 'otp' ? 'otp' : 'password', step: 1, data: {} };

  const main = $('#main');

  function shell(inner) {
    const tabs = `<div class="tabs" role="tablist">
      <button role="tab" data-mode="signin" class="${state.mode === 'signin' || state.mode === 'forgot' ? 'active' : ''}">Sign in</button>
      <button role="tab" data-mode="signup" class="${state.mode === 'signup' ? 'active' : ''}">First time here?</button></div>`;
    main.innerHTML = `<div class="card card-gold auth-card">
      <div class="head"><span class="big-emoji">${state.mode === 'signup' ? '🎅' : state.mode === 'forgot' ? '🗝️' : '🎄'}</span>
        <h1>${state.mode === 'signup' ? 'Create your account' : state.mode === 'forgot' ? 'Reset your password' : 'Welcome back, elf!'}</h1>
        <p class="muted" style="margin:0">${esc(s.event_title)}</p></div>
      ${tabs}<div id="err"></div>${inner}</div>`;
    main.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; state.step = 1; render(); }));
  }

  const showError = (msg) => { $('#err').innerHTML = msg ? `<div class="form-error" role="alert">${esc(msg)}</div>` : ''; };
  const showOk = (msg) => { $('#err').innerHTML = `<div class="form-success" role="status">${esc(msg)}</div>`; };

  async function submit(form, btn, fn) {
    showError('');
    SS.busy(btn, true);
    try { await fn(new FormData(form)); } catch (err) { showError(err.message); } finally { SS.busy(btn, false); }
  }

  function done() {
    SS.toast('Ho ho ho! You are signed in.', 'success');
    setTimeout(() => location.replace(next), 400);
  }

  /* ----------------------------------------------------------- sign in */
  function renderSignin() {
    const canSwitch = method === 'both';
    if (state.signinVia === 'password') {
      shell(`<form id="f" novalidate>
        <div class="field"><label for="id">Official email or Employee ID</label>
          <input id="id" name="identifier" autocomplete="username" required placeholder="you@${esc((domains[0] || '@company.com').slice(1))}"></div>
        <div class="field"><label for="pw">Password</label>
          <input id="pw" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Sign in 🎁</button>
        <div class="auth-foot">
          <button type="button" class="text-link" id="forgot">Forgot password?</button>
          ${canSwitch ? '<button type="button" class="text-link" id="via">Email me a one-time code instead</button>' : ''}
        </div></form>`);
      $('#forgot').addEventListener('click', () => { state.mode = 'forgot'; state.step = 1; render(); });
    } else if (state.step === 1) {
      shell(`<form id="f" novalidate>
        <div class="field"><label for="id">Official email or Employee ID</label>
          <input id="id" name="identifier" autocomplete="username" required value="${esc(state.data.identifier || '')}"></div>
        <p class="muted" style="font-size:.9rem">We'll send a 6-digit code to your official email.</p>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Send my code ✉️</button>
        <div class="auth-foot">${canSwitch ? '<button type="button" class="text-link" id="via">Use my password instead</button>' : ''}</div></form>`);
    } else {
      shell(`<form id="f" novalidate>
        <p class="muted center">Enter the 6-digit code sent to your official email.</p>
        <div class="field"><label for="otp">One-time code</label>
          <input id="otp" name="otp" class="otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Verify &amp; sign in</button>
        <div class="auth-foot"><button type="button" class="text-link" id="back">← Use a different email</button>
          <button type="button" class="text-link" id="resend">Resend code</button></div></form>`);
      $('#back').addEventListener('click', () => { state.step = 1; render(); });
      $('#resend').addEventListener('click', async () => {
        try { await SS.api('/api/auth/otp/request', { method: 'POST', body: { identifier: state.data.identifier } }); showOk('A new code is on its way.'); }
        catch (e) { showError(e.message); }
      });
    }
    const via = $('#via');
    if (via) via.addEventListener('click', () => { state.signinVia = state.signinVia === 'password' ? 'otp' : 'password'; state.step = 1; render(); });

    const form = $('#f');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit(form, form.querySelector('[type=submit]'), async (fd) => {
        if (state.signinVia === 'password') {
          await SS.api('/api/auth/login', { method: 'POST', body: { identifier: fd.get('identifier'), password: fd.get('password') } });
          done();
        } else if (state.step === 1) {
          state.data.identifier = fd.get('identifier');
          const r = await SS.api('/api/auth/otp/request', { method: 'POST', body: { identifier: state.data.identifier } });
          state.step = 2; render(); showOk(r.message);
        } else {
          await SS.api('/api/auth/otp/verify', { method: 'POST', body: { identifier: state.data.identifier, otp: fd.get('otp') } });
          done();
        }
      });
    });
  }

  /* ----------------------------------------------------------- sign up */
  function renderSignup() {
    const needCode = Boolean(s.signup_require_employee_id);
    const needOtp = Boolean(s.require_email_otp_signup);
    const needPw = method !== 'otp';
    const intro = `<p class="muted" style="font-size:.95rem">Only employees listed in the ${esc(s.company_short)} directory can join. Use the email address HR has on file for you.</p>`;
    const emailField = `<div class="field"><label for="em">Official email</label>
        <input id="em" name="email" type="email" autocomplete="email" required value="${esc(state.data.email || '')}">
        <span class="hint">${esc(emailHint)}</span></div>`;
    const codeField = needCode ? `<div class="field"><label for="code">Employee ID</label>
        <input id="code" name="employeeCode" autocomplete="off" required placeholder="e.g. TS1024" value="${esc(state.data.employeeCode || '')}"></div>` : '';
    const pwFields = `<div class="field"><label for="pw">Create a password</label>
        <input id="pw" name="password" type="password" autocomplete="new-password" required minlength="8">
        <span class="hint">At least 8 characters with a letter and a number.</span></div>
      <div class="field"><label for="pw2">Confirm password</label>
        <input id="pw2" name="password2" type="password" autocomplete="new-password" required></div>`;

    // Simple one-step sign-up: email (+ Employee ID if HR requires it) + password
    if (!needOtp) {
      shell(`<form id="f" novalidate>${intro}${emailField}${codeField}${needPw ? pwFields : ''}
        <button class="btn btn-primary btn-block btn-lg" type="submit">Create my account ✨</button>
        <div class="auth-foot"><span class="muted">Already signed up?</span><button type="button" class="text-link" id="toSignin">Sign in instead</button></div></form>`);
      $('#toSignin').addEventListener('click', () => { state.mode = 'signin'; state.step = 1; render(); });
      const form = $('#f');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submit(form, form.querySelector('[type=submit]'), async (fd) => {
          if (needPw && fd.get('password') !== fd.get('password2')) throw new Error('The two passwords do not match.');
          await SS.api('/api/auth/signup/complete', {
            method: 'POST',
            body: { email: String(fd.get('email') || '').trim(), employeeCode: String(fd.get('employeeCode') || '').trim() || undefined, password: fd.get('password') || undefined },
          });
          done();
        });
      });
      return;
    }

    if (state.step === 1) {
      shell(`<form id="f" novalidate>${intro}${emailField}${codeField}
        <button class="btn btn-primary btn-block btn-lg" type="submit">Continue →</button></form>`);
    } else {
      const d = state.data;
      shell(`<form id="f" novalidate>
        <div class="form-success">🎄 Hi ${esc(d.name)}! ${d.otpRequired ? `We sent a 6-digit code to <strong>${esc(d.maskedEmail)}</strong>.` : 'Your details matched the directory.'}</div>
        ${d.otpRequired ? `<div class="field"><label for="otp">Verification code</label>
          <input id="otp" name="otp" class="otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>` : ''}
        ${d.passwordRequired ? `
        <div class="field"><label for="pw">Create a password</label>
          <input id="pw" name="password" type="password" autocomplete="new-password" required minlength="8">
          <span class="hint">At least 8 characters with a letter and a number.</span></div>
        <div class="field"><label for="pw2">Confirm password</label>
          <input id="pw2" name="password2" type="password" autocomplete="new-password" required></div>` : ''}
        <button class="btn btn-primary btn-block btn-lg" type="submit">Activate my account ✨</button>
        <div class="auth-foot"><button type="button" class="text-link" id="back">← Back</button>
          ${d.otpRequired ? '<button type="button" class="text-link" id="resend">Resend code</button>' : ''}</div></form>`);
      $('#back').addEventListener('click', () => { state.step = 1; render(); });
      const resend = $('#resend');
      if (resend) resend.addEventListener('click', async () => {
        try { await SS.api('/api/auth/signup/start', { method: 'POST', body: { email: d.email, employeeCode: d.employeeCode } }); showOk('A new code is on its way.'); }
        catch (e) { showError(e.message); }
      });
    }
    const form = $('#f');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit(form, form.querySelector('[type=submit]'), async (fd) => {
        if (state.step === 1) {
          const email = String(fd.get('email') || '').trim();
          const employeeCode = String(fd.get('employeeCode') || '').trim();
          const r = await SS.api('/api/auth/signup/start', { method: 'POST', body: { email, employeeCode } });
          state.data = { ...r, email, employeeCode };
          state.step = 2; render();
        } else {
          if (state.data.passwordRequired && fd.get('password') !== fd.get('password2')) throw new Error('The two passwords do not match.');
          await SS.api('/api/auth/signup/complete', {
            method: 'POST',
            body: { email: state.data.email, employeeCode: state.data.employeeCode, otp: fd.get('otp'), password: fd.get('password') || undefined },
          });
          done();
        }
      });
    });
  }

  /* ----------------------------------------------------------- forgot */
  function renderForgot() {
    if (state.step === 1) {
      shell(`<form id="f" novalidate>
        <p class="muted">Enter your official email or Employee ID and we'll email you a reset code.</p>
        <div class="field"><label for="id">Official email or Employee ID</label>
          <input id="id" name="identifier" required value="${esc(state.data.identifier || '')}"></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Send reset code</button>
        <div class="auth-foot"><button type="button" class="text-link" id="back">← Back to sign in</button></div></form>`);
      $('#back').addEventListener('click', () => { state.mode = 'signin'; render(); });
    } else {
      shell(`<form id="f" novalidate>
        <div class="field"><label for="otp">Reset code</label>
          <input id="otp" name="otp" class="otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>
        <div class="field"><label for="pw">New password</label>
          <input id="pw" name="password" type="password" autocomplete="new-password" required minlength="8">
          <span class="hint">At least 8 characters with a letter and a number.</span></div>
        <div class="field"><label for="pw2">Confirm new password</label>
          <input id="pw2" name="password2" type="password" autocomplete="new-password" required></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Save &amp; sign in</button>
        <div class="auth-foot"><button type="button" class="text-link" id="back">← Back</button></div></form>`);
      $('#back').addEventListener('click', () => { state.step = 1; render(); });
    }
    const form = $('#f');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit(form, form.querySelector('[type=submit]'), async (fd) => {
        if (state.step === 1) {
          state.data.identifier = fd.get('identifier');
          const r = await SS.api('/api/auth/password/forgot', { method: 'POST', body: { identifier: state.data.identifier } });
          state.step = 2; render(); showOk(r.message);
        } else {
          if (fd.get('password') !== fd.get('password2')) throw new Error('The two passwords do not match.');
          await SS.api('/api/auth/password/reset', { method: 'POST', body: { identifier: state.data.identifier, otp: fd.get('otp'), password: fd.get('password') } });
          done();
        }
      });
    });
  }

  function render() {
    if (state.mode === 'signup') renderSignup();
    else if (state.mode === 'forgot') renderForgot();
    else renderSignin();
    const first = main.querySelector('input');
    if (first) first.focus();
  }
  render();
})();
