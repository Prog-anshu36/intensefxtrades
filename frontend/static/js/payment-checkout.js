/* Paid access is granted only after server-side capture verification. */
window.IntenseFXPayments = (() => {
  let sdk;
  function loadSdk() {
    if (window.Razorpay) return Promise.resolve();
    if (!sdk) sdk = new Promise((resolve,reject) => {
      const script=document.createElement('script');script.src='https://checkout.razorpay.com/v1/checkout.js';
      script.onload=()=>resolve();script.onerror=()=>{sdk=null;reject(new Error('Checkout could not load. Please retry.'));};document.head.appendChild(script);
    });
    return sdk;
  }
  async function checkout(product,months) {
    const auth=window.IntenseFXAuth;
    const order=await auth.billingRequest({action:'order',product,months});
    if(!/^order_/.test(order.order_id) || !Number.isInteger(order.amount) || order.amount<=0 || order.currency!=='INR')throw new Error('Checkout returned an invalid order.');
    try{sessionStorage.setItem('ift_pending_payment',order.order_id);}catch(_){}
    await loadSdk();
    await new Promise((resolve,reject)=>{
      const checkout=new window.Razorpay({key:order.key_id,order_id:order.order_id,amount:order.amount,currency:order.currency,name:'intensefxTRADES',description:`${product} · ${months} month${months===1?'':'s'} prepaid access`,
        handler:async response=>{try{const result=await auth.billingRequest({action:'verify',order_id:order.order_id,payment_id:response.razorpay_payment_id,signature:response.razorpay_signature});if(!result.verified)throw new Error('Payment activation is pending.');await auth.refreshSubscription();try{sessionStorage.removeItem('ift_pending_payment');}catch(_){}resolve();}catch(e){reject(e);}},
        modal:{ondismiss:()=>reject(new Error('Checkout cancelled. Your access has not changed.'))},theme:{color:'#4388ff'}});
      checkout.on('payment.failed',()=>reject(new Error('Payment failed. Your access has not changed.')));
      checkout.open();
    });
  }
  async function checkStatus() {
    let order_id;try{order_id=sessionStorage.getItem('ift_pending_payment');}catch(_){}
    if(!order_id)throw new Error('No pending checkout was found in this browser. Your current access is shown under Plans & Billing.');
    const result=await window.IntenseFXAuth.billingRequest({action:'status',order_id});
    if(!result.verified)throw new Error('This payment is not verified yet. Please check again shortly or contact support if your bank was charged.');
    await window.IntenseFXAuth.refreshSubscription();try{sessionStorage.removeItem('ift_pending_payment');}catch(_){}
  }
  return {checkout,checkStatus};
})();
