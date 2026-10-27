const PageSubscription = {
  pendingFeature: null,
  selectedPlan: null,
  message: "",
  vipMessage: "",
  vipMessageKind: "",
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
      <header class="subscription-heading"><div><span class="subscription-kicker">INTENSEFXTRADES PLANS</span><h2>Choose your trading workspace</h2><p>Permissions follow your verified plan. Prices for paid plans are configurable and have not been set.</p></div><div class="subscription-current" style="--plan-color:${current.color}"><i></i><span><small>CURRENT PLAN</small><b>${current.name} · ${current.tier}</b><em>${this.escape(status)}</em></span></div></header>
      <section class="vip-key-panel" aria-label="Redeem VIP key"><div><span class="subscription-kicker">VIP ACCESS</span><h3>Have a VIP key?</h3><p>Enter your key to activate its plan in this browser.</p></div><div class="vip-key-entry"><label class="sr-only" for="vipKeyInput">VIP key</label><input id="vipKeyInput" type="password" autocomplete="off" placeholder="Enter VIP key"><button id="vipKeyRedeem" type="button">Redeem key</button><span id="vipKeyMessage" data-kind="${this.vipMessageKind}" role="status" aria-live="polite">${this.escape(this.vipMessage)}</span></div></section>
      <div class="subscription-cards">${sys.ORDER.map(code => this.card(sys.PLANS[code], current)).join("")}</div>
      <section class="subscription-gate" aria-live="polite"><h3>${this.selectedPlan ? `Selected: ${this.escape(sys.PLANS[this.selectedPlan].name)} · ${this.escape(sys.PLANS[this.selectedPlan].tier)}` : 'Select the plan that suits you'}</h3><p>${this.selectedPlan && this.selectedPlan !== current.code ? 'Your choice is saved for this session. Paid activation requires verified payment or a valid VIP key. Checkout and prices are not configured yet; your current access stays unchanged.' : 'Continue with your current plan. You can review or upgrade your plan here at any time.'}</p><button type="button" class="subscription-secondary" id="subscriptionContinue">Continue with ${this.escape(current.tier)}</button></section>
      ${this.renderComparison(sys)}
      <div class="subscription-manage"><div><b>Manage subscription</b><span>Billing is not connected yet, so there is no active renewal or cancellation to manage.</span></div><button disabled>Not connected</button></div>
      <div class="subscription-footnote"><b>Payments are not connected yet.</b> Paid plan actions do not change your plan. No price or payment provider is assumed. The current GitHub Pages deployment uses browser-local trading data; server-side private data and subscription enforcement require the later authenticated backend connection.</div>
    </section>`;
  },
  card(plan, current) {
    const isCurrent = plan.code === current.code;
    const price = plan.price === 0 ? "₹0" : plan.price == null ? "Price to be configured" : `₹${Number(plan.price).toLocaleString("en-IN")}`;
    const unavailable = plan.code !== "blue";
    return `<article class="subscription-card ${isCurrent ? "is-current" : ""}" style="--plan-color:${plan.color}"><div class="subscription-card-top"><span class="subscription-plan-name"><i></i>${plan.name}</span>${isCurrent ? `<span class="subscription-current-tag">CURRENT</span>` : ""}</div><h3>${plan.tier}</h3><div class="subscription-price">${price}${plan.price === 0 ? `<small> forever</small>` : ""}</div><ul>${plan.bullets.map(item => `<li><span>✓</span>${this.escape(item)}</li>`).join("")}</ul><button class="subscription-cta ${isCurrent ? "selected" : ""}" data-subscription-plan="${plan.code}" aria-pressed="${this.selectedPlan === plan.code}">${this.selectedPlan === plan.code ? "Selected" : isCurrent ? "Use current plan" : `Choose ${plan.tier}`}</button>${unavailable ? `<small class="subscription-no-checkout">Prices and checkout setup required</small>` : ""}</article>`;
  },
  renderComparison(sys) {
    const rows = [
      ["Dashboard", "dashboard"], ["Trades and journal", "trades"], ["General settings", "generalSettings"], ["Chart workspace", "tradingView"],
      ["Analysis", "analysis"], ["Performance", "performance"], ["Backtesting", "backtesting"], ["Replay · last 365 days", "replay"],
      ["Trading Analysis", "tradeAnalysis"], ["Technical indicators", "technicalIndicators"], ["AI Coach", "aiCoach"],
      ["Premium appearance settings", "premiumAppearance"], ["Advanced application settings", "advancedSettings"],
      ["Full historical XAUUSD data", "premiumXauusd"], ["Replay beyond one year", "extendedHistoricalReplay"], ["Additional accounts", "additionalAccount"],
    ];
    return `<section class="subscription-comparison"><div><span class="subscription-kicker">ENTITLEMENTS</span><h3>Plan feature comparison</h3></div><div class="subscription-comparison-scroll"><table><thead><tr><th>Feature</th>${sys.ORDER.map(code => `<th style="--plan-color:${sys.PLANS[code].color}">${sys.PLANS[code].name}</th>`).join("")}</tr></thead><tbody>${rows.map(([label,feature]) => `<tr><th>${label}</th>${sys.ORDER.map(code => { const plan=sys.PLANS[code],included=plan.features.has(feature); const note=feature==="replay"&&code==="purple"?"Last year":included?"Included":"—"; return `<td class="${included?"included":"excluded"}" style="--plan-color:${plan.color}">${included?"✓":"·"}<small>${note}</small></td>`; }).join("")}</tr>`).join("")}</tbody></table></div></section>`;
  },
  afterRender(container) {
    container.querySelector("#subscriptionGateBack")?.addEventListener("click", () => { this.pendingFeature = null; Router.go("dashboard"); });
    container.querySelector("#subscriptionContinue")?.addEventListener("click", () => Router.go("dashboard"));
    const keyInput = container.querySelector("#vipKeyInput");
    container.querySelector("#vipKeyRedeem")?.addEventListener("click", () => {
      const result = window.SubscriptionSystem.redeemVipKey(keyInput?.value);
      if (!result.ok) {
        this.vipMessage = result.storageUnavailable ? "Browser storage is unavailable. Enable site storage and try again." : "That VIP key was not recognized.";
        this.vipMessageKind = "error";
        const status = container.querySelector("#vipKeyMessage");
        if (status) { status.textContent = this.vipMessage; status.dataset.kind = "error"; }
        return;
      }
      this.vipMessage = result.plan.name + " · " + result.plan.tier + " activated in this browser.";
      this.vipMessageKind = "success";
      this.pendingFeature = null;
      this.message = "";
      Router.go("subscription");
    });
    keyInput?.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); container.querySelector("#vipKeyRedeem")?.click(); } });
    container.querySelectorAll("[data-subscription-plan]").forEach(button => button.addEventListener("click", () => {
      const code = button.dataset.subscriptionPlan;
      if (!window.SubscriptionSystem.PLANS[code]) return;
      this.selectedPlan = code;
      Router.go("subscription");
    }));
  },
  escape(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]); },
};
