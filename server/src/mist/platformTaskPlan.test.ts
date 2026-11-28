import{expect,it}from'vitest';
import{compactPlatformTaskSteps,newPlatformTaskStep,parsePlatformTaskPlan,platformTaskHistory,resolvePlatformFileContinuation,requestedTaskAttachmentScope,requestsProvidedMaterialsOnly,shortPdfContinuationPlan,shortOfficeTailPlan}from'./platformTaskPlan';
import{platformReasoning}from'../ai/platformModel';
import {composeTaskInstructions} from '../shared/mistTaskHistoryText';

it('recognizes a supplied-material limit only from a current direct instruction',()=>{
 for(const request of [
  '请交办一次只读核对。只用我提供的模拟数据。请报告十二月十日。',
  '请交办一次，只读核对之。用我提供的模拟数据，模拟订单的约定交期是 12 月 10 日，请报告这个日期。',
  '请核对交期，只用我提供的模拟数据。',
  '只用我提供的数据（不要查系统）。',
  '请仅依据本轮提供的附件。',
  'Please use only the facts I provided.',
 ])expect(requestsProvidedMaterialsOnly(request)).toBe(true);
 for(const request of [
  '只读核对原交期。',
  '请只读核对。用我提供的订单号回源查询。',
  '客户写道：“先做核对。只用我提供的数据。” 请核对这句话。',
  '如果只用我提供的数据不能确认，请核对系统。',
  composeTaskInstructions([{state:'succeeded',instructions:'只用我提供的数据。',result:'上轮报告'}],'本轮请回读原订单。'),
 ])expect(requestsProvidedMaterialsOnly(request)).toBe(false);
});

function requestedPdfRange(files:Parameters<typeof requestedTaskAttachmentScope>[0], text:string) {
 const {pdfRanges,pdfChoice,pdfScopeConflict}=requestedTaskAttachmentScope(files,text);
 if(pdfChoice||pdfScopeConflict||pdfRanges.size!==1)return;
 const [[fileId,range]]=[...pdfRanges];
 return {fileId,...range};
}

const mixedFiles=[
  {id:'pdf1',name:'quote.pdf',mimeType:'application/pdf',size:1},
  {id:'pdf2',name:'quote.pdf',mimeType:'application/pdf',size:1},
  {id:'xlsx',name:'compare.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:1},
  {id:'photo',name:'label.png',mimeType:'image/png',size:1},
];

it.each([
  ['请只读取 quote.pdf（2）的前 3 页，其他文件不要读取。',['pdf2']],
  ['只读取 label.png，不要读剩余附件。',['photo']],
  ['Please read only label.png. Do not open any other files.',['photo']],
  ['读取 label.png 不要读取其他附件 compare.xlsx。',['photo']],
  ['请查看 label.png。勿读取任何附件。',[]],
  ['请只读 quote.pdf，不要读取其他文件。',[]],
])('selects known attachments only for an explicit exclusive request (%s)',(request,expected)=>{
  const scope=requestedTaskAttachmentScope(mixedFiles,request);
  expect([...scope.allowedFiles!]).toEqual(expected);
  if(expected[0]==='pdf2')expect(scope.pdfRanges.get('pdf2')).toEqual({from:1,to:3});
});

it('keeps mixed-source reading and ignores exclusion text in prior conversation context',()=>{
  const request=composeTaskInstructions([{state:'succeeded',instructions:'不要读取其他附件。',result:'已核对。'}],
    '请只读取 compare.xlsx 的「确认报价」工作表。也核对标签。');
  const scope=requestedTaskAttachmentScope(mixedFiles,request);
  expect(scope.allowedFiles).toBeUndefined();
  expect(scope.worksheet).toMatchObject({fileId:'xlsx',worksheet:'确认报价'});
});

it('narrows a multi-file visual choice without altering a separately requested text-only PDF',()=>{
 const files=['alpha','beta','note'].map(id=>({id,name:id+'.pdf',mimeType:'application/pdf',size:1}));
 const request='请目视核对 alpha.pdf 第 1 至 3 页。请目视核对 beta.pdf 第 2 至 3 页。请只读取 note.pdf 第 1 页的文字。';
 const question=requestedTaskAttachmentScope(files,request).pdfVisualChoice;
 expect(question).toContain('每个文件一行');
 const response=(answer:string)=>requestedTaskAttachmentScope(files,request,[{id:'q',question:question!,answer,askedAt:'',answeredAt:'now'}]);
 expect(response('note.pdf 第 1 页').pdfVisualChoice).toBe(question);
 const selected=response('beta.pdf 第 2 页');
 expect(selected.pdfVisualChoice).toBeUndefined();
 expect([...selected.pdfVisualRanges]).toEqual([['beta',{from:2,to:2}]]);
 expect([...selected.pdfRanges]).toEqual([['beta',{from:2,to:2}],['note',{from:1,to:1}]]);
 expect([...selected.excludedPdfIds!]).toEqual(['alpha']);
});

it('binds shorthand worksheet rows and rejects invalid row ranges rather than widening them',()=>{
 const files=[{id:'quote',name:'quote.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:1}];
 const scope=(suffix:string)=>requestedTaskAttachmentScope(files,'请只读取 quote.xlsx 的工作表「报价」'+suffix+'。').worksheet;
 expect(scope('第 23、47 行')).toMatchObject({fileId:'quote',rows:[{from:23,to:23},{from:47,to:47}],rowScopeConflict:false});
 expect(scope('第 47 至 23 行')?.rowScopeConflict).toBe(true);
 expect(scope('第 0 行')?.rowScopeConflict).toBe(true);
});

it('accepts only a bound business tool decision, without thoughts, owner impersonation or model request IDs',()=>{
  expect(parsePlatformTaskPlan('{"name":"bambook_query","arguments":{"type":"email"}}')).toEqual({name:'bambook_query',arguments:{type:'email'}});
  expect(()=>parsePlatformTaskPlan('{"name":"bambook_workspaces","arguments":{}}')).toThrow();
  expect(()=>parsePlatformTaskPlan('{"name":"bambook_get","arguments":{"workspaceId":"other"}}')).toThrow('MODEL_PLAN_SCOPE');
  expect(()=>parsePlatformTaskPlan('{"name":"bambook_task","arguments":{"action":"resume"}}')).toThrow();
  expect(()=>parsePlatformTaskPlan('{"name":"bambook_query","arguments":{},"reasoning":"private"}')).toThrow();
  const plan=parsePlatformTaskPlan('{"name":"bambook_execute","arguments":{"requestId":"model-id","command":{"type":"email.flag","payload":{}}}}'),step=newPlatformTaskStep(plan,0);
  expect(step.plan.arguments.requestId).toBe(step.id);expect(step.plan.arguments.requestId).not.toBe('model-id');
  expect(parsePlatformTaskPlan('{"name":"bambook_audit","arguments":{"requestId":"mcp-original-receipt"}}').arguments.requestId).toBe('mcp-original-receipt');
});

it('discards a model envelope request ID only when the server assigns the operation ID',()=>{
 const execute={name:'bambook_execute',arguments:{requestId:'from-arguments',command:{type:'order.governance.saveDraft',payload:{}}},requestId:'from-envelope'};
 const plan=parsePlatformTaskPlan(JSON.stringify(execute));
 expect(plan).toEqual({name:execute.name,arguments:{command:execute.arguments.command}});
 const step=newPlatformTaskStep(plan,0);
 expect(step.plan.arguments.requestId).toBe(step.id);
 const finish={name:'bambook_task',arguments:{action:'finish',outcome:'succeeded',result:'已核对'},requestId:'from-model'};
 expect(parsePlatformTaskPlan(JSON.stringify(finish))).toEqual({name:finish.name,arguments:finish.arguments});
 for(const wrong of [
  {...execute,requestId:{value:'from-model'}},
  {...execute,reasoning:'private'},
  {...execute,workspaceId:'outside'},
  {...execute,name:'bambook_get'},
  {...finish,arguments:{action:'status'}},
  {...execute,name:'bambook_audit'},
 ])expect(()=>parsePlatformTaskPlan(JSON.stringify(wrong))).toThrow('MODEL_PLAN_INVALID');
 expect(()=>parsePlatformTaskPlan(JSON.stringify({...execute,arguments:{...execute.arguments,workspaceId:'outside'}}))).toThrow('MODEL_PLAN_SCOPE');
});

it('labels omitted results while retaining stable operation references for recovery',()=>{
  const plan={name:'bambook_query',arguments:{type:'email'}},old={...newPlatformTaskStep(plan,0),result:{body:'x'.repeat(150_000)}},latest={...newPlatformTaskStep(plan,1),result:{revision:3,body:'y'.repeat(150_000),results:[{id:'mail'}]}};
  const history=platformTaskHistory([old,latest]);expect(history.omitted).toBe(1);expect(history.recent).toHaveLength(1);expect(history.operations.map(x=>x.operationId)).toEqual([old.id,latest.id]);
});
it('rejects a concatenated future read and completion instead of treating proposed operations as executed facts',()=>{
 const status=JSON.stringify({name:'bambook_task',arguments:{action:'status'}}),read=JSON.stringify({name:'bambook_get',arguments:{type:'email',id:'original-mail'}}),finish=JSON.stringify({name:'bambook_task',arguments:{action:'finish',outcome:'succeeded',result:'Already reread and verified.'}});
 expect(()=>parsePlatformTaskPlan(status+read+finish)).toThrow('MODEL_PLAN_INVALID');
 expect(()=>parsePlatformTaskPlan(read+'\nAlready verified the original record.')).toThrow('MODEL_PLAN_INVALID');
 expect(parsePlatformTaskPlan(JSON.stringify({name:'bambook_task',arguments:{action:'wait',delaySeconds:60,summary:'Read the original record after the scheduled time.'}})).arguments.action).toBe('wait');
});
it('bounds completed history without altering an unacknowledged write or losing operation references',()=>{
 const plan={name:'bambook_execute',arguments:{command:{type:'email.draft.save',payload:{body:'a'.repeat(20_000)}}}},completed=Array.from({length:8},(_,i)=>({...newPlatformTaskStep(plan,i),result:{receipt:{requestId:'mcp-'+i,result:{id:'draft-'+i}},body:'b'.repeat(140_000)}})),pending=newPlatformTaskStep(plan,9),steps=compactPlatformTaskSteps([...completed,pending]);
 expect(JSON.stringify(steps).length).toBeLessThanOrEqual(600_000);expect(steps.at(-1)).toEqual(pending);expect(steps.map(s=>s.id)).toEqual([...completed,pending].map(s=>s.id));expect(steps.slice(0,-1).every(s=>s.result!==undefined)).toBe(true);expect(steps.some(s=>s.compacted)).toBe(true);
});
it('uses a dedicated platform task reasoning profile while retaining the existing override mechanism',()=>{
 expect(platformReasoning('agent-task',{})).toBe('high');expect(platformReasoning('agent-task',{BAMBOOK_PLATFORM_REASONING_AGENT_TASK:'medium'})).toBe('medium');
});


it('normalizes a question progress string from arguments into the public update',()=>{
  const question={action:'question',question:'请补充约定交期。'};
  const payload={name:'bambook_task',arguments:{...question,progress:'读取报价后\n需要核对交期。',requestId:'ignored'}};
  expect(parsePlatformTaskPlan(JSON.stringify(payload))).toEqual({name:'bambook_task',arguments:question,progress:'读取报价后 需要核对交期。'});
  expect(parsePlatformTaskPlan(JSON.stringify({...payload,progress:'请核对交期。'}))).toEqual({name:'bambook_task',arguments:question,progress:'请核对交期。'});
  expect(parsePlatformTaskPlan(JSON.stringify({...payload,progress:'Bearer abcdef1234567890'}))).toEqual({name:'bambook_task',arguments:question});
  expect(parsePlatformTaskPlan(JSON.stringify({...payload,arguments:{...question,progress:'bmt1_abc123'}}))).toEqual({name:'bambook_task',arguments:question});
});

it('leaves unexpected tool arguments in place for strict validation',()=>{
  const question={action:'question',question:'请补充约定交期。',progress:{unexpected:true},unknown:'must not be stripped'};
  expect(parsePlatformTaskPlan(JSON.stringify({name:'bambook_task',arguments:question}))).toEqual({name:'bambook_task',arguments:question});
  const finish={action:'finish',outcome:'succeeded',result:'已核对。',progress:'更新'};
  expect(parsePlatformTaskPlan(JSON.stringify({name:'bambook_task',arguments:finish}))).toEqual({name:'bambook_task',arguments:finish});
});

it('accepts a bounded public progress update without forwarding it to the tool',()=>{
  const plan=parsePlatformTaskPlan(JSON.stringify({name:'bambook_get',arguments:{type:'order',id:'so-demo'},progress:'先核对订单中的交期，再与附件对照。'}));
  expect(plan.progress).toBe('先核对订单中的交期，再与附件对照。');
  expect(plan.arguments).toEqual({type:'order',id:'so-demo'});
  expect(parsePlatformTaskPlan(JSON.stringify({...plan,progress:'Bearer abcdef1234567890'}))).not.toHaveProperty('progress');
  expect(parsePlatformTaskPlan(JSON.stringify({...plan,progress:'字'.repeat(300)})).progress).toHaveLength(240);
});


it('sends identical read bodies once while keeping each operation and changed revisions distinct',()=>{
  const plan={name:'bambook_get',arguments:{type:'order',id:'so'}};
  const result={revision:63,object:{data:{id:'so',text:'条款'.repeat(2000)}}};
  const first={...newPlatformTaskStep(plan,1000),result};
  const repeated={...newPlatformTaskStep(plan,2000),result:structuredClone(result)};
  const changed={...newPlatformTaskStep(plan,3000),result:{...result,revision:64}};
  const history=platformTaskHistory([first,repeated,changed]);
  expect(history.recent.map(step=>step.operationId)).toEqual([first.id,repeated.id,changed.id]);
  expect(history.recent[0].result).toMatchObject({duplicateOf:repeated.id});
  expect(history.recent[1].result).toEqual(result);
  expect(history.recent[2].result).toEqual({...result,revision:64});
  expect(first.result).toEqual(result);
});


it('uses the last verified continuation for the same file and only exposes a short cursor to the model',()=>{
 const read=(fileId:string)=>({name:'bambook_file_text',arguments:{fileId}});
 const next=(fileId:string)=>({name:'bambook_file_text',arguments:{fileId,cursor:'next',maxChars:7000}});
 const first={...newPlatformTaskStep(read('first'),1),result:{hasMore:true,nextCursor:'aft1.original-first',sourceHash:'source-one'}};
 const other={...newPlatformTaskStep(read('other'),2),result:{hasMore:true,nextCursor:'aft1.original-other'}};
 const failed={...newPlatformTaskStep(next('first'),3),result:{error:true}};
 const history=platformTaskHistory([first,other,failed]);
 expect(history.recent[0].result).toMatchObject({nextCursor:'next',sourceHash:'source-one'});
 expect(JSON.stringify(history)).not.toContain('aft1.original');
 expect(first.result.nextCursor).toBe('aft1.original-first');
 expect(resolvePlatformFileContinuation(next('first'),[first,other,failed]).arguments).toEqual({fileId:'first',cursor:'aft1.original-first',maxChars:7000});
 expect(resolvePlatformFileContinuation(next('missing'),[first,other])).toEqual(next('missing'));
 const done={...newPlatformTaskStep(next('first'),4),result:{hasMore:false}};
 expect(resolvePlatformFileContinuation(next('first'),[first,other,done])).toEqual(next('first'));
});

it('uses only an explicit, unambiguous prefix in the original task request',()=>{
 const file={id:'pdf',name:'sample.pdf',mimeType:'application/pdf',size:1200};
 expect(requestedPdfRange([file],'请只读取 sample.pdf 前 10 页。')).toEqual({fileId:'pdf',from:1,to:10});
 expect(requestedPdfRange([file],'本次仅核对第 1 至 5 页。')).toEqual({fileId:'pdf',from:1,to:5});
 expect(requestedPdfRange([file],'Please read only the first 12 pages.')).toEqual({fileId:'pdf',from:1,to:12});
 expect(requestedPdfRange([file],'请只看前 10 页。')).toEqual({fileId:'pdf',from:1,to:10});
 expect(requestedPdfRange([file],'请只读取第 11 至第 15 页。')).toEqual({fileId:'pdf',from:11,to:15});
 expect(requestedPdfRange([file],'Read only pages 11–15.')).toEqual({fileId:'pdf',from:11,to:15});
 expect(requestedPdfRange([file],'请只读取第 15 至第 11 页。')).toBeUndefined();
 expect(requestedPdfRange([file],'如果只读取前 10 页没找到条款，请继续。')).toBeUndefined();
 expect(requestedPdfRange([file],'只读前 10 页。请只读前 5 页。')).toEqual({fileId:'pdf',from:1,to:10});
 expect(requestedPdfRange([file,{...file,id:'other',name:'other.pdf'}],'请只读前 10 页。')).toBeUndefined();
});

it('recognizes a single explicitly requested PDF page without interpreting a wider request as one page',()=>{
 const file={id:'pdf',name:'sample.pdf',mimeType:'application/pdf',size:1200};
 for(const request of ['请只读取 sample.pdf 的第 22 页。','仅核对第 22 页的交期。','Read only page 22 of sample.pdf.','Please only review the 22nd page of sample.pdf.']){
  expect(requestedPdfRange([file],request)).toEqual({fileId:'pdf',from:22,to:22});
 }
 for(const request of ['只读第 22 页之后的内容。','请只读取第 22 页以外的正文。']){
  expect(requestedPdfRange([file],request)).toBeUndefined();
 }
 const exclusive=requestedTaskAttachmentScope(mixedFiles,'请只读取 quote.pdf（2）的第 22 页，其他附件不要读。');
 expect(exclusive.pdfRanges.get('pdf2')).toEqual({from:22,to:22});
 expect([...exclusive.allowedFiles!]).toEqual(['pdf2']);
});

it('limits a PDF visual read requested after the user adds the missing originals',()=>{
 const file={id:'scan',name:'scan.pdf',mimeType:'application/pdf',size:1200};
 const prompt='三份原件还没上传，请先在原任务问我要附件。收到后请目视核对 scan.pdf 第 3 页。';
 expect(requestedTaskAttachmentScope([],prompt).pdfRanges.size).toBe(0);
 const {pdfRanges,pdfVisualRanges}=requestedTaskAttachmentScope([file],prompt);
 expect(pdfRanges.get(file.id)).toEqual({from:3,to:3});
 expect(pdfVisualRanges.get(file.id)).toEqual({from:3,to:3});
  const sheet={id:'sheet',name:'quote.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:1200};
  const worksheet=requestedTaskAttachmentScope([sheet],'收到附件后，请只读取 quote.xlsx 的工作表「报价」第 23 行。').worksheet;
  expect(worksheet).toMatchObject({fileId:'sheet',worksheet:'报价',rows:[{from:23,to:23}]});
});

it('uses the page restriction in the answer that supplied the PDF and only narrows the original request',()=>{
 const file={id:'scan',name:'scan.pdf',mimeType:'application/pdf',size:1200};
 const answered={id:'q',question:'请补交扫描原件。',askedAt:'',answeredAt:'2026-11-28T00:01:00Z',
  answer:'请目视核对 scan.pdf 第 3 页。',attachmentIds:[file.id]};
 const fresh=requestedTaskAttachmentScope([file],'请先问我补交原件。',[answered]);
 expect(fresh.pdfRanges.get(file.id)).toEqual({from:3,to:3});
 expect(fresh.pdfVisualRanges.get(file.id)).toEqual({from:3,to:3});
 const narrowed=requestedTaskAttachmentScope([file],'请只读 scan.pdf 第 2 至第 4 页。',[answered]);
 expect(narrowed.pdfRanges.get(file.id)).toEqual({from:3,to:3});
 const wider={...answered,answer:'请只读 scan.pdf 第 1 至第 5 页。'};
 expect(requestedTaskAttachmentScope([file],'请只读 scan.pdf 第 2 至第 4 页。',[wider]).pdfRanges.get(file.id))
  .toEqual({from:2,to:4});
 expect(requestedTaskAttachmentScope([file],'请只读 scan.pdf 第 2 页。',[answered]).pdfScopeConflict).toBe(true);
 expect(requestedTaskAttachmentScope([file],'请先问我补交原件。',[{...answered,attachmentIds:['other']}]).pdfRanges.size).toBe(0);
});

it('does not reopen a file excluded by the original request when it is later supplied with an answer',()=>{
 const scan={id:'scan',name:'scan.pdf',mimeType:'application/pdf',size:1200},extra={...scan,id:'extra',name:'extra.pdf'};
 const answered={id:'q',question:'请补交原件。',askedAt:'',answeredAt:'2026-11-28T00:01:00Z',attachmentIds:[extra.id],
  answer:'请只读取 extra.pdf 第 3 页。'};
 const scope=requestedTaskAttachmentScope([scan,extra],'请只读取 scan.pdf 第 2 页。不要读取其他附件。',[answered]);
 expect([...scope.allowedFiles!]).toEqual(['scan']);
});

it('intersects an Excel row scope from the answer with the original scope',()=>{
 const file={id:'sheet',name:'quote.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:1200};
 const answered={id:'q',question:'请补交表格。',askedAt:'',answeredAt:'2026-11-28T00:01:00Z',attachmentIds:[file.id],
  answer:'请只读取 quote.xlsx 的工作表「报价」第 45 至第 47 行。'};
 expect(requestedTaskAttachmentScope([file],'请只读取 quote.xlsx 的工作表「报价」第 23 至第 46 行。',[answered]).worksheet)
  .toMatchObject({fileId:file.id,worksheet:'报价',rows:[{from:45,to:46}]});
});
it('binds a PDF page limit to an exact name or numbered original in its own clause',()=>{
 const named={id:'terms',name:'terms.pdf',mimeType:'application/pdf',size:1};
 const files=[...mixedFiles,named];
 expect(requestedPdfRange(files,'请只读取 terms.pdf 第 2 至 4 页。')).toEqual({fileId:'terms',from:2,to:4});
 expect(requestedPdfRange(files,'请只读取 quote.pdf（2）的第 22 页。')).toEqual({fileId:'pdf2',from:22,to:22});
 expect(requestedPdfRange(files,'Read only page 22 of quote.pdf(2).')).toEqual({fileId:'pdf2',from:22,to:22});
 expect(requestedPdfRange(files,'先比较 terms.pdf。请只读取 quote.pdf（2）的第 22 页。')).toEqual({fileId:'pdf2',from:22,to:22});
 expect(requestedPdfRange(files,'请只读取 quote.pdf 的第 22 页。')).toBeUndefined();
 expect(requestedPdfRange(files,'请只读取第 22 页。之后看 terms.pdf。')).toBeUndefined();
 const scoped=requestedTaskAttachmentScope(files,'请只读取 quote.pdf（2）的第 22 页。也核对 terms.pdf。');
 expect(scoped.excludedPdfIds).toEqual(new Set(['pdf1']));
 expect(requestedTaskAttachmentScope(files,'请只读取 quote.pdf（2）的第 22 页。也核对 quote.pdf（1）。').excludedPdfIds).toBeUndefined();
});

it('keeps different page limits per original and gives each unresolved range its own question',()=>{
 const terms={id:'terms',name:'terms.pdf',mimeType:'application/pdf',size:1};
 const selected=requestedTaskAttachmentScope([...mixedFiles,terms],'请只读 quote.pdf（2）第 22 页，且核对其他来源。请只读 terms.pdf 第 2 至 4 页。');
 expect([...selected.pdfRanges]).toEqual([['pdf2',{from:22,to:22}],['terms',{from:2,to:4}]]);
 const doc={id:'word',name:'sample.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:1};
 expect(requestedTaskAttachmentScope([...mixedFiles,doc],'请只读取 sample.docx 第 2 页。').pdfChoice).toBeUndefined();
 const conflict=requestedTaskAttachmentScope([terms],'只读 terms.pdf 第 3 至 1 页。');
 expect(conflict.pdfScopeConflict).toBe(true);
 const files=[...mixedFiles,terms,{...terms,id:'terms2'}];
 const text='请只读取 quote.pdf 第 22 页。请只读取 terms.pdf 第 2 至 4 页。';
 const pending=requestedTaskAttachmentScope(files,text).pdfChoice!;
 expect(pending.ids).toEqual(['pdf1','pdf2']);
 const first={id:'q1',question:pending.question,askedAt:'2026-11-27',answeredAt:'2026-11-27',answer:'quote.pdf（2）'};
 const next=requestedTaskAttachmentScope(files,text,[first]).pdfChoice!;
 expect(next.ids).toEqual(['terms','terms2']);
 expect(next.question).not.toBe(first.question);
 const second={...first,id:'q2',question:next.question,answer:'terms.pdf（5）'};
 expect([...requestedTaskAttachmentScope(files,text,[first,second]).pdfRanges])
  .toEqual([['pdf2',{from:22,to:22}],['terms',{from:2,to:4}]]);
});

it('retains disjoint pages in a single original across natural page lists and repeated clauses',()=>{
 const file={id:'pdf',name:'terms.pdf',mimeType:'application/pdf',size:1};
 const requests=[
  '请只读取 terms.pdf 第 22 页和第 24 页。',
  '仅核对 terms.pdf 第22、24页。',
  '请只读 terms.pdf 第24页。请只读 terms.pdf 第22页。',
  'Read only pages 22 and 24 of terms.pdf.',
 ];
 for(const text of requests){
  expect(requestedTaskAttachmentScope([file],text).pdfRanges.get(file.id)).toEqual({
   from:22,to:24,windows:[{from:22,to:22},{from:24,to:24}],
  });
 }
 expect(requestedTaskAttachmentScope([file],'只读 terms.pdf 第 2 至 4 页和第 8 页。').pdfRanges.get(file.id))
  .toEqual({from:2,to:8,windows:[{from:2,to:4},{from:8,to:8}]});
 expect(requestedTaskAttachmentScope([file],'Read only pages 22, 24–25, and 27 of terms.pdf.').pdfRanges.get(file.id))
  .toMatchObject({windows:[{from:22,to:22},{from:24,to:25},{from:27,to:27}]});
 expect(requestedTaskAttachmentScope([file],'只读 terms.pdf 第 2 页或第 4 页。').pdfScopeConflict).toBe(true);
});

it('limits automatic PDF continuation to one short page window without a prior continuation attempt', () => {
 const file={id:'pdf',name:'sample.pdf',mimeType:'application/pdf',size:1500};
 const plan={name:'bambook_file_text',arguments:{fileId:file.id}};
 const result={kind:'pdf',file:{id:file.id},sourceHash:'a'.repeat(64),pages:24,range:{start:0,end:3500,pageFrom:1,pageTo:20},hasMore:true,nextPageFrom:21,nextCursor:'aft1.original'};
 const first={...newPlatformTaskStep(plan,0),result};
 expect(shortPdfContinuationPlan([file],[first])?.arguments).toEqual({fileId:file.id,cursor:'aft1.original',maxChars:3500});
 expect(shortPdfContinuationPlan([file],[{...first,result:{...result,pages:25}}])).toBeUndefined();
 const longer={...first,result:{...result,pages:26}};
 expect(shortPdfContinuationPlan([file],[longer],'请核对 sample.pdf 末页。')?.arguments.cursor).toBe('aft1.original');
 for(const request of [
  '不要核对 sample.pdf 末页。',
  '先核对 sample.pdf 前 20 页，尾段留待下一轮。',
  'sample.pdf 的最后一页暂不查看。',
  'Please check the PDF, but do not read the last page yet.',
 ]){
  expect(shortPdfContinuationPlan([file],[first],request)).toBeUndefined();
  expect(shortPdfContinuationPlan([file],[longer],request)).toBeUndefined();
 }
 expect(shortPdfContinuationPlan([file],[longer],'请核对 sample.pdf 末页，不要换算金额。')?.arguments.cursor).toBe('aft1.original');
 expect(shortPdfContinuationPlan([file],[longer],'此次仅查看 sample.pdf 第 26 页。')).toBeUndefined();
 expect(shortPdfContinuationPlan([file,{...file,id:'other',name:'other.pdf'}],[longer],'请核对 sample.pdf 末页。')).toBeUndefined();
 expect(shortPdfContinuationPlan([file],[{...longer,result:{...longer.result,pages:41}}],'请核对 sample.pdf 末页。')).toBeUndefined();
 expect(shortPdfContinuationPlan([file],[{...first,result:{...result,nextPageFrom:undefined}}])).toBeUndefined();
 expect(shortPdfContinuationPlan([file],[{...first,compacted:true}])).toBeUndefined();
 const failed={...newPlatformTaskStep({...plan,arguments:{...plan.arguments,cursor:result.nextCursor}},1),result:{error:true}};
 expect(shortPdfContinuationPlan([file],[first,failed])).toBeUndefined();
});

it('continues each eligible PDF using its own cursor and skips long or already attempted sources',()=>{
 const first={id:'short-one',name:'first.pdf',mimeType:'application/pdf',size:1200};
 const second={...first,id:'short-two',name:'second.pdf'};
 const longer={...first,id:'long-pdf',name:'longer.pdf'};
 const read=(id:string,pages:number,cursor:string)=>({
  ...newPlatformTaskStep({name:'bambook_file_text',arguments:{fileId:id}},0),
  result:{kind:'pdf',file:{id},sourceHash:'a'.repeat(64),pages,range:{start:0,end:3500,pageFrom:1,pageTo:20},hasMore:true,nextPageFrom:21,nextCursor:cursor},
 });
 const heads=[read(first.id,21,'aft1.first'),read(second.id,24,'aft1.second'),read(longer.id,25,'aft1.long')];
 const files=[longer,first,second];
 const firstTail=shortPdfContinuationPlan(files,heads);
 expect(firstTail?.arguments).toEqual({fileId:first.id,cursor:'aft1.first',maxChars:3500});
 const failed={...newPlatformTaskStep(firstTail!,1),result:{error:true}};
 const secondTail=shortPdfContinuationPlan(files,[...heads,failed]);
 expect(secondTail?.arguments).toEqual({fileId:second.id,cursor:'aft1.second',maxChars:3500});
 const completed={...newPlatformTaskStep(secondTail!,2),result:{hasMore:false}};
 expect(shortPdfContinuationPlan(files,[...heads,failed,completed])).toBeUndefined();
});

it('pre-reads only one same-page continuation before an optional short tail',()=>{
 const file={id:'pdf',name:'dense.pdf',mimeType:'application/pdf',size:1200};
 const head={...newPlatformTaskStep({name:'bambook_file_text',arguments:{fileId:file.id}},0),result:{
  kind:'pdf',file:{id:file.id},sourceHash:'a'.repeat(64),pages:23,
  range:{start:0,end:3500,pageFrom:1,pageTo:20,textLimited:true},hasMore:true,nextCursor:'aft1.middle',
 }};
 const next=shortPdfContinuationPlan([file],[head]);
 expect(next?.arguments.cursor).toBe('aft1.middle');
 const middle={...newPlatformTaskStep(next!,1),result:{...head.result,
  range:{...head.result.range,start:3500,end:4500,textLimited:false},nextPageFrom:21,nextCursor:'aft1.tail',
 }};
 expect(shortPdfContinuationPlan([file],[head,middle])?.arguments.cursor).toBe('aft1.tail');
 const stillPartial={...middle,result:{...middle.result,range:{...middle.result.range,textLimited:true},
  nextPageFrom:undefined,nextCursor:'aft1.more'}};
 expect(shortPdfContinuationPlan([file],[head,stillPartial])).toBeUndefined();
 expect(shortPdfContinuationPlan([file],[head,{...middle,result:{...middle.result,sourceHash:'b'.repeat(64)}}])).toBeUndefined();
 const short={...head,result:{...head.result,pages:12,range:{...head.result.range,pageTo:12}}};
 expect(shortPdfContinuationPlan([file],[short])?.arguments.cursor).toBe('aft1.middle');
});

it('pre-reads an Office tail only with a bounded result from that exact original',()=>{
 const file={id:'quote',name:'quote.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:2000};
 const plan={name:'bambook_file_text',arguments:{fileId:file.id}};
 const result={kind:'xlsx',file:{id:file.id},sourceHash:'a'.repeat(64),range:{start:0,end:3500},
  hasMore:true,nextCursor:'aft1.scope',remainingOfficeChars:3500};
 const first={...newPlatformTaskStep(plan,0),result};
 expect(shortOfficeTailPlan([file],[first])?.arguments).toEqual({fileId:file.id,cursor:'aft1.scope',maxChars:3500});
 for(const invalid of [
  {...result,remainingOfficeChars:undefined},
  {...result,remainingOfficeChars:3501},
  {...result,remainingOfficeChars:0},
  {...result,file:{id:'other'}},
  {...result,reason:'正文超过安全提取范围'},
 ]){
  expect(shortOfficeTailPlan([file],[{...first,result:invalid}])).toBeUndefined();
 }
 const failed={...newPlatformTaskStep({...plan,arguments:{...plan.arguments,cursor:result.nextCursor}},1),result:{error:true}};
 expect(shortOfficeTailPlan([file],[first,failed])).toBeUndefined();
});

it('summarizes only continuous PDF page windows with the same verified source and exact cursor',()=>{
 const makeRead=(fileId:string,from:number,to:number,pages:number,cursor:string|undefined,nextCursor:string|undefined,extra={})=>({
  ...newPlatformTaskStep({name:'bambook_file_text',arguments:{fileId,...(cursor?{cursor}:{})}},0),
  result:{kind:'pdf',file:{id:fileId},sourceHash:'a'.repeat(64),pages,range:{start:0,end:5,pageFrom:from,pageTo:to},
   hasMore:!!nextCursor,...(nextCursor?{nextCursor,nextPageFrom:to+1}:{}),...extra},
 });
 const first=makeRead('first',1,20,23,undefined,'aft1.first',{pagesWithoutText:[3]});
 expect(platformTaskHistory([first])).toMatchObject({
  pdfPendingCoverage:[{fileId:'first',pagesInOriginal:23,returnedThroughPage:20,pagesWithoutText:[3],unreadPages:{from:21,to:23}}],
 });
 expect(platformTaskHistory([first])).not.toHaveProperty('pdfCoverage');
 const last=makeRead('first',21,23,23,'aft1.first',undefined,{pagesWithoutText:[22],reason:'第 22 页没有可提取文字',truncated:true,complete:false});
 const unrelated=makeRead('other',21,21,21,'aft1.other',undefined);
 expect(platformTaskHistory([first,unrelated,last]).pdfCoverage).toEqual([{fileId:'first',pagesChecked:23,pagesWithoutText:[3,22]}]);
 for(const variant of [
  {...last,plan:{...last.plan,arguments:{fileId:'first',cursor:'aft1.other'}}},
  {...last,result:{...last.result,sourceHash:'b'.repeat(64)}},
  {...last,result:{...last.result,range:{...last.result.range,pageFrom:22}}},
  {...last,result:{...last.result,range:{...last.result.range,textLimited:true}}},
  {...last,result:{...last.result,range:{...last.result.range,start:2}}},
  {...last,result:{...last.result,reason:'正文超过安全提取范围',pagesWithoutText:undefined}},
  {...last,compacted:true},
 ]){
  expect(platformTaskHistory([first,variant])).not.toHaveProperty('pdfCoverage');
 }
 expect(platformTaskHistory([last])).not.toHaveProperty('pdfCoverage');
 expect(platformTaskHistory([first,last,{...last,result:{error:true}}])).not.toHaveProperty('pdfCoverage');
});

it('requires contiguous character offsets when a PDF page window is split',()=>{
 const read=(from:number,to:number,start:number,end:number,cursor?:string,next?:string,nextPageFrom?:number,textLimited=false)=>({
  ...newPlatformTaskStep({name:'bambook_file_text',arguments:{fileId:'pdf',...(cursor?{cursor}:{})}},0),
  result:{kind:'pdf',file:{id:'pdf'},sourceHash:'a'.repeat(64),pages:23,
   range:{start,end,pageFrom:from,pageTo:to,...(textLimited?{textLimited:true}:{})},
   hasMore:!!next,...(next?{nextCursor:next}:{}),...(nextPageFrom?{nextPageFrom}:{})},
 });
 const first=read(1,20,0,3500,undefined,'aft1.slice',undefined,true);
 const second=read(1,20,3500,4400,'aft1.slice','aft1.tail',21);
 expect(platformTaskHistory([first]).pdfPendingCoverage).toEqual([
  {fileId:'pdf',pagesInOriginal:23,returnedThroughPage:0,pagesWithoutText:[],partialWindow:{from:1,to:20},unreadPages:{from:21,to:23}},
 ]);
 expect(platformTaskHistory([first,second]).pdfPendingCoverage).toEqual([
  {fileId:'pdf',pagesInOriginal:23,returnedThroughPage:20,pagesWithoutText:[],unreadPages:{from:21,to:23}},
 ]);

 const last=read(21,23,0,400,'aft1.tail');
 expect(platformTaskHistory([first,second,last]).pdfCoverage).toEqual([{fileId:'pdf',pagesChecked:23,pagesWithoutText:[]}]);
 for(const bad of [
  read(1,20,3501,4400,'aft1.slice','aft1.tail',21),
  read(1,20,3499,4400,'aft1.slice','aft1.tail',21),
  read(1,19,3500,4400,'aft1.slice','aft1.tail',20),
  read(1,20,3500,4400,'aft1.wrong','aft1.tail',21),
 ]){
  const history=platformTaskHistory([first,bad,last]);
  expect(history).not.toHaveProperty('pdfCoverage');
  expect(history).not.toHaveProperty('pdfPendingCoverage');
 }
 expect(platformTaskHistory([first,last])).not.toHaveProperty('pdfCoverage');
 expect(platformTaskHistory([first,second,read(21,23,0,400,'aft1.tail',undefined,undefined,true)])).not.toHaveProperty('pdfCoverage');
});

it('identifies the full quotation amount and the exact converted line amounts in a complete read', () => {
  const plan={name:'bambook_get',arguments:{type:'quotation',id:'quote'}};
  const object={type:'quotation',id:'quote',label:'QT-8',truncated:false,data:{
    currency:'EUR',total:'28158.00',lines:[
      {amount:'78.00',conversion:{orderId:'batch-a',orderCode:'SO-A'}},
      {amount:'28080.00',conversion:{orderId:'batch-b',orderCode:'SO-B'}},
      {amount:'0.00'},
    ],
  }};
  const complete={...newPlatformTaskStep(plan,0),result:{revision:4,object}};
  const duplicate={...newPlatformTaskStep(plan,1),result:complete.result};
  const incomplete={...newPlatformTaskStep(plan,2),result:{revision:4,object:{...object,truncated:true}}};
  const compacted={...newPlatformTaskStep(plan,3),result:complete.result,compacted:true};
  const recent=platformTaskHistory([complete,duplicate,incomplete,compacted]).recent;
  expect(recent[0]).not.toHaveProperty('quotationAmountScope');
  expect(recent[1]).toMatchObject({quotationAmountScope:{currency:'EUR',fullQuotationTotal:'28158.00',convertedLines:[
    {lineNumber:1,orderCode:'SO-A',quotationLineAmount:'78.00'},
    {lineNumber:2,orderCode:'SO-B',quotationLineAmount:'28080.00'},
  ]}});
  expect(recent[2]).not.toHaveProperty('quotationAmountScope');
  expect(recent[3]).not.toHaveProperty('quotationAmountScope');
  expect(complete.result.object.data).toEqual(object.data);
});
