const REQUEST_MARK = '\n【本次请求】\n';
const CONTEXT_HEADER = '【此前对话】\n';
export const TASK_HISTORY_TURNS = 3;
const CONTEXT_REPLY = 300;
export const TASK_INSTRUCTION_LIMIT = 4000;

function textPrefix(value: string, limit: number) {
  const prefix = value.slice(0,limit);
  return prefix.length < value.length ? prefix.replace(/[\uD800-\uDBFF]$/u,'') : prefix;
}

/** 把此前几轮的问答压成一段上下文，随本次请求一起交给任务；展示时用 splitTaskRequest 去掉。 */
export function composeTaskInstructions(history: ReadonlyArray<{state:string;instructions:string;result:string}>, text: string): string {
  const message = text.trim();
  if (message.length > TASK_INSTRUCTION_LIMIT) throw new Error('问题超过 4000 字，请缩短后重试');
  let remaining = TASK_INSTRUCTION_LIMIT - CONTEXT_HEADER.length - REQUEST_MARK.length - message.length;
  if (remaining <= 0) return message;

  const context: string[] = [];
  const turns = history.filter(t => t.state === 'succeeded' && t.result).slice(-TASK_HISTORY_TURNS).reverse();
  for (const task of turns) {
    const room = remaining - (context.length ? 1 : 0);
    if (room < 3) break;
    const historyText = `我：${splitTaskRequest(task.instructions)}\n小竹：${textPrefix(task.result,CONTEXT_REPLY)}`
      .replaceAll(REQUEST_MARK,'\n〔本次请求〕\n');
    const item = textPrefix(historyText,room);
    context.unshift(item);
    remaining = room - item.length;
  }
  return context.length ? CONTEXT_HEADER + context.join('\n') + REQUEST_MARK + message : message;
}
export function splitTaskRequest(instructions: string): string {
  const at = instructions.indexOf(REQUEST_MARK);
  if (at < 0) return instructions;
  const prefix = instructions.slice(0,at);
  // Older instructions could have had their context header clipped before the separator.
  return instructions.startsWith(CONTEXT_HEADER) || CONTEXT_HEADER.startsWith(prefix)
    ? instructions.slice(at + REQUEST_MARK.length)
    : instructions;
}

