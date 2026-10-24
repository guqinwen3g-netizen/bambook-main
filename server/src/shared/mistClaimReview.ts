/** Present only frozen business facts; keep the original snapshot string unchanged for approval validation. */
export function claimReviewDisplay(snapshot:string){
 const kinds:Record<string,string>={Allowance:'折让',ReturnRefund:'退货退款',Replace:'换货补发',Repair:'返修'};
 const destinations:Record<string,string>={Scrap:'报废',Replace:'换货补发',Repair:'返修'};
 const unavailable={title:'索赔方案',details:[{label:'审批内容',value:'资料无法读取，请打开原业务核对'}]};
 let value:Record<string,unknown>;
 try{const parsed:unknown=JSON.parse(snapshot);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return unavailable;value=parsed as Record<string,unknown>;}catch{return unavailable;}
 const text=(x:unknown)=>typeof x==='string'?x:'';
 const kind=kinds[text(value.kind)];if(!kind)return unavailable;
 const details:Array<{label:string;value:string}>=[];
 const add=(label:string,entry:unknown)=>{const content=text(entry);if(content)details.push({label,value:content});};
 const money=(amount:unknown,currency:unknown)=>typeof amount==='number'&&Number.isFinite(amount)?amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+text(currency):'';
 add('客户',value.customerName);add('来源订单',value.order);add('来源发票',value.invoice);add('客诉问题',value.problem);add('处置方式',kind);
 if(value.kind==='Allowance'||value.kind==='ReturnRefund')add('金额',money(value.amount,value.currency));
 const source=value.goodsSource&&typeof value.goodsSource==='object'&&!Array.isArray(value.goodsSource)?value.goodsSource as Record<string,unknown>:null;
 if(source){add('商品',[text(source.style),text(source.name)].filter(Boolean).join(' · '));add('原票单价',money(source.unitPrice,value.currency));}
 if(value.kind!=='Allowance'){
  if(typeof value.quantity==='number'&&Number.isFinite(value.quantity))add('数量',value.quantity.toLocaleString('en-US',{maximumFractionDigits:4})+' '+text(value.unit));
  add('退回去向',destinations[text(value.destination)]);
 }
 add('处置依据',value.basis);
 return {title:[text(value.case),kind].filter(Boolean).join(' · '),details};
}
