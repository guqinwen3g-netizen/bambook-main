import {describe,it,expect} from 'vitest';
import {applyMistCommand,createMistState,mistCommandPermission,type MistContext,type MistCommand,type MistState} from './mistWorkspace';
import {lcAlerts,lcAvailableMinor,lcStatus,readLetterOfCredits} from './mistLetterOfCredit';

function fixture(){
  let id=0;const ctx={id:()=>`lc-${++id}`,now:'2026-10-18T02:00:00Z',actorId:'docs',actorName:'单证 林'} as MistContext;
  let state=createMistState(ctx,'demo');
  for(const o of state.orders)if(o.id==='SO-G-2026-017'||o.id==='SO-G-2026-009')(o as unknown as {governance:{contract:{paymentMethod:string}}}).governance.contract.paymentMethod='LC';
  const run=(command:MistCommand)=>{const result=applyMistCommand(state,command,ctx);state=result.state;return result.result as {id:string;presentationId?:string};};
  return {run,get state(){return state as MistState;},get lc(){return readLetterOfCredits(state)[0];},shipmentId:state.fulfillment!.shipments[0].id};
}
const input=(patch:Record<string,unknown>={})=>({lcNo:'lc26nw0412',orderIds:['SO-G-2026-017'],issuingBank:'Nordea Bank Abp, Stockholm',advisingBank:'中国银行上海分行',availableBy:'sight',currency:'usd',amount:'50000',tolerancePct:'5',issueDate:'2026-09-20',latestShipmentDate:'2026-10-25',expiryDate:'2026-11-15',expiryPlace:'中国',presentationDays:'',partialShipment:true,documentsRequired:'商业发票一式三份；全套清洁已装船提单；装箱单',...patch});
const save=(patch:Record<string,unknown>={})=>({type:'lc.save',payload:{input:input(patch)}}) as MistCommand;
const present=(id:string,shipmentId:string,patch:Record<string,unknown>={})=>({type:'lc.present',payload:{id,shipmentId,shipmentDate:'2026-10-14',presentedAt:'2026-10-17',amount:'30000',documents:'发票、提单、装箱单',...patch}}) as MistCommand;

describe('信用证台账',()=>{
  it('登记来证：订单须为信用证付款、同一客户、同一币种；日期顺序；同开证行信用证号不得重复',()=>{
    const f=fixture();
    expect(()=>f.run(save({orderIds:['SO-G-2026-018']}))).toThrow('不是信用证');
    expect(()=>f.run(save({orderIds:[]}))).toThrow('请选择');
    expect(()=>f.run(save({currency:'EUR'}))).toThrow('币种');
    expect(()=>f.run(save({expiryDate:'2026-10-20'}))).toThrow('开证日 ≤ 最晚装运日 ≤ 有效期');
    expect(()=>f.run(save({issueDate:'2026-10-19'}))).toThrow('不能晚于今天');
    expect(()=>f.run(save({tolerancePct:'12'}))).toThrow('0–10');
    expect(()=>f.run(save({availableBy:'usance'}))).toThrow('远期天数');
    expect(()=>f.run(save({amount:'0'}))).toThrow('大于零');
    const {id}=f.run(save());
    expect(f.lc).toMatchObject({id,code:'LC-2026-0002',lcNo:'LC26NW0412',customerId:'customer-1',currency:'USD',amount:50000,tolerancePct:5,presentationDays:21,partialShipment:true,transhipment:false});
    expect(lcAvailableMinor(f.lc)).toBe(5250000);
    expect(lcStatus(f.lc,'2026-10-18')).toBe('active');
    expect(lcAlerts(f.lc,'2026-10-18')).toEqual(['距最晚装运日 7 天']);
    expect(()=>f.run(save())).toThrow('已登记');
    expect(f.state.events.some(e=>e.entityType==='customs'&&e.entityId===id&&e.text.includes('登记信用证 LC26NW0412'))).toBe(true);
    expect(mistCommandPermission(save())).toBe('customs:write');
  });
  it('修改书逐项记录原条款与新条款；无变化或上限低于已交单时拒绝',()=>{
    const f=fixture();const {id}=f.run(save());
    expect(()=>f.run({type:'lc.amend',payload:{id,date:'2026-10-10',changes:{}}} as MistCommand)).toThrow('至少');
    expect(()=>f.run({type:'lc.amend',payload:{id,date:'2026-10-10',changes:{amount:'50000'}}} as MistCommand)).toThrow('相同');
    f.run({type:'lc.amend',payload:{id,date:'2026-10-10',changes:{latestShipmentDate:'2026-11-05',expiryDate:'2026-11-30',partialShipment:false},note:'客户同意展期'}} as MistCommand);
    expect(f.lc.amendments[0]).toMatchObject({no:1,note:'客户同意展期',changes:[{field:'latestShipmentDate',from:'2026-10-25',to:'2026-11-05'},{field:'expiryDate',from:'2026-11-15',to:'2026-11-30'},{field:'partialShipment',from:'允许',to:'不允许'}]});
    expect(f.lc).toMatchObject({latestShipmentDate:'2026-11-05',expiryDate:'2026-11-30',partialShipment:false});
    f.run(present(id,f.shipmentId,{amount:'40000'}));
    expect(()=>f.run({type:'lc.amend',payload:{id,date:'2026-10-18',changes:{amount:'30000'}}} as MistCommand)).toThrow('低于已交单');
  });
  it('交单：不得超过可用余额；自动识别迟装、迟交单、过期与不允许分批；同一出运不得重复交单',()=>{
    const f=fixture();const {id}=f.run(save({latestShipmentDate:'2026-10-12',presentationDays:'2',expiryDate:'2026-10-16'}));
    expect(()=>f.run(present(id,'nope'))).toThrow('出运不存在');
    expect(()=>f.run(present(id,f.shipmentId,{amount:'52500.01'}))).toThrow('可用余额 52500.00 USD');
    expect(()=>f.run(present(id,f.shipmentId,{presentedAt:'2026-10-13'}))).toThrow('不能早于装运日');
    expect(()=>f.run(present(id,f.shipmentId,{presentedAt:'2026-10-19'}))).toThrow('已发生');
    const r=f.run(present(id,f.shipmentId,{amount:'52500'}));
    const p=f.lc.presentations[0];
    expect(p).toMatchObject({id:r.presentationId,no:1,shipmentCode:'SHP-2026-00001',deadline:'2026-10-16',result:'pending'});
    expect(p.autoDiscrepancies).toEqual(['迟装：装运日 2026-10-14 晚于最晚装运日 2026-10-12','信用证过期：交单日 2026-10-17 晚于有效期 2026-10-16']);
    expect(()=>f.run(present(id,f.shipmentId))).toThrow('已在本信用证下交单');
    expect(lcStatus(f.lc,'2026-10-18')).toBe('drawn');
    const g=fixture();const b=g.run(save({partialShipment:false,presentationDays:'2'})).id;
    g.run(present(b,g.shipmentId,{amount:'10000'}));
    expect(g.lc.presentations[0].autoDiscrepancies).toEqual(['迟交单：交单日 2026-10-17 晚于交单期截止 2026-10-16（装运后 2 天）']);
  });
  it('银行审单结果：不符须列明不符点、拒付须写理由、承付不超过交单金额；承付或拒付后定案；拒付释放余额',()=>{
    const f=fixture();const {id}=f.run(save());const {presentationId}=f.run(present(id,f.shipmentId));
    const result=(patch:Record<string,unknown>)=>({type:'lc.presentation.result',payload:{id,presentationId,date:'2026-10-18',...patch}}) as MistCommand;
    expect(()=>f.run(result({result:'discrepant'}))).toThrow('不符点');
    expect(()=>f.run(result({result:'refused'}))).toThrow('拒付理由');
    expect(()=>f.run(result({result:'honoured',honouredAmount:'30000.01'}))).toThrow('不能超过交单金额');
    expect(()=>f.run(result({result:'complying',date:'2026-10-16'}))).toThrow('交单日与今天之间');
    f.run(result({result:'discrepant',discrepancies:'提单未注明运费已付'}));
    expect(lcAlerts(f.lc,'2026-10-18')).toContain('第 1 次交单存在不符点，待申请人答复');
    expect(()=>f.run({type:'lc.cancel',payload:{id,date:'2026-10-18',reason:'结束'}} as MistCommand)).toThrow('未承付或未拒付');
    f.run(result({result:'honoured',honouredAmount:'29800',note:'扣不符点费 200 USD'}));
    expect(f.lc.presentations[0]).toMatchObject({result:'honoured',honouredAmount:29800,discrepancies:'提单未注明运费已付'});
    expect(f.lc.presentations[0].history.map(h=>h.result)).toEqual(['discrepant','honoured']);
    expect(lcAvailableMinor(f.lc)).toBe(5250000-2980000);
    expect(()=>f.run(result({result:'refused',note:'x'}))).toThrow('不能再改结果');
    const g=fixture();const b=g.run(save()).id;const p2=g.run(present(b,g.shipmentId)).presentationId;
    g.run({type:'lc.presentation.result',payload:{id:b,presentationId:p2,result:'refused',date:'2026-10-18',note:'申请人拒绝接受不符点'}} as MistCommand);
    expect(lcAvailableMinor(g.lc)).toBe(5250000);
    g.run(present(b,g.shipmentId,{amount:'1000'}));
    expect(g.lc.presentations).toHaveLength(2);
  });
  it('原件附件只能追加，不能移除；附件须已上传',()=>{
    const f=fixture();const {id}=f.run(save());const file=f.state.files[0].id;
    expect(()=>f.run({type:'lc.files',payload:{id,fileIds:['nope']}} as MistCommand)).toThrow('附件不存在');
    f.run({type:'lc.files',payload:{id,fileIds:[file]}} as MistCommand);
    expect(f.lc.fileIds).toEqual([file]);
    expect(()=>f.run({type:'lc.files',payload:{id,fileIds:[]}} as MistCommand)).toThrow('只能追加');
    expect(()=>f.run({type:'lc.files',payload:{id,fileIds:[file]}} as MistCommand)).toThrow('没有新增');
  });
  it('注销：须写原因，注销后不能修改或交单',()=>{
    const f=fixture();const {id}=f.run(save());
    expect(()=>f.run({type:'lc.cancel',payload:{id,date:'2026-10-18',reason:''}} as MistCommand)).toThrow('注销原因');
    f.run({type:'lc.cancel',payload:{id,date:'2026-10-18',reason:'客户改为电汇'}} as MistCommand);
    expect(lcStatus(f.lc,'2026-10-18')).toBe('cancelled');
    expect(lcAlerts(f.lc,'2026-10-18')).toEqual([]);
    expect(()=>f.run({type:'lc.amend',payload:{id,date:'2026-10-18',changes:{amount:'1'}}} as MistCommand)).toThrow('已注销');
    expect(()=>f.run(present(id,f.shipmentId))).toThrow('已注销');
    expect(()=>f.run({type:'lc.cancel',payload:{id,date:'2026-10-18',reason:'x'}} as MistCommand)).toThrow('已注销');
  });
});
