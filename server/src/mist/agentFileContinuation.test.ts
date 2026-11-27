import {expect,it,vi} from 'vitest';
import {PDFParse} from 'pdf-parse';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {readFileTextWindow,type FileTextWindowCache} from './agentFileWindow';
import {platformTrail} from './agentTaskTrail';
const scope={workspaceId:'w',fileId:'f'};
it('restricts workbook extraction and continuations to one exactly named visible worksheet',async()=>{
 const zip=new JSZip(), file={name:'quote.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
 zip.file('xl/workbook.xml','<workbook><sheets><sheet name="报价草案" r:id="r1"/><sheet name="确认报价" r:id="r2"/><sheet name="内部底表" state = "hidden" r:id="r3"/></sheets></workbook>');
 zip.file('xl/_rels/workbook.xml.rels','<Relationships>'+[1,2,3].map(num=>'<Relationship Id="r'+num+'" Target="worksheets/sheet'+num+'.xml"/>').join('')+'</Relationships>');
 const xml=(value:string)=>'<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>'+value+'</t></is></c></row></sheetData></worksheet>';
 zip.file('xl/worksheets/sheet1.xml',xml('DRAFT QUOTE'));
 zip.file('xl/worksheets/sheet2.xml',xml('CONFIRMED '.repeat(180)+' FINAL-CELL'));
 zip.file('xl/worksheets/sheet3.xml',xml('HIDDEN CONTENT'));
 const bytes=await zip.generateAsync({type:'nodebuffer'});
 const first=await readFileTextWindow(scope,file,bytes,500,undefined,undefined,undefined,'确认报价');
 expect(first).toMatchObject({kind:'xlsx',worksheetScope:'确认报价',sheets:['确认报价'],observedSheets:['确认报价'],hasMore:true});
 let position:unknown=first.nextCursor,last=first,joined=first.text;
 while(position){
  last=await readFileTextWindow(scope,file,bytes,500,position,undefined,undefined,'确认报价');joined+=last.text;position=last.nextCursor;
 }
 expect(last).toMatchObject({hasMore:false,complete:false,worksheetComplete:false,sourceHash:first.sourceHash});
 const whole=await readFileTextWindow(scope,file,bytes,8000,undefined,undefined,undefined,'确认报价');
 expect(whole).toMatchObject({hasMore:false,complete:false,worksheetComplete:true,truncated:false});
 expect(joined).toContain('FINAL-CELL');
 expect(joined).not.toMatch(/DRAFT QUOTE|HIDDEN CONTENT/);
 await expect(readFileTextWindow(scope,file,bytes,500,first.nextCursor,undefined,undefined,'报价草案')).rejects.toMatchObject({code:'FILE_TEXT_SOURCE_CHANGED'});
 for(const name of ['内部底表','不存在']){
  const unavailable=await readFileTextWindow(scope,file,bytes,500,undefined,undefined,undefined,name);
  expect(unavailable).toMatchObject({kind:'unreadable',text:'',hasMore:false});
  expect(JSON.stringify(unavailable)).not.toMatch(/DRAFT QUOTE|HIDDEN CONTENT/);
 }
});

it('returns consecutive stable text windows, never calling the final fragment a complete document',async()=>{
 const file={name:'contract.txt',mimeType:'text/plain'},bytes=Buffer.from('条款 ABC '.repeat(5000)+'尾部交期 2026-12-31');
 let cursor:unknown;let joined='',hash='';let calls=0;
 do{const r=await readFileTextWindow(scope,file,bytes,8000,cursor);expect(r.range.start).toBe(joined.length);expect(r.text.length).toBeLessThanOrEqual(8000);expect(r.complete).toBe(false);if(hash)expect(r.sourceHash).toBe(hash);hash=r.sourceHash;joined+=r.text;cursor=r.nextCursor;expect(++calls).toBeLessThan(10);}while(cursor);
 expect(joined).toBe(bytes.toString());expect(joined).toContain('尾部交期');
 const first=await readFileTextWindow(scope,file,bytes,8000);
 await expect(readFileTextWindow(scope,file,Buffer.from('new bytes'),8000,first.nextCursor)).rejects.toMatchObject({code:'FILE_TEXT_SOURCE_CHANGED',status:409});
 await expect(readFileTextWindow({...scope,fileId:'other'},file,bytes,8000,first.nextCursor)).rejects.toThrow('续读');
 await expect(readFileTextWindow(scope,file,bytes,8000,'invalid')).rejects.toThrow('续读');
});
it.each(['docx','xlsx','pptx'])('reuses Office extraction across long %s slices without dropping the tail',async ext=>{
 const z=new JSZip(),body='质量要求 '.repeat(5000)+'最后条款 END-991';
 if(ext==='docx'){
  z.file('word/document.xml','<w:document><w:body><w:p><w:r><w:t>'+body+'</w:t></w:r></w:p></w:body></w:document>');
 }else if(ext==='xlsx'){
  z.file('xl/workbook.xml','<workbook><sheets><sheet name="要求" r:id="r1"/></sheets></workbook>');
  z.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>');
  z.file('xl/worksheets/sheet1.xml','<worksheet><row><c r="A1" t="inlineStr"><is><t>'+body+'</t></is></c></row></worksheet>');
 }else{
  z.file('ppt/presentation.xml','<p:presentation><p:sldId r:id="r1"/></p:presentation>');
  z.file('ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/></Relationships>');
  z.file('ppt/slides/slide1.xml','<p:sld><a:p><a:r><a:t>'+body+'</a:t></a:r></a:p></p:sld>');
 }
 const bytes=await z.generateAsync({type:'nodebuffer'}),file={name:'requirements.'+ext,mimeType:''};
 const gather=async(cache?:FileTextWindowCache)=>{
  let cursor:unknown;
  const results=[];
  do{
   const part=await readFileTextWindow(scope,file,bytes,8000,cursor,cache);
   results.push(part);
   cursor=part.nextCursor;
  }while(cursor);
  return results;
 };
 const unzip=vi.spyOn(JSZip,'loadAsync');
 try{
  const original=await gather();
  expect(original.length).toBeGreaterThan(1);
  expect(unzip).toHaveBeenCalledTimes(original.length);
  const cache:FileTextWindowCache=new Map();
  const reused=await gather(cache);
  expect(unzip).toHaveBeenCalledTimes(original.length+1);
  expect(reused).toEqual(original);
  expect(reused.at(-1)?.text).toContain('最后条款 END-991');
  expect(cache.size).toBe(0);
  if(ext==='xlsx')expect(reused.every(part=>part.observedSheets?.includes('要求'))).toBe(true);
  if(ext==='pptx')expect(reused.every(part=>part.pages===1)).toBe(true);
 }finally{unzip.mockRestore();}
});

function contractPdf(count:number,blankPage=0){
 const font=3+count*2,objects=['<</Type/Catalog/Pages 2 0 R>>',`<</Type/Pages/Kids[${Array.from({length:count},(_,i)=>`${3+i*2} 0 R`).join(' ')}]/Count ${count}>>`];
 for(let i=1;i<=count;i++){const line=`Clause P${i}: ${i===count?'DELIVERY 2026-12-31 and FINAL TERM.':'General terms. '.repeat(20)}`;const stream=i===blankPage?'':`BT /F1 10 Tf 10 100 Td (${line}) Tj ET`;objects.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 1000 200]/Contents ${2+i*2} 0 R/Resources<</Font<</F1 ${font} 0 R>>>>>>`);objects.push(`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`);}
 objects.push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>');let out='%PDF-1.4\n';const offsets:number[]=[];for(const [i,o]of objects.entries()){offsets.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;}const xref=out.length;out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<</Size ${objects.length+1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(out);
}
it('continues within a PDF window and past page twenty to the final clause without duplicate text',async()=>{
 const bytes=contractPdf(27),file={name:'contract.pdf',mimeType:'application/pdf'};let cursor:unknown,joined='',lastPage=1,lastEnd=0,calls=0;
 do{const r=await readFileTextWindow(scope,file,bytes,1000,cursor);if(r.range.pageFrom===lastPage)expect(r.range.start).toBe(lastEnd);else{expect(r.range.pageFrom).toBe(21);expect(r.range.start).toBe(0);}lastPage=r.range.pageFrom!;lastEnd=r.range.end;expect(r.pages).toBe(27);joined+=r.text;cursor=r.nextCursor;expect(++calls).toBeLessThan(15);}while(cursor);
 for(let i=1;i<=27;i++)expect(joined.match(new RegExp(`Clause P${i}:`,'g'))).toHaveLength(1);
 expect(joined).toContain('FINAL TERM');
});
it('allows a changed response size without splitting surrogate pairs or skipping content',async()=>{
 const text='🧵'.repeat(160)+'END',bytes=Buffer.from(text),file={name:'unicode.txt',mimeType:'text/plain'};
 const a=await readFileTextWindow(scope,file,bytes,201),b=await readFileTextWindow(scope,file,bytes,300,a.nextCursor);
 expect(a.text.length).toBe(200);expect(a.text+b.text).toBe(text);expect(b.range.start).toBe(a.range.end);expect(b.hasMore).toBe(false);expect(b.complete).toBe(false);
});

it('never returns PDF text beyond a task prefix, including across character slices', async () => {
 const file={name:'contract.pdf',mimeType:'application/pdf'}, bytes=contractPdf(23,3);
 const first=await readFileTextWindow(scope,file,bytes,1000,undefined,undefined,{from:1,to:10});
 let position:unknown=first.nextCursor,last=first,body=first.text;
 while(position){
  last=await readFileTextWindow(scope,file,bytes,1000,position,undefined,{from:1,to:10});
  body+=last.text;position=last.nextCursor;
 }
 expect(first).toMatchObject({pages:23,pagesWithoutText:[3],pageScopeLimit:10,range:{pageFrom:1,pageTo:10}});
 expect(last).toMatchObject({hasMore:false,complete:false,range:{pageFrom:1,pageTo:10}});
 const [receipt]=platformTrail([{id:'prefix',at:'',plan:{name:'bambook_file_text',arguments:{fileId:scope.fileId}},result:last}]);
 expect(receipt.detail).toContain('本次未读第 11 至 23 页');
 expect(body).toContain('Clause P10:');
 expect(body).not.toContain('Clause P11:');
 expect(body).not.toContain('FINAL TERM');
 const forged='aft1.'+Buffer.from(JSON.stringify({...scope,v:1,source:first.sourceHash,page:21,offset:0})).toString('base64url');
 await expect(readFileTextWindow(scope,file,bytes,1000,forged,undefined,{from:1,to:10})).rejects.toMatchObject({code:'FILE_TEXT_PAGE_SCOPE'});
});

it('starts an explicitly bounded PDF at its selected page and rejects cursors before or after the range',async()=>{
 const file={name:'contract.pdf',mimeType:'application/pdf'}, bytes=contractPdf(23,3), selected={from:11,to:15};
 const read=await readFileTextWindow(scope,file,bytes,8000,undefined,undefined,selected);
 expect(read).toMatchObject({pageScopeStart:11,pageScopeLimit:15,pages:23,hasMore:false,complete:false,range:{pageFrom:11,pageTo:15}});
 expect(read.text).toContain('Clause P11:');
 expect(read.text).toContain('Clause P15:');
 expect(read.text).not.toMatch(/Clause P(?:10|16):/);
 const [receipt]=platformTrail([{id:'range',at:'',plan:{name:'bambook_file_text',arguments:{fileId:scope.fileId}},result:read}]);
 expect(receipt.detail).toBe('提取范围第 11 至 15 页；本次未读第 1 至 10 页；本次未读第 16 至 23 页');
 for(const page of [1,31]){
  const forged='aft1.'+Buffer.from(JSON.stringify({...scope,v:1,source:read.sourceHash,page,offset:0})).toString('base64url');
  await expect(readFileTextWindow(scope,file,bytes,1000,forged,undefined,selected)).rejects.toMatchObject({code:'FILE_TEXT_PAGE_SCOPE'});
 }
});

it('continues a selected PDF range from the selected starting page',async()=>{
 const file={name:'contract.pdf',mimeType:'application/pdf'}, bytes=contractPdf(39), selected={from:11,to:35};
 const first=await readFileTextWindow(scope,file,bytes,20_000,undefined,undefined,selected);
 expect(first).toMatchObject({hasMore:true,nextPageFrom:31,range:{pageFrom:11,pageTo:30}});
 const tail=await readFileTextWindow(scope,file,bytes,20_000,first.nextCursor,undefined,selected);
 expect(tail).toMatchObject({sourceHash:first.sourceHash,hasMore:false,complete:false,range:{pageFrom:31,pageTo:35}});
 expect(tail.text).toContain('Clause P35:');
 expect(tail.text).not.toContain('Clause P36:');
});

it('reports PDF page windows and partial text honestly in the same task trail', async () => {
 const bytes = contractPdf(23,22), file = {name:'contract.pdf',mimeType:'application/pdf'};
 const first = await readFileTextWindow(scope,file,bytes,8000);
 const tail = await readFileTextWindow(scope,file,bytes,8000,first.nextCursor);
 const limited = await readFileTextWindow(scope,file,bytes,1000);
 const continued = await readFileTextWindow(scope,file,bytes,8000,limited.nextCursor);
 const steps = [first,tail,limited,continued].map((result,index)=>({
  id:String(index),at:'2026-11-26T00:00:00Z',plan:{name:'bambook_file_text',arguments:{fileId:scope.fileId}},result,
 }));
 expect(limited.range.textLimited).toBe(true);
 expect(limited.nextPageFrom).toBeUndefined();
 expect(first.range.textLimited).toBeUndefined();
 expect(first.nextPageFrom).toBe(21);
 expect(continued.range.textLimited).toBeUndefined();
 expect(continued.nextPageFrom).toBe(21);
 expect(platformTrail(steps).map(step=>step.detail)).toEqual([
  '提取范围第 1 至 20 页；本次未读第 21 至 23 页',
  '提取范围第 21 至 23 页；第 22 页无可提取文字',
  '第 1 至 20 页的部分正文；本页段正文待续读',
  '第 1 至 20 页的部分正文；本次未读第 21 至 23 页',
 ]);
});

it('does not call a mixed text/image PDF complete when a page has no extractable text',async()=>{
 const r=await readFileTextWindow(scope,{name:'mixed.pdf',mimeType:'application/pdf'},contractPdf(3,2),8000);
 expect(r).toMatchObject({hasMore:false,complete:false,pagesWithoutText:[2]});expect(r.reason).toContain('2');
});

it('binds excerpts to their physical pages within each returned character slice',async()=>{
 const bytes=contractPdf(23,22),file={name:'paged.pdf',mimeType:'application/pdf'};
 const head=await readFileTextWindow(scope,file,bytes,1000);
 expect(head.pageTextSpans?.map(span=>span.page)).toEqual([1,2,3,4,5]);
 expect(head.pageTextSpans?.at(-1)?.end).toBe(head.text.length);
 const continued=await readFileTextWindow(scope,file,bytes,8000,head.nextCursor);
 expect(continued.pageTextSpans?.[0]).toMatchObject({page:5,start:0});
 const tail=await readFileTextWindow(scope,file,bytes,8000,continued.nextCursor);
 expect(tail.pageTextSpans?.map(span=>[span.page,tail.text.slice(span.start,span.end)])).toEqual([
  [21,expect.stringContaining('Clause P21:')],
  [23,expect.stringContaining('FINAL TERM')],
 ]);
 expect(tail.pagesWithoutText).toEqual([22]);
 expect(tail.sourceHash).toBe(head.sourceHash);
 const fileRef={id:scope.fileId,name:file.name};
 const trail=platformTrail([head,continued,tail].map((result,index)=>({
  id:String(index),at:'2026-11-26T00:00:00Z',
  plan:{name:'bambook_file_text',arguments:{fileId:fileRef.id}},
  result:{...result,file:fileRef},
 })),[fileRef]);
 expect(trail[0].taskAttachmentObservedPages).toEqual([1,2,3,4,5]);
 expect(trail[1].taskAttachmentPage).toBe(5);
 expect(trail[2].taskAttachmentObservedPages).toEqual([21,22,23]);
});

it('reports only workbook tabs represented in the current slice, excluding hidden tabs',async()=>{
 const zip=new JSZip();
 zip.file('xl/workbook.xml','<workbook><sheets><sheet name="报价草案" r:id="r1"/><sheet name="核对结果" r:id="r2"/><sheet name="内部底表" state="hidden" r:id="r3"/></sheets></workbook>');
 zip.file('xl/_rels/workbook.xml.rels','<Relationships>'+[1,2,3].map(num=>'<Relationship Id="r'+num+'" Target="worksheets/sheet'+num+'.xml"/>').join('')+'</Relationships>');
 for(const [index,value] of ['draft-'.repeat(90),'QUOTE-FINAL-USD','PRIVATE-HIDDEN-TAB'].entries()){
  zip.file('xl/worksheets/sheet'+(index+1)+'.xml','<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>'+value+'</t></is></c></row></sheetData></worksheet>');
 }
 const bytes=await zip.generateAsync({type:'nodebuffer'});
 const file={name:'quote.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
 const first=await readFileTextWindow(scope,file,bytes,200);
 const last=await readFileTextWindow(scope,file,bytes,1000,first.nextCursor);
 expect(first.sheets).toEqual(['报价草案','核对结果']);
 expect(first.observedSheets).toEqual(['报价草案']);
 expect(last.observedSheets).toEqual(['报价草案','核对结果']);
 expect(last.text).toContain('QUOTE-FINAL-USD');
 expect(first.text+last.text).not.toContain('PRIVATE-HIDDEN-TAB');
 const fileRef={id:scope.fileId,name:file.name};
 const trail=platformTrail([{id:'xlsx',at:'',plan:{name:'bambook_file_text',arguments:{fileId:fileRef.id}},result:{...first,file:fileRef}}],[fileRef]);
 expect(trail[0].taskAttachmentObservedSheets).toEqual(['报价草案']);
});

it('reuses one parsed PDF window for consecutive slices while keeping byte and page checks',async()=>{
 const file={name:'dense.pdf',mimeType:'application/pdf'},bytes=contractPdf(23,22);
 const cache:FileTextWindowCache=new Map();
 const parse=vi.spyOn(PDFParse.prototype,'getText');
 try {
  const first=await readFileTextWindow(scope,file,bytes,1000,undefined,cache);
  expect(parse).toHaveBeenCalledTimes(1);
  await expect(readFileTextWindow(scope,file,contractPdf(23,21),8000,first.nextCursor,cache))
   .rejects.toMatchObject({code:'FILE_TEXT_SOURCE_CHANGED'});
  await expect(readFileTextWindow({...scope,fileId:'other'},file,bytes,8000,first.nextCursor,cache)).rejects.toThrow('续读');
  const otherScope={...scope,fileId:'other'};
  const other=await readFileTextWindow(otherScope,file,bytes,1000,undefined,cache);
  expect(parse).toHaveBeenCalledTimes(2);
  const middle=await readFileTextWindow(scope,file,bytes,8000,first.nextCursor,cache);
  expect(parse).toHaveBeenCalledTimes(2);
  expect(middle.nextPageFrom).toBe(21);
  expect(middle).toEqual(await readFileTextWindow(scope,file,bytes,8000,first.nextCursor));
  const tail=await readFileTextWindow(scope,file,bytes,8000,middle.nextCursor,cache);
  expect(parse).toHaveBeenCalledTimes(4);
  expect(tail.pagesWithoutText).toEqual([22]);
  expect(tail.text).toContain('FINAL TERM');
  expect(cache.size).toBe(1);
  expect((await readFileTextWindow(otherScope,file,bytes,8000,other.nextCursor,cache)).nextPageFrom).toBe(21);
  expect(parse).toHaveBeenCalledTimes(4);
  expect(cache.size).toBe(0);
 }finally{parse.mockRestore();}
});

it.each([true,false])('handles old Excel cursors safely when the corrected value form is present: %s',async changed=>{
 const zip=new JSZip();
 zip.file('xl/workbook.xml','<workbook><sheets><sheet name="报价" r:id="r1"/></sheets></workbook>');
 zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>');
 zip.file('xl/worksheets/sheet1.xml','<worksheet><row><c r="A1" t="str"><v'+(changed?' xml:space="preserve"':'')+'> QUOTE-SPACE-155 </v></c></row>'
  +'<row><c r="A2" t="str"><v>'+('Long terms. '.repeat(40))+'EXCEL-FINAL-399</v></c></row></worksheet>');
 const bytes=await zip.generateAsync({type:'nodebuffer'}),file={name:'quote.xlsx',mimeType:''};
 const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
 const legacySource=hash(JSON.stringify(['file-text-v1',hash(bytes),file.name,file.mimeType]));
 const legacy='aft1.'+Buffer.from(JSON.stringify({...scope,v:1,source:legacySource,page:1,offset:200})).toString('base64url');
 const first=await readFileTextWindow(scope,file,bytes,200);
 expect(first.text).toContain('QUOTE-SPACE-155');
 expect(first.observedSheets).toEqual(['报价']);
 expect(first.nextCursor).toMatch(changed?/^aft2\./:/^aft1\./);
 if(changed){
  await expect(readFileTextWindow(scope,file,bytes,1000,legacy)).rejects.toMatchObject({code:'FILE_TEXT_CURSOR_UPDATED',status:409});
  expect(first.sourceHash).not.toBe(legacySource);
 }else{
  expect(first.sourceHash).toBe(legacySource);
  expect((await readFileTextWindow(scope,file,bytes,1000,legacy)).text).toContain('EXCEL-FINAL-399');
 }
 const tail=await readFileTextWindow(scope,file,bytes,1000,first.nextCursor);
 expect(tail.sourceHash).toBe(first.sourceHash);
 expect(tail.text).toContain('EXCEL-FINAL-399');
 expect(tail.range.start).toBe(first.range.end);
});
