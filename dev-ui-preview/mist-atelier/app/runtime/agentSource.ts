import type {RouteTarget} from '../nav';
/** Internal source links carry identifiers only; they cannot launch an external URL. */
export function agentSource(source:string|undefined):{view:string;id:string;target?:RouteTarget}|null{
 if(!source)return null;
 try{
  const u=new URL(source);if(u.protocol!=='bambook:'||u.hostname!=='open'||u.username||u.password||u.port||u.hash||u.pathname&&u.pathname!=='/')return null;
  const view=u.searchParams.get('view'),id=u.searchParams.get('id');
  if(!view||!/^[a-z][a-z0-9/-]*$/.test(view)||!id||id.length>300)return null;
  const keys=['versionId','batchId','section','customerId','orderLineId','productionId','detail'];
  const target:Record<string,string>={};
  for(const [key,value]of u.searchParams){
   if(!['view','id',...keys].includes(key)||u.searchParams.getAll(key).length!==1||value.length>300||/[\u0000-\u001f]/.test(value))return null;
   if(keys.includes(key)){if(key==='detail'&&value!=='full')return null;if(value)target[key]=value;}
  }
  return {view,id,...(Object.keys(target).length?{target:target as RouteTarget}:{})};
 }catch{return null;}
}
