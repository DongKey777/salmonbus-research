// Keeps an open page current without reloading it. Every 60 seconds the page reads /version.json; when the site digest
// differs from the one the page was built with, it fetches its own URL again and swaps only the [data-live] sections
// whose HTML changed (and the children of [data-live-list] lists), keeping the scroll position and every <details> the
// visitor opened or closed. Errors back off (doubling up to 15 minutes); a hidden tab does not poll and checks at once
// when it is shown again if a poll is due. The polling core (createPoller) has no DOM and is tested in Node.
(function (factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else if (typeof window !== "undefined") window.siteLive = api.start(window, document);
})(function () {
  "use strict";

  const MAX_MS = 15 * 60 * 1000;

  function backoff(baseMs, failures, maxMs) {
    return failures ? Math.min(baseMs * 2 ** failures, maxMs) : baseMs;
  }

  // env: { check() -> Promise, baseMs, maxMs?, now(), setTimeout, clearTimeout, hidden() }
  function createPoller(env) {
    const maxMs = env.maxMs || MAX_MS;
    let timer = null;
    let failures = 0;
    let inFlight = false;
    let lastStart = env.now();
    let dueAt = null;
    let stopped = false;

    function arm(ms) {
      if (timer !== null) env.clearTimeout(timer);
      timer = null;
      dueAt = env.now() + ms;
      if (stopped || env.hidden()) return;
      timer = env.setTimeout(run, ms);
    }

    async function run() {
      timer = null;
      if (stopped || inFlight) return;
      if (env.hidden()) { dueAt = env.now(); return; }
      inFlight = true;
      lastStart = env.now();
      try {
        await env.check();
        failures = 0;
      } catch (_) {
        failures += 1;
      } finally {
        inFlight = false;
      }
      arm(backoff(env.baseMs, failures, maxMs));
    }

    function visibility() {
      if (stopped) return;
      if (env.hidden()) {
        if (timer !== null) env.clearTimeout(timer);
        timer = null;
        return;
      }
      if (inFlight || timer !== null) return;
      const wait = Math.max(0, (dueAt === null ? lastStart + env.baseMs : dueAt) - env.now());
      if (wait === 0) run();
      else arm(wait);
    }

    return {
      start() { stopped = false; arm(env.baseMs); },
      stop() { stopped = true; if (timer !== null) env.clearTimeout(timer); timer = null; },
      visibility,
      runNow: run,
      get failures() { return failures; },
      get delay() { return backoff(env.baseMs, failures, maxMs); },
      get scheduled() { return timer !== null; },
    };
  }

  function sameSectionOrder(current, fresh) {
    return current.length === fresh.length && current.every((node, i) => node.id === fresh[i].id);
  }

  // ------------------------------------------------------------------------------------------- page side
  function start(win, doc) {
    const body = doc.body;
    const baseMs = (Number(body.dataset.poll) || 60) * 1000;
    const versionUrl = body.dataset.versionUrl || "/version.json";
    const served = new Map();
    const toggled = new Set();
    const OPEN_KEY = `rs-open:${win.location.pathname}`;
    const FOCUS_KEY = `rs-focus:${win.location.pathname}`;
    let digest = body.dataset.digest;
    let lastContact = Date.now();
    let offline = false;
    let pending = false;

    const liveNodes = (root) => [...root.querySelectorAll("[data-live]")].filter((n) => n.id && !n.parentElement.closest("[data-live-list]"));
    const listNodes = (root) => [...root.querySelectorAll("[data-live-list]")].filter((n) => n.id);
    const remember = (node) => served.set(node.id, node.outerHTML);

    liveNodes(doc).forEach(remember);
    listNodes(doc).forEach((list) => [...list.children].forEach((n) => { if (n.id) remember(n); }));

    try {
      const saved = JSON.parse(win.sessionStorage.getItem(OPEN_KEY) || "null");
      win.sessionStorage.removeItem(OPEN_KEY);
      if (saved) {
        for (const [id, open] of Object.entries(saved)) {
          const d = doc.getElementById(id);
          if (d && d.tagName === "DETAILS") { d.open = open; toggled.add(id); }
        }
      }
      const focusedId = win.sessionStorage.getItem(FOCUS_KEY);
      win.sessionStorage.removeItem(FOCUS_KEY);
      if (focusedId) doc.getElementById(focusedId)?.focus({ preventScroll: true });
    } catch (_) { /* storage may be unavailable */ }

    doc.addEventListener("click", (e) => {
      const summary = e.target instanceof win.Element ? e.target.closest("details > summary") : null;
      if (summary && summary.parentElement.id) toggled.add(summary.parentElement.id);
    }, true);

    function keepOpenState(fresh) {
      const all = fresh.tagName === "DETAILS" ? [fresh] : [];
      for (const d of [...all, ...fresh.querySelectorAll("details[id]")]) {
        const now = doc.getElementById(d.id);
        if (now && toggled.has(d.id)) d.open = now.open;
      }
    }

    // The topmost section still on screen, in document order, that scrolls with the page (not the sticky bar or list).
    function anchor() {
      for (const n of doc.querySelectorAll("main [data-live][id], main [data-live-list] > [id]")) {
        if (n.parentElement.closest("[data-live-list]") && !n.parentElement.matches("[data-live-list]")) continue;
        const pos = win.getComputedStyle(n).position;
        if (pos === "sticky" || pos === "fixed") continue;
        const r = n.getBoundingClientRect();
        if (r.bottom > 0 && r.height > 0) return { id: n.id, top: r.top };
      }
      return null;
    }

    function restore(mark) {
      if (!mark) return;
      const n = doc.getElementById(mark.id);
      if (!n) return;
      const delta = n.getBoundingClientRect().top - mark.top;
      if (Math.abs(delta) >= 1) win.scrollBy(0, delta);
    }

    async function swap(current, fresh) {
      if (served.get(fresh.id) === fresh.outerHTML) return;
      const html = fresh.outerHTML;
      const node = doc.importNode(fresh, true);
      keepOpenState(node);
      if (win.siteCharts) await win.siteCharts.prepare(node);
      const focused = doc.activeElement;
      const focusId = focused && current.contains(focused) ? focused.id : null;
      current.replaceWith(node);
      if (focusId) doc.getElementById(focusId)?.focus({ preventScroll: true });
      served.set(node.id, html);
      if (win.siteCharts) win.siteCharts.setup(node);
    }

    async function syncList(list, freshList) {
      const freshKids = [...freshList.children].filter((n) => n.id);
      const freshIds = new Set(freshKids.map((n) => n.id));
      for (const n of [...list.children]) if (n.id && !freshIds.has(n.id)) n.remove();
      let prev = null;
      for (const fresh of freshKids) {
        let node = doc.getElementById(fresh.id);
        if (node && list.contains(node)) {
          await swap(node, fresh);
          node = doc.getElementById(fresh.id);
        } else {
          node = doc.importNode(fresh, true);
          served.set(fresh.id, fresh.outerHTML);
          if (win.siteCharts) await win.siteCharts.prepare(node);
          list.insertBefore(node, prev ? prev.nextSibling : list.firstChild);
          if (win.siteCharts) win.siteCharts.setup(node);
        }
        if ((prev ? prev.nextElementSibling : list.firstElementChild) !== node) {
          list.insertBefore(node, prev ? prev.nextSibling : list.firstChild);
        }
        prev = node;
      }
    }

    function assetChanged(fresh) {
      const css = (d) => (d.querySelector('link[data-asset="css"]') || {}).href;
      const js = (d) => [...d.querySelectorAll('script[data-asset="js"]')].map((s) => s.src).join(" ");
      if (js(fresh) !== js(doc)) return "js";
      if (css(fresh) !== css(doc)) return "css";
      return null;
    }

    function swapStylesheet(fresh) {
      const old = doc.querySelector('link[data-asset="css"]');
      const next = fresh.querySelector('link[data-asset="css"]');
      if (!old || !next) return Promise.resolve();
      return new Promise((resolve) => {
        const link = doc.createElement("link");
        link.rel = "stylesheet";
        link.dataset.asset = "css";
        link.onload = link.onerror = () => { old.remove(); resolve(); };
        link.href = next.getAttribute("href");
        old.after(link);
      });
    }

    function reloadKeepingState(nextDigest) {
      const open = {};
      for (const id of toggled) {
        const d = doc.getElementById(id);
        if (d && d.tagName === "DETAILS") open[id] = d.open;
      }
      try { win.sessionStorage.setItem(OPEN_KEY, JSON.stringify(open)); } catch (_) { /* ignore */ }
      try {
        if (doc.activeElement?.id) win.sessionStorage.setItem(FOCUS_KEY, doc.activeElement.id);
      } catch (_) { /* storage may be unavailable */ }
      const url = new win.URL(win.location.href);
      url.searchParams.set("v", nextDigest);
      win.location.replace(url.href);
    }

    async function apply(fresh) {
      const changed = assetChanged(fresh);
      if (changed === "js") { reloadKeepingState(fresh.body.dataset.digest); return false; }
      const freshLive = liveNodes(fresh);
      const freshIds = new Set(freshLive.map((n) => n.id));
      const same = sameSectionOrder(liveNodes(doc), freshLive) &&
        sameSectionOrder(listNodes(doc), listNodes(fresh)) &&
        freshLive.every((n) => doc.getElementById(n.id)) && liveNodes(doc).every((n) => freshIds.has(n.id)) &&
        listNodes(fresh).every((l) => doc.getElementById(l.id));
      if (!same) { reloadKeepingState(fresh.body.dataset.digest); return false; }
      // Load all visible replacement charts before changing any displayed section.
      // A failed chart fetch leaves the complete previous snapshot on screen for retry.
      if (win.siteCharts) await win.siteCharts.prepare(fresh);
      if (changed === "css") await swapStylesheet(fresh);
      const mark = anchor();
      for (const node of freshLive) await swap(doc.getElementById(node.id), node);
      for (const freshList of listNodes(fresh)) await syncList(doc.getElementById(freshList.id), freshList);
      restore(mark);
      body.dataset.digest = fresh.body.dataset.digest;
      win.dispatchEvent(new win.CustomEvent("site:updated", { detail: { digest: body.dataset.digest } }));
      return true;
    }

    function minutesAgo() {
      return Math.max(1, Math.round((Date.now() - lastContact) / 60000));
    }

    function showStatus() {
      const status = doc.getElementById("live-status");
      const text = status && status.querySelector(".live__text");
      if (!text) return;
      status.classList.toggle("is-offline", offline || pending);
      if (offline || pending) {
        if (!text.dataset.served) text.dataset.served = text.textContent;
        text.textContent = pending && !offline ? "새 결과 반영 중 · 현재 화면 유지" : `연결 끊김 · ${minutesAgo()}분 전 확인`;
      } else if (text.dataset.served) {
        text.textContent = text.dataset.served;
        delete text.dataset.served;
      }
    }

    async function check() {
      try {
        const res = await win.fetch(`${versionUrl}?t=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(String(res.status));
        const v = await res.json();
        if (!v || !v.digest) throw new Error("VERSION_MISSING");
        if (v.digest === digest) {
          lastContact = Date.now();
          offline = false; pending = false; showStatus();
          return "same";
        }
        pending = true; offline = false; showStatus();
        const page = await win.fetch(`${win.location.pathname}?v=${v.digest}`, { cache: "no-store", headers: { Accept: "text/html" } });
        if (page.status === 404) return "gone";
        if (!page.ok) throw new Error(String(page.status));
        const fresh = new win.DOMParser().parseFromString(await page.text(), "text/html");
        if (fresh.body.dataset.digest !== v.digest) return "stale";
        if (!await apply(fresh)) return "reloading";
        digest = v.digest;
        lastContact = Date.now();
        offline = false; pending = false; showStatus();
        return "changed";
      } catch (err) {
        offline = true;
        showStatus();
        throw err;
      }
    }

    const poller = createPoller({
      check, baseMs, now: () => Date.now(), hidden: () => doc.hidden,
      setTimeout: (fn, ms) => win.setTimeout(fn, ms), clearTimeout: (t) => win.clearTimeout(t),
    });
    doc.addEventListener("visibilitychange", () => poller.visibility());
    win.setInterval(() => { if (offline || pending) showStatus(); }, 30000);
    poller.start();
    return { poller, check, get digest() { return digest; } };
  }

  return { createPoller, backoff, sameSectionOrder, start, MAX_MS };
});

/* Progressive model filters. All model links and rows are present without JS. */
(() => {
  'use strict';
  const root = () => document.getElementById('arrival-hub-content');
  function applyFilter(scope) {
    if (!scope) return;
    const filter = scope.querySelector('[data-arrival-filter]');
    if (!filter) return;
    filter.hidden = false;
    const query = (filter.querySelector('[data-model-search]')?.value || '').trim().toLocaleLowerCase('ko');
    const kind = filter.querySelector('[data-model-kind]')?.value || 'all';
    const rows = scope.querySelectorAll('[data-arrival-model]');
    let count = 0;
    rows.forEach(row => {
      const match = (kind === 'all' || row.dataset.kind === kind) && (row.dataset.search || '').toLocaleLowerCase('ko').includes(query);
      row.hidden = !match;
      if (match) count += 1;
    });
    const counter = filter.querySelector('[data-model-count]');
    if (counter) counter.textContent = `${rows.length}개 중 ${count}개 표시`;
    const empty = scope.querySelector('[data-model-empty]');
    if (empty) empty.hidden = count !== 0;
  }
  document.addEventListener('input', event => {
    if (event.target instanceof Element && event.target.matches('[data-model-search]')) applyFilter(root());
  });
  document.addEventListener('change', event => {
    if (event.target instanceof Element && event.target.matches('[data-model-kind]')) applyFilter(root());
  });
  window.addEventListener('site:updated', () => applyFilter(root()));
  applyFilter(root());
})();
