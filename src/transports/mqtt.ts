/**
 * MQTT transport — cross-host real-time messaging via mqtt.js.
 *
 * Topic structure:
 *   oracle/{name}/inbox       — direct messages to an oracle
 *   oracle/{name}/status      — presence (busy/ready/idle/crashed)
 *   oracle/{name}/heartbeat   — alive ping
 *   fleet/{host}/sessions     — session list broadcast
 *   fleet/{host}/feed         — feed events (real-time)
 *
 * Uses mqtt.js (standard MQTT client) over WebSocket or TCP.
 */

import mqtt from "mqtt";
import type { Transport, TransportTarget, TransportMessage, TransportPresence } from "../transport";
import type { FeedEvent } from "../lib/feed";

export interface MqttConfig {
  broker: string;          // e.g. "ws://localhost:9001" or "mqtt://localhost:1883"
  clientId?: string;
  username?: string;
  password?: string;
  selfName: string;        // this host's oracle fleet name
  selfHost: string;        // this host's hostname
}

export class MqttTransport implements Transport {
  readonly name = "mqtt";
  private _connected = false;
  private client: mqtt.MqttClient | null = null;
  private config: MqttConfig;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private msgHandlers = new Set<(msg: TransportMessage) => void>();
  private presenceHandlers = new Set<(p: TransportPresence) => void>();
  private feedHandlers = new Set<(e: FeedEvent) => void>();

  constructor(config: MqttConfig) {
    this.config = config;
  }

  get connected() { return this._connected; }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const clientId = this.config.clientId || `maw-${this.config.selfHost}-${Date.now()}`;
      const opts: mqtt.IClientOptions = {
        clientId,
        clean: true,
        keepalive: 60,
        connectTimeout: 10_000,
        username: this.config.username || undefined,
        password: this.config.password || undefined,
      };

      try {
        this.client = mqtt.connect(this.config.broker, opts);

        this.client.on("connect", () => {
          this._connected = true;
          this.subscribeTopics();
          this.startHeartbeat();
          console.log(`[mqtt] connected to ${this.config.broker}`);
          resolve();
        });

        this.client.on("message", (topic: string, payload: Buffer) => {
          this.handleIncoming(topic, payload.toString());
        });

        this.client.on("close", () => {
          this._connected = false;
          this.stopHeartbeat();
        });

        this.client.on("error", (err) => {
          console.error("[mqtt] error:", err.message);
          if (!this._connected) reject(err);
        });

        this.client.on("reconnect", () => {
          console.log("[mqtt] reconnecting...");
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    this._connected = false;
  }

  async send(target: TransportTarget, message: string): Promise<boolean> {
    if (!this.client || !this._connected) return false;

    const topic = `oracle/${target.oracle}/inbox`;
    const payload = JSON.stringify({
      from: this.config.selfName,
      body: message,
      timestamp: Date.now(),
    });

    return new Promise((resolve) => {
      this.client!.publish(topic, payload, { qos: 0 }, (err) => {
        resolve(!err);
      });
    });
  }

  async publishPresence(presence: TransportPresence): Promise<void> {
    if (!this.client || !this._connected) return;
    const topic = `oracle/${presence.oracle}/status`;
    this.client.publish(topic, JSON.stringify(presence), { qos: 0 });
  }

  async publishFeed(event: FeedEvent): Promise<void> {
    if (!this.client || !this._connected) return;
    const topic = `fleet/${this.config.selfHost}/feed`;
    this.client.publish(topic, JSON.stringify(event), { qos: 0 });
  }

  onMessage(handler: (msg: TransportMessage) => void) {
    this.msgHandlers.add(handler);
  }

  onPresence(handler: (p: TransportPresence) => void) {
    this.presenceHandlers.add(handler);
  }

  onFeed(handler: (e: FeedEvent) => void) {
    this.feedHandlers.add(handler);
  }

  /** MQTT can reach any remote target */
  canReach(target: TransportTarget): boolean {
    return !!target.host && target.host !== "local" && target.host !== "localhost";
  }

  // --- Private ---

  private subscribeTopics() {
    if (!this.client) return;

    this.client.subscribe([
      "oracle/+/inbox",
      "oracle/+/status",
      "oracle/+/heartbeat",
      "fleet/+/feed",
      "fleet/+/sessions",
    ], { qos: 0 });
  }

  private handleIncoming(topic: string, payload: string) {
    const parts = topic.split("/");

    try {
      // oracle/{name}/inbox → message
      if (parts[0] === "oracle" && parts[2] === "inbox") {
        const msg = JSON.parse(payload);
        for (const h of this.msgHandlers) {
          h({
            from: msg.from || "unknown",
            to: parts[1],
            body: msg.body || msg.message || payload,
            timestamp: msg.timestamp || Date.now(),
            transport: "mqtt",
          });
        }
      }

      // oracle/{name}/status → presence
      if (parts[0] === "oracle" && parts[2] === "status") {
        const p = JSON.parse(payload);
        for (const h of this.presenceHandlers) h(p);
      }

      // fleet/{host}/feed → feed event (skip own)
      if (parts[0] === "fleet" && parts[2] === "feed") {
        if (parts[1] !== this.config.selfHost) {
          const event = JSON.parse(payload);
          for (const h of this.feedHandlers) h(event);
        }
      }
    } catch {
      // Malformed payload — ignore
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.client && this._connected) {
        const topic = `oracle/${this.config.selfName}/heartbeat`;
        this.client.publish(topic, JSON.stringify({
          host: this.config.selfHost,
          timestamp: Date.now(),
        }), { qos: 0 });
      }
    }, 30_000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null; }
  }
}
