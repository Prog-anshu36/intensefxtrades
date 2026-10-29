/* IntenseFX Trades marketing site — progressive enhancement. No dependencies.
   Everything here degrades gracefully: pages are readable with JS off. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover:hover) and (pointer:fine)").matches;
  const root = document.documentElement;
  root.classList.remove("js-off");

  // Low-power heuristic: few cores / low memory / small phone → drop continuous effects.
  const lowPower = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (navigator.deviceMemory && navigator.deviceMemory <= 4) || innerWidth < 820;
  if (lowPower) root.classList.add("lite");

  /* ---------- nav ---------- */
  const toggle = $(".nav-toggle"), panel = $(".nav-panel");
  if (toggle && panel) {
    const set = (open) => {
      panel.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      if (!open) panel.querySelectorAll("a,button").forEach((e) => e.blur?.());
    };
    toggle.addEventListener("click", () => set(toggle.getAttribute("aria-expanded") !== "true"));
    addEventListener("keydown", (e) => { if (e.key === "Escape" && panel.classList.contains("open")) { set(false); toggle.focus(); } });
    panel.addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
    matchMedia("(min-width:981px)").addEventListener("change", (m) => m.matches && set(false));
  }

  /* ---------- reveal once ---------- */
  const rv = $$(".rv");
  if ("IntersectionObserver" in window && !reduced) {
    const io = new IntersectionObserver((es) => es.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }), { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    rv.forEach((el) => io.observe(el));
    $$(".phero-art .shot").forEach((el) => io.observe(el));
  } else { rv.forEach((el) => el.classList.add("in")); $$(".phero-art .shot").forEach((el) => el.classList.add("in")); }

  /* ---------- hero parallax (pointer only, rAF-throttled, no idle rendering) ---------- */
  const stage = $("[data-parallax]");
  if (stage && finePointer && !reduced && !lowPower) {
    let raf = 0, nx = 0, ny = 0;
    const apply = () => { raf = 0; stage.style.setProperty("--mx", nx.toFixed(3)); stage.style.setProperty("--my", ny.toFixed(3)); };
    addEventListener("pointermove", (e) => {
      nx = (e.clientX / innerWidth - 0.5) * 2; ny = (e.clientY / innerHeight - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(apply);
    }, { passive: true });
  }

  /* ---------- ambient particles (tiny canvas, paused offscreen / hidden) ---------- */
  const cv = $("#spark");
  if (cv && !reduced && !lowPower) {
    const ctx = cv.getContext("2d");
    let W = 0, H = 0, pts = [], run = false, raf = 0, visible = true;
    const size = () => { const r = cv.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 1.5); W = cv.width = r.width * d; H = cv.height = r.height * d; };
    const init = () => { size(); pts = Array.from({ length: 38 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: (Math.random() * 1.4 + .4) * (devicePixelRatio || 1), v: Math.random() * .18 + .04, a: Math.random() * .5 + .15 })); };
    const tick = () => {
      if (!run) return;
      ctx.clearRect(0, 0, W, H);
      for (const p of pts) {
        p.y -= p.v; if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fillStyle = `rgba(110,163,255,${p.a})`; ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    const go = () => { const should = visible && !document.hidden; if (should && !run) { run = true; raf = requestAnimationFrame(tick); } else if (!should) { run = false; cancelAnimationFrame(raf); } };
    init(); addEventListener("resize", () => { size(); }); document.addEventListener("visibilitychange", go);
    new IntersectionObserver((e) => { visible = e[0].isIntersecting; go(); }).observe(cv); go();
  }

  /* ---------- gentle 3D tilt on large screenshots (pointer only) ---------- */
  if (finePointer && !reduced) {
    $$("[data-tilt]").forEach((el) => {
      let raf = 0;
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        if (raf) return; raf = requestAnimationFrame(() => { raf = 0; el.style.setProperty("--ry", (x * 5).toFixed(2) + "deg"); el.style.setProperty("--rx", (-y * 4).toFixed(2) + "deg"); });
      });
      el.addEventListener("pointerleave", () => { el.style.setProperty("--ry", "0deg"); el.style.setProperty("--rx", "0deg"); });
    });
  }

  /* ---------- lightbox (native <dialog>: focus trap + Esc included) ---------- */
  let lb = null, lastTrigger = null;
  const buildLb = () => {
    lb = document.createElement("dialog");
    lb.className = "lb"; lb.setAttribute("aria-label", "Screenshot preview");
    lb.innerHTML = '<div class="lb-in"><div class="lb-bar"><span class="t"></span><button type="button" data-fit aria-pressed="false">Actual size</button><button type="button" data-close aria-label="Close preview">Close ✕</button></div><div class="lb-stage"><img alt=""></div><p class="lb-cap"></p></div>';
    document.body.appendChild(lb);
    lb.addEventListener("click", (e) => { if (e.target === lb || e.target.matches(".lb-in")) lb.close(); });
    lb.querySelector("[data-close]").addEventListener("click", () => lb.close());
    const fit = lb.querySelector("[data-fit]"), st = lb.querySelector(".lb-stage");
    fit.addEventListener("click", () => { const on = st.classList.toggle("full"); fit.setAttribute("aria-pressed", String(on)); fit.textContent = on ? "Fit to screen" : "Actual size"; });
    lb.addEventListener("close", () => { lastTrigger?.focus(); document.body.style.overflow = ""; });
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button.zoom"); if (!b) return;
    const img = b.querySelector("img"); if (!img) return;
    if (!lb) buildLb();
    lastTrigger = b;
    const full = b.dataset.full || img.currentSrc || img.src;
    const li = lb.querySelector("img"); li.src = full; li.alt = img.alt;
    lb.querySelector(".t").textContent = img.alt;
    lb.querySelector(".lb-cap").textContent = b.closest(".shot-wrap")?.querySelector("figcaption")?.textContent || "";
    lb.querySelector(".lb-stage").classList.remove("full");
    const fit = lb.querySelector("[data-fit]"); fit.textContent = "Actual size"; fit.setAttribute("aria-pressed", "false");
    document.body.style.overflow = "hidden";
    lb.showModal();
  });

  /* ---------- roving tabs / tablist (home feature preview) ---------- */
  $$("[data-tabs]").forEach((wrap) => {
    const tabs = $$('[role="tab"]', wrap), panes = $$('[role="tabpanel"]', wrap);
    const sel = (i, focus) => {
      tabs.forEach((t, k) => { const on = k === i; t.setAttribute("aria-selected", on); t.tabIndex = on ? 0 : -1; panes[k].hidden = !on; });
      // lazy-load the selected image
      panes[i].querySelectorAll("img[data-src]").forEach((im) => { im.src = im.dataset.src; im.removeAttribute("data-src"); });
      if (focus) tabs[i].focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => sel(i));
      t.addEventListener("keydown", (e) => {
        const k = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (k) { e.preventDefault(); sel((i + k + tabs.length) % tabs.length, true); }
        else if (e.key === "Home") { e.preventDefault(); sel(0, true); }
        else if (e.key === "End") { e.preventDefault(); sel(tabs.length - 1, true); }
      });
    });
    sel(0);
  });

  /* ---------- FAQ accordion ---------- */
  $$(".faq").forEach((faq) => {
    const items = $$(".faq-item", faq), qs = items.map((i) => $(".faq-q", i));
    const setOpen = (item, open) => {
      item.classList.toggle("open", open);
      const q = $(".faq-q", item); q.setAttribute("aria-expanded", String(open));
      $(".faq-a", item).toggleAttribute("inert", !open);
    };
    items.forEach((item) => { setOpen(item, false); $(".faq-q", item).addEventListener("click", () => setOpen(item, !item.classList.contains("open"))); });
    qs.forEach((q, i) => q.addEventListener("keydown", (e) => {
      const k = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: qs.length - 1 }[e.key];
      if (k !== undefined) { e.preventDefault(); qs[(k + qs.length) % qs.length].focus(); }
    }));
    // open from hash
    const h = location.hash && $(location.hash + ".faq-item");
    if (h) { setOpen(h, true); }
  });

  /* ---------- features scroll-spy ---------- */
  const idx = $$(".fx-index a");
  if (idx.length && "IntersectionObserver" in window) {
    const map = new Map(idx.map((a) => [a.getAttribute("href").slice(1), a]));
    const spy = new IntersectionObserver((es) => es.forEach((en) => {
      if (en.isIntersecting) { idx.forEach((a) => a.classList.remove("on")); map.get(en.target.id)?.classList.add("on"); }
    }), { rootMargin: "-30% 0px -60% 0px" });
    map.forEach((_, id) => { const s = document.getElementById(id); s && spy.observe(s); });
  }

  /* ---------- pricing: duration selector (prices come from the build-time config) ---------- */
  const sel = $("#duration");
  if (sel) {
    const fmt = new Intl.NumberFormat("en-IN");
    const sym = sel.dataset.symbol || "₹";
    const render = () => {
      const m = +sel.value;
      $$("[data-monthly]").forEach((el) => {
        const mo = +el.dataset.monthly, t = $(".total", el.closest(".plan,.vip") || el), price = $(".amt", el);
        if (mo === 0) { if (t) t.textContent = "No payment, no expiry"; return; }
        price.textContent = sym + fmt.format(mo * m);
        const unit = $(".unit", el); if (unit) unit.textContent = "/ " + (m === 1 ? "1 month" : m + " months");
        if (t) t.textContent = m === 1 ? "One-time prepaid purchase" : `${sym}${fmt.format(mo)} × ${m} months · no term discount`;
      });
    };
    sel.addEventListener("change", render); render();
  }

  /* ---------- readiness self-check (local only, nothing is stored or sent) ---------- */
  $$("[data-check]").forEach((box) => {
    const ins = $$("input", box), out = $("output", box), bar = $(".meter i", box);
    const msgs = [
      "Tick what is honestly true today. Nothing here is stored or sent.",
      "A start. Pick one gap and practise it in a simulated account first.",
      "Taking shape. Keep reviewing trades until the pattern is clear.",
      "Solid foundations. Keep testing the process before putting real money behind it.",
      "Strong preparation habits. This is reflection, not a prediction of any result.",
    ];
    const upd = () => { const n = ins.filter((i) => i.checked).length, lvl = n === 0 ? 0 : Math.min(4, Math.ceil((n / ins.length) * 4)); out.textContent = `${n} of ${ins.length} ticked. ${msgs[lvl]}`; bar.style.width = (n / ins.length) * 100 + "%"; };
    ins.forEach((i) => i.addEventListener("change", upd)); upd();
  });

  /* ---------- contact form: honest modes ---------- */
  const form = $("#contact-form");
  if (form) {
    const mode = form.dataset.mode; // "endpoint" | "mailto" | "unconfigured"
    const status = $(".status", form), btn = $("button[type=submit]", form);
    const say = (cls, msg) => { status.className = "status show " + cls; status.textContent = msg; };
    if (mode === "unconfigured") { say("info", "Development placeholder: this form is not connected to an email service yet, so it cannot send messages. Add CONTACT_FORM_ENDPOINT or OFFICIAL_CONTACT_EMAIL in site.config.json."); btn.disabled = true; }
    const rules = { name: (v) => v.trim().length >= 2 || "Enter your name.", email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || "Enter a valid email address.", message: (v) => v.trim().length >= 10 || "Write at least 10 characters." };
    const check = (el) => { const r = rules[el.name]?.(el.value); const ok = r === true; el.setAttribute("aria-invalid", String(!ok)); $("#" + el.id + "-err").textContent = ok ? "" : r; return ok; };
    $$("input,textarea", form).forEach((el) => { if (rules[el.name]) el.addEventListener("blur", () => check(el)); });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (mode === "unconfigured") return;
      const fields = $$("input,textarea", form).filter((el) => rules[el.name]);
      const good = fields.map(check).every(Boolean);
      if (!good) { fields.find((f) => f.getAttribute("aria-invalid") === "true")?.focus(); return say("bad", "Please fix the highlighted fields."); }
      if ($(".hp", form).value) return; // honeypot
      const data = Object.fromEntries(fields.map((f) => [f.name, f.value.trim()]));
      if (mode === "mailto") {
        const to = form.dataset.email;
        location.href = `mailto:${to}?subject=${encodeURIComponent("IntenseFX Trades enquiry from " + data.name)}&body=${encodeURIComponent(data.message + "\n\n" + data.name + " <" + data.email + ">")}`;
        return say("info", "Your email app should open with the message ready. Nothing has been sent until you press Send there.");
      }
      btn.classList.add("loading"); btn.disabled = true; say("info", "Sending…");
      try {
        const res = await fetch(form.dataset.endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data) });
        if (!res.ok) throw new Error(res.status);
        form.reset(); say("ok", "Message sent. We will reply to the email address you gave.");
      } catch { say("bad", "The message could not be sent. Please try again later or use the email address above."); }
      finally { btn.classList.remove("loading"); btn.disabled = false; }
    });
  }
})();
