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
  it('splits one fabric style by recorded package colour and explicit classification',()=>{
    const f=fixture(),s=f.state,ship=s.fulfillment.shipments[0],line=s.orderLines.find(l=>l.id===ship.lines[0].lineId)!;
    s.orders.find(o=>o.id===line.orderId)!.type='fabric';Object.assign(line,{style:'FAB-1',unit:'米',price:3.8,qty:10,breakdown:{kind:'fabric',composition:'65%涤纶/35%棉',width:150,weight:141,rows:[{color:'本白',quantity:5},{color:'藏蓝',quantity:5}]}});
    Object.assign(ship,{domain:'fabric',packingColorVersion:1});ship.lines[0].quantity=10;
    s.fulfillment.packing=s.fulfillment.packing.filter(r=>r.shipmentId!==ship.id);s.fulfillment.packing.push({id:'white',shipmentId:ship.id,lineId:line.id,productionId:ship.lines[0].productionId,carton:'R1',quantity:5,netWeight:2,grossWeight:3,volume:1,note:'',fabricColor:'本白'},{id:'navy',shipmentId:ship.id,lineId:line.id,productionId:ship.lines[0].productionId,carton:'R2',quantity:5,netWeight:2.5,grossWeight:3,volume:1,note:'',fabricColor:'藏蓝'} as any);
    const common={family:'fabric',brandType:'0',preference:'0',styles:['FAB-1'],legalUnit:'米',secondUnit:'千克'};
    f.run('fulfillment.customs.classify.save',{...common,hsCode:'5513110000',declaredName:'漂白涤棉布',elements:['机织','漂白','65%涤纶/35%棉','150cm，141g/m²','无品牌'],colors:['本白']});
    f.run('fulfillment.customs.classify.save',{...common,hsCode:'5513210000',declaredName:'染色涤棉布',elements:['机织','染色','65%涤纶/35%棉','150cm，141g/m²','无品牌'],colors:['藏蓝']});
    f.run('fulfillment.customs.items',{id:f.customsId});const c=f.state.fulfillment.customs[0];
    expect(c.items).toHaveLength(2);expect(c.items).toEqual(expect.arrayContaining([expect.objectContaining({hsCode:'5513110000',quantity:5,secondQty:2,amount:19}),expect.objectContaining({hsCode:'5513210000',quantity:5,secondQty:2.5,amount:19})]));
    expect(customsItemsStale(f.state,c)).toBe(false);
    (f.state.fulfillment.packing.find(row=>row.id==='navy') as any).fabricColor='本白';expect(customsItemsStale(f.state,c)).toBe(true);
  });
  it('requires disjoint colour scopes for duplicate fabric styles and retains legacy wildcard protection',()=>{
    const f=fixture(),base={family:'fabric',hsCode:'5513110000',declaredName:'面料',brandType:'0',preference:'0',styles:['FAB-1'],elements:['机织','漂白','65%涤纶/35%棉','150cm','无品牌']};
    f.run('fulfillment.customs.classify.save',{...base,colors:['本白']});
    expect(()=>f.run('fulfillment.customs.classify.save',{...base,colors:[' 本白 ']})).toThrow('已在归类');
    expect(()=>f.run('fulfillment.customs.classify.save',{...base})).toThrow('已在归类');
    f.run('fulfillment.customs.classify.save',{...base,colors:['藏蓝']});
    expect(readCustomsClassifications(f.state).map(c=>c.colors)).toEqual([['本白'],['藏蓝']]);
    const first=readCustomsClassifications(f.state)[0];f.run('fulfillment.customs.classify.save',{...base,id:first.id,declaredName:'更新品名'});expect(readCustomsClassifications(f.state)[0].colors).toEqual(['本白']);
  });
  it('does not infer a multi-colour shipment breakdown from the order ratio',()=>{
    const f=fixture(),s=f.state,ship=s.fulfillment.shipments[0],line=s.orderLines.find(l=>l.id===ship.lines[0].lineId)!;
    s.orders.find(o=>o.id===line.orderId)!.type='fabric';Object.assign(line,{style:'FAB-2',unit:'米',qty:10,breakdown:{kind:'fabric',composition:'棉',width:150,weight:141,rows:[{color:'本白',quantity:5},{color:'藏蓝',quantity:5}]}});Object.assign(ship,{domain:'fabric',state:'preparing'});
    f.run('fulfillment.customs.classify.save',{family:'fabric',hsCode:'5513110000',declaredName:'面料',brandType:'0',preference:'0',styles:['FAB-2'],colors:['本白'],elements:['机织','漂白','棉','150cm','无品牌']});
    expect(()=>f.run('fulfillment.customs.items',{id:f.customsId})).toThrow('请先核对每件面料的颜色');
  });
  it('keeps legacy unscoped classifications usable without claiming colour verification',()=>{
    const f=fixture(),s=f.state,ship=s.fulfillment.shipments[0],line=s.orderLines.find(l=>l.id===ship.lines[0].lineId)!;
    s.orders.find(o=>o.id===line.orderId)!.type='fabric';Object.assign(line,{style:'FAB-OLD',unit:'米',breakdown:{kind:'fabric',composition:'棉',width:150,weight:141,rows:[{color:'本白',quantity:250},{color:'藏蓝',quantity:250}]}});Object.assign(ship,{domain:'fabric',state:'preparing'});
    f.run('fulfillment.customs.classify.save',{family:'fabric',hsCode:'5513110000',declaredName:'原面料归类',brandType:'0',preference:'0',styles:['FAB-OLD'],elements:['机织','漂白','棉','150cm','无品牌']});
    f.run('fulfillment.customs.items',{id:f.customsId});expect(f.state.fulfillment.customs[0].items).toHaveLength(1);expect(f.state.fulfillment.shipments[0].packingColorVersion).toBeUndefined();
  });
  it('allocates rounded invoice cents across fabric colours without negative amounts or drift',()=>{
    const f=fixture(),s=f.state,ship=s.fulfillment.shipments[0],line=s.orderLines.find(l=>l.id===ship.lines[0].lineId)!;const colors=['白','蓝','灰','黑'];
    s.orders.find(o=>o.id===line.orderId)!.type='fabric';Object.assign(line,{style:'FAB-CENTS',unit:'米',price:.01,qty:2,breakdown:{kind:'fabric',composition:'棉',width:150,weight:141,rows:colors.map(color=>({color,quantity:.5}))}});Object.assign(ship,{domain:'fabric',packingColorVersion:1});ship.lines[0].quantity=2;
    s.fulfillment.packing=s.fulfillment.packing.filter(r=>r.shipmentId!==ship.id);s.fulfillment.packing.push(...colors.map((color,i)=>({id:'p'+i,shipmentId:ship.id,lineId:line.id,productionId:ship.lines[0].productionId,carton:'R'+i,quantity:.5,netWeight:1,grossWeight:1,volume:1,note:'',fabricColor:color})));
    for(const color of colors)f.run('fulfillment.customs.classify.save',{family:'fabric',hsCode:'5513110000',declaredName:'面料',brandType:'0',preference:'0',styles:['FAB-CENTS'],colors:[color],elements:['机织','漂白','棉','150cm','无品牌']});
    f.run('fulfillment.customs.items',{id:f.customsId});const amounts=f.state.fulfillment.customs[0].items!.map(item=>item.amount);
    expect(amounts.every(amount=>amount>=0)).toBe(true);expect(amounts.reduce((sum,amount)=>sum+amount,0)).toBeCloseTo(.02);expect(amounts.filter(amount=>amount>0)).toHaveLength(2);
  });
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
    // PostgreSQL jsonb 存取后键顺序改变，不应误判为已变化
    c.items=c.items!.map(i=>Object.fromEntries(Object.entries(i).reverse()) as typeof i);
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
  it('生成后可逐项手工调整品名、要素与法定数量：留痕、不算出运变化；重新生成时自动值未变的调整保留',()=>{
    const f=fixture();
    f.run('fulfillment.customs.classify.save',suit);
    f.run('fulfillment.customs.items',{id:f.customsId});
    const adj={id:f.customsId,no:1,declaredName:'男式羊毛制西服上衣',elements:'3|0|机织|西服上衣|男式|100%羊毛|Northwind|货号CC-AW27-COAT-014',legalQty:500,secondQty:478.5,reason:'报关行审单：净重按磅单'};
    expect(mistCommandPermission({type:'fulfillment.customs.item.adjust',payload:adj} as MistCommand)).toBe('customs:write');
    expect(()=>f.run('fulfillment.customs.item.adjust',{...adj,no:9})).toThrow('不存在');
    expect(()=>f.run('fulfillment.customs.item.adjust',{...adj,reason:''})).toThrow('调整原因');
    expect(()=>f.run('fulfillment.customs.item.adjust',{...adj,secondQty:0})).toThrow('第二数量须大于 0');
    f.run('fulfillment.customs.item.adjust',adj);
    let c=f.state.fulfillment.customs[0],i=c.items![0];
    expect(i).toMatchObject({declaredName:'男式羊毛制西服上衣',secondQty:478.5,amount:23250,quantity:500,hsCode:'6203310000',generated:{declaredName:'男式羊毛西服上衣',secondQty:480},adjusted:{actor:'陈晓',reason:'报关行审单：净重按磅单',fields:['declaredName','secondQty']}});
    expect(f.state.events[0].text).toBe('手工调整申报商品项 1（申报品名、第二数量）：报关行审单：净重按磅单');
    expect(customsItemsStale(f.state,c)).toBe(false);
    expect(()=>f.run('fulfillment.customs.item.adjust',adj)).toThrow('没有改动');
    // 装箱净重变了：第二数量自动值变了，以新值为准；品名自动值没变，保留调整
    f.state.fulfillment.packing[0].netWeight=90;
    expect(customsItemsStale(f.state,c)).toBe(true);
    f.run('fulfillment.customs.items',{id:f.customsId});
    c=f.state.fulfillment.customs[0];i=c.items![0];
    expect(i.declaredName).toBe('男式羊毛制西服上衣');expect(i.secondQty).not.toBe(478.5);
    expect(i.adjusted?.fields).toEqual(['declaredName']);expect(i.generated).toEqual({declaredName:'男式羊毛西服上衣'});
    expect(f.state.events[0].text).toContain('保留 1 项手工调整');
    expect(customsItemsStale(f.state,c)).toBe(false);
    // 改回自动值即清除调整标记
    f.run('fulfillment.customs.item.adjust',{...adj,declaredName:'男式羊毛西服上衣',secondQty:i.secondQty,reason:'恢复'});
    i=f.state.fulfillment.customs[0].items![0];
    expect(i.adjusted).toBeUndefined();expect(i.generated).toBeUndefined();
    expect(f.state.events[0].text).toBe('申报商品项 1 恢复为自动生成值：恢复');
    f.state.fulfillment.customs[0].status='cleared';
    expect(()=>f.run('fulfillment.customs.item.adjust',{...adj,reason:'改单'})).toThrow('已放行');
  });
});
