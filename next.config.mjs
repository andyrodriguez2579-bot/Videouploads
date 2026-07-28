/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // postgres.js and the AWS SDK are Node-only; keep them out of the bundler's
  // module graph so route handlers and server actions load them at runtime.
  serverExternalPackages: ["postgres", "@aws-sdk/client-s3", "bcryptjs"],
  experimental: {
    serverActions: {
      // Narration and archival stills are uploaded through server actions.
      bodySizeLimit: "128mb",
    },
  },
};

export default nextConfig;
