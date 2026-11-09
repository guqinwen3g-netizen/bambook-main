/** Operator-tunable task budgets. A missing, malformed or out-of-range value falls back to the default instead of loosening a limit by accident. */
export function limitFromEnv(name: string, fallback: number, min: number, max: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}
export const agentTaskLimits = (env: NodeJS.ProcessEnv = process.env) => ({
  steps: limitFromEnv('MIST_AGENT_TASK_STEP_LIMIT', 40, 5, 200, env),
  runtimeMs: limitFromEnv('MIST_AGENT_TASK_RUNTIME_MINUTES', 30, 5, 240, env) * 60_000,
  activePerUser: limitFromEnv('MIST_AGENT_TASK_ACTIVE_PER_USER', 10, 1, 50, env),
});
/** 小竹每日用量上限（按上海营业日）：每人任务数与模型调用次数，以及全公司模型调用次数。 */
export const agentDailyLimits = (env: NodeJS.ProcessEnv = process.env) => ({
  tasksPerUser: limitFromEnv('MIST_AGENT_DAILY_TASKS_PER_USER', 50, 1, 1000, env),
  turnsPerUser: limitFromEnv('MIST_AGENT_DAILY_TURNS_PER_USER', 400, 10, 20000, env),
  turnsPerCompany: limitFromEnv('MIST_AGENT_DAILY_TURNS_PER_COMPANY', 3000, 10, 200000, env),
});
