import {describe,expect,it} from 'vitest';
import {applyMistCommand,createMistState,type MistCommand,type MistContext} from './mistWorkspace';

function fixture(){
  let serial=0;
  const ctx:MistContext={id:()=>`tc-${++serial}`,now:'2026-11-05T00:00:00Z',actorId:'seller',actorName:'业务',can:()=>true};
  let state=createMistState(ctx,'empty');
  const run=(command:MistCommand,actor=ctx)=>{const r=applyMistCommand(state,command,actor);state=r.state;return r.result;};
  const supplierId=String(run({type:'market.supplier.save',payload:{input:{name:'辅料供应商',type:'辅料'}}}).id);
  const makerId=String(run({type:'market.relation.save',payload:{input:{name:'纽扣制造厂',category:'Partner',customerId:'',supplierId:'',country:'中国',address:'',aliases:[],contacts:[]}}}).id);
  const basic={sku:'TR-007',name:'四孔扣',category:'trimming' as const,season:'',supplierId,supplierCode:'S-18',composition:'树脂',specification:'18 mm',color:'绿',unit:'个',cost:'0.2',currency:'CNY',sourceDevId:'',sourceVersionId:''};
  const productId=String(run({type:'market.product.save',payload:{input:basic}}).id);
  return {ctx,run,productId,supplierId,makerId,basic,get state(){return state;},product:()=>state.market.products.find(p=>p.id===productId)!};
}
describe('trim catalog and supplier quotation basis',()=>{
  it('keeps the manufacturer separate from the supplying company and preserves category-specific facts through a normal product edit',()=>{
    const f=fixture();
    f.run({type:'market.product.trimProfile.save',payload:{productId:f.productId,category:'buttons',manufacturerRelationId:f.makerId,parameters:{material:'树脂'}}});
    f.run({type:'market.product.save',payload:{id:f.productId,input:{...f.basic,name:'哑光四孔扣'}}});
    expect(f.product().supplierId).toBe(f.supplierId);
    expect(f.product().trimProfile).toEqual({category:'buttons',manufacturerRelationId:f.makerId,parameters:{material:'树脂'}});
    expect(()=>f.run({type:'market.product.trimProfile.save',payload:{productId:f.productId,category:'buttons',manufacturerRelationId:null,parameters:{material:'树脂'}}},{...f.ctx,can:()=>false})).toThrow();
    expect(()=>f.run({type:'market.product.trimProfile.save',payload:{productId:f.productId,category:'buttons',parameters:{zipperLength:'8 cm'}}})).toThrow();
    expect(f.state.fulfillment.stock).toEqual([]);
  });
  it('records the offer date, units, applicable conditions and evidence at the supplier price; unknown dates are not inferred',()=>{
    const f=fixture();const terms={date:'2026-11-01',unit:'打',moqUnit:'打',conditions:'单款单色满50打',fileIds:[]};
    const offer={productId:f.productId,supplierId:f.supplierId,supplierCode:'S-18',price:'3.60',currency:'CNY',moq:'50'};
    f.run({type:'market.product.source.save',payload:{...offer,quoteTerms:terms}});
    expect(f.product().sources?.[0].quoteTerms).toEqual(terms);
    expect(()=>f.run({type:'market.product.source.save',payload:{...offer,quoteTerms:{...terms,date:'2026-02-30'}}})).toThrow();
    expect(()=>f.run({type:'market.product.source.save',payload:{...offer,quoteTerms:{...terms,fileIds:['missing-file']}}})).toThrow();
    f.run({type:'market.product.source.save',payload:{...offer,quoteTerms:{...terms,unit:'包',conditions:'每包12个'}}});
    expect(f.product().priceHistory?.at(-1)?.previousTerms).toEqual(terms);
    expect(f.product().sources?.[0].quoteTerms?.unit).toBe('包');
    f.run({type:'market.product.source.save',payload:{...offer,price:'4.00'}});
    expect(f.product().sources?.[0].quoteTerms).toBeUndefined();
    expect(f.product().cost).toBe('0.2');
  });
});

describe('material use on an exact garment factory version',()=>{
  function caseWithSource(){
    const f=fixture();
    const factory=String(f.run({type:'market.supplier.save',payload:{input:{name:'样衣工厂',type:'成衣加工',capabilities:'成衣打样'}}}).id);
    f.state.customers.push({id:'c',name:'设计客户',code:'C',country:'',city:'',industry:'',owner:'',ownerId:'seller',grade:'',currency:'EUR',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
    f.run({type:'market.product.trimProfile.save',payload:{productId:f.productId,category:'buttons',manufacturerRelationId:f.makerId,parameters:{material:'树脂'}}});
    const offer={productId:f.productId,supplierId:f.supplierId,supplierCode:'B18',price:'3.60',currency:'CNY',moq:'50',quoteTerms:{date:'2026-11-01',unit:'打',moqUnit:'打',conditions:'绿色',fileIds:[]}};
    f.run({type:'market.product.source.save',payload:offer});
    const d=f.run({type:'development.submit',payload:{values:{initiator:'customer',requestType:'design',name:'试制外套',customer:'c',style:'STYLE-X',season:'AW',category:'夹克',kind:'new',fabric:'棉斜纹',color:'灰绿',target:'',sizeBase:'M',goal:'核对扣位',factories:[factory],due:'2026-11-25',collaborators:[],sampleQuantity:1},fileIds:[]}});
    const devId=String(d.devId),first=String(d.versionId);
    const use={devId,versionId:first,productId:f.productId,offerSupplierId:f.supplierId,position:'门襟',perPiece:'5',unit:'个',provider:'company' as const,nature:'existing' as const,specification:'18 mm',color:'绿色',colorMode:'specified' as const,colorReference:'色卡A'};
    return {f,devId,first,factory,offer,use};
  }
  it('freezes technical and quoted facts independently for each position and version',async()=>{
    const {f,devId,first,factory,offer,use}=caseWithSource();
    const a=f.run({type:'development.material.add',payload:use});
    f.run({type:'development.material.add',payload:{...use,position:'袖口',perPiece:'2',provider:'factory'}});
    const get=(id:string)=>f.state.versions.find(v=>v.id===id)!;
    const old=structuredClone(get(first).materialUses);
    f.run({type:'market.product.source.save',payload:{...offer,price:'4.10',quoteTerms:{...offer.quoteTerms,date:'2026-11-04'}}});
    f.run({type:'market.product.trimProfile.save',payload:{productId:f.productId,category:'buttons',parameters:{material:'新树脂'}}});
    expect(get(first).materialUses).toEqual(old);expect(old).toHaveLength(2);
    expect(old?.[0]).toMatchObject({position:'门襟',perPiece:'5',catalog:{sku:'TR-007',manufacturerName:'纽扣制造厂',profile:{parameters:{material:'树脂'}}},offer:{supplierName:'辅料供应商',price:'3.60',terms:{date:'2026-11-01',unit:'打'}}});
    const next=f.run({type:'development.round.create',payload:{devId,factories:[factory],requirements:'复核用量',targetDate:'2026-11-26',referenceVersionIds:[first],fileIds:[]}}),second=String(next.versionId);
    expect(get(second).materialUses).toEqual(old);
    f.run({type:'development.material.edit',payload:{...use,versionId:second,useId:String(a.id),perPiece:'6'}});
    f.run({type:'development.material.add',payload:{...use,versionId:second,position:'备用扣',perPiece:'1',nature:'substitute'}});
    expect(get(first).materialUses).toEqual(old);expect(get(second).materialUses?.at(-1)?.offer?.price).toBe('4.10');expect(get(second).materialUses?.[0].offer?.price).toBe('3.60');
    expect(get(second).materialUses?.at(-1)?.catalog.profile?.parameters.material).toBe('新树脂');expect(f.state.fulfillment.stock).toEqual([]);
    f.state.settings.companyProfile={legalName:'通知单测试公司'} as NonNullable<typeof f.state.settings.companyProfile>;
    const {developmentNoticeContent}=await import('./mistDevelopmentNotice');
    const content=developmentNoticeContent(f.state,f.state.devs.find(x=>x.id===devId)!,get(first));
    expect(content.materials?.map(m=>[m.sku,m.position,m.perPiece,m.provider])).toEqual([['TR-007','门襟','5','我方提供'],['TR-007','袖口','2','工厂自配']]);
    expect(JSON.stringify(content.materials)).not.toContain('3.60');
    const {renderDevelopmentNoticeHtml}=await import('../templates/developmentNotice');
    const html=renderDevelopmentNoticeHtml({...content,noticeNo:'D-N01',seq:1,templateVersion:3,generatedAt:f.ctx.now,generatedBy:'业务',generatedById:'seller'});
    expect(html).toContain('本版辅料');expect(html).toContain('门襟');expect(html).toContain('袖口');expect(html).not.toContain('3.60');
    const {projectGarmentMaterials}=await import('./mistGarmentMaterials');
    const projected={...f.state,market:{...f.state.market,relations:[],suppliers:[]}};
    projectGarmentMaterials(projected);
    const hidden=projected.versions.find(v=>v.id===first)!.materialUses![0];
    expect(hidden.offer).toBeUndefined();expect(hidden.catalog.manufacturerName).toBeUndefined();expect(hidden.catalog.profile?.manufacturerRelationId).toBeUndefined();
    expect(hidden.catalog.specs).toEqual(old![0].catalog.specs);expect(get(first).materialUses).toEqual(old);
    f.run({type:'development.recordSample',payload:{devId,versionId:first,sample:'SRC-1',quantity:1,returnedAt:f.ctx.now}});
    f.run({type:'development.recordQc',payload:{devId,versionId:first,qc:{result:'pass',reviewer:'QC',reviewedAt:f.ctx.now,report:'QC-01',opinion:'通过'}}});
    const archive=f.run({type:'market.product.fromVersion',payload:{devId,versionId:first,sku:'JK-ARCH'}});
    expect(f.state.market.products.find(p=>p.id===archive.id)?.materialUses).toEqual(old);


  });
  it('rejects mismatched sources, missing color, false developed origin and changes after an actual return',()=>{
    const {f,use,first}=caseWithSource();
    expect(()=>f.run({type:'development.material.add',payload:{...use,color:''}})).toThrow('须填写具体颜色');
    expect(()=>f.run({type:'development.material.add',payload:{...use,devId:'other'}})).toThrow('不属于本开发案');
    expect(()=>f.run({type:'development.material.add',payload:{...use,offerSupplierId:'other'}})).toThrow();
    expect(()=>f.run({type:'development.material.add',payload:use},{...f.ctx,can:p=>p!=='suppliers:read'})).toThrow('没有供应商报价读取权限');
    f.state.versions.find(v=>v.id===first)!.returnedAt=f.ctx.now;
    expect(()=>f.run({type:'development.material.add',payload:use})).toThrow('本版用料已冻结');
  });
});
