import { existsSync } from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { env } from "../src/config/env.js";
import { logger } from "../src/utils/logger.js";

const TUNNEL_URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

const WINDOWS_FALLBACK_PATHS = [
  "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
  "C:\\Program Files\\cloudflared\\cloudflared.exe",
];

function resolveCloudflaredCommand(): string {
  const probe = spawnSync("cloudflared", ["--version"], { stdio: "ignore" });
  if (!probe.error) return "cloudflared";

  const fallback = WINDOWS_FALLBACK_PATHS.find((path) => existsSync(path));
  if (fallback) return fallback;

  throw new Error(
    "cloudflared not found on PATH. Install it with: winget install --id Cloudflare.cloudflared -e",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A freshly created trycloudflare.com hostname can take several seconds to
 * propagate. Registering it with Meta before it's reachable makes Meta's own
 * verification request fail with a 502, so we poll our own health endpoint
 * through the tunnel until it responds.
 */
async function waitUntilReachable(tunnelUrl: string): Promise<boolean> {
  const attempts = 15;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(`${tunnelUrl}/health`);
      if (response.ok) return true;
    } catch {
      // not reachable yet, keep retrying
    }
    await sleep(2000);
  }

  return false;
}

async function registerWebhook(tunnelUrl: string): Promise<void> {
  const reachable = await waitUntilReachable(tunnelUrl);
  if (!reachable) {
    logger.error({ tunnelUrl }, "Tunnel never became reachable, skipping webhook registration");
    return;
  }

  const callbackUrl = `${tunnelUrl}/webhook`;
  const appAccessToken = `${env.WHATSAPP_APP_ID}|${env.WHATSAPP_APP_SECRET}`;

  const params = new URLSearchParams({
    object: "whatsapp_business_account",
    callback_url: callbackUrl,
    fields: "messages",
    verify_token: env.WHATSAPP_VERIFY_TOKEN,
    access_token: appAccessToken,
  });

  const response = await fetch(
    `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_APP_ID}/subscriptions`,
    { method: "POST", body: params },
  );

  const body: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    logger.error({ status: response.status, body }, "Failed to register webhook with Meta");
    return;
  }

  logger.info({ callbackUrl }, "Webhook registered with Meta — update propagates immediately");
}

function startTunnel(): ChildProcess {
  const command = resolveCloudflaredCommand();
  const child = spawn(command, ["tunnel", "--url", `http://localhost:${env.PORT}`]);

  let registered = false;

  const onLogChunk = (chunk: Buffer): void => {
    const text = chunk.toString();
    process.stderr.write(text);

    if (registered) return;

    const match = TUNNEL_URL_REGEX.exec(text);
    if (!match) return;

    registered = true;
    registerWebhook(match[0]).catch((err: unknown) => {
      logger.error({ err }, "Unexpected error registering webhook");
    });
  };

  child.stdout?.on("data", onLogChunk);
  child.stderr?.on("data", onLogChunk);

  child.on("exit", (code) => {
    logger.info({ code }, "cloudflared exited");
    process.exit(code ?? 0);
  });

  return child;
}

const tunnel = startTunnel();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => tunnel.kill());
}
