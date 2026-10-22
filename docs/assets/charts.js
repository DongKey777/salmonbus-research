// Charts on every screen width. A page inlines the wide SVG of each chart; the medium and phone variants are files.
// The stylesheet shows the widest variant whose text stays at 12 px or more in the card, as an empty box that already
// has that variant's aspect ratio, and this script fetches the SVG into whichever box is shown, so nothing below moves.
// Fetched SVG is inlined like the wide one, so hover titles and detail links work the same in every variant.
// Touch screens and keyboards have no hover: a tap or keyboard focus on a line, point or area shows the chart's own
// hover title in a small tip, a linked line keeps its link inside the tip, and a second tap on the same line follows it.
// When even the phone variant does not fit (cards under 320 px), the card scrolls sideways and fades the hidden edge.
(() => {
  "use strict";

  const EDGE = 2;
  const XLINK = "http://www.w3.org/1999/xlink";
  const fetched = new Map();
  let keyboard = false;
  let pointer = "mouse";
  let tip = null;
  let active = null;

  function load(src) {
    if (!fetched.has(src)) {
      const job = fetch(src, { cache: "force-cache" })
        .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.text(); })
        .catch((err) => { fetched.delete(src); throw err; });
      fetched.set(src, job);
    }
    return fetched.get(src);
  }

  const boxes = (figure) => [...figure.children].filter((el) => el.classList.contains("chart__v"));
  const kindOf = (box) => ["wide", "medium", "narrow"].find((k) => box.classList.contains(`chart__${k}`));

  function shownBox(figure) {
    return boxes(figure).find((box) => getComputedStyle(box).display !== "none") || null;
  }

  async function fill(box) {
    const src = box.dataset.src;
    if (!src || box.dataset.loaded === src || box.dataset.loading === src) return;
    box.dataset.loading = src;
    try {
      const text = await load(src);
      if (box.dataset.src === src) {
        box.innerHTML = text;
        box.dataset.loaded = src;
      }
    } catch (_) {
      // The box keeps its size and stays empty; the next resize or page refresh tries again.
    } finally {
      if (box.dataset.loading === src) delete box.dataset.loading;
    }
  }

  function update(figure) {
    const box = shownBox(figure);
    if (box) fill(box);
  }

  // Fills the boxes of a figure that is about to replace `current` before it is shown: a variant whose file did not
  // change is copied from the page, and the variant the card shows now is fetched first, so a refresh never blanks a chart.
  async function prepare(fresh) {
    const jobs = [];
    for (const figure of fresh.querySelectorAll("[data-figure]")) {
      const current = document.getElementById(figure.id);
      if (!current) continue;
      const shown = shownBox(current);
      const shownKind = shown ? kindOf(shown) : null;
      for (const box of boxes(figure)) {
        const kind = kindOf(box);
        const same = boxes(current).find((b) => kindOf(b) === kind);
        if (box.dataset.loaded === box.dataset.src) continue;
        if (same && same.dataset.loaded === box.dataset.src) {
          box.innerHTML = same.innerHTML;
          box.dataset.loaded = box.dataset.src;
        } else if (kind === shownKind) {
          jobs.push(fill(box));
        }
      }
    }
    await Promise.all(jobs);
  }

  function measure(scroller) {
    const card = scroller.closest("[data-chart]");
    const frame = scroller.parentElement;
    if (!card || !frame) return;
    const room = scroller.scrollWidth - scroller.clientWidth;
    const wide = room > EDGE;
    card.classList.toggle("is-wide", wide);
    frame.classList.toggle("can-left", wide && scroller.scrollLeft > EDGE);
    frame.classList.toggle("can-right", wide && scroller.scrollLeft < room - EDGE);
    if (wide) {
      scroller.tabIndex = 0;
      scroller.setAttribute("role", "region");
      scroller.setAttribute("aria-label", `${scroller.dataset.name || "그림"}, 옆으로 밀어 볼 수 있음`);
    } else {
      scroller.removeAttribute("tabindex");
      scroller.removeAttribute("role");
      scroller.removeAttribute("aria-label");
    }
  }

  const resized = "ResizeObserver" in window ? new ResizeObserver((entries) => {
    for (const e of entries) {
      e.target.querySelectorAll("[data-figure]").forEach(update);
      const scroller = e.target.querySelector("[data-chart-scroll]");
      if (scroller) measure(scroller);
    }
  }) : null;

  function setup(root) {
    for (const scroller of root.querySelectorAll("[data-chart-scroll]")) {
      if (scroller.dataset.ready) continue;
      scroller.dataset.ready = "1";
      scroller.addEventListener("scroll", () => {
        measure(scroller);
        if (active && scroller.contains(active)) hide();
      }, { passive: true });
      if (resized) resized.observe(scroller.parentElement);
      measure(scroller);
    }
    root.querySelectorAll("[data-figure]").forEach(update);
  }

  if (!resized) {
    window.addEventListener("resize", () => {
      document.querySelectorAll("[data-figure]").forEach(update);
      document.querySelectorAll("[data-chart-scroll]").forEach(measure);
    });
  }

  function hide() {
    if (active) active.classList.remove("is-active");
    active = null;
    if (tip) tip.hidden = true;
  }

  function titleOf(hit) {
    const t = [...hit.children].find((c) => c.tagName.toLowerCase() === "title");
    return t ? t.textContent.trim() : "";
  }

  function hrefOf(hit) {
    const link = hit.closest("a");
    if (!link) return null;
    const href = link.getAttribute("href") || link.getAttributeNS(XLINK, "href") || "";
    return href.startsWith("/attempts/") ? href : null;
  }

  function show(hit, x, y) {
    const text = titleOf(hit);
    const card = hit.closest("[data-chart]");
    if (!text || !card) return;
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "chart-tip";
      tip.setAttribute("role", "status");
    }
    if (tip.parentElement !== card) card.appendChild(tip);
    tip.textContent = text;
    const href = hrefOf(hit);
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = "상세 글 보기";
      tip.appendChild(a);
    }
    if (active) active.classList.remove("is-active");
    active = hit;
    hit.classList.add("is-active");
    tip.hidden = false;
    const box = card.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.max(8, Math.min(x - box.left - w / 2, box.width - w - 8));
    let top = y - box.top - h - 14;
    if (top < 4) top = y - box.top + 18;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  document.addEventListener("keydown", (e) => {
    keyboard = true;
    if (e.key === "Escape") hide();
  }, true);

  document.addEventListener("pointerdown", (e) => {
    keyboard = false;
    pointer = e.pointerType || "mouse";
  }, true);

  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target || (tip && tip.contains(target))) return;
    const hit = target.closest(".rs-chart .rs-h");
    if (!hit || pointer === "mouse" || e.detail === 0) {
      hide();
      return;
    }
    if (hit === active && hrefOf(hit)) return;
    e.preventDefault();
    show(hit, e.clientX, e.clientY);
  });

  document.addEventListener("focusin", (e) => {
    const link = keyboard && e.target instanceof Element ? e.target.closest(".rs-chart a") : null;
    const hit = link ? link.querySelector(".rs-h") : null;
    if (!hit) return;
    const r = hit.getBoundingClientRect();
    show(hit, r.left + r.width / 2, r.top + r.height / 2);
  });

  document.addEventListener("focusout", (e) => {
    if (keyboard && e.target instanceof Element && e.target.closest(".rs-chart a")) hide();
  });

  window.addEventListener("resize", hide);
  window.siteCharts = { setup, prepare };
  setup(document);
})();
