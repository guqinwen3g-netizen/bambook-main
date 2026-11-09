/** Internal scenario metadata. Customer settings commands cannot enable or edit this field. */
export type MistBusinessClock = { mode: 'fixed'; at: string; timezone: 'Asia/Shanghai' };
/** Business date only: the same Shanghai day on server and browser, independent of host timezone. */
export function mistBusinessDate(instant: string | Date): string {
 const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
 const part = (key: string) => parts.find(value => value.type === key)!.value;
 return `${part('year')}-${part('month')}-${part('day')}`;
}
/** Plain calendar day (YYYY-MM-DD): exists in the Gregorian calendar. No timezone involved. */
export function isCalendarDay(value: unknown): value is string {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
 const [y, m, d] = value.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));
 return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
/** Calendar arithmetic on a plain day; the result is still a plain day, not an instant. */
export function shiftCalendarDay(day: string, days: number): string {
 const [y, m, d] = day.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d + days));
 return `${String(t.getUTCFullYear()).padStart(4, '0')}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
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
   if(/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value)))return shiftCalendarDay(value,deltaDays);
   if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)&&Number.isFinite(Date.parse(value)))return new Date(Date.parse(value)+deltaInstant).toISOString();
  }
  if(Array.isArray(value))return value.map(item=>walk(item,key));
  if(value&&typeof value==='object')for(const [child,item]of Object.entries(value))(value as Record<string,unknown>)[child]=walk(item,child);
  return value;
 };
 walk(next);next.settings.businessClock={mode:'fixed',at:fixedAt,timezone:'Asia/Shanghai'};return next;
}

/** 按既有最大序号续号（不按条数计，补零位数不同的旧号也能识别）。 */
export function nextSerialCode(head: string, codes: Iterable<string | undefined>, width = 4): string {
  let max = 0;
  for (const code of codes) {
    if (!code || !code.startsWith(head)) continue;
    const tail = code.slice(head.length);
    if (/^\d+$/.test(tail)) max = Math.max(max, Number(tail));
  }
  return head + String(max + 1).padStart(width, '0');
}

/** 业务年度编号：`PREFIX-YYYY-0001`，年份取上海业务日。 */
export function nextBusinessCode(prefix: string, codes: Iterable<string | undefined>, now: string, width = 4): string {
  return nextSerialCode(`${prefix}-${mistBusinessDate(now).slice(0, 4)}-`, codes, width);
}
