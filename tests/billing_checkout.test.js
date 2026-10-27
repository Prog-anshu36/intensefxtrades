const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
let requests=[],refresh=0,opens=0,verified=true;
const window={IntenseFXAuth:{billingRequest:async b=>{requests.push(b);if(b.action==='order')return {key_id:'rzp_test_x',order_id:'order_test',amount:24900,currency:'INR'};return {verified};},refreshSubscription:async()=>{refresh++}},Razorpay:function(options){this.on=()=>{};this.open=()=>{opens++;options.handler({razorpay_payment_id:'pay_test',razorpay_signature:'signature'});};}};
vm.runInNewContext(fs.readFileSync('frontend/static/js/payment-checkout.js','utf8'),{window,document:{}});
await window.IntenseFXPayments.checkout('golden_vip',1);assert.equal(refresh,1);assert.equal(requests[0].product,'golden_vip');assert.equal(requests[0].amount,undefined,'amount is computed by trusted server');assert.equal(requests[1].order_id,'order_test');
verified=false;await assert.rejects(window.IntenseFXPayments.checkout('red',3),/pending/);assert.equal(refresh,1,'checkout success callback alone never activates or refreshes access');
window.IntenseFXAuth.billingRequest=async()=>{throw Error('Merchant setup pending')};await assert.rejects(window.IntenseFXPayments.checkout('green',1),/pending/);assert.equal(opens,2,'unconfigured checkout never opens the gateway');
console.log('billing_checkout.test.js passed: server-priced orders, verified activation and fail-closed merchant setup');
})().catch(e=>{console.error(e);process.exitCode=1});

