'use strict';
/* Voice notes: tap the mic to dictate into a note field. Text is always appended, never replaced.
   Uses the Web Speech API when it's available. If it's missing or fails (no permission, not allowed in an
   installed iPhone web app, offline), it focuses the field and suggests the keyboard's mic key, which works offline on iPhone. */
const Voice = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const SILENCE_MS = () => window.__voiceSilenceMs || 12000; // auto-stop after a long pause
  let active = null; // { rec, ta, btn, stop }
  const MIC = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  // If the phone refused speech service, skip straight to the keyboard hint for a week, then try again.
  const unusable = () => !SR || Date.now() - Number(localStorage.getItem('voiceUnavailable') || 0) < 7 * 864e5;

  function joinText(base, add) {
    add = add.trim(); if (!add) return base;
    add = add[0].toUpperCase() + add.slice(1);
    if (!base.trim()) return add;
    return base.replace(/\s+$/, '') + (/[.!?]$/.test(base.trim()) ? ' ' : '. ') + add;
  }
  function hint(ta, msg) {
    let el = ta.parentNode.querySelector('.voicehint');
    if (!el) { el = h('div', { class: 'voicehint' }); ta.after(el); }
    el.textContent = msg; el.hidden = false;
    clearTimeout(el._t); el._t = setTimeout(() => (el.hidden = true), 9000);
  }
  function fallback(ta, reason) {
    ta.hidden = false; ta.focus();
    const tip = 'Tap the 🎤 key on your keyboard to dictate (works offline).';
    const why = { 'not-allowed': 'Microphone access is off for this app.', 'service-not-allowed': 'Voice notes aren’t available in this app on this phone.',
      network: 'Voice notes need an internet connection.', offline: 'You’re offline.', 'audio-capture': 'No microphone was found.', unsupported: 'Voice notes aren’t supported here.' }[reason] || 'Voice notes stopped.';
    hint(ta, `${why} ${tip}`);
  }
  function stopAll() { if (active) active.stop(); }

  function start(ta, btn) {
    stopAll();
    ta.hidden = false;
    if (unusable()) return fallback(ta, SR ? 'service-not-allowed' : 'unsupported');
    if (!navigator.onLine) return fallback(ta, 'offline');
    let rec;
    try { rec = new SR(); } catch (e) { return fallback(ta, 'unsupported'); }
    rec.lang = navigator.language || 'en-US'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    const base = ta.value; let finals = '', heard = false, started = false, failed = null, silence = null;
    const live = h('div', { class: 'interim' }, 'Listening…'); ta.after(live);
    const t0 = Date.now();
    const arm = () => { clearTimeout(silence); silence = setTimeout(() => me.stop(), SILENCE_MS()); };
    const set = v => { ta.value = v; ta.dispatchEvent(new Event('input', { bubbles: true })); };
    const me = {
      rec, ta, btn,
      stop() {
        if (active !== me) return;
        active = null; clearTimeout(silence); try { rec.stop(); } catch (e) {}
        btn.classList.remove('rec'); btn.setAttribute('aria-pressed', 'false'); btn.querySelector('.vlabel').textContent = 'Voice';
        live.remove();
      },
    };
    rec.onstart = () => { started = true; arm(); };
    rec.onresult = e => {
      heard = true; arm();
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]; if (r.isFinal) finals += ' ' + r[0].transcript; else interim += r[0].transcript;
      }
      set(joinText(base, finals));
      live.textContent = interim ? `“${interim.trim()}…”` : 'Listening…';
    };
    rec.onerror = e => {
      failed = e.error;
      if (e.error === 'service-not-allowed') localStorage.setItem('voiceUnavailable', String(Date.now()));
      if (['not-allowed', 'service-not-allowed', 'network', 'audio-capture', 'language-not-supported'].includes(e.error)) { me.stop(); fallback(ta, e.error); }
    };
    rec.onend = () => {
      const quick = !started && !heard && Date.now() - t0 < 1500;
      const wasActive = active === me;
      me.stop();
      if (wasActive && quick && !failed) fallback(ta, 'unsupported'); // ended instantly with no error: treat as unavailable
    };
    active = me;
    btn.classList.add('rec'); btn.setAttribute('aria-pressed', 'true'); btn.querySelector('.vlabel').textContent = 'Stop';
    try { rec.start(); } catch (e) { me.stop(); fallback(ta, 'unsupported'); }
  }

  // Returns a mic button bound to a textarea. `container` (optional): stop when it scrolls out of view.
  function button(ta, { container, compact } = {}) {
    const btn = h('button', { type: 'button', class: 'voicebtn' + (compact ? ' compact' : ''), 'aria-label': 'Dictate a voice note', 'aria-pressed': 'false',
      onclick: e => { e.preventDefault(); active && active.btn === btn ? active.stop() : start(ta, btn); } },
      h('span', { html: MIC }), h('span', { class: 'vlabel' }, 'Voice'));
    if (container && 'IntersectionObserver' in window) {
      new IntersectionObserver(es => { if (active && active.btn === btn && !es[0].isIntersecting) active.stop(); }).observe(container);
    }
    return btn;
  }
  document.addEventListener('visibilitychange', () => document.hidden && stopAll());
  window.addEventListener('hashchange', stopAll);
  return { button, stopAll, supported: () => !unusable() };
})();
