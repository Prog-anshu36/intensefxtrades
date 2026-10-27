export const PRODUCTS = Object.freeze({green:4900,purple:14900,red:19900,golden_vip:24900});
export function quote(product, months) {
  if (!Object.hasOwn(PRODUCTS,product) || ![1,3,12].includes(months)) throw new Error('Choose a supported product and term.');
  return {product,months,amount:PRODUCTS[product]*months,currency:'INR',plan:product==='golden_vip'?'red':product};
}
export async function signatureValid(secret, message, signature) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature||'')) return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(signature.match(/../g),b=>parseInt(b,16));
  return crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(message));
}
export function capturedPaymentMatches(payment, order) {
  return payment?.status==='captured' && payment.captured===true && payment.order_id===order.razorpay_order_id && payment.amount===order.amount_paise && payment.currency===order.currency && !payment.amount_refunded;
}

