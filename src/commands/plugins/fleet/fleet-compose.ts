/**
 * fleet-compose.ts — Generate docker-compose.yml for `maw serve`.
 *
 * Single-service compose. `docker compose up` runs the maw API server
 * (port 3456) with all required volumes mounted.
 *
 * Usage: maw fleet compose [--output <path>] [--port <N>]
 */

import { writeFileSync } from "node:fs";

interface ComposeService {
  build?: { context: string; dockerfile: string };
  image?: string;
  container_name: string;
  command: string;
  ports: string[];
  volumes: string[];
  environment: Record<string, string>;
  restart: string;
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
}

interface ComposeFile {
  services: Record<string, ComposeService>;
  volumes: Record<string, { driver: string }>;
}

export function generateServeCompose(opts: { port?: number } = {}): { yaml: string } {
  const port = opts.port ?? 3456;
  const tlsPort = port + 1;

  const compose: ComposeFile = {
    services: {
      "maw-serve": {
        build: { context: ".", dockerfile: "Dockerfile.serve" },
        container_name: "maw-serve",
        command: `maw serve ${port} --host 0.0.0.0`,
        ports: [`${port}:${port}`, `${tlsPort}:${tlsPort}`],
        volumes: [
          "claude-config:/root/.claude",
          "maw-config:/root/.config/maw",
          "code-repos:/root/Code",
          "/var/run/docker.sock:/var/run/docker.sock",
        ],
        environment: {
          MAW_HOST: "0.0.0.0",
          MAW_PORT: String(port),
          NODE_ENV: "production",
          TMUX_TMPDIR: "/tmp/tmux",
        },
        restart: "unless-stopped",
        healthcheck: {
          test: ["CMD", "curl", "-sf", `http://localhost:${port}/api/health`],
          interval: "15s",
          timeout: "5s",
          retries: 3,
        },
      },
    },
    volumes: {
      "claude-config": { driver: "local" },
      "maw-config": { driver: "local" },
      "code-repos": { driver: "local" },
    },
  };

  return { yaml: toYaml(compose) };
}

function toYaml(obj: ComposeFile): string {
  const lines: string[] = ["services:"];

  for (const [name, svc] of Object.entries(obj.services)) {
    lines.push(`  ${name}:`);
    if (svc.build) {
      lines.push(`    build:`);
      lines.push(`      context: ${svc.build.context}`);
      lines.push(`      dockerfile: ${svc.build.dockerfile}`);
    }
    if (svc.image) lines.push(`    image: ${svc.image}`);
    lines.push(`    container_name: ${svc.container_name}`);
    lines.push(`    command: ${svc.command}`);
    lines.push("    ports:");
    for (const p of svc.ports) lines.push(`      - "${p}"`);
    lines.push("    volumes:");
    for (const v of svc.volumes) lines.push(`      - ${v}`);
    lines.push("    environment:");
    for (const [k, v] of Object.entries(svc.environment)) lines.push(`      ${k}: "${v}"`);
    if (svc.healthcheck) {
      lines.push("    healthcheck:");
      lines.push(`      test: ${JSON.stringify(svc.healthcheck.test)}`);
      lines.push(`      interval: ${svc.healthcheck.interval}`);
      lines.push(`      timeout: ${svc.healthcheck.timeout}`);
      lines.push(`      retries: ${svc.healthcheck.retries}`);
    }
    lines.push(`    restart: ${svc.restart}`);
    lines.push("");
  }

  lines.push("volumes:");
  for (const [name, vol] of Object.entries(obj.volumes)) {
    lines.push(`  ${name}:`);
    lines.push(`    driver: ${vol.driver}`);
  }

  return lines.join("\n");
}

export async function cmdFleetCompose(args: string[]): Promise<void> {
  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : undefined;
  const portIdx = args.indexOf("--port");
  const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : undefined;

  const { yaml } = generateServeCompose({ port });

  if (outputPath) {
    writeFileSync(outputPath, yaml);
    console.log(`\x1b[32m✓\x1b[0m docker-compose.yml written to ${outputPath}`);
    console.log(`\x1b[90m  next: docker compose up -d\x1b[0m`);
  } else {
    console.log(yaml);
    console.log(`\n\x1b[90m# pipe to file: maw fleet compose --output docker-compose.yml\x1b[0m`);
    console.log(`\x1b[90m# then run:    docker compose up -d\x1b[0m`);
  }
}
