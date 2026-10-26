import {expect,it} from 'vitest';
import type {TokenPayload} from '../auth/service';
import {projectState} from './access';
import {createMistState} from '../shared/mistWorkspace';

const ctx={id:(()=>{let n=0;return()=>'bank-'+(++n);})(),now:'2026-10-27T04:00:00Z',actorName:'林舒'};
const actor=(permissions:string[])=>({userId:'u',roles:[],permissions,authorizationLoaded:true,departmentIds:[]} as TokenPayload);
const view=(permissions:string[])=>{const state=createMistState(ctx,'demo');state.bankAccounts=[{id:'acct-usd',code:'BA-01',currency:'USD'} as any];state.fxRecords=[{id:'fx-1'} as any];return projectState(state,actor(permissions),()=>createMistState(ctx,'empty'));};

it('keeps company bank accounts with finance staff who record receipts and payments',()=>{
 const sales=view(['finance:read','invoices:read','vouchers:read']);
 expect(sales.state.bankAccounts).toEqual([]);expect(sales.hidden.some(s=>s.key==='bankAccounts')).toBe(true);
 expect(sales.state.fxRecords).toHaveLength(1);
 const finance=view(['finance:read','invoices:read','vouchers:read','vouchers:write']);
 expect(finance.state.bankAccounts).toHaveLength(1);expect(finance.hidden.some(s=>s.key==='bankAccounts')).toBe(false);
});
