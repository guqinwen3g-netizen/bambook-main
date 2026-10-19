import path from 'node:path';
import {promises as fs} from 'node:fs';
import {MistPrivateFiles,type MistStoredFile} from '../src/mist/files';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function main(){
 const root=process.env.MIST_FILES_DIR?.trim(),queue=process.env.BAMBOOK_IMAGE_CUTOUT_QUEUE?.trim();
 if(!root||!queue||!process.env.BAMBOOK_BACKGROUND_REMOVAL_MODEL?.trim())throw new Error('图片去背 worker 私有配置不完整');
 const storage=new MistPrivateFiles(root,queue);await fs.mkdir(queue,{recursive:true,mode:0o700});
 for(const name of (await fs.readdir(queue)).filter(name=>name.endsWith('.json')).sort()){
  const jobPath=path.join(queue,name);
  try{const job=JSON.parse(await fs.readFile(jobPath,'utf8')) as {workspaceId:string;file:MistStoredFile};if(!UUID.test(job.workspaceId)||!job.file||!UUID.test(job.file.id)||job.file.storageKey!==`${job.workspaceId}/${job.file.id}`)throw new Error('去背任务内容无效');await storage.generateCutouts(job.workspaceId,job.file);await fs.unlink(jobPath);console.log(`[image-cutout] completed ${job.workspaceId}/${job.file.id}`);}
  catch(error){console.error(`[image-cutout] failed ${name}:`,error instanceof Error?error.message:String(error));await fs.unlink(jobPath).catch(()=>undefined);process.exitCode=1;}
 }
}
void main().catch(error=>{console.error('[image-cutout] worker failed:',error instanceof Error?error.message:String(error));process.exitCode=1;});
