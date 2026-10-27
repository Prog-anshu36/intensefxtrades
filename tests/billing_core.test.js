const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const core=await import('../supabase/functions/billing/billing-core.mjs');
 const s={window:null,document:{addEventListener(){}},addEventListener(){}};s.window=s;vm.createContext(s);vm.runInContext(fs.readFileSync('frontend/static/js/subscription.js','utf8'),s);
 for(const [code,monthly] of Object.entries({green:49,purple:149,red:199,golden_vip:249}))for(const months of [1,3,12]){
  assert.equal(core.quote(code,months).amount,monthly*months*100);
  assert.equal(s.SubscriptionSystem.purchaseQuote(code,months).amountPaise,core.quote(code,months).amount);
 }
 assert.equal(s.SubscriptionSystem.ORDER.length,4,'Golden VIP is a pass, never a fifth card');
 assert.throws(()=>core.quote('blue',1));assert.throws(()=>core.quote('red',2));assert.throws(()=>core.quote('red','12'));
 s.IntenseFXAuth={getSubscription:()=>({plan_code:'red',product_code:'golden_vip',status:'active',current_period_end:new Date(Date.now()+86400000).toISOString()})};
 const pass=s.SubscriptionSystem.getUserPlan();assert.equal(pass.name,'Golden VIP');for(const feature of Object.keys(s.SubscriptionSystem.FEATURES))assert.ok(s.SubscriptionSystem.canAccessFeature(feature,pass));
 s.IntenseFXAuth.getSubscription=()=>({plan_code:'red',product_code:'golden_vip',status:'active',current_period_end:'2020-01-01'});assert.equal(s.SubscriptionSystem.getUserPlan().code,'blue');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('test-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('payload'))).toString('hex');
 assert.equal(await core.signatureValid('test-secret','payload',sig),true);assert.equal(await core.signatureValid('test-secret','modified',sig),false);assert.equal(await core.signatureValid('test-secret','payload',''),false);
 const order={razorpay_order_id:'order_test',amount_paise:24900,currency:'INR'},payment={order_id:'order_test',amount:24900,currency:'INR',status:'captured',captured:true};assert.equal(core.capturedPaymentMatches(payment,order),true);for(const change of [{status:'authorized'},{amount:1},{currency:'USD'},{order_id:'order_other'},{amount_refunded:24900}])assert.equal(core.capturedPaymentMatches({...payment,...change},order),false);
 console.log('billing_core.test.js passed: all product terms, frontend/server prices, Golden full access/expiry, signatures and payment matching');
})().catch(e=>{console.error(e);process.exitCode=1});

