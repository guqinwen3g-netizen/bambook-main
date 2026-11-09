import {mistBusinessDate,mistBusinessInstant,type MistBusinessClock} from '../../../../server/src/shared/mistBusinessClock';
let frozen: MistBusinessClock|undefined;
/** Bound only from the currently authenticated workspace response; never changes the system clock. */
export function bindBusinessClock(clock: MistBusinessClock|undefined) { frozen=clock; }
export function businessNow(): Date { return new Date(mistBusinessInstant({settings:{businessClock:frozen}},new Date().toISOString())); }
export const businessDate = mistBusinessDate;
/** Date-only defaults must use the server business day, never truncate a UTC timestamp. */
export function businessToday(): string { return businessDate(businessNow()); }
/** datetime-local 输入框的值按业务时区（北京时间，无夏令时）显示与回读，不随电脑时区漂移。 */
export function businessInputValue(date: Date = businessNow()): string {
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 16);
}
export function businessInputInstant(value: string): string {
  return new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? value + ':00+08:00' : value).toISOString();
}
