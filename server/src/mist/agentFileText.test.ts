import {expect,it} from 'vitest';
import {extractFileText,fileTextLimit,FILE_TEXT_DEFAULT} from './agentFileText';
const bytes=(text:string)=>new TextEncoder().encode(text);
/** Smallest valid one-page PDF whose content stream draws the given text. */
function pdf(text:string){
 const objects=['<</Type/Catalog/Pages 2 0 R>>','<</Type/Pages/Kids[3 0 R]/Count 1>>','<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',null,'<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
 const stream=`BT /F1 12 Tf 10 50 Td (${text}) Tj ET`;objects[3]=`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
 let out='%PDF-1.4\n';const offsets:number[]=[];objects.forEach((o,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});
 const xref=out.length;out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<</Size ${objects.length+1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
 return bytes(out);
}
it('extracts bounded plain text and marks truncation',async()=>{
 const r=await extractFileText({name:'notes.txt',mimeType:'text/plain'},bytes('line one\n\n\n\nline two '+'x'.repeat(500)),200);
 expect(r.kind).toBe('text');expect(r.text.length).toBe(200);expect(r.truncated).toBe(true);expect(r.text).toContain('line one\n\nline two');
 const small=await extractFileText({name:'a.csv',mimeType:'application/octet-stream'},bytes('a,b\n1,2'),FILE_TEXT_DEFAULT);
 expect(small).toMatchObject({kind:'text',text:'a,b\n1,2',truncated:false});
});
it('reads text from a PDF and reports page count',async()=>{
 const r=await extractFileText({name:'po.pdf',mimeType:'application/pdf'},pdf('Order PO-778 confirmed'),4000);
 expect(r.kind).toBe('pdf');expect(r.text).toContain('PO-778');expect(r.pages).toBe(1);expect(r.truncated).toBe(false);
});
it('says plainly when a file cannot be read instead of guessing',async()=>{
 expect(await extractFileText({name:'x.pdf',mimeType:'application/pdf'},bytes('not a pdf'),500)).toMatchObject({kind:'unreadable'});
 expect(await extractFileText({name:'x.pdf',mimeType:'application/pdf'},bytes('%PDF-1.4 garbage'),500)).toMatchObject({kind:'unreadable',text:''});
 expect(await extractFileText({name:'photo.png',mimeType:'image/png'},new Uint8Array([137,80,78,71]),500)).toMatchObject({kind:'unsupported',text:''});
 expect(await extractFileText({name:'sheet.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},new Uint8Array(10),500)).toMatchObject({kind:'unsupported'});
 expect(await extractFileText({name:'bin.txt',mimeType:'text/plain'},new Uint8Array(Array.from({length:200},()=>0xff)),500)).toMatchObject({kind:'unreadable'});
});
it('refuses oversized sources and validates the character limit',async()=>{
 expect(await extractFileText({name:'big.txt',mimeType:'text/plain'},new Uint8Array(21*1024*1024),500)).toMatchObject({kind:'unsupported'});
 expect(fileTextLimit(undefined)).toBe(FILE_TEXT_DEFAULT);
 for(const bad of [0,199,20001,1.5,'8000',null])expect(()=>fileTextLimit(bad)).toThrow(RangeError);
});
