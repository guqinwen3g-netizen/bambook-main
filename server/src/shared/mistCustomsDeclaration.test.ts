import {describe,it,expect} from 'vitest';
import {applyMistCommand,createMistState,mistCommandPermission,type MistCommand,type MistContext,type MistState} from './mistWorkspace';
import {customsFamilyOf,customsItemsStale,defaultLegalUnits,draftCustomsDeclaration,normalizeUnit,readCustomsClassifications} from './mistCustomsDeclaration';

function fixture(){
  let i=0;const ctx={id:()=>`cd-${++i}`,now:'2026-10-18T02:00:00Z',actorName:'陈晓',actorId:'demo-warehouse'} as unknown as MistContext;
  let state=createMistState(ctx,'demo');
  const ship=state.fulfillment.shipments[0];ship.state='ready';const customs=state.fulfillment.customs[0];customs.status='draft';state.fulfillment.customsClassifications=[];state.customers.find(c=>c.id===ship.customerId)!.country='瑞典';
  const run=(type:string,payload:Record<string,unknown>)=>{const r=applyMistCommand(state,{type,payload} as MistCommand,ctx);state=r.state;return r.result as {id:string};};
  return {run,ctx,customsId:customs.id,get state(){return state as MistState;}};
}
const suit={family:'garment',hsCode:'6203.3100.00',declaredName:'男式羊毛西服上衣',brandType:'3',preference:'0',elements:['机织','西服上衣','男式','100%羊毛','Northwind'],styles:['cc-aw27-coat-014']};

describe('报关申报资料',()=>{
  it('归类与生成都是报关单证写权限；章节、单位默认值与单位别名',()=>{
    expect(mistCommandPermission({type:'fulfillment.customs.classify.save',payload:suit} as MistCommand)).toBe('customs:write');
    expect(mistCommandPermission({type:'fulfillment.customs.items',payload:{id:'x'}} as MistCommand)).toBe('customs:write');
    expect(customsFamilyOf('6203310000')).toBe('garment');expect(customsFamilyOf('5112.1100')).toBe('fabric');expect(customsFamilyOf('9619')).toBeUndefined();
    expect(defaultLegalUnits('6203110000')).toEqual({legalUnit:'套',secondUnit:'千克'});expect(defaultLegalUnits('6203310000')).toEqual({legalUnit:'件',secondUnit:'千克'});
    expect(defaultLegalUnits('5112110000')).toEqual({legalUnit:'米',secondUnit:'千克'});expect(defaultLegalUnits('6006220000')).toEqual({legalUnit:'千克',secondUnit:''});
    expect(normalizeUnit('PCS')).toBe('件');expect(normalizeUnit('yds')).toBe('码');
  });
  it('校验归类档案：10 位编号、章节与板块一致、要素齐全、款号不重复',()=>{
    const f=fixture();
    expect(()=>f.run('fulfillment.customs.classify.save',{...suit,hsCode:'620331'})).toThrow('10 位');
    expect(()=>f.run('fulfillment.customs.classify.save',{...suit,family:'fabric'})).toThrow('第 50–60 章');
    expect(()=>f.run('fulfillment.customs.classify.save',{...suit,brandType:'9'})).toThrow('品牌类型');
    expect(()=>f.run('fulfillment.customs.classify.save',{...suit,elements:['机织','','男式','100%羊毛','无']})).toThrow('请填写种类');
    expect(()=>f.run('fulfillment.customs.classify.save',{...suit,elements:['机|织','西服上衣','男式','100%羊毛','无']})).toThrow('不能包含');
    expect(()=>f.run('fulfillment.customs.classify.save',{...suit,styles:[]})).toThrow('款号');
    f.run('fulfillment.customs.classify.save',suit);
    const c=readCustomsClassifications(f.state)[0];
    expect(c).toMatchObject({code:'HSC-0001',hsCode:'6203310000',legalUnit:'件',secondUnit:'千克',styles:['cc-aw27-coat-014']});
    expect(()=>f.run('fulfillment.customs.classify.save',{...suit,styles:['CC-AW27-COAT-014']})).toThrow('已在归类 HSC-0001');
    f.run('fulfillment.customs.classify.void',{id:c.id,reason:'归类错误'});
    f.run('fulfillment.customs.classify.save',{...suit,styles:['CC-AW27-COAT-014']});
    expect(readCustomsClassifications(f.state)).toHaveLength(2);
  });
  it('按款号匹配归类生成商品项：数量、金额与 CI 同算法，法定数量取装箱净重，要素带货号',()=>{
    const f=fixture();
    expect(()=>f.run('fulfillment.customs.items',{id:f.customsId})).toThrow('尚未建立商品归类');
    f.run('fulfillment.customs.classify.save',suit);
    f.run('fulfillment.customs.items',{id:f.customsId});
    const c=f.state.fulfillment.customs[0];
    expect(c.items).toEqual([expect.objectContaining({no:1,hsCode:'6203310000',declaredName:'男式羊毛西服上衣',elements:'3|0|机织|西服上衣|男式|100%羊毛|Northwind|货号CC-AW27-COAT-014',quantity:500,unit:'件',legalQty:500,legalUnit:'件',secondQty:480,secondUnit:'千克',unitPrice:46.5,amount:23250,currency:'USD',origin:'中国',destination:'瑞典'})]);
    expect(c).toMatchObject({packages:5,netWeight:480,grossWeight:540,hsCode:'6203310000'});
    expect(customsItemsStale(f.state,c)).toBe(false);
    f.state.fulfillment.packing[0].netWeight=90;
    expect(customsItemsStale(f.state,c)).toBe(true);
    expect(f.state.events[0].text).toContain('生成申报商品项 1 项：USD 23250.00');
  });
  it('成交单位无法换算为法定单位时列出原因，不猜；已放行的不能再生成',()=>{
    const f=fixture();
    f.run('fulfillment.customs.classify.save',{...suit,hsCode:'6203110000',declaredName:'男式羊毛西服套装',elements:['机织','西服套装','男式','100%羊毛','Northwind']});
    const ship=f.state.fulfillment.shipments[0];
    expect(draftCustomsDeclaration(f.state,ship).blockers.join()).toContain('成交单位“件”无法换算为法定单位“套”');
    expect(()=>f.run('fulfillment.customs.items',{id:f.customsId})).toThrow('无法换算');
    f.state.fulfillment.customs[0].status='cleared';
    expect(()=>f.run('fulfillment.customs.items',{id:f.customsId})).toThrow('已放行');
  });
});
