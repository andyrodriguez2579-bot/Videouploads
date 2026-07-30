/**
 * Render worker.
 *
 * Consumes the BullMQ `renders` queue and encodes each job. Run it alongside
 * the app whenever `REDIS_URL` is set:
 *
 *   npm run worker
 *
 * Without `REDIS_URL` the app renders in-process and this worker is not needed;
 * it exits immediately rather than idling on a queue that will never fill.
 *
 * The `react-server` resolve condition is set by the npm script so the modules
 * guarded with `server-only` can be imported outside Next.
 */
import "dotenv/config";

import { Worker } from "bullmq";

import {
  RENDER_QUEUE_NAME,
  createRedisConnection,
  isQueueEnabled,
  type RenderJobData,
} from "../src/lib/queue";
import { getRenderProvider } from "../src/lib/render";
import { reclaimStaleRenders, runRenderJob } from "../src/server/renders";

/** One encode at a time: ffmpeg already uses every core it can get. */
const CONCURRENCY = Number(process.env.RENDER_WORKER_CONCURRENCY ?? 1);

async function main() {
  if (!isQueueEnabled()) {
    console.error(
      "REDIS_URL is not set, so renders run inside the app and no worker is needed.\n" +
        "Set REDIS_URL (docker compose --profile jobs up -d redis) to use this worker.",
    );
    process.exit(1);
  }

  // Fail fast on a missing toolchain rather than accepting jobs we cannot do.
  await getRenderProvider().preflight();

  const reclaimed = await reclaimStaleRenders();
  if (reclaimed > 0) {
    console.log(`Marked ${reclaimed} render(s) as failed: their process died mid-encode.`);
  }

  const worker = new Worker<RenderJobData>(
    RENDER_QUEUE_NAME,
    async (job) => {
      console.log(`[${job.id}] rendering ${job.data.renderId} (attempt ${job.attemptsMade + 1})`);
      await runRenderJob(job.data.renderId);
    },
    { connection: createRedisConnection({ blocking: true }), concurrency: CONCURRENCY },
  );

  worker.on("completed", (job) => console.log(`[${job.id}] done`));
  worker.on("failed", (job, error) => console.error(`[${job?.id}] failed: ${error.message}`));

  console.log(`Render worker ready (concurrency ${CONCURRENCY}). Ctrl-C to stop.`);

  // Close on signal so an in-flight encode is not abandoned half-written.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`\n${signal} — finishing the current job, then exiting.`);
      void worker.close().then(() => process.exit(0));
    });
  }
}

main().catch((error) => {
  console.error("Worker failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
