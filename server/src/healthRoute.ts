import type { RequestHandler } from 'express';

type TtsPrewarm = { provider: string; ok: boolean; skipped?: boolean; elapsedMs?: number; at?: string; error?: string } | null;
type HealthDeps = { prisma: { $queryRaw: (query: TemplateStringsArray) => Promise<unknown> }; build: string; authRequired: boolean; tts: () => TtsPrewarm };

/**
 * Public liveness/readiness probe for the main API. Deploy scripts read status / database / mode
 * (scripts/deploy/bambook-dev-release.sh, direct-dev.py). The endpoint is unauthenticated, so it only
 * returns state flags: database and TTS error text goes to the server log, never to the response.
 */
export function createHealthHandler(deps: HealthDeps): RequestHandler {
  return async (_req, res) => {
    const ttsPrewarm = deps.tts();
    if (ttsPrewarm?.error) console.error('[health] tts prewarm failed', ttsPrewarm.error);
    const health = {
        status: "ok",
        node: "PandaAI-Sovereign-Node-Prisma",
        timestamp: Date.now(),
        version: process.env.npm_package_version || '1.0.0',
        build: deps.build,
        authRequired: deps.authRequired,
        realtime: 'sse-in-process',
        database: 'ok',
        tts: ttsPrewarm
            ? {
                provider: ttsPrewarm.provider,
                prewarmOk: ttsPrewarm.ok,
                prewarmSkipped: ttsPrewarm.skipped,
                prewarmElapsedMs: ttsPrewarm.elapsedMs,
                prewarmAt: ttsPrewarm.at,
            }
            : { provider: process.env.BAMBOOK_TTS_PROVIDER || 'melo', prewarmOk: null },
    };
    try {
        await deps.prisma.$queryRaw`SELECT 1`;
        res.json(health);
    } catch (error: unknown) {
        console.error('[health] database check failed', error instanceof Error ? error.message : error);
        res.status(503).json({ ...health, status: 'error', database: 'unavailable' });
    }
  };
}
