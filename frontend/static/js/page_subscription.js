const PageSubscription = {
  pendingFeature: null,
  selectedPlan: null,
  termMonths: 1,
  paymentMessage: "",
  checkoutBusy: false,
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
      <header class="subscription-heading"><div><span class="subscription-kicker">INTENSEFXTRADES PLANS</span><h2>Choose your trading workspace</h2><p>Permissions follow your verified plan. Choose 1, 3 or 12 months of prepaid access. No automatic renewal. Prices are in INR; no term discount is applied.</p></div><div class="subscription-current" style="--plan-color:${current.color}"><i></i><span><small>CURRENT PLAN</small><b>${current.name} · ${current.tier}</b><em>${this.escape(status)}</em></span></div></header>
      <section class="vip-key-panel" aria-label="Redeem VIP key"><div><span class="subscription-kicker">VIP ACCESS</span><h3>Have a VIP key?</h3><p>Redeem a privately issued key through your signed-in account.</p></div><div class="vip-key-entry"><label class="sr-only" for="vipKeyInput">VIP key</label><input id="vipKeyInput" type="password" autocomplete="off" placeholder="Enter VIP key"><button id="vipKeyRedeem" type="button">Redeem key</button><span id="vipKeyMessage" data-kind="${this.vipMessageKind}" role="status" aria-live="polite">${this.escape(this.vipMessage)}</span></div></section>
      <label class="subscription-term">Access duration <select id="subscriptionTerm" aria-label="Access duration">${[[1,'1 month'],[3,'3 months'],[12,'12 months · Annual']].map(([n,label])=>`<option value="${n}" ${n===this.termMonths?'selected':''}>${label}</option>`).join('')}</select></label>
      <div class="subscription-cards">${sys.ORDER.map(code => this.card(sys.PLANS[code], current)).join("")}</div>
      <section class="vip-key-panel golden-vip-pass" aria-label="Golden VIP Pass" style="--plan-color:#efc75e;border-color:#8b7138"><div><span class="subscription-kicker">GOLDEN VIP PASS</span><h3>Every supported feature. Full access.</h3><p>A separate pass, not a fifth plan. Includes all Elite features and full supported history.</p></div><div><strong>₹${sys.purchaseQuote('golden_vip',this.termMonths).amount.toLocaleString('en-IN')} / ${this.termMonths} month${this.termMonths===1?'':'s'}</strong><button type="button" class="subscription-secondary" data-subscription-plan="golden_vip" aria-pressed="${this.selectedPlan==='golden_vip'}">${this.selectedPlan==='golden_vip'?'Selected':'Choose Golden VIP'}</button></div></section>
      ${this.renderSelection(sys,current)}
      ${this.renderComparison(sys)}
      <div class="subscription-manage"><div><b>Prepaid access · no auto-renewal</b><span>${verified?.current_period_end ? `Access ends ${this.escape(new Date(verified.current_period_end).toLocaleDateString('en-IN'))}.` : 'Blue Free has no expiry.'} Same-product renewal extends your remaining term. A different-product purchase starts a new term without prorating.</span></div></div>
      <div class="subscription-footnote"><b>Payments are not open yet.</b> Merchant approval, bank settlement setup and provider test payments are required. Selecting a plan never charges you or unlocks access. Trading data remains stored in your browser.</div>
    </section>`;
  },
  card(plan, current) {
    const isCurrent = plan.code === current.code;
    const price = `₹${window.SubscriptionSystem.purchaseQuote(plan.code,this.termMonths).amount.toLocaleString("en-IN")}`;
    const unavailable = plan.code !== "blue";
    return `<article class="subscription-card ${isCurrent ? "is-current" : ""}" style="--plan-color:${plan.color}"><div class="subscription-card-top"><span class="subscription-plan-name"><i></i>${plan.name}</span>${isCurrent ? `<span class="subscription-current-tag">CURRENT</span>` : ""}</div><h3>${plan.tier}</h3><div class="subscription-price">${price}${plan.price === 0 ? `<small> forever</small>` : `<small> / ${this.termMonths} month${this.termMonths===1?"":"s"}</small>`}</div><ul>${plan.bullets.map(item => `<li><span>✓</span>${this.escape(item)}</li>`).join("")}</ul><button class="subscription-cta ${isCurrent ? "selected" : ""}" data-subscription-plan="${plan.code}" aria-pressed="${this.selectedPlan === plan.code}">${this.selectedPlan === plan.code ? "Selected" : isCurrent ? "Use current plan" : `Choose ${plan.tier}`}</button>${unavailable ? `<small class="subscription-no-checkout">Prepaid access · no automatic renewal</small>` : ""}</article>`;
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
    ];
    return `<section class="subscription-comparison"><div><span class="subscription-kicker">ENTITLEMENTS</span><h3>Plan feature comparison</h3></div><div class="subscription-comparison-scroll"><table><thead><tr><th>Feature</th>${sys.ORDER.map(code => `<th style="--plan-color:${sys.PLANS[code].color}">${sys.PLANS[code].name}</th>`).join("")}</tr></thead><tbody>${rows.map(([label,feature]) => `<tr><th>${label}</th>${sys.ORDER.map(code => { const plan=sys.PLANS[code],included=plan.features.has(feature); const note=feature==="replay"&&code==="purple"?"Last year":included?"Included":"—"; return `<td class="${included?"included":"excluded"}" style="--plan-color:${plan.color}">${included?"✓":"·"}<small>${note}</small></td>`; }).join("")}</tr>`).join("")}</tbody></table></div></section>`;
  },
  afterRender(container) {
    container.querySelector('#subscriptionTerm')?.addEventListener('change', event=>{this.termMonths=Number(event.target.value);this.paymentMessage='';Router.go('subscription');});
    container.querySelector('#subscriptionPay')?.addEventListener('click', async()=>{
      if(this.checkoutBusy)return;
      this.checkoutBusy=true;this.paymentMessage='Checking secure checkout…';Router.go('subscription');
      try{await window.IntenseFXPayments.checkout(this.selectedPlan,this.termMonths);this.paymentMessage='Payment verified. Your access is active.';}
      catch(error){this.paymentMessage=error.message || 'Checkout is unavailable.';}
      finally{this.checkoutBusy=false;if(Router.current==='subscription')Router.go('subscription');}
    });
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
    container.querySelectorAll("[data-subscription-plan]").forEach(button => button.addEventListener("click", () => {
      const code = button.dataset.subscriptionPlan;
      if (!window.SubscriptionSystem.PLANS[code] && code!=="golden_vip") return;
      this.selectedPlan = code;
      Router.go("subscription");
    }));
  },
  escape(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]); },
};

