import type {MistFile,MistState} from './mistWorkspace';
import type {DemoFileTemplate} from './mistDemoFiles';

/** Presentation aliases for the fictional development company; persisted business IDs stay stable. */
export const MIST_COMPANY_IDENTITY={
 owner:'沈霁',garmentSales:'林澈',workspace:'雾织贸易 · 经营工作台',
 legalName:'雾织国际贸易（上海）有限公司',englishName:'Mistweave Textile & Apparel Trading (Shanghai) Co., Ltd.',domain:'mistweave-textile.com',
} as const;

/** 虚构公司的公司资料（抬头、地址、税号、银行），公司基线与本机演示公司共用，报价单 / 合同等正式单据据此生成。 */
export const MIST_COMPANY_PROFILE={
 legalName:MIST_COMPANY_IDENTITY.legalName,
 englishName:MIST_COMPANY_IDENTITY.englishName,
 address:'上海市虹口区东大名路 1089 号北外滩商务中心 12 层',
 englishAddress:'12F, North Bund Business Center, 1089 Dongdaming Road, Hongkou, Shanghai 200080, China',
 phone:'+86 21 6168 7720',email:'operations@mistweave-textile.com',taxId:'91310109MA7K4T9R6X',customsCode:'3122260C8M',
 bankName:'浦东商业银行上海外滩支行',bankAccount:'3100668890201175426',swift:'PDSBCNSH',defaultCurrency:'CNY',
} as const;

const RENAMES:ReadonlyArray<readonly[string,string]>=[
 ['澄岳纺织服装贸易（上海）有限公司',MIST_COMPANY_IDENTITY.legalName],
 ['Claridge Peak Textile & Apparel Trading (Shanghai) Co., Ltd.',MIST_COMPANY_IDENTITY.englishName],
 ['澄岳贸易','雾织贸易'],['澄岳','雾织'],['Claridge Peak','Mistweave'],
 ['zhou.min@','shen.ji@'],['gu.yan@','lin.che@'],['claridgepeak-textile.com',MIST_COMPANY_IDENTITY.domain],
 ['周敏',MIST_COMPANY_IDENTITY.owner],['顾言',MIST_COMPANY_IDENTITY.garmentSales],
];
export function mistCompanyDisplayName(value:string):string{return RENAMES.reduce((text,[before,after])=>text.split(before).join(after),value);}

/** Includes serialized approval snapshots so both sides of their equality checks keep the same aliases. */
export function renameMistCompanyIdentity<T>(value:T):T{
 if(typeof value==='string')return mistCompanyDisplayName(value) as T;
 if(Array.isArray(value))return value.map(item=>renameMistCompanyIdentity(item)) as T;
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,renameMistCompanyIdentity(item)])) as T;
 return value;
}

/** Recover the exact business source of the baseline PDF without guessing from its display filename. */
export function mistCompanySeedFileSource(state:MistState,file:MistFile):{template:DemoFileTemplate;ref:string}|null{
 const order=state.orders.find(row=>row.governance?.contract.confirmationFileIds.includes(file.id));
 if(order)return{template:'customer-po',ref:order.id};
 const document=state.fulfillment.documents.find(row=>row.fileIds.includes(file.id)&&['CI','PL'].includes(row.type));
 if(document)return{template:document.type==='CI'?'commercial-invoice':'packing-list',ref:document.shipmentId};
 const customs=state.fulfillment.customs.find(row=>row.fileIds.includes(file.id));
 if(customs)return{template:'customs-release',ref:customs.shipmentId};
 const bill=state.payables?.bills.find(row=>row.fileIds?.includes(file.id));
 if(bill&&bill.lines[0])return{template:'vat-invoice',ref:bill.lines[0].purchaseId};
 const purchase=state.fulfillment.purchases.find(row=>row.offlineSend?.fileIds.includes(file.id));
 if(purchase)return{template:'supplier-contract',ref:purchase.id};
 const credit=state.letterOfCredits?.find(row=>row.fileIds.includes(file.id));
 return credit?{template:'letter-of-credit',ref:credit.lcNo}:null;
}
