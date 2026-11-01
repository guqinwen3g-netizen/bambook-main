/** The receipt query subset used by Mist. Local-file and memory fixtures follow the same filters/order as Prisma. */
export function queryMistReceipts(rows: any[], args: any): any[] {
  const stamp=(row:any)=>new Date(row.createdAt??row.result?.__agentAudit?.at??0);
  const match=(row:any,where:any):boolean=>Object.entries(where??{}).every(([key,value]:[string,any])=>{
    if(key==='AND')return value.every((part:any)=>match(row,part));
    if(key==='OR')return value.some((part:any)=>match(row,part));
    if(key==='result'){let found=row.result;for(const part of value.path??[])found=found?.[part];if(Object.prototype.hasOwnProperty.call(value,'equals'))return found===value.equals;if(value.lte!==undefined)return typeof found==='number'&&found<=value.lte;if(value.gte!==undefined)return typeof found==='number'&&found>=value.gte;return false;}
    const actual=key==='createdAt'?stamp(row).getTime():row[key];
    if(key==='createdAt'&&(value instanceof Date||typeof value==='string'))return actual===new Date(value).getTime();
    if(value&&typeof value==='object'&&!Array.isArray(value))return Object.entries(value).every(([op,bound]:[string,any])=>{
      const target=key==='createdAt'?new Date(bound).getTime():bound;
      if(op==='in')return bound.includes(actual);
      if(op==='startsWith')return typeof actual==='string'&&actual.startsWith(bound);
      if(op==='lt')return actual<target;if(op==='lte')return actual<=target;if(op==='gt')return actual>target;if(op==='gte')return actual>=target;
      return false;
    });
    return actual===value;
  });
  let found=rows.filter(row=>match(row,args.where));
  if(args.orderBy){const order=Array.isArray(args.orderBy)?args.orderBy:[args.orderBy];found.sort((a,b)=>{
    for(const rule of order)for(const [key,direction] of Object.entries(rule)){const left=key==='createdAt'?stamp(a).getTime():a[key],right=key==='createdAt'?stamp(b).getTime():b[key];if(left!==right)return(left<right?-1:1)*(direction==='desc'?-1:1);}return 0;
  });}
  if(args.take!==undefined)found=found.slice(0,args.take);
  return structuredClone(found.map(row=>row.createdAt===undefined&&row.result?.__agentAudit?{...row,createdAt:stamp(row)}:row));
}
