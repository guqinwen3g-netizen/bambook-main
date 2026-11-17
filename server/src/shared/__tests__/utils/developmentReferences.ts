import {applyMistCommand,createMistState,type DevelopmentValues,type MistCommand,type MistContext} from '../../mistWorkspace';
import {withTestFactories} from './devFactories';
export function developmentReferenceFixture(){
 let id=0;const ctx:MistContext={id:()=>`ref-${++id}`,now:'2026-11-18T04:00:00.000Z',actorName:'业务员',actorId:'sales',can:scope=>['products:read','products:write'].includes(scope),members:[{id:'sales',name:'业务员',active:true},{id:'same-name',name:'工厂收件人',active:true}]};
 let state=withTestFactories(createMistState(ctx,'empty'));
 state.customers.push({id:'customer',name:'客户',code:'C',country:'',city:'',industry:'',owner:'业务员',ownerId:'sales',grade:'',currency:'USD',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
 state.files.push({id:'reference-original',name:'对照样说明.txt',mimeType:'text/plain',size:1,storageKey:'fixture/reference-original',createdAt:ctx.now});
 const run=(command:unknown)=>{const result=applyMistCommand(state,command as MistCommand,ctx);state=result.state;return result.result as any;};
 const sampleId=run({type:'fulfillment.samples.create',payload:{name:'棉斜纹',category:'面料',form:'米样',quantity:1.25,unit:'米',location:'样品架 C03',size:'',color:'灰',note:'完整参考段，不裁切',fileIds:['reference-original'],source:{kind:'manual',description:'公司留样'}}}).id;
 const values:DevelopmentValues={domain:'garment',name:'短外套',customer:'customer',style:'ST-REF',season:'AW27',category:'外套',kind:'new',requestType:'replicate',fabric:'羊毛混纺待分析',color:'灰',target:'',sizeBase:'M',goal:'对比颜色和结构',factories:['A厂'],due:'2026-11-22',collaborators:[],sampleQuantity:1};
 const devId=run({type:'development.submit',payload:{values,fileIds:[]}}).devId;
 const dev=()=>state.devs.find(d=>d.id===devId)!,sample=()=>state.fulfillment.samples.find(s=>s.id===sampleId)!;
 const taskId=dev().versionIds[0];
 const link=(extra:Record<string,unknown>={})=>run({type:'development.reference.add',payload:{devId,sampleId,fileIds:['reference-original'],purpose:'仅作颜色、手感与结构对照，不作主料',...extra}});
 const dispatch=(referenceId:string,extra:Record<string,unknown>={})=>run({type:'development.reference.dispatch',payload:{devId,taskVersionId:taskId,items:[{referenceId,quantity:.5,sourceLocation:'样品架 C03'}],sentAt:'2026-11-18',expectedReturn:'2026-11-22',delivery:{kind:'handover',recipient:'工厂收件人',address:'工厂样品室',carrier:'',trackingNo:'',evidence:'工厂到样品室领取完整参考段'},postage:{amount:0,currency:'CNY',zeroReason:'供方自提，我方不垫付'},note:'整段归还，不裁切',...extra}});
 const back=(dispatchId:string,loanId:string,quantity:number)=>run({type:'development.reference.return',payload:{devId,dispatchId,items:[{loanId,quantity,location:'样品架 C03'}],receivedAt:'2026-11-18',delivery:{kind:'handover',recipient:'业务员',address:'公司样品室',carrier:'',trackingNo:'',evidence:'工厂将同一完整参考段交回'},note:'按原借出归还'}});
 return{ctx,run,devId,dev,sampleId,sample,taskId,link,dispatch,back,get state(){return state;}};
}
