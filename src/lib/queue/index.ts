import "server-only";

import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";

import { getEnv } from "@/lib/env";

/**
 * Background job queue for renders.
 *
 * Redis is **optional on purpose**. The whole app is meant to run with no extra
 * services, so when `REDIS_URL` is unset renders execute in-process: fine on a
 * laptop, and the only cost is that a restart mid-render orphans the job. Set
 * `REDIS_URL` and the same work goes through BullMQ instead, where it survives a
 * restart and retries itself. Nothing else in the codebase changes shape.
 */

export const RENDER_QUEUE_NAME = "renders";

export interface RenderJobData {
  renderId: string;
}

/** Matches `render_jobs.max_attempts`, whose default is 3. */
export const RENDER_JOB_ATTEMPTS = 3;

export function isQueueEnabled(): boolean {
  return Boolean(getEnv().REDIS_URL);
}

/**
 * BullMQ requires `maxRetriesPerRequest: null` — its blocking commands would
 * otherwise be aborted by ioredis' own retry ceiling mid-wait.
 */
export function createRedisConnection(): Redis {
  const url = getEnv().REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set.");
  return new IORedis(url, { maxRetriesPerRequest: null });
}

let queue: Queue<RenderJobData> | null = null;

export function getRenderQueue(): Queue<RenderJobData> | null {
  if (!isQueueEnabled()) return null;
  queue ??= new Queue<RenderJobData>(RENDER_QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: RENDER_JOB_ATTEMPTS,
      // A failing encode usually fails instantly (bad input, missing binary),
      // so back off rather than burning three attempts in the same second.
      backoff: { type: "exponential", delay: 5_000 },
      // Keep a short tail for debugging; the durable record is `render_jobs`.
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 200 },
    },
  });
  return queue;
}

/**
 * Hands a render to the queue. Returns the queue's job id, or null when no
 * queue is configured and the caller should run the work itself.
 */
export async function enqueueRender(renderId: string): Promise<string | null> {
  const target = getRenderQueue();
  if (!target) return null;
  const job = await target.add(RENDER_QUEUE_NAME, { renderId }, { jobId: renderId });
  return job.id ?? null;
}

export async function closeRenderQueue(): Promise<void> {
  if (!queue) return;
  await queue.close();
  queue = null;
}
