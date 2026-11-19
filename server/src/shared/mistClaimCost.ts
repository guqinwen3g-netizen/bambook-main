import {MistCommandError,mistMoneyMinor,type MistState} from './mistWorkspace';
import {platformCreditEffectiveAmount} from './mistPlatform';

export type ClaimCostLine={kind:'credit'|'recovery';key:string;label:string;currency:string;amount:number};
/** Response-only financial totals; no claim, supplier, receipt, attachment or approval identifiers. */
export type OrderClaimCostBasis={orderId:string;credits:Array<{currency:string;amount:number}>;recoveries:Array<{currency:string;amount:number}>};

export function orderClaimCostLines(root:MistState,orderId:string,basis?:ReadonlyArray<OrderClaimCostBasis>|null):ClaimCostLine[]{
  if(basis===null)throw new MistCommandError('PRECONDITION','售后核算依据未读取');
  if(basis!==undefined){
    const matches=basis.filter(item=>item.orderId===orderId),row=matches[0];
    if(matches.length!==1)throw new MistCommandError('PRECONDITION','售后核算依据不完整');
    return (['credits','recoveries'] as const).flatMap(group=>{
      if(!Array.isArray(row[group])||row[group].some(item=>!item||typeof item!=='object')||new Set(row[group].map(item=>item.currency)).size!==row[group].length)throw new MistCommandError('VALIDATION','售后核算币种汇总无效');
      return row[group].map(item=>{
        if(!/^[A-Z]{3}$/.test(item.currency)||!Number.isFinite(item.amount)||item.amount<=0)throw new MistCommandError('VALIDATION','售后核算金额或币种无效');
        return {kind:group==='credits'?'credit' as const:'recovery' as const,key:'claim-basis:'+group+':'+item.currency,label:group==='credits'?'客户贷项':'工厂补偿到账',currency:item.currency,amount:item.amount};
      });
    });
  }
  const claims=(root.platform?.claims??[]).filter(claim=>claim.orderId===orderId&&claim.state!=='Cancelled'),ids=new Set(claims.map(claim=>claim.id)),rows:ClaimCostLine[]=[];
  for(const credit of root.platform?.credits??[])if(ids.has(credit.claimId)){
    const amount=platformCreditEffectiveAmount(credit);
    if(amount>0)rows.push({kind:'credit',key:'claim-credit:'+credit.id,label:credit.code+' 客户贷项',currency:credit.currency,amount});
  }
  // Cash corresponds to an existing bank receipt. Do not count promises, reversed
  // allocations, noncash fulfilment or supplier-bill deductions again as income.
  for(const claim of claims)for(const recovery of claim.coordination?.recoveries??[])for(const entry of recovery.settlements??[])
    if(entry.kind==='receipt'&&!entry.reversed&&entry.amount>0)rows.push({kind:'recovery',key:'claim-cash:'+entry.id,label:claim.code+' 工厂补偿到账',currency:entry.currency,amount:entry.amount});
  return rows;
}

export function financialClaimCostBasis(root:MistState,orderIds:ReadonlySet<string>):OrderClaimCostBasis[]{
  return [...orderIds].map(orderId=>{
    const totals={credits:new Map<string,number>(),recoveries:new Map<string,number>()};
    for(const row of orderClaimCostLines(root,orderId)){const group=row.kind==='credit'?totals.credits:totals.recoveries;group.set(row.currency,(group.get(row.currency)??0)+mistMoneyMinor(row.amount));}
    const amounts=(group:Map<string,number>)=>[...group].map(([currency,minor])=>({currency,amount:minor/100}));
    return {orderId,credits:amounts(totals.credits),recoveries:amounts(totals.recoveries)};
  });
}
