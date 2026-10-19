/** Internal scenario metadata. Customer settings commands cannot enable or edit this field. */
export type MistBusinessClock = { mode: 'fixed'; at: string; timezone: 'Asia/Shanghai' };
export function mistBusinessInstant(state: {settings?: {businessClock?: MistBusinessClock}} | null | undefined, actual: string): string {
 const clock=state?.settings?.businessClock;
 if(clock?.mode!=='fixed'||clock.timezone!=='Asia/Shanghai'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(clock.at))return actual;
 const date=new Date(clock.at);
 return Number.isFinite(date.getTime())&&date.toISOString()===clock.at?clock.at:actual;
}

/** One-time alignment of this fictional scenario. Identifiers, money, files and real audit history are preserved. */
export function alignMistScenarioTime<T extends {settings: {businessClock?: MistBusinessClock}}>(state:T, fixedAt:string):T {
 const checked=mistBusinessInstant({settings:{businessClock:{mode:'fixed',at:fixedAt,timezone:'Asia/Shanghai'}}},'');
 if(!checked)throw new Error('Invalid fixed business instant');
 if(state.settings.businessClock?.at===fixedAt)return structuredClone(state);
 if(state.settings.businessClock)throw new Error('An aligned scenario must not be shifted twice');
 const next=structuredClone(state), targetDay=fixedAt.slice(0,10);
 // Original operating scene was anchored on October 19; closed January–September history remains historical.
 const deltaDays=(Date.parse(targetDay+'T00:00:00Z')-Date.parse('2026-10-19T00:00:00Z'))/86400000;
 const deltaInstant=Date.parse(fixedAt)-Date.parse('2026-10-19T23:59:59.999+08:00');
 const walk=(value:unknown,key=''):unknown=>{
  if(['events','files','email','businessClock','companyBaseline','demoSeed'].includes(key))return value;
  if(typeof value==='string'&&value>='2026-10-01'){
   if(/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value)))return new Date(Date.parse(value+'T00:00:00Z')+deltaDays*86400000).toISOString().slice(0,10);
   if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)&&Number.isFinite(Date.parse(value)))return new Date(Date.parse(value)+deltaInstant).toISOString();
  }
  if(Array.isArray(value))return value.map(item=>walk(item,key));
  if(value&&typeof value==='object')for(const [child,item]of Object.entries(value))(value as Record<string,unknown>)[child]=walk(item,child);
  return value;
 };
 walk(next);next.settings.businessClock={mode:'fixed',at:fixedAt,timezone:'Asia/Shanghai'};return next;
}
