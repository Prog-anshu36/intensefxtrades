import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import {quote,signatureValid,capturedPaymentMatches} from './billing-core.mjs';

// This function authenticates user requests and verifies webhook HMAC itself.
// Never enable BILLING_ENABLED until merchant approval and test payments pass.
Deno.serve(async req => {
  const origin=req.headers.get('origin');
  const allowed=Deno.env.get('BILLING_ALLOWED_ORIGIN') || 'https://prog-anshu36.github.io';
  const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
  const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
  if(origin && origin!==allowed)return reply({error:'Origin not allowed.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'POST required.'},405);
  const keyId=Deno.env.get('RAZORPAY_KEY_ID'),secret=Deno.env.get('RAZORPAY_KEY_SECRET'),webhookSecret=Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
  if(Deno.env.get('BILLING_ENABLED')!=='true' || !keyId || !secret || !webhookSecret)return reply({error:'Payments are not open yet. Merchant verification and payment configuration are pending.'},503);
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const rpay=async(path:string,body?:unknown)=>{
    const r=await fetch('https://api.razorpay.com/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Basic '+btoa(keyId+':'+secret),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    if(!r.ok)throw new Error('Payment provider could not complete this request.');
    return r.json();
  };
  const fulfill=async(order:any,payment:any)=>{
    if(!capturedPaymentMatches(payment,order))throw new Error('Payment has not been captured or does not match this purchase.');
    const {error}=await admin.rpc('fulfill_prepaid_order',{order_ref:order.id,payment_ref:payment.id});
    if(error)throw new Error('Payment activation is pending. Please check again shortly.');
  };
  try {
    const raw=await req.text();
    if(raw.length>65536)return reply({error:'Request too large.'},413);
    const webhook=new URL(req.url).pathname.endsWith('/webhook');
    if(webhook){
      if(!await signatureValid(webhookSecret,raw,req.headers.get('x-razorpay-signature')))return reply({error:'Invalid signature.'},401);
      const event=JSON.parse(raw);
      if(event.event!=='payment.captured')return reply({received:true});
      const entity=event.payload?.payment?.entity;
      if(!/^pay_[a-zA-Z0-9]+$/.test(entity?.id||'') || !/^order_[a-zA-Z0-9]+$/.test(entity?.order_id||''))return reply({error:'Invalid payment.'},400);
      const {data:order,error}=await admin.from('billing_orders').select('*').eq('razorpay_order_id',entity.order_id).maybeSingle();
      if(error || !order)return reply({error:'Unknown purchase.'},404);
      await fulfill(order,await rpay('payments/'+entity.id));
      return reply({received:true});
    }
    const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
    const {data:{user},error:authError}=await admin.auth.getUser(token);
    if(authError || !user)return reply({error:'Sign in before buying access.'},401);
    const body=JSON.parse(raw);
    if(body.action==='order'){
      const q=quote(body.product,body.months);
      const {count,error:rateError}=await admin.from('billing_orders').select('id',{count:'exact',head:true}).eq('user_id',user.id).gte('created_at',new Date(Date.now()-600000).toISOString());
      if(rateError)throw new Error('Checkout is temporarily unavailable.');
      if((count||0)>=5)return reply({error:'Too many checkout attempts. Wait ten minutes before trying again.'},429);
      const {data:sub}=await admin.from('subscriptions').select('plan_code,product_code,status,current_period_end').eq('user_id',user.id).single();
      const rank=['blue','green','purple','red','golden_vip'];
      const active=sub && ['active','trialing'].includes(sub.status) && (!sub.current_period_end || Date.parse(sub.current_period_end)>Date.now());
      if(active && rank.indexOf(sub.product_code==='golden_vip'?'golden_vip':sub.plan_code)>rank.indexOf(q.product))return reply({error:'Your higher access is still active. Choose this lower plan after it expires.'},409);
      const id=crypto.randomUUID();
      const order=await rpay('orders',{amount:q.amount,currency:q.currency,receipt:id});
      const {error}=await admin.from('billing_orders').insert({id,user_id:user.id,product_code:q.product,months:q.months,amount_paise:q.amount,currency:q.currency,razorpay_order_id:order.id});
      if(error)throw new Error('Could not save the purchase. No charge was made.');
      return reply({key_id:keyId,order_id:order.id,amount:q.amount,currency:q.currency,product:q.product,months:q.months});
    }
    if(body.action==='status'){
      if(!/^order_[a-zA-Z0-9]+$/.test(body.order_id||''))return reply({error:'Invalid order reference.'},400);
      const {data:order}=await admin.from('billing_orders').select('status').eq('user_id',user.id).eq('razorpay_order_id',body.order_id).maybeSingle();
      if(!order)return reply({error:'Purchase not found for this account.'},404);
      return reply({verified:order.status==='fulfilled'});
    }
    if(body.action==='verify'){
      if(!/^order_[a-zA-Z0-9]+$/.test(body.order_id||'') || !/^pay_[a-zA-Z0-9]+$/.test(body.payment_id||''))return reply({error:'Invalid payment reference.'},400);
      const {data:order}=await admin.from('billing_orders').select('*').eq('user_id',user.id).eq('razorpay_order_id',body.order_id).maybeSingle();
      if(!order)return reply({error:'Purchase not found.'},404);
      if(!await signatureValid(secret,order.razorpay_order_id+'|'+body.payment_id,body.signature))return reply({error:'Payment signature was not valid.'},400);
      await fulfill(order,await rpay('payments/'+body.payment_id));
      return reply({verified:true});
    }
    return reply({error:'Unsupported payment action.'},400);
  }catch(error){return reply({error:error instanceof Error?error.message:'Payment request failed.'},400);}
});
