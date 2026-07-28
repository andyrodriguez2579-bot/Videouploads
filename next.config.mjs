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
      // Narration and archival stills are uploaded through server actions.
      bodySizeLimit: "128mb",
    },
  },
};

export default nextConfig;
