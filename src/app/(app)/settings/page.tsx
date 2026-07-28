import { Alert, Badge, PageHeader } from "@/components/ui";
import { describeEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Read-only configuration view. Settings are environment variables, not
 * database rows, so that a secret is never editable — or readable — from the
 * browser. Only presence is ever reported for secrets.
 */
export default function SettingsPage() {
  const env = describeEnv();

  const rows: { label: string; value: string; note?: string }[] = [
    { label: "Environment", value: env.values.NODE_ENV },
    { label: "App URL", value: env.values.APP_URL },
    { label: "Auth provider", value: env.values.AUTH_PROVIDER, note: "local = no cloud dependency" },
    { label: "Storage driver", value: env.values.STORAGE_DRIVER },
    {
      label: "Local storage path",
      value: env.values.LOCAL_STORAGE_PATH,
      note: "Used when STORAGE_DRIVER=local",
    },
    { label: "S3 bucket", value: env.values.S3_BUCKET },
    { label: "S3 endpoint", value: env.values.S3_ENDPOINT, note: "Set for Cloudflare R2 or MinIO" },
    { label: "FFmpeg path", value: env.values.FFMPEG_PATH },
    { label: "Redis (job queue)", value: env.values.REDIS_URL, note: "Required from Milestone 2" },
  ];

  const providers: { label: string; value: string; free: boolean }[] = [
    {
      label: "Scene plan",
      value: env.values.SCENE_PLAN_PROVIDER,
      free: env.values.SCENE_PLAN_PROVIDER === "manual" || env.values.SCENE_PLAN_PROVIDER === "mock",
    },
    {
      label: "Titles / captions copy",
      value: env.values.COPY_PROVIDER,
      free: env.values.COPY_PROVIDER === "manual" || env.values.COPY_PROVIDER === "mock",
    },
    {
      label: "Text to speech",
      value: env.values.TTS_PROVIDER,
      free: env.values.TTS_PROVIDER === "none" || env.values.TTS_PROVIDER === "piper",
    },
    {
      label: "Transcription",
      value: env.values.ASR_PROVIDER,
      free: env.values.ASR_PROVIDER === "none" || env.values.ASR_PROVIDER === "faster_whisper",
    },
    {
      label: "Publishing",
      value: env.values.PUBLISHING_MODE,
      free: env.values.PUBLISHING_MODE === "mock",
    },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Configuration comes from environment variables. Secret values are never displayed — only whether they are present."
      />

      <div className="mb-6">
        {env.valid ? (
          <Alert tone="success" title="Environment configuration is valid." />
        ) : (
          <Alert
            tone="error"
            title="Environment configuration has problems"
            items={env.issues.map((i) => `${i.key}: ${i.message}`)}
          />
        )}
      </div>

      <section aria-labelledby="providers-heading" className="mb-8">
        <h2 id="providers-heading" className="mb-3 font-serif text-lg font-semibold">
          Providers
        </h2>
        <p className="mb-3 text-sm text-black/60">
          Every capability sits behind an interface. The defaults below cost nothing and need no
          external account.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {providers.map((provider) => (
            <li key={provider.label} className="card flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{provider.label}</p>
                <p className="text-xs text-black/60">{provider.value}</p>
              </div>
              <Badge tone={provider.free ? "good" : "warn"}>
                {provider.free ? "Free / local" : "Paid provider"}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="config-heading" className="mb-8">
        <h2 id="config-heading" className="mb-3 font-serif text-lg font-semibold">
          Configuration
        </h2>
        <div className="overflow-x-auto rounded-lg border border-black/10 bg-white">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Non-secret environment configuration</caption>
            <thead className="bg-black/[0.03] text-left">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Setting
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Value
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Note
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="px-4 py-2.5 text-left font-medium">
                    {row.label}
                  </th>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.value}</td>
                  <td className="px-4 py-2.5 text-xs text-black/60">{row.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="secrets-heading">
        <h2 id="secrets-heading" className="mb-3 font-serif text-lg font-semibold">
          Secrets
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {Object.entries(env.secrets).map(([key, present]) => (
            <li
              key={key}
              className="flex items-center justify-between gap-3 rounded-md border border-black/10 bg-white px-3 py-2 text-sm"
            >
              <span className="font-mono text-xs">{key}</span>
              <Badge tone={present ? "good" : "neutral"}>{present ? "set" : "not set"}</Badge>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
