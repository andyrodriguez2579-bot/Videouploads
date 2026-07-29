/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // postgres.js and the AWS SDK are Node-only; keep them out of the bundler's
  // module graph so route handlers and server actions load them at runtime.
  //
  // bullmq is here for a second reason: it ships an optional Valkey client that
  // is not installed, and bundling it emits "Can't resolve @valkey/valkey-glide"
  // warnings on every build. Left unaddressed that noise is where a real module
  // error goes to hide.
  serverExternalPackages: ["postgres", "@aws-sdk/client-s3", "bcryptjs", "bullmq", "ioredis"],
  experimental: {
    serverActions: {
      // Narration and archival stills are uploaded through server actions, and
      // a server action buffers the whole body in memory — so this is a real
      // memory ceiling, not a formality.
      //
      // 128 MB comfortably covers lossless narration: ten minutes of mono
      // 24-bit/48 kHz is ~86 MB as WAV, ~50 MB as FLAC.
      //
      // MAX_UPLOAD_MB must not exceed this. src/lib/env.ts enforces that,
      // because the failure mode otherwise is an opaque error at the exact
      // moment someone uploads the take they just spent an hour recording.
      bodySizeLimit: "128mb",
    },
  },
};

export default nextConfig;
