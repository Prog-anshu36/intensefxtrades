/* Order summary and provider checkout. This page never grants access itself. */
const PageCheckout = {
  product: null, months: 1, busy: false, message: '', success: false,
  selectProduct(product,months=1) {
    if(!['green','purple','red','golden_vip'].includes(product))throw new Error('Choose a paid plan or pass.');
    window.SubscriptionSystem.purchaseQuote(product,months);
    this.product=product;this.months=months;this.message='';this.success=false;
    try{sessionStorage.setItem('ift_checkout_selection',JSON.stringify({product,months}));}catch(_){}
  },
  init() {
    if(this.product)return;
    try{const saved=JSON.parse(sessionStorage.getItem('ift_checkout_selection')||'null');if(saved)this.selectProduct(saved.product,saved.months);}catch(_){}
  },
  render() {
    const sys=window.SubscriptionSystem;
    const item=this.product==='golden_vip'?sys.GOLDEN_PASS:sys.PLANS[this.product];
    if(!item)return '<section class="subscription-page"><h2>Choose your access first</h2><button id="checkoutBack" class="subscription-secondary">View plans</button></section>';
    const quote=sys.purchaseQuote(this.product,this.months),escape=PageSubscription.escape;
    const user=window.IntenseFXAuth?.getUser?.();
    return `<section class="subscription-page checkout-page" style="--plan-color:${item.color}"><header class="subscription-heading"><div><span class="subscription-kicker">SECURE CHECKOUT</span><h2>${this.success?'Access activated':'Review your purchase'}</h2><p>One-time prepaid access. No automatic renewal.</p></div><button id="checkoutBack" class="subscription-secondary">← Plans</button></header><div class="checkout-grid"><article class="subscription-card"><span class="subscription-plan-name">${escape(item.name)} · ${escape(item.tier)}</span><h3>${this.product==='golden_vip'?'Every supported feature unlocked':escape(item.tier)+' access'}</h3><p>${escape(user?.email||'Sign in to purchase for your account.')}</p><label>Access duration <select id="checkoutTerm" ${this.busy?'disabled':''}>${[[1,'1 month'],[3,'3 months'],[12,'12 months · Annual']].map(([n,label])=>`<option value="${n}" ${n===this.months?'selected':''}>${label}</option>`).join('')}</select></label><p>Starts after verified payment. Same-product renewals extend your remaining term.</p><p>Your trades and journals are preserved when access expires.</p></article><article class="subscription-card"><h3>Order summary</h3><div class="checkout-row"><span>${escape(item.name)} · ${this.months} month${this.months===1?'':'s'}</span><b>₹${quote.amount.toLocaleString('en-IN')}</b></div><div class="checkout-row checkout-total"><span>Total · INR</span><b>₹${quote.amount.toLocaleString('en-IN')}</b></div><p role="status" id="checkoutStatus">${escape(this.message||'Razorpay merchant activation is in progress. Payment collection is unavailable until setup and testing are complete.')}</p>${this.success?'<button id="checkoutContinue" class="subscription-cta">Open Dashboard</button>':`<button id="checkoutPay" class="subscription-cta" ${this.busy?'disabled':''}>${this.busy?'Opening checkout…':'Pay securely · ₹'+quote.amount.toLocaleString('en-IN')}</button>`}<button id="checkoutCheck" class="subscription-secondary" ${this.busy?'disabled':''}>Check previous payment status</button><small>Card and UPI details are entered only in the payment provider’s checkout, never stored by this app.</small></article></div></section>`;
  },
  afterRender(container) {
    container.scrollTop = 0;
    container.querySelector('#checkoutBack')?.addEventListener('click',()=>Router.go('subscription'));
    container.querySelector('#checkoutContinue')?.addEventListener('click',()=>Router.go('dashboard'));
    container.querySelector('#checkoutTerm')?.addEventListener('change',event=>{this.selectProduct(this.product,Number(event.target.value));Router.go('checkout');});
    const run=async action=>{
      if(this.busy)return;this.busy=true;this.message='Checking secure payment…';Router.go('checkout');
      try{if(action==='pay')await window.IntenseFXPayments.checkout(this.product,this.months);else await window.IntenseFXPayments.checkStatus();this.success=true;this.message='Payment verified. Access is active on your account.';}
      catch(error){this.message=error.message||'Payment could not be completed.';}
      finally{this.busy=false;if(Router.current==='checkout')Router.go('checkout');}
    };
    container.querySelector('#checkoutPay')?.addEventListener('click',()=>run('pay'));
    container.querySelector('#checkoutCheck')?.addEventListener('click',()=>run('status'));
  },
};
