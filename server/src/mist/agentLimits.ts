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
