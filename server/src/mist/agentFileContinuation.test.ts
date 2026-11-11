import {expect,it} from 'vitest';
import JSZip from 'jszip';
import {readFileTextWindow} from './agentFileWindow';
const scope={workspaceId:'w',fileId:'f'};
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
it('continues long Word and Excel attachments without dropping a long cell',async()=>{
 for(const ext of ['docx','xlsx']){
  const z=new JSZip(),body='质量要求 '.repeat(5000)+'最后条款 END-991';
  if(ext==='docx')z.file('word/document.xml','<w:document><w:body><w:p><w:r><w:t>'+body+'</w:t></w:r></w:p></w:body></w:document>');
  else{z.file('xl/workbook.xml','<workbook><sheets><sheet name="要求" r:id="r"/></sheets></workbook>');z.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r" Target="worksheets/sheet1.xml"/></Relationships>');z.file('xl/worksheets/sheet1.xml','<worksheet><row><c r="A1" t="inlineStr"><is><t>'+body+'</t></is></c></row></worksheet>');}
  const bytes=await z.generateAsync({type:'nodebuffer'});let cursor:unknown,joined='';
  do{const r=await readFileTextWindow(scope,{name:'requirements.'+ext,mimeType:''},bytes,8000,cursor);joined+=r.text;cursor=r.nextCursor;}while(cursor);
  expect(joined).toContain('最后条款 END-991');expect(joined.match(/END-991/g)).toHaveLength(1);
 }
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

it('does not call a mixed text/image PDF complete when a page has no extractable text',async()=>{
 const r=await readFileTextWindow(scope,{name:'mixed.pdf',mimeType:'application/pdf'},contractPdf(3,2),8000);
 expect(r).toMatchObject({hasMore:false,complete:false,pagesWithoutText:[2]});expect(r.reason).toContain('2');
});
