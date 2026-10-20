/**
 * 主图规则（用户 2026-10-20 定案）：产品档案、开发案及其版本的附件里，第一张图片是“主图”，
 * 用于列表、详情与首页展示，并且只有主图会自动抠图；之后上传的背面、细节等都是“补充图”，
 * 数量不限，只做普通预览，不进入抠图队列。
 */
type ImageFile={id:string;mimeType:string};
type ImageOwnerState={files?:ImageFile[];devs?:{fileIds?:string[]}[];versions?:{fileIds?:string[]}[];market?:{products?:{fileIds?:string[]}[]}};

const isImage=(file:ImageFile|undefined)=>!!file&&file.mimeType.startsWith('image/');
/** 附件列表中的主图编号：按附件顺序取第一张图片；没有图片时为空。 */
export function primaryImageId(files:readonly ImageFile[]|ReadonlyMap<string,ImageFile>,ids:readonly string[]|undefined):string|undefined{
 const find=(id:string)=>files instanceof Map?files.get(id):(files as readonly ImageFile[]).find(file=>file.id===id);
 return (ids??[]).find(id=>isImage(find(id)));
}
/** 把指定图片设为主图：移到第一张图片之前，其余附件保持原有顺序。 */
export function withPrimaryImage(ids:readonly string[],id:string):string[]{return ids.includes(id)?[id,...ids.filter(value=>value!==id)]:[...ids];}
/** 工作区内所有主图编号；只有这些图片允许生成抠图派生。 */
export function primaryImageIds(state:ImageOwnerState):Set<string>{
 const files=new Map((state.files??[]).map(file=>[file.id,file] as const)),primary=new Set<string>();
 for(const owner of [...(state.market?.products??[]),...(state.devs??[]),...(state.versions??[])]){const id=primaryImageId(files,owner.fileIds);if(id)primary.add(id);}
 return primary;
}
