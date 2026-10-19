import {applyMistCommand,createMistState,getMistReviewTasks,type MistCommand,type MistContext,type MistState} from './mistWorkspace';
import {seedCompanyHistory} from './mistCompanyHistory';
import {demoFileRecord} from './mistDemoFiles';
import type {MistAccountRef,MistMemberDirectoryEntry} from './mistAccounts';

export const MIST_COMPANY_BASELINE_VERSION=4;
export const MIST_COMPANY_BASELINE_AS_OF='2026-10-19T04:00:00.000Z';
export const MIST_COMPANY_DATASET='claridge-peak-continuous-operations';
export const MIST_COMPANY_WORKSPACE_NAME='澄岳贸易 · 经营工作台';

export type MistCompanyRosterKey='owner'|'fabricManager'|'garmentManager'|'fabricSales'|'garmentSales'|'finance'|'fabricQc'|'garmentQc'|'logistics';
export type MistCompanyRoster=Record<MistCompanyRosterKey,MistAccountRef>;
export type MistCompanyBaselineFailure={step:string;message:string};

export const MIST_COMPANY_PROFILE={
 legalName:'澄岳纺织服装贸易（上海）有限公司',
 englishName:'Claridge Peak Textile & Apparel Trading (Shanghai) Co., Ltd.',
 address:'上海市虹口区东大名路 1089 号北外滩商务中心 12 层',
 englishAddress:'12F, North Bund Business Center, 1089 Dongdaming Road, Hongkou, Shanghai 200080, China',
 phone:'+86 21 6168 7720',email:'operations@claridgepeak-textile.com',taxId:'91310109MA7K4T9R6X',customsCode:'3122260C8M',
 bankName:'浦东商业银行上海外滩支行',bankAccount:'3100668890201175426',swift:'PDSBCNSH',defaultCurrency:'CNY',
} as const;

const DAY=86400000;
const DEMO_ACCOUNT_MAP:Record<string,MistCompanyRosterKey>={
 'demo-reviewer':'owner','demo-sales':'garmentSales','demo-buyer':'fabricSales','demo-finance':'finance','demo-qc':'garmentQc','demo-warehouse':'logistics',
};
const BANNED_PRESENTATION=/(模拟|演示|示例|\bDEMO(?:[-_\s]|$)|\bTEST(?:[-_\s]|$)|example\.(?:test|invalid)|\bsimulation\b)/i;

function memberDirectory(roster:MistCompanyRoster):MistMemberDirectoryEntry[]{return[
 {...roster.owner,active:true,owner:true,groups:['fabric','garment']},
 {...roster.fabricManager,active:true,groups:['fabric']},{...roster.garmentManager,active:true,groups:['garment']},
 {...roster.fabricSales,active:true,groups:['fabric']},{...roster.garmentSales,active:true,groups:['garment']},
 {...roster.finance,active:true,groups:[]},{...roster.fabricQc,active:true,groups:['fabric']},{...roster.garmentQc,active:true,groups:['garment']},{...roster.logistics,active:true,groups:[]},
]}

function replaceBusinessText(value:string){return value
 .replace(/软件演示/g,'公司经营').replace(/模拟/g,'经营').replace(/演示/g,'业务').replace(/示例/g,'参考')
 .replace(/\bDEMO(?=[-_\s]|$)/gi,'OPS').replace(/\bTEST(?=[-_\s]|$)/gi,'QA')
 .replace(/example\.(?:test|invalid)/gi,'claridgepeak-textile.com').replace(/\bsimulation\b/gi,'operations');}

/** 账号 ID 及冻结审批快照都必须切到本次公司花名册；storageKey 保留兼容前缀，落盘后会改成私有路径。 */
function rewriteSeed(value:unknown,roster:MistCompanyRoster,key=''):unknown{
 if(typeof value==='string'){
  let text=value;for(const[oldId,role]of Object.entries(DEMO_ACCOUNT_MAP))text=text.split(oldId).join(roster[role].id);
  return key==='storageKey'?text:replaceBusinessText(text);
 }
 if(Array.isArray(value)){value.forEach((item,index)=>{value[index]=rewriteSeed(item,roster,key);});return value;}
 if(value&&typeof value==='object')for(const[name,child]of Object.entries(value as Record<string,unknown>))(value as Record<string,unknown>)[name]=rewriteSeed(child,roster,name);
 return value;
}

function contextFor(base:MistContext,roster:MistCompanyRoster,key:MistCompanyRosterKey,number:()=>string):MistContext{
 const members=memberDirectory(roster),reviewer=roster.owner.id;
 return{...base,actorId:roster[key].id,actorName:roster[key].name,members,can:()=>true,consumeBusinessNumber:()=>number(),authority:{
  supplier:Object.fromEntries(['purchase','processing','finished','material'].flatMap(kind=>['garment','fabric'].map(domain=>[`supplierCommitment.approvers.${kind}.${domain}`,{version:1,userIds:[reviewer]}]))),
  businessReviewerId:reviewer,claimReviewerId:reviewer,orderReviewerIds:{garment:[reviewer],fabric:[reviewer]},paymentReviewerIds:[reviewer],risk:{all:true,orders:true,customers:true},riskReviewerIds:[reviewer],
 }};
}

export function createMistCompanyBaseline(base:MistContext,roster:MistCompanyRoster,onFailures?:(failures:MistCompanyBaselineFailure[])=>void,options:{claimReviewerId?:string}={}):MistState{
 const failures:MistCompanyBaselineFailure[]=[];let numberSeq=900000;
 const initial=createMistState({...base,actorId:'demo-reviewer',actorName:'周敏'},'demo',rows=>failures.push(...rows));
 let state=rewriteSeed(initial,roster) as MistState;
 const departmentReviewer=(id?:string)=>id===roster.fabricSales.id?roster.fabricManager.id:id===roster.garmentSales.id?roster.garmentManager.id:roster.owner.id;
 for(const quote of state.market.quotations)if(quote.approval?.status==='pending')quote.approval.reviewerId=departmentReviewer(quote.approval.requesterId);
 for(const risk of state.platform.risks)for(const request of risk.escalations||[])if(request.decision==='pending')request.reviewerIds=[departmentReviewer(request.requesterId)];
 const number=()=>base.consumeBusinessNumber?.('CLM')??`CLM-${base.now.slice(0,4)}-${++numberSeq}`;
 const owner=contextFor(base,roster,'owner',number),fabric=contextFor(base,roster,'fabricSales',number),garment=contextFor(base,roster,'garmentSales',number),finance=contextFor(base,roster,'finance',number),fabricQc=contextFor(base,roster,'fabricQc',number),garmentQc=contextFor(base,roster,'garmentQc',number);
 const claimReviewerKey=(Object.keys(roster) as MistCompanyRosterKey[]).find(key=>roster[key].id===(options.claimReviewerId||roster.owner.id));
 if(!claimReviewerKey)throw new Error('Claim reviewer must belong to the company roster');
 const claimReviewer=contextFor(base,roster,claimReviewerKey,number);
 garment.authority!.claimReviewerId=roster[claimReviewerKey].id;
 claimReviewer.authority!.claimReviewerId=roster[claimReviewerKey].id;
 const run=(step:string,command:MistCommand,ctx:MistContext=owner)=>{try{const master=['market.customer.create','market.contact.save','market.supplier.save','market.product.save'].includes(command.type);const result=applyMistCommand(state,command,master?{...ctx,now:base.now.slice(0,4)+'-01-02T08:00:00.000Z'}:ctx);state=result.state;return result.result;}catch(error){failures.push({step,message:error instanceof Error?error.message:String(error)});return{};}};
 const id=(result:Record<string,unknown>|undefined,key='id')=>typeof result?.[key]==='string'?String(result[key]):'';
 const day=(offset:number)=>new Date(Date.parse(base.now)+offset*DAY).toISOString().slice(0,10);
 const at=(offset:number,hour=9)=>{const value=new Date(Date.parse(base.now)+offset*DAY);value.setUTCHours(hour,0,0,0);return value.toISOString();};

 delete state.settings.demoSeed;state.settings.companyBaseline={version:MIST_COMPANY_BASELINE_VERSION,seededAt:base.now,dataset:MIST_COMPANY_DATASET};
 state.settings.workspaceName=MIST_COMPANY_WORKSPACE_NAME;state.settings.profileName=roster.owner.name;state.settings.profileEmail='zhou.min@claridgepeak-textile.com';
 state.memberIds=memberDirectory(roster).filter(row=>!row.owner).map(row=>row.id);
 state.members=memberDirectory(roster).filter(row=>!row.owner).map(row=>({userId:row.id,name:row.name,addedBy:roster.owner.id,addedByName:roster.owner.name,addedAt:base.now}));
 state.memberGroups=memberDirectory(roster).filter(row=>row.groups.length).map(row=>({userId:row.id,name:row.name,groups:row.groups,updatedAt:base.now,updatedBy:roster.owner.name}));
 state.reviewerIds=[roster.owner.id];
 run('company profile',{type:'settings.update',payload:{workspaceName:MIST_COMPANY_WORKSPACE_NAME,profileName:roster.owner.name,profileEmail:'zhou.min@claridgepeak-textile.com',companyProfile:{...MIST_COMPANY_PROFILE}}},owner);

 const accountIds:Record<string,string>={};
 for(const row of [
  ['cny','人民币基本户','浦东商业银行上海外滩支行','3100668890201175426','CNY',1850000],
  ['usd','美元结算户','浦东商业银行上海外滩支行','3100668890201175426-USD','USD',268000],
  ['eur','欧元结算户','浦东商业银行上海外滩支行','3100668890201175426-EUR','EUR',146000],
 ] as const)accountIds[row[0]]=id(run('bank account '+row[0],{type:'finance.account.save',payload:{name:row[1],bankName:row[2],accountNo:row[3],currency:row[4],openingDate:'2026-01-01',openingBalance:row[5]}},finance));
 for(const receipt of state.receipts){const accountId=accountIds[receipt.currency.toLowerCase()];if(accountId)run('assign receipt '+receipt.code,{type:'finance.account.assign',payload:{kind:'receipt',id:receipt.id,accountId,reason:'按银行流水币种归入公司结算户'}},finance);}
 for(const payment of state.payments){const accountId=accountIds[payment.currency.toLowerCase()];if(accountId)run('assign payment '+payment.code,{type:'finance.account.assign',payload:{kind:'payment',id:payment.id,accountId,reason:'按付款凭证币种归入公司结算户'}},finance);}

 const employees=[
  [roster.owner.name,'管理层','总经理','zhou.min@claridgepeak-textile.com','2018-03-12'],[roster.fabricManager.name,'面料事业部','面料部经理','yu.ning@claridgepeak-textile.com','2019-05-06'],[roster.garmentManager.name,'成衣事业部','成衣部经理','lu.heng@claridgepeak-textile.com','2019-08-19'],
  [roster.fabricSales.name,'面料事业部','面料业务','shen.he@claridgepeak-textile.com','2021-02-22'],[roster.garmentSales.name,'成衣事业部','成衣业务','gu.yan@claridgepeak-textile.com','2020-07-13'],[roster.finance.name,'财务部','财务主管','lin.shu@claridgepeak-textile.com','2020-11-02'],
  [roster.fabricQc.name,'品质部','面料 QC','tang.lan@claridgepeak-textile.com','2022-04-18'],[roster.garmentQc.name,'品质部','成衣 QC','xu.yan@claridgepeak-textile.com','2021-09-01'],[roster.logistics.name,'物流单证部','物流单证','chen.xiao@claridgepeak-textile.com','2022-01-10'],
  ['江澈','采购部','成衣采购','jiang.che@claridgepeak-textile.com','2023-03-06'],['温岚','采购部','面辅料采购','wen.lan@claridgepeak-textile.com','2023-06-12'],['韩舟','物流单证部','报关单证','han.zhou@claridgepeak-textile.com','2024-02-19'],['苏芮','行政人事部','人事行政','su.rui@claridgepeak-textile.com','2024-07-08'],
 ];
 for(const employee of employees)run('employee '+employee[0],{type:'platform.employee.save',payload:{name:employee[0],department:employee[1],position:employee[2],contact:employee[3],startDate:employee[4],note:'年度人员名册核对',active:true}},owner);

 const extraCustomers=[
  ['Berg Outerwear GmbH','德国','慕尼黑','户外服装品牌','EUR','T/T 30/70','FOB 上海','成衣 · 功能面料',180000,'Lukas Berg','Sourcing Director','lukas.berg@berg-outerwear.de','+49 89 2041 7781'],
  ['Atelier Mori Co., Ltd.','日本','东京','设计师品牌','USD','T/T 30/70','FOB 上海','精纺面料 · 西装',120000,'Kenji Mori','Product Director','kenji.mori@atelier-mori.jp','+81 3 4589 2661'],
  ['Hallberg Studio AB','瑞典','马尔默','女装品牌','EUR','T/T 30/70','FOB 上海','大衣 · 双面呢',150000,'Sofia Brandt','Head of Buying','sofia.brandt@hallberg-studio.se','+46 40 612 74 18'],
  ['Rowan & Fenwick Ltd.','英国','曼彻斯特','精品百货','USD','L/C at sight','FOB 上海','西装 · 大衣',220000,'Oliver Reed','Menswear Buyer','oliver.reed@rowan-fenwick.co.uk','+44 161 410 7826'],
  ['Asterline Retail Inc.','美国','纽约','服装零售','USD','T/T 20/80','FOB 上海','成衣 · 辅料',260000,'Maya Lewis','Category Manager','maya.lewis@asterline-retail.com','+1 212 555 0186'],
 ] as const;
 const customerIds:string[]=[];
 for(const row of extraCustomers){
  const existing=state.customers.find(customer=>customer.name===row[0]||row[0]==='Atelier Mori Co., Ltd.'&&customer.name==='Atelier Mori');
  const input={name:row[0],country:row[1],city:row[2],industry:row[3],ownerId:roster.garmentSales.id,grade:'B · 成长客户',currency:row[4],terms:row[5],incoterm:row[6],categories:row[7],creditLimit:row[8],since:day(-520)};
  const customerId=existing?(run('customer master '+row[0],{type:'market.customer.update',payload:{id:existing.id,patch:input}},garment),existing.id):id(run('customer '+row[0],{type:'market.customer.create',payload:{input}},garment));
  if(!customerId)continue;customerIds.push(customerId);
  run('customer contact '+row[0],{type:'market.contact.save',payload:{kind:'customer',parentId:customerId,name:row[9],role:row[10],email:row[11],phone:row[12],primary:true}},garment);
 }

 const extraSuppliers=[
  ['SUP-0101','绍兴岚桥纺织','织造','精纺羊毛 · 羊毛混纺 · 小批量现货',60000,'米/月',24,'浙江绍兴柯桥区钱清街道纺织产业园 18 号','fabric'],
  ['SUP-0102','湖州嘉纬染整','染整','羊毛染色 · 后整理 · 防缩',90000,'米/月',16,'浙江湖州吴兴区织里镇染整园 6 号','fabric'],
  ['SUP-0103','宁波新拓辅料','辅料','拉链 · 金属扣 · 洗标 · 吊牌',1500000,'件/月',10,'浙江宁波鄞州区五乡工业区 31 号','garment'],
  ['SUP-0104','苏州云帛数码','印花','数码印花 · 花型分色 · 小单快反',26000,'米/月',15,'江苏苏州吴江区盛泽镇东方丝绸市场 9 区','fabric'],
  ['SUP-0105','平湖启程服饰','成衣加工','梭织外套 · 羽绒服 · 工装夹克',8000,'件/月',32,'浙江平湖经济开发区兴平二路 77 号','garment'],
  ['SUP-0106','南通衡远制衣','成衣加工','衬衫 · 西装 · 小批量柔性生产',6500,'件/月',30,'江苏南通通州区川姜镇工业路 26 号','garment'],
 ] as const;
 const supplierIds:string[]=[];
 for(const[index,row]of extraSuppliers.entries()){const handler=row[8]==='fabric'?roster.fabricSales.id:roster.garmentSales.id,ctx=row[8]==='fabric'?fabric:garment,supplierId=id(run('supplier '+row[1],{type:'market.supplier.save',payload:{input:{code:row[0],name:row[1],type:row[2],country:'中国',address:row[7],capabilities:row[3],capacity:row[4],capacityUnit:row[5],leadDays:row[6],fileIds:[],note:'年度供应商复核通过',handlerIds:{[row[8]]:handler}}}},ctx));if(!supplierId)continue;supplierIds.push(supplierId);
  const contactName=['顾海川','宋宁','方洁','魏明','邹婕','陈宏'][index];run('supplier contact '+row[1],{type:'market.contact.save',payload:{kind:'supplier',parentId:supplierId,name:contactName,role:'业务经理',email:`contact${index+1}@${['lanqiao-textile.cn','jiawei-finishing.cn','xintuo-trims.cn','yunbo-print.cn','qicheng-apparel.cn','hengyuan-garment.cn'][index]}`,phone:`+86 13${8+index} 6208 ${String(3100+index*137).padStart(4,'0')}`,primary:true}},ctx);
 }

 const products=[
  ['FB-2801','RWS 羊毛双面呢','fabric','羊毛 80% 再生锦纶 20%','燕麦色','米','11.80','USD',{weight:'560',width:'150',weave:'双面斜纹',yarn:'2/30Nm',finish:'缩绒防起球'}],
  ['FB-2802','再生尼龙机械弹','fabric','再生锦纶 88% 氨纶 12%','炭黑','米','4.65','USD',{weight:'145',width:'148',weave:'四面弹',yarn:'70D+40D',finish:'C0 防泼水'}],
  ['FB-2803','精纺羊毛哔叽','fabric','羊毛 70% 涤纶 30%','藏青','米','8.40','USD',{weight:'275',width:'152',weave:'2/2 斜纹',yarn:'80/2',finish:'抗皱'}],
  ['FB-2804','棉锦高密府绸','fabric','棉 68% 锦纶 32%','卡其','米','3.20','USD',{weight:'118',width:'150',weave:'平纹',yarn:'40S×70D',finish:'纸感'}],
  ['FB-2805','天丝羊毛斜纹','fabric','莱赛尔 55% 羊毛 45%','雾灰','米','6.90','USD',{weight:'210',width:'148',weave:'斜纹',yarn:'50S',finish:'砂洗'}],
  ['FB-2806','有机棉磨毛帆布','fabric','有机棉 100%','橄榄绿','米','4.10','USD',{weight:'260',width:'148',weave:'帆布',yarn:'16S/2',finish:'磨毛'}],
  ['GA-2801','RWS 双面呢长大衣','garment','羊毛混纺','燕麦色','件','62.00','USD',{style:'CP-CT-2801',garmentCategory:'大衣',sizeRange:'XS–XL',mainFabric:'FB-2801'}],
  ['GA-2802','轻量防泼水夹克','garment','再生锦纶','炭黑','件','28.50','USD',{style:'CP-JK-2802',garmentCategory:'夹克',sizeRange:'S–XXL',mainFabric:'FB-2802'}],
  ['GA-2803','精纺单西','garment','羊毛混纺','藏青','件','49.00','USD',{style:'CP-BZ-2803',garmentCategory:'西装',sizeRange:'44–56',mainFabric:'FB-2803'}],
  ['GA-2804','工装衬衫外套','garment','棉锦混纺','卡其','件','24.80','USD',{style:'CP-SJ-2804',garmentCategory:'衬衫外套',sizeRange:'S–XXL',mainFabric:'FB-2804'}],
  ['GA-2805','无里结构西装','garment','天丝羊毛','雾灰','件','45.60','USD',{style:'CP-BZ-2805',garmentCategory:'西装',sizeRange:'44–54',mainFabric:'FB-2805'}],
  ['TR-2801','双开金属拉链 65cm','trimming','铜合金','枪色','条','8.20','CNY',{trimType:'拉链',size:'65cm / 双开',moq:'1000 条'}],
  ['TR-2802','再生涤纶洗标','trimming','再生涤纶','本白','枚','0.18','CNY',{trimType:'洗标',size:'30×60mm',moq:'5000 枚'}],
  ['TR-2803','哑光四合扣 15mm','trimming','铜合金','哑黑','套','0.65','CNY',{trimType:'四合扣',size:'15mm',moq:'3000 套'}],
  ['TR-2804','人字纹棉带 20mm','trimming','棉 100%','本白','米','0.42','CNY',{trimType:'织带',size:'20mm',moq:'2000 米'}],
 ] as const;
 const productIds:string[]=[];
 for(const[index,row]of products.entries()){const supplierId=row[2]==='garment'?supplierIds[4+index%2]:row[2]==='trimming'?supplierIds[2]:supplierIds[0],result=run('product '+row[0],{type:'market.product.save',payload:{input:{sku:row[0],name:row[1],category:row[2],season:'AW28',supplierId,supplierCode:`${row[0]}-S`,composition:row[3],specification:'',color:row[4],unit:row[5],cost:row[6],currency:row[7],sourceDevId:'',sourceVersionId:'',specs:{...row[8]},refPrice:(Number(row[6])*1.28).toFixed(2),fileIds:[],note:'产品档案已完成规格与成本复核'}}},row[2]==='fabric'?fabric:garment);const productId=id(result);if(productId)productIds.push(productId);}

 const developmentSeeds=[
  ['RWS 双面呢长大衣开发','CP-CT-2801','大衣','RWS 羊毛双面呢','燕麦色','确认领型比例、手工缝合和成衣克重','garment'],
  ['轻量防泼水夹克开发','CP-JK-2802','夹克','再生尼龙机械弹','炭黑','确认防泼水等级、压胶位置和活动量','garment'],
  ['RWS 羊毛双面呢开发','','双面呢','560 g/m² RWS 羊毛混纺','燕麦色','达到起球 4 级与柔软手感','fabric'],
  ['再生尼龙机械弹开发','','功能面料','145 g/m² 再生尼龙四面弹','炭黑','确认 C0 防泼水和经纬向弹性','fabric'],
  ['天丝羊毛斜纹开发','','精纺面料','210 g/m² 天丝羊毛斜纹','雾灰','兼顾垂感、抗皱与成衣稳定性','fabric'],
 ] as const;
 for(const[index,row]of developmentSeeds.entries()){const domain=row[6],customerId=customerIds[index%customerIds.length]||state.customers[index%state.customers.length]?.id,factoryId=domain==='fabric'?(supplierIds.find(id=>state.market.suppliers.find(row=>row.id===id)?.type==='织造')||supplierIds[0]):(supplierIds.find(id=>state.market.suppliers.find(row=>row.id===id)?.type==='成衣加工')||supplierIds[0]);if(!customerId||!factoryId)continue;
  const values:any={domain,initiator:'customer',requestType:index%2?'design':'replicate',name:row[0],customer:customerId,style:row[1],season:'AW28',category:row[2],kind:'new',fabric:row[3],color:row[4],target:domain==='fabric'?'8.50':'48.00',targetCurrency:'USD',targetUnit:domain==='fabric'?'米':'件',sizeBase:domain==='fabric'?'':'M',goal:row[5],factories:[factoryId],due:day(30+index*5),collaborators:[],sampleQuantity:domain==='fabric'?3:2,...(domain==='fabric'?{sampleForm:'米样',sampleUnit:'米',fabricRequirements:{composition:index===2?'羊毛:80\n再生锦纶:20':index===3?'再生锦纶:88\n氨纶:12':'莱赛尔:55\n羊毛:45',weightValue:index===2?'560':index===3?'145':'210',weightUnit:'g/m²',widthValue:index===2?'150':'148',widthUnit:'cm',yarn:'按供应商纱支报告',weave:index===3?'四面弹':'斜纹',usage:index===3?'功能夹克':'大衣 / 西装',handle:index===3?'挺括有弹性':'柔软垂顺',finish:index===3?'C0 防泼水':'抗皱防起球',performance:index===3?'防泼水 4 级':'起球 4 级'}}:{})};
  const ctx=domain==='fabric'?fabric:garment,result=run('development portfolio '+index,{type:'development.submit',payload:{values,fileIds:[]}},ctx),devId=id(result,'devId'),versionId=id(result,'versionId');if(!devId||!versionId||index>3)continue;
  if(domain==='fabric'){run('development sample '+index,{type:'development.recordSample',payload:{devId,versionId,sample:`CP-F28-${index+1}-A`,quantity:3,form:'米样',unit:'米',location:'面料样品架 C-1',color:row[4],returnedAt:at(-2-index)}},fabric);run('development qc '+index,{type:'development.recordQc',payload:{devId,versionId,domain:'fabric',qc:{result:'pass',reviewer:roster.fabricQc.name,reviewedAt:at(-1-index),report:`QC-F-2026-${String(84+index).padStart(4,'0')}`,opinion:'克重、门幅及外观达到本轮要求。',fabricMeasurements:[{property:'克重',actual:Number(index===2?558:145),unit:'g/m²'},{property:'门幅',actual:148,unit:'cm'}]}}},fabricQc);}else{run('development sample '+index,{type:'development.recordSample',payload:{devId,versionId,sample:`CP-G28-${index+1}-A`,quantity:2,returnedAt:at(-2-index),form:'首样',unit:'件',location:'成衣样品间 A-2',color:row[4]}},garment);run('development qc '+index,{type:'development.recordQc',payload:{devId,versionId,qc:{result:index===0?'pass':'reject',reviewer:roster.garmentQc.name,reviewedAt:at(-1-index),report:`QC-G-2026-${String(112+index).padStart(4,'0')}`,opinion:index===0?'尺寸与外观达到首样要求。':'袖窿活动量不足，需修版后复检。',measurements:[],appearanceDefects:index===0?0:1}}},garmentQc);}
 }

 const quotationIds:string[]=[];
 const approveOrder=(orderId:string,index:number)=>{const order=state.orders.find(row=>row.id===orderId);if(!order)throw new Error('PO source order missing');const proof=demoFileRecord(base.id(),'customer-po',orderId,`${order.code} 客户PO确认.pdf`,base.now);state.files.push(proof);const confirmation=proof.id;run('company order draft '+index,{type:'order.governance.saveDraft',payload:{orderId,input:{kind:'external',poNumber:`CP-AW28-${String(index+1).padStart(3,'0')}`,confirmationFileIds:[confirmation],internalPurpose:'',receiver:'',paymentMethod:'TT',depositPercent:30,paymentNote:'30% 定金，70% 见提单副本',incoterm:'FOB',deliveryPlace:'上海'}}},fabric);run('company order submit '+index,{type:'order.governance.submit',payload:{orderId}},fabric);run('company order approve '+index,{type:'order.governance.decide',payload:{id:orderId,decision:'approved',note:'客户确认、价格、交期与付款条件已核对'}},owner);};
 for(let index=0;index<6;index++){const product=state.market.products.find(row=>row.id===productIds[index])||state.market.products[index],customerId=customerIds[index%customerIds.length]||state.customers[index%state.customers.length]?.id;if(!product||!customerId)continue;const result=run('quotation portfolio '+index,{type:'market.quotation.save',payload:{input:{customerId,currency:product.currency==='CNY'?'USD':product.currency,season:index<3?'AW28':'SS28',validUntil:day(18+index*4),deliveryTerms:'FOB 上海',paymentTerms:index===3?'100% 即期信用证':'T/T 30% 定金，70% 见提单副本',lines:[{productId:product.id,sourceDevId:product.sourceDevId,sourceVersionId:product.sourceVersionId,name:product.name,style:product.sku,specification:product.specification||Object.values(product.specs||{}).join(' · '),qty:String(600+index*350),unit:product.unit,price:(Number(product.cost)*1.35).toFixed(2),cost:product.cost}],fileIds:[],note:index===5?'客户要求补充色卡后确认最终颜色':'按年度询盘和目标交期编制'}}},fabric),quoteId=id(result);if(!quoteId)continue;quotationIds.push(quoteId);if(index<5){run('quotation sent '+index,{type:'market.quotation.status',payload:{id:quoteId,status:'Sent',evidence:'业务邮件发送报价单并登记送达'}},fabric);run('quotation accepted '+index,{type:'market.quotation.status',payload:{id:quoteId,status:'Accepted',evidence:'客户采购邮件确认价格与交期'}},fabric);const converted=run('quotation convert '+index,{type:'market.quotation.convert',payload:{id:quoteId,type:'fabric',due:day(55+index*4),ownerId:roster.fabricSales.id}},fabric),orderId=id(converted,'orderId');if(orderId)approveOrder(orderId,index);}}

 for(let index=0;index<Math.min(5,customerIds.length);index++){const customerId=customerIds[index],stages=['sampling','quoting','intent','lost','quoting'] as const,result=run('opportunity portfolio '+index,{type:'crm.opportunity.save',payload:{input:{customerId,title:['AW28 功能外套首单','SS28 精纺面料开发','双面呢大衣补单','工装衬衫询价','节日胶囊系列'][index],domain:index===1?'fabric':'garment',amount:String([48000,36000,72000,19000,96000][index])+'.00',currency:index===1||index===2?'EUR':'USD',expectedDate:day(35+index*8),ownerId:index===1?roster.fabricSales.id:roster.garmentSales.id,note:index===3?'客户内部预算调整，交期窗口已错过':'客户年度采购计划已进入跟进',devIds:[],quotationIds:[],orderIds:[]}}},index===1?fabric:garment),opportunityId=id(result);if(opportunityId&&stages[index]!=='intent')run('opportunity stage '+index,{type:'crm.opportunity.stage',payload:{id:opportunityId,stage:stages[index],note:stages[index]==='lost'?'客户年度预算取消':'按客户反馈更新阶段'}},index===1?fabric:garment);
  run('customer follow-up '+index,{type:'crm.followUp.save',payload:{customerId,method:index%2?'email':'meeting',content:['视频会议确认功能夹克首样方向与目标成本。','邮件确认精纺面料克重、门幅及色卡要求。','年度补单数量待零售团队复核。','客户通知本季预算暂停，保留下一季开发资料。','采购确认节日胶囊系列进入合同准备。'][index],at:at(-index-1,7),nextDate:stages[index]==='lost'?'':day(4+index),link:opportunityId?{kind:'opportunity',id:opportunityId}:null}},index===1?fabric:garment);
 }

 for(const [month,family] of [[2,'fabric'],[3,'garment'],[5,'fabric'],[6,'garment'],[8,'fabric'],[9,'garment']] as const){
  const productId=productIds[family==='fabric'?0:6],customerId=customerIds[0];
  try{state=seedCompanyHistory(state,{sales:family==='fabric'?fabric:garment,finance,qc:family==='fabric'?fabricQc:garmentQc,logistics:contextFor(base,roster,'logistics',number),reviewer:owner},{month,family,productId,customerId});}catch(error){failures.push({step:'historical '+month+' '+family,message:error instanceof Error?error.message:String(error)});}
 }

 const claimInvoices=state.invoices.filter(row=>row.open>0).slice(0,3);
 for(let index=0;index<claimInvoices.length;index++){const invoice=claimInvoices[index],order=state.orders.find(row=>row.id===invoice.orderId);if(!order)continue;const result=run('claim '+index,{type:'platform.claim.create',payload:{orderId:order.id,invoiceId:invoice.id,problem:['到货抽检发现两件袖口缝线松脱，客户要求登记并等待照片补充。','客户要求对包装压痕给予商业折让，双方正在确认金额。','首批到货中三件内衬色差，双方同意一次性折让结案。'][index],fileIds:[]}},garment),claimId=id(result);if(!claimId||index===0)continue;const disposition=id(run('claim disposition '+index,{type:'platform.claim.disposition',payload:{claimId,kind:'Allowance',amount:index===1?180:240,quantity:0,unit:'',returnDisposition:'',basis:index===1?'客户照片与到货抽检表已核对，金额待主管审批':'客户邮件、到货抽检表与折让金额已由双方确认',fileIds:[]}},garment));if(!disposition)continue;run('claim submit '+index,{type:'platform.claim.submit',payload:{id:disposition}},garment);if(index===2){run('claim decide '+index,{type:'platform.claim.decide',payload:{id:disposition,decision:'approved',note:'核对来源发票、客户事实与折让金额，同意执行'}},claimReviewer);run('claim execute '+index,{type:'platform.claim.execute',payload:{id:disposition}},garment);}}

 state=rewriteSeed(state,roster) as MistState;
 // Business correspondence is retained as archive material, without claiming a live mailbox connection.
 for(const account of state.email.accounts){account.example=false;account.connection='not_connected';account.credentialSet=false;account.lastSyncAt=null;account.failedFolders=[];account.ownerId=roster.garmentSales.id;account.ownerName=roster.garmentSales.name;account.memberIds=account.kind==='shared'?[roster.owner.id,roster.fabricSales.id,roster.finance.id,roster.logistics.id]:[];account.memberNames=(account.memberIds||[]).map(id=>Object.values(roster).find(person=>person.id===id)!.name);account.address=account.kind==='shared'?'orders@claridgepeak-textile.com':'gu.yan@claridgepeak-textile.com';account.displayName=account.kind==='shared'?'订单往来档案':'客户往来档案';account.aliases=[];account.signature=roster.garmentSales.name+'\n'+MIST_COMPANY_PROFILE.englishName;}
 for(const message of state.email.messages){message.example=false;message.folder='archive';message.body=message.body.replace(/（参考邮件）|（参考）/g,'');message.attachments=[];}
 const poMail=state.email.messages[0],poOrder=poMail?.links.find(link=>link.kind==='order');
 if(poMail&&poOrder){const order=state.orders.find(row=>row.id===poOrder.id),file=state.files.find(row=>order?.governance?.contract.confirmationFileIds.includes(row.id));if(order&&file){poMail.subject='采购确认：'+order.code;poMail.body=`Hi ${roster.garmentSales.name},\n\nPlease proceed with order ${order.code} as per the attached purchase order.\n${state.orderLines.filter(row=>row.orderId===order.id).map(row=>`${row.style}: ${row.qty} ${row.unit} at ${order.currency} ${row.price.toFixed(2)}`).join('\n')}\nDelivery: ${order.due}\n\nBest regards,\nEmma`;poMail.extracted=[];poMail.attachments=[{id:base.id(),fileId:file.id,name:file.name,size:file.size,contentType:file.mimeType}];}}
 state.reviewerIds=[...new Set(getMistReviewTasks(state).flatMap(task=>task.reviewerIds))];
 if(failures.length)onFailures?.(failures);
 return state;
}

export function mistCompanyBaselineMetrics(state:MistState){return{
 customers:state.customers.length,suppliers:state.market.suppliers.length,relations:state.market.relations.length,products:state.market.products.length,quotations:state.market.quotations.length,
 opportunities:state.crm.opportunities.length,followUps:state.crm.followUps.length,developments:state.devs.length,orders:state.orders.length,purchases:state.fulfillment.purchases.length,shipments:state.fulfillment.shipments.length,
 invoices:state.invoices.length,receipts:state.receipts.length,claims:state.platform.claims.length,employees:state.platform.employees.length,bankAccounts:state.bankAccounts?.length||0,files:state.files.length,events:state.events.length,
};}

export function mistCompanyVisibleTextIssues(state:MistState){const issues:Array<{path:string;value:string}>=[];const walk=(value:unknown,path:string,key='')=>{if(typeof value==='string'){const internal=key==='storageKey'||/(^|\.)(?:id|\w+Id|\w+Ids)(?:\[\d+\])?$/.test(path);if(!internal&&BANNED_PRESENTATION.test(value))issues.push({path,value});return;}if(Array.isArray(value)){value.forEach((item,index)=>walk(item,`${path}[${index}]`,key));return;}if(value&&typeof value==='object')for(const[name,child]of Object.entries(value as Record<string,unknown>))walk(child,path?`${path}.${name}`:name,name);};walk(state,'');return issues;}
