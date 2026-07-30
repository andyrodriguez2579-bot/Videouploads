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
 * Producer and consumer need opposite failure behaviour, so they get different
 * connections.
 *
 * A **worker** blocks on Redis waiting for jobs, so it must never give up:
 * `maxRetriesPerRequest: null` is what BullMQ requires, otherwise ioredis
 * aborts the blocking command mid-wait.
 *
 * A **producer** is inside a web request. With those same settings a dead Redis
 * makes `queue.add()` retry forever rather than reject, which hangs the request
 * that clicked "Start render" instead of reporting the problem. Bounded retries
 * plus `enableOfflineQueue: false` make it fail fast and visibly.
 */
export function createRedisConnection(options: { blocking: boolean }): Redis {
  const url = getEnv().REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set.");

  return options.blocking
    ? new IORedis(url, { maxRetriesPerRequest: null })
    : new IORedis(url, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 5_000,
        // Without this an unreachable host logs an unhandled error event.
        lazyConnect: false,
        retryStrategy: (times) => (times > 2 ? null : Math.min(times * 200, 500)),
      });
}

/** Ceiling on how long a web request may wait to hand off a job. */
const ENQUEUE_TIMEOUT_MS = 8_000;

let queue: Queue<RenderJobData> | null = null;

export function getRenderQueue(): Queue<RenderJobData> | null {
  if (!isQueueEnabled()) return null;
  queue ??= new Queue<RenderJobData>(RENDER_QUEUE_NAME, {
    connection: createRedisConnection({ blocking: false }),
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

  // Belt and braces alongside the connection settings: whatever ioredis does,
  // a web request never waits longer than this to hand a job off.
  let timer: NodeJS.Timeout | undefined;
  try {
    const job = await Promise.race([
      target.add(RENDER_QUEUE_NAME, { renderId }, { jobId: renderId }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`the job queue did not respond within ${ENQUEUE_TIMEOUT_MS}ms`)),
          ENQUEUE_TIMEOUT_MS,
        );
      }),
    ]);
    return job.id ?? null;
  } catch (error) {
    // Drop the cached queue so the next attempt builds a fresh connection.
    // Without this, one outage at startup would poison every later render.
    void closeRenderQueue().catch(() => {});
    queue = null;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function closeRenderQueue(): Promise<void> {
  if (!queue) return;
  await queue.close();
  queue = null;
}
