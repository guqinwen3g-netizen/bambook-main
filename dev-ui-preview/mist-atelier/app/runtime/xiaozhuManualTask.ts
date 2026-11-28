import type {InterfaceLocale} from '../../../../services/interfaceLanguage';

export type ManualTaskSubmission={
  requestId:string;
  identityId:string;
  name:string;
  instructions:string;
  executor:'external'|'platform';
  locale?:InterfaceLocale;
};

const storageKey=(scope:string)=>'mist.xiaozhu.manual-task:'+scope;

/** Keep one unresolved, explicitly submitted form in the same tab and account/company scope. */
export function readManualTaskSubmission(scope?:string):ManualTaskSubmission|undefined{
  if(!scope)return;
  try{
    const entry=JSON.parse(sessionStorage.getItem(storageKey(scope))??'null') as Partial<ManualTaskSubmission>|null;
    if(!entry||typeof entry.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(entry.requestId)
      ||typeof entry.identityId!=='string'||!entry.identityId||entry.identityId.length>100
      ||typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>60
      ||typeof entry.instructions!=='string'||!entry.instructions.trim()||entry.instructions.length>4000
      ||!(entry.executor==='external'&&entry.locale===undefined||entry.executor==='platform'&&(entry.locale==='zh-CN'||entry.locale==='en-US')))return;
    const {requestId,identityId,name,instructions,executor,locale}=entry;
    return {requestId,identityId,name,instructions,executor,...(locale?{locale}:{})};
  }catch{ /* The open page still supports recovery in memory. */ }
}

export function saveManualTaskSubmission(scope:string|undefined,entry?:ManualTaskSubmission){
  if(!scope)return;
  try{
    if(entry)sessionStorage.setItem(storageKey(scope),JSON.stringify(entry));
    else sessionStorage.removeItem(storageKey(scope));
  }catch{ /* Storage can be unavailable. */ }
}
