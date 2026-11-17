import type {MistState} from '../../mistWorkspace';
import {openDevelopmentFactoryTasks} from '../../mistDevelopmentTaskLifecycle';
/** Legacy lifecycle fixtures deliberately preserve active work; these are setup decisions, not product auto-closure. */
export function retainFixtureFactoryTasks(state:MistState,devId:string){const dev=state.devs.find(d=>d.id===devId)!;return{taskResolutions:openDevelopmentFactoryTasks(state,dev).map(v=>({versionId:v.id,kind:'retained' as const,reason:'保留后续安排'})),retainFollowups:true};}
