import {mistBusinessInstant,type MistBusinessClock} from '../../../../server/src/shared/mistBusinessClock';
let frozen: MistBusinessClock|undefined;
/** Bound only from the currently authenticated workspace response; never changes the system clock. */
export function bindBusinessClock(clock: MistBusinessClock|undefined) { frozen=clock; }
export function businessNow(): Date { return new Date(mistBusinessInstant({settings:{businessClock:frozen}},new Date().toISOString())); }
