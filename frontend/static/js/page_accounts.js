/* Full-width account selection. Normal and prop ledgers stay independent. */
const PageAccounts = {
  busy:false, message:'', showArchived:false,
  escape: value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  render() {
    const e=this.escape,accounts=Store.state.accounts||[],active=Store.state.active_account_id;
    const propAllowed=window.SubscriptionSystem.canAccessFeature('backtesting');
    if(propAllowed)PropFirmSession.load();
    return `<section class="subscription-page classic-accounts"><header class="subscription-heading"><div><span class="subscription-kicker">YOUR TRADING WORKSPACES</span><h2>Choose your account</h2><p>Each account keeps its own trades, balance, drawings and replay.</p></div><label><input type="checkbox" id="hubShowArchived" ${this.showArchived?'checked':''}> Show archived accounts</label></header><p role="status">${e(this.message)}</p><div class="classic-account-grid">${accounts.filter(a=>this.showArchived||!a.archived).map(a=>`<article class="classic-account-card ${a.id===active?'selected':''}"><span class="subscription-kicker">${e(a.type||'Demo')} · ${a.archived?'ARCHIVED':a.id===active?'CURRENT ACCOUNT':'TRADING ACCOUNT'}</span><h3>${e(a.name)}</h3><strong>${e(a.currency_symbol||'$')}${Number(a.balance??a.initial_balance??0).toLocaleString('en-US',{minimumFractionDigits:2})}</strong><p>Dedicated trades, journal and backtesting workspace.</p><button class="propfirm-primary" data-hub-account="${e(a.id)}" ${a.archived?'disabled':''}>${a.id===active?'Open account':'Select account'} →</button><div class="classic-account-actions"><button class="propfirm-secondary" data-hub-action="${a.archived?'restore':'archive'}" data-account-id="${e(a.id)}">${a.archived?'Restore':'Archive'}</button>${a.id===active?'<button class="propfirm-secondary" data-hub-action="reset" data-account-id="'+e(a.id)+'">Reset</button>':''}<button class="propfirm-secondary" data-hub-action="delete" data-account-id="${e(a.id)}">Delete</button></div></article>`).join('')}</div><details class="propfirm-card"><summary>Create a trading account</summary><form id="hubCreateAccount" class="propfirm-create-grid"><label>Name<input name="name" required maxlength="80" placeholder="My trading account"></label><label>Type<select name="type"><option>Demo</option><option>Paper</option><option>Real</option></select></label><label>Starting balance<input name="balance" type="number" min="1" step="any" value="10000" required></label><label>Currency<select name="currency"><option>USD</option><option>INR</option><option>EUR</option><option>GBP</option></select></label><button class="propfirm-primary" ${this.busy?'disabled':''}>Create account →</button></form></details><section class="classic-prop-create"><header><span class="subscription-kicker">PROP FIRM PRACTICE</span><h2>Choose your evaluation</h2></header>${propAllowed?PropFirmSession.renderCreation():'<div class="propfirm-card"><p>Prop practice is included with Green Starter and above.</p><button class="propfirm-secondary" id="hubViewPlans">View plans</button></div>'}</section></section>`;
  },
  async mutate(action,doneRoute='accounts') {
    if(this.busy)return;this.busy=true;this.message='';
    try{const data=await action();if(data?.error || !Array.isArray(data?.accounts))throw new Error(data?.error||'Account service returned an invalid response.');Store.state=data;Store.notify();this.busy=false;Router.go(doneRoute);}
    catch(error){this.message=error.message;this.busy=false;Router.go('accounts');}
  },
  afterRender(container) {
    container.scrollTop = 0;
    container.querySelector('#hubShowArchived')?.addEventListener('change',e=>{this.showArchived=e.target.checked;Router.go('accounts');});
    container.querySelector('#hubViewPlans')?.addEventListener('click',()=>Router.go('subscription'));
    container.querySelectorAll('[data-hub-account]').forEach(button=>button.addEventListener('click',()=>this.mutate(()=>API.switchAccount(button.dataset.hubAccount),'dashboard')));
    container.querySelectorAll('[data-hub-action]').forEach(button=>button.addEventListener('click',()=>{
      const {hubAction:action,accountId:id}=button.dataset;
      if(action==='delete'&&!confirm('Permanently delete this account and its records? This cannot be undone.'))return;
      if(action==='reset'&&!confirm('Reset the current account? This clears its trades and journal.'))return;
      if(action==='archive')this.mutate(()=>API.archiveAccount(id));
      if(action==='restore')this.mutate(()=>API.restoreAccount(id));
      if(action==='delete')this.mutate(()=>API.deleteAccount(id));
      if(action==='reset')this.mutate(()=>API.resetAccount());
    }));
    container.querySelector('#hubCreateAccount')?.addEventListener('submit',event=>{
      event.preventDefault();
      const form=event.currentTarget,read=name=>form.elements.namedItem(name).value;
      const accountType=read('type');
      const existing=Store.state.accounts||[];
      if(accountType.toLowerCase()==='demo'&&(!window.SubscriptionSystem.canCreateDemoAccount(existing)||!window.SubscriptionSystem.canCreateAccount(existing))){const plan=window.SubscriptionSystem.getUserPlan();this.message=`Your ${plan.name} plan allows up to ${plan.demoAccountLimit} demo account(s). Archived demo accounts also count.`;Router.go('accounts');return;}
      if(accountType.toLowerCase()!=='demo'&&!window.SubscriptionSystem.canCreateAccount(existing)){this.message='Your current plan has reached its trading account limit. Archived accounts also count.';Router.go('accounts');return;}
      const balance=Number(read('balance')),name=read('name').trim(),currency=read('currency');
      if(!name||!Number.isFinite(balance)||balance<=0){this.message='Enter a name and a positive starting balance.';Router.go('accounts');return;}
      this.mutate(()=>API.createAccount({name,type:read('type'),starting_balance:balance,currency,currency_symbol:({USD:'$',INR:'₹',EUR:'€',GBP:'£'})[currency]}));
    });
    if(window.SubscriptionSystem.canAccessFeature('backtesting'))PropFirmSession.bindCreation(container);
  },
};
