/**
 * curlFetch — HTTP via curl subprocess.
 *
 * Bun/Node fetch() is broken on macOS for local/WireGuard IPs.
 * curl (Apple-signed) bypasses the macOS Local Network Privacy restriction.
 * Used for ALL peer/federation HTTP calls.
 */

export interface CurlResponse {
  ok: boolean;
  status: number;
  data: any;
}

export async function curlFetch(url: string, opts?: {
  method?: string;
  body?: string;
  timeout?: number;
}): Promise<CurlResponse> {
  const timeoutSec = Math.ceil((opts?.timeout || 10000) / 1000);
  const args = ["curl", "-sf", "--max-time", String(timeoutSec)];
  if (opts?.method) args.push("-X", opts.method);
  if (opts?.body) {
    args.push("-H", "Content-Type: application/json", "-d", opts.body);
  }
  args.push(url);

  try {
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const text = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return { ok: false, status: code, data: null };
    return { ok: true, status: 200, data: text ? JSON.parse(text) : null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
