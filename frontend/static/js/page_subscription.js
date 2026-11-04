const PageSubscription = {
  pendingFeature: null,
  selectedPlan: null,
  termMonths: 1,
  paymentMessage: "",
  checkoutBusy: false,
  message: "",
  vipMessage: "",
  vipMessageKind: "",
  promoMessage: "",
  promoMessageKind: "",
  init() {},
  requestFeature(feature, message = "") {
    this.pendingFeature = feature;
    this.message = message;
    window.UI?.closeModal?.("settingsModal");
    Router.go("subscription");
  },
  render() {
    const sys = window.SubscriptionSystem;
    const current = sys.getUserPlan();
    const feature = this.pendingFeature && sys.FEATURES[this.pendingFeature];
    const required = feature ? sys.requiredPlan(this.pendingFeature) : null;
    const verified = window.IntenseFXAuth?.getSubscription?.();
    const usingVip = Boolean(sys.getVipPlanCode?.() && sys.normalizePlan(verified) === "blue");
    const status = usingVip ? "VIP key active · this browser" : (verified?.status || "Free plan · local workspace");
    return `<section class="subscription-page">
      ${feature ? `<div class="subscription-gate" style="--plan-color:${required.color}"><span class="subscription-kicker">PLAN ACCESS</span><h2>${this.escape(feature.label)} is included with ${required.name} · ${required.tier}</h2><p>${this.escape(this.message || `Your current plan is ${current.name} · ${current.tier}. Upgrade options will appear here when checkout is connected.`)}</p><button class="subscription-secondary" id="subscriptionGateBack">Back to workspace</button></div>` : ""}
      <header class="subscription-heading"><div><span class="subscription-kicker">INTENSEFXTRADES PLANS</span><h2>Choose your trading workspace</h2><p>Permissions follow your verified plan. Choose 1, 3 or 12 months of prepaid access. No automatic renewal. Prices are in INR; no term discount is applied.</p></div><div class="subscription-current" style="--plan-color:${current.color}"><i></i><span><small>CURRENT PLAN</small><b>${current.name} · ${current.tier}</b><em>${this.escape(status)}</em></span></div></header>
      <section class="vip-key-panel" aria-label="Redeem VIP key"><div><span class="subscription-kicker">VIP ACCESS</span><h3>Have a VIP key?</h3><p>Redeem your access code while signed in. Each code's plan, duration and redemption limit are set per code — some may be redeemed more than once per account, and a live countdown of the time remaining shows next to your plan once active.</p></div><div class="vip-key-entry"><label class="sr-only" for="vipKeyInput">VIP key</label><input id="vipKeyInput" type="password" autocomplete="off" placeholder="Enter VIP key"><button id="vipKeyRedeem" type="button">Redeem key</button><span id="vipKeyMessage" data-kind="${this.vipMessageKind}" role="status" aria-live="polite">${this.escape(this.vipMessage)}</span></div></section>
      <section class="vip-key-panel promo-code-panel" aria-label="Redeem promo code"><div><span class="subscription-kicker">PROMO CODE</span><h3>Have a promo code?</h3><p>Got a code from Team IntenseFX or a collaboration partner? Enter it here. Codes are not case-sensitive.</p></div><div class="vip-key-entry"><label class="sr-only" for="promoCodeInput">Promo code</label><input id="promoCodeInput" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Enter promo code"><button id="promoCodeRedeem" type="button">Apply code</button><span id="promoCodeMessage" data-kind="${this.promoMessageKind}" role="status" aria-live="polite">${this.escape(this.promoMessage)}</span></div></section>
      <div id="devPromoMount"></div>
      <label class="subscription-term">Access duration <select id="subscriptionTerm" aria-label="Access duration">${[[1,'1 month'],[3,'3 months'],[12,'12 months · Annual']].map(([n,label])=>`<option value="${n}" ${n===this.termMonths?'selected':''}>${label}</option>`).join('')}</select></label>
      <div class="subscription-cards">${sys.ORDER.map(code => this.card(sys.PLANS[code], current)).join("")}</div>
      <section class="vip-key-panel golden-vip-pass" aria-label="Golden VIP Pass" style="--plan-color:#efc75e;border-color:#8b7138"><div><span class="subscription-kicker">GOLDEN VIP PASS</span><h3>Every supported feature. Full access.</h3><p>A separate pass, not a fifth plan. Includes all Elite features and full supported history.</p></div><div><strong>₹${sys.purchaseQuote('golden_vip',this.termMonths).amount.toLocaleString('en-IN')} / ${this.termMonths} month${this.termMonths===1?'':'s'}</strong><button type="button" class="subscription-secondary" data-subscription-plan="golden_vip" aria-pressed="${this.selectedPlan==='golden_vip'}">${this.selectedPlan==='golden_vip'?'Selected':'Buy Golden VIP'}</button></div></section>
      ${this.renderSelection(sys,current)}
      ${this.renderComparison(sys)}
      <div class="subscription-manage"><div><b>Prepaid access · no auto-renewal</b><span>${verified?.current_period_end ? `Access ends ${this.escape(new Date(verified.current_period_end).toLocaleDateString('en-IN'))}.` : (verified?.provider === 'vip' && sys.normalizePlan(verified) !== 'blue' ? 'Your VIP access has no expiry.' : 'Blue Free has no expiry.')} Same-product renewal extends your remaining term. A different-product purchase starts a new term without prorating.</span></div></div>
      <div class="subscription-footnote"><b>Payments are not open yet.</b> Merchant approval, bank settlement setup and provider test payments are required. Selecting a plan never charges you or unlocks access. Trading data remains stored in your browser.</div>
    </section>`;
  },
  card(plan, current) {
    const isCurrent = plan.code === current.code;
    const price = `₹${window.SubscriptionSystem.purchaseQuote(plan.code,this.termMonths).amount.toLocaleString("en-IN")}`;
    const unavailable = plan.code !== "blue";
    return `<article class="subscription-card ${isCurrent ? "is-current" : ""}" style="--plan-color:${plan.color}"><div class="subscription-card-top"><span class="subscription-plan-name"><i></i>${plan.name}</span>${isCurrent ? `<span class="subscription-current-tag">CURRENT</span>` : ""}</div><h3>${plan.tier}</h3><div class="subscription-price">${price}${plan.price === 0 ? `<small> forever</small>` : `<small> / ${this.termMonths} month${this.termMonths===1?"":"s"}</small>`}</div><ul>${plan.bullets.map(item => `<li><span>✓</span>${this.escape(item)}</li>`).join("")}</ul><button class="subscription-cta ${isCurrent ? "selected" : ""}" data-subscription-plan="${plan.code}" aria-pressed="${this.selectedPlan === plan.code}">${plan.code === "blue" ? "Continue Free" : `Buy ${plan.tier}`}</button>${unavailable ? `<small class="subscription-no-checkout">Prepaid access · no automatic renewal</small>` : ""}</article>`;
  },
  renderSelection(sys,current) {
    const selected=this.selectedPlan==='golden_vip'?sys.GOLDEN_PASS:sys.PLANS[this.selectedPlan];
    const quote=selected && selected.code!=='blue'?sys.purchaseQuote(selected.code,this.termMonths):null;
    return `<section class="subscription-gate" aria-live="polite"><h3>${selected?`Selected: ${this.escape(selected.name)} · ${this.escape(selected.tier)}`:'Select your access'}</h3>${quote?`<p>₹${quote.amount.toLocaleString('en-IN')} for ${this.termMonths} month${this.termMonths===1?'':'s'}. One-time prepaid purchase.</p>`:''}<p id="subscriptionPaymentStatus" role="status">${this.escape(this.paymentMessage || 'Paid access activates only after the server verifies a captured payment.')}</p>${selected&&selected.code!=='blue'?`<button type="button" class="subscription-secondary" id="subscriptionPay" ${this.checkoutBusy?'disabled':''}>${this.checkoutBusy?'Opening checkout…':`Buy ${this.escape(selected.tier)} · ₹${quote.amount.toLocaleString('en-IN')}`}</button>`:''}<button type="button" class="subscription-secondary" id="subscriptionContinue">Continue with ${this.escape(current.tier)}</button></section>`;
  },
  renderComparison(sys) {
    const rows = [
      ["Dashboard", "dashboard"], ["Trades and journal", "trades"], ["General settings", "generalSettings"], ["Chart workspace", "tradingView"],
      ["Analysis", "analysis"], ["Performance", "performance"], ["Backtesting", "backtesting"], ["Replay · last 365 days", "replay"],
      ["Trading Analysis", "tradeAnalysis"], ["Technical indicators", "technicalIndicators"], ["AI Coach", "aiCoach"],
      ["Premium appearance settings", "premiumAppearance"], ["Advanced application settings", "advancedSettings"],
      ["Full historical XAUUSD data", "premiumXauusd"], ["Replay beyond one year", "extendedHistoricalReplay"], ["Additional accounts", "additionalAccount"],
      ["Fast-forward multiple candles", "candleSkip"],
    ];
    return `<section class="subscription-comparison"><div><span class="subscription-kicker">ENTITLEMENTS</span><h3>Plan feature comparison</h3></div><div class="subscription-comparison-scroll"><table><thead><tr><th>Feature</th>${sys.ORDER.map(code => `<th style="--plan-color:${sys.PLANS[code].color}">${sys.PLANS[code].name}</th>`).join("")}</tr></thead><tbody>${rows.map(([label,feature]) => `<tr><th>${label}</th>${sys.ORDER.map(code => { const plan=sys.PLANS[code],included=plan.features.has(feature); const note=feature==="replay"&&code==="purple"?"Last year":feature==="candleSkip"&&included?`Up to ${plan.candleSkipCap}`:included?"Included":"—"; return `<td class="${included?"included":"excluded"}" style="--plan-color:${plan.color}">${included?"✓":"·"}<small>${note}</small></td>`; }).join("")}</tr>`).join("")}</tbody></table></div></section>`;
  },
  afterRender(container) {
    container.querySelector('#subscriptionTerm')?.addEventListener('change', event=>{this.termMonths=Number(event.target.value);this.paymentMessage='';Router.go('subscription');});
    container.querySelector('#subscriptionPay')?.addEventListener('click',()=>{PageCheckout.selectProduct(this.selectedPlan,this.termMonths);Router.go('checkout');});
    container.querySelector("#subscriptionGateBack")?.addEventListener("click", () => { this.pendingFeature = null; Router.go("dashboard"); });
    container.querySelector("#subscriptionContinue")?.addEventListener("click", () => Router.go("dashboard"));
    const keyInput = container.querySelector("#vipKeyInput");
    container.querySelector("#vipKeyRedeem")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = "Validating…";
      let result;
      try { result = await window.SubscriptionSystem.redeemVipKey(keyInput?.value); }
      catch { result = { ok: false, message: "Redemption could not be verified. Try again." }; }
      finally { button.disabled = false; button.textContent = "Redeem key"; }
      if (!result.ok) {
        this.vipMessage = result.message || "VIP redemption failed. Please try again.";
        this.vipMessageKind = "error";
        const status = container.querySelector("#vipKeyMessage");
        if (status) { status.textContent = this.vipMessage; status.dataset.kind = "error"; }
        return;
      }
      this.vipMessage = result.plan.name + " · " + result.plan.tier + " verified for your account.";
      this.vipMessageKind = "success";
      this.pendingFeature = null;
      this.message = "";
      Router.go("subscription");
    });
    keyInput?.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); container.querySelector("#vipKeyRedeem")?.click(); } });
    const promoInput = container.querySelector("#promoCodeInput");
    container.querySelector("#promoCodeRedeem")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (button.disabled) return;
      const code = String(promoInput?.value || "").trim();
      const status = container.querySelector("#promoCodeMessage");
      const show = (text, kind) => { this.promoMessage = text; this.promoMessageKind = kind; if (status) { status.textContent = text; status.dataset.kind = kind; } };
      if (!code) { show("Enter a promo code first.", "error"); return; }
      button.disabled = true; button.textContent = "Checking…";
      let result;
      try { result = await window.SubscriptionSystem.redeemVipKey(code); }
      catch { result = { ok: false, message: "Promo code could not be verified. Try again." }; }
      finally { button.disabled = false; button.textContent = "Apply code"; }
      if (!result.ok) { show((result.message || "Promo code failed.").replace(/VIP key/g, "promo code"), "error"); return; }
      this.promoMessage = result.plan.name + " · " + result.plan.tier + " activated on your account.";
      this.promoMessageKind = "success";
      this.pendingFeature = null; this.message = "";
      Router.go("subscription");
    });
    promoInput?.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); container.querySelector("#promoCodeRedeem")?.click(); } });
    this.mountDeveloperPanel(container.querySelector("#devPromoMount"));
    container.querySelectorAll("[data-subscription-plan]").forEach(button => button.addEventListener("click", () => {
      const code = button.dataset.subscriptionPlan;
      if (!window.SubscriptionSystem.PLANS[code] && code!=="golden_vip") return;
      this.selectedPlan = code;
      if(code==='blue'){Router.go('dashboard');return;}
      PageCheckout.selectProduct(code,this.termMonths);
      Router.go('checkout');
    }));
  },
  async mountDeveloperPanel(mount) {
    const auth = window.IntenseFXAuth;
    if (!mount || !auth?.checkDeveloper) return;
    let isDev = false;
    try { isDev = await auth.checkDeveloper(); } catch { isDev = false; }
    if (!isDev || !mount.isConnected) return;
    const plans = [["green", "Green · Starter"], ["purple", "Purple · Pro"], ["red", "Red · Elite"], ["golden_vip", "Golden VIP"]];
    mount.innerHTML = `<section class="vip-key-panel dev-promo-panel" aria-label="Developer promo codes"><div><span class="subscription-kicker">DEVELOPER MODE</span><h3>Create promo codes</h3><p>Only visible on your developer account. Codes you save here work on every account.</p></div>
      <form class="dev-promo-form" id="devPromoForm" autocomplete="off">
        <label>Code<input id="devPromoCode" type="text" maxlength="32" placeholder="e.g. ACME2026" required></label>
        <label>Plan<select id="devPromoPlan">${plans.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
        <label>Duration<span class="dev-inline"><input id="devPromoDuration" type="number" min="1" max="3650" value="30"><select id="devPromoUnit"><option value="24">days</option><option value="1">hours</option></select></span></label>
        <label class="dev-check"><input id="devPromoNever" type="checkbox"> Never expires</label>
        <label>Uses per account<input id="devPromoLimit" type="number" min="1" max="10000" value="1"></label>
        <label class="dev-check"><input id="devPromoUnlimited" type="checkbox"> Unlimited uses per account</label>
        <label class="dev-wide">Note (optional)<input id="devPromoNote" type="text" maxlength="120" placeholder="Client / collaboration"></label>
        <button type="submit" id="devPromoCreate">Save promo code</button><span id="devPromoMessage" role="status" aria-live="polite"></span>
      </form><div class="dev-promo-list" id="devPromoList"></div></section>`;
    const $ = id => mount.querySelector(id);
    const msg = (t, k) => { const m = $("#devPromoMessage"); m.textContent = t; m.dataset.kind = k || ""; };
    const reasons = { forbidden: "This account is not a developer account.", invalid_code: "Code must be 3–32 letters, numbers, - or _.", invalid_product: "Choose a valid plan.", invalid_duration: "Enter a valid duration.", invalid_limit: "Uses per account must be 1–10000.", exists: "That code already exists." };
    const loadList = async () => {
      const list = $("#devPromoList"); if (!list) return;
      const res = await auth.devListPromos();
      if (!res?.ok) { list.textContent = "Could not load your codes."; return; }
      if (!res.codes.length) { list.textContent = "No promo codes yet."; return; }
      const dur = c => c.no_expiry ? "never expires" : (c.duration_hours % 24 === 0 ? c.duration_hours / 24 + " day(s)" : c.duration_hours + " hour(s)");
      list.innerHTML = `<table><thead><tr><th>Code</th><th>Plan</th><th>Access</th><th>Per account</th><th>Used</th><th></th></tr></thead><tbody>${res.codes.map(c => `<tr class="${c.active ? "" : "is-off"}"><td><b>${this.escape(c.code)}</b>${c.note ? `<small>${this.escape(c.note)}</small>` : ""}</td><td>${this.escape(c.product_code)}</td><td>${dur(c)}</td><td>${c.max_per_account ?? "unlimited"}</td><td>${c.redemptions} / ${c.accounts} acct</td><td><button type="button" data-hash="${this.escape(c.key_hash)}" data-next="${c.active ? "0" : "1"}">${c.active ? "Disable" : "Enable"}</button></td></tr>`).join("")}</tbody></table>`;
    };
    $("#devPromoForm").addEventListener("submit", async event => {
      event.preventDefault();
      const btn = $("#devPromoCreate"); btn.disabled = true;
      const never = $("#devPromoNever").checked, unl = $("#devPromoUnlimited").checked;
      const hours = Math.round(Number($("#devPromoDuration").value) * Number($("#devPromoUnit").value));
      const res = await auth.devCreatePromo({ code: $("#devPromoCode").value, product: $("#devPromoPlan").value, hours: never ? null : hours, unlimitedTime: never, perAccount: unl ? null : Number($("#devPromoLimit").value), note: $("#devPromoNote").value });
      btn.disabled = false;
      if (!res?.ok) { msg(reasons[res?.reason] || "Could not save the code.", "error"); return; }
      msg("Saved " + res.code + ". It now works on every account.", "success");
      $("#devPromoCode").value = ""; $("#devPromoNote").value = "";
      loadList();
    });
    $("#devPromoList").addEventListener("click", async event => {
      const b = event.target.closest("button[data-hash]"); if (!b) return;
      b.disabled = true;
      await auth.devSetPromoActive(b.dataset.hash, b.dataset.next === "1");
      loadList();
    });
    loadList();
  },
  escape(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]); },
};
