'use strict';
const {PlatformError}=require('./index.cjs');
const fail=code=>{throw new PlatformError(code,503);};
function createPriceVerifier({client,prices={},livemode,allowInlinePricesForTests=false}){
 const catalog=prices.products||prices;
 if(prices.mode&&prices.mode!==(livemode?'live':'sandbox'))fail('price_catalog_mode_mismatch');
 if(livemode&&allowInlinePricesForTests)fail('inline_test_prices_not_allowed_live');
 const productId=p=>typeof p==='string'?p:p?.id;
 function shape(p,o,product){if(p.livemode!==livemode||p.currency!=='usd'||p.unit_amount!==o.amountCents||productId(p.product)!==product)fail('catalog_price_mismatch');if(o.kind==='subscription'){if(p.recurring?.interval!=='month'||(p.recurring.interval_count??1)!==1)fail('catalog_interval_mismatch');}else if(p.recurring)fail('catalog_interval_mismatch');}
 async function prepare(o){
  const item=catalog[o.kind==='credits'?'axioms':o.sku];
  if(!item){if(!allowInlinePricesForTests)fail('catalog_price_unconfigured');return{line:{quantity:1,price_data:{currency:'usd',unit_amount:o.amountCents,product_data:{name:'Red-XAI '+o.sku},...(o.kind==='subscription'?{recurring:{interval:'month'}}:{})}},binding:{type:'test-inline',quantity:1,unitAmount:o.amountCents}};}
  if(typeof item.price!=='string'||typeof item.product!=='string')fail('catalog_price_unconfigured');
  const p=await client.prices.retrieve(item.price,{expand:['product']});if(p.id!==item.price||p.active!==true||p.livemode!==livemode||p.currency!=='usd'||productId(p.product)!==item.product||typeof p.product==='object'&&p.product.active===false)fail('catalog_price_mismatch');
  if(o.kind==='credits'){if(!p.custom_unit_amount||p.custom_unit_amount.enabled===false||p.custom_unit_amount.minimum>o.amountCents||o.amountCents<Math.max(501,item.minimumCents||501))fail('catalog_credit_minimum_mismatch');return{line:{quantity:1,price_data:{currency:'usd',unit_amount:o.amountCents,product:item.product}},binding:{type:'variable-product',quantity:1,productId:item.product,unitAmount:o.amountCents}};}
  if(item.amountCents!==o.amountCents)fail('catalog_sku_amount_mismatch');shape(p,o,item.product);return{line:{quantity:1,price:item.price},binding:{type:'fixed',quantity:1,priceId:item.price,productId:item.product,unitAmount:o.amountCents}};
 }
 async function verify(session,o,binding){
  if(!binding)fail('checkout_price_binding_missing');let lines=session.line_items;if(!lines?.data)lines=await client.checkout.sessions.listLineItems(session.id,{limit:2});if(lines.has_more||lines.data?.length!==1)fail('checkout_line_items_mismatch');const line=lines.data[0];if(line.quantity!==binding.quantity||line.amount_total!==o.amountCents||line.currency!=='usd')fail('checkout_line_items_mismatch');
  if(binding.type==='test-inline'){if(!allowInlinePricesForTests)fail('inline_test_prices_not_allowed');if(line.price?.unit_amount!==o.amountCents||line.price.currency!=='usd')fail('checkout_price_mismatch');return;}
  const priceId=productId(line.price);if(binding.type==='fixed'&&priceId!==binding.priceId)fail('checkout_catalog_price_mismatch');const p=await client.prices.retrieve(priceId,{expand:['product']});shape(p,o,binding.productId);
 }
 return{prepare,verify,catalog};
}
module.exports={createPriceVerifier};
