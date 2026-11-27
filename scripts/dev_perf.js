// Timing helpers for the local dev harness. scripts/dev_server.mjs injects this into index.html
// when the page is opened with &perf=1 (never in production). In the console:
//   await __H.pages()      // navTo() and sidebar-click timings for every page (median of 3)
//   await __H.measure(() => openJobDetail(jobs[0].id))
// measure(fn, done) runs fn, then follows animation frames:
//   sync    = the time fn itself took (the click handler, or the whole render when it is synchronous);
//   settle  = until the frame that shows the result has been drawn: the first animation frame at
//             which done() holds (default: straight away; for page switches: the view is shown
//             and the page's render function has run), plus that
//             frame's own style/layout/paint (up to the next frame callback);
//   longest = the longest gap between frames within 600 ms (jank, including deferred work).
window.__H = {
  lastRender: 0,
  // Note when any page's render function last ran (deferred renders included).
  track() {
    if (this._tracked) return; this._tracked = true;
    ['renderDashboard', 'renderTodo', 'renderJobs', 'renderSchedule', 'renderReporting', 'renderBoards', 'renderSettings'].forEach((n) => {
      const o = window[n]; if (typeof o !== 'function') return;
      window[n] = function () { const r = o.apply(this, arguments); __H.lastRender = performance.now(); return r; };
    });
  },
  async measure(fn, done = () => true, win = 600) {
    this.track();
    const t0 = performance.now();
    await fn();
    const t1 = performance.now();
    let last = t1, longest = 0, doneAt = null, settle = null;
    await new Promise((res) => {
      const loop = () => {
        const n = performance.now(); longest = Math.max(longest, n - last); last = n;
        if (doneAt !== null && settle === null) settle = n - t0;
        else if (doneAt === null) { let ok = false; try { ok = done(t0); } catch (e) { ok = true; } if (ok) doneAt = n; }
        if (settle === null && n - t0 > 5000) settle = n - t0; // never done: give up (shows as 5000+)
        if (n - t0 < win || settle === null) requestAnimationFrame(loop); else res();
      };
      requestAnimationFrame(loop);
    });
    return { sync: +(t1 - t0).toFixed(1), settle: +settle.toFixed(1), longest: +longest.toFixed(1) };
  },
  idle(ms = 700) { return new Promise((r) => setTimeout(r, ms)); },
  med(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; },
  async rep(name, fn, n = 3, before, done) {
    const r = [];
    for (let i = 0; i < n; i++) { if (before) await before(); await this.idle(); r.push(await this.measure(fn, done)); }
    return { name, sync: this.med(r.map((x) => x.sync)), settle: this.med(r.map((x) => x.settle)), longest: this.med(r.map((x) => x.longest)) };
  },
  // done() for a page switch: the view is on screen and its render has run. (The tabs-r7 loader
  // is transparent for its first 120 ms, so a render that lands before then is what you see.)
  viewDone(p) { return (t0) => !document.getElementById('view-' + p).classList.contains('hidden') && __H.lastRender >= t0; },
  async pages(list = ['dashboard', 'todo', 'jobs', 'schedule', 'reporting', 'boards', 'settings']) {
    const out = [];
    const away = (p) => async () => { navTo(p === 'dashboard' ? 'todo' : 'dashboard'); };
    for (const p of list) out.push(await this.rep('navTo ' + p, () => navTo(p), 3, away(p), this.viewDone(p)));
    for (const p of list) out.push(await this.rep('click ' + p, () => document.getElementById('snav-' + p).click(), 3, away(p), this.viewDone(p)));
    console.table(out);
    return out;
  },
  // Initial load: ms from navigation start until Streamtime data is loaded and the first view drawn
  // (_stLoad.phase 'done'), plus the long tasks (> 50 ms) seen on the way.
  load: { done: null, longTasks: [] },
};
try { new PerformanceObserver((l) => l.getEntries().forEach((e) => __H.load.longTasks.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) { /* not supported */ }
(function poll() {
  // eslint-disable-next-line no-undef
  if (typeof _stLoad !== 'undefined' && _stLoad.phase === 'done') { requestAnimationFrame(() => { __H.load.done = Math.round(performance.now()); }); return; }
  setTimeout(poll, 10);
})();
