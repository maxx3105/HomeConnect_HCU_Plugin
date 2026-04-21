import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { childLogger } from "../logger.js";

const log = childLogger("hc-auth");

/**
 * Home Connect OAuth2 Device Flow.
 *
 * Endpoints:
 *   POST {base}/security/oauth/device_authorization
 *   POST {base}/security/oauth/token                 (grant_type=device_code)
 *   POST {base}/security/oauth/token                 (grant_type=refresh_token)
 *
 * Spec: https://api-docs.home-connect.com/authorization/#device-flow
 */
export class HomeConnectAuth {
  constructor() {
    this.base = config.homeConnect.baseUrl;
    this.clientId = config.homeConnect.clientId;
    this.clientSecret = config.homeConnect.clientSecret;
    this.scopes = config.homeConnect.scopes;
    this.tokenFile = path.resolve(config.tokenStore);

    /** @type {?{access_token:string, refresh_token:string, expires_at:number}} */
    this.tokens = null;
  }

  async init() {
    await this.#loadFromDisk();
    if (!this.tokens?.refresh_token) {
      await this.#performDeviceFlow();
    }
    if (this.#accessTokenExpired()) {
      await this.refresh();
    }
  }

  async getAccessToken() {
    if (this.#accessTokenExpired()) {
      await this.refresh();
    }
    return this.tokens.access_token;
  }

  async refresh() {
    log.info("Refreshing Home Connect access token");
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.tokens.refresh_token,
      client_secret: this.clientSecret,
    });
    const res = await fetch(`${this.base}/security/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Refresh failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    this.#storeTokenResponse(data);
    await this.#saveToDisk();
  }

  async #performDeviceFlow() {
    log.info("Starting Home Connect Device Authorization flow");
    const daBody = new URLSearchParams({
      client_id: this.clientId,
      scope: this.scopes,
    });
    const daRes = await fetch(`${this.base}/security/oauth/device_authorization`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: daBody,
    });
    if (!daRes.ok) {
      const t = await daRes.text();
      throw new Error(`device_authorization failed: ${daRes.status} ${t}`);
    }
    const da = await daRes.json();

    log.warn(
      { user_code: da.user_code, verification_uri: da.verification_uri },
      `\n\n============================================================\n` +
        `  OPEN: ${da.verification_uri}\n` +
        `  ENTER CODE: ${da.user_code}\n` +
        (da.verification_uri_complete
          ? `  OR DIRECT: ${da.verification_uri_complete}\n`
          : "") +
        `  Expires in ${da.expires_in}s\n` +
        `============================================================\n`
    );

    const interval = (da.interval ?? 5) * 1000;
    const deadline = Date.now() + (da.expires_in ?? 300) * 1000;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));

      const tokRes = await fetch(`${this.base}/security/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "device_code",
          device_code: da.device_code,
          client_id: this.clientId,
        }),
      });
      if (tokRes.ok) {
        this.#storeTokenResponse(await tokRes.json());
        await this.#saveToDisk();
        log.info("Home Connect authorization successful");
        return;
      }
      const err = await tokRes.json().catch(() => ({}));
      if (err.error === "authorization_pending" || err.error === "slow_down") {
        continue;
      }
      throw new Error(`device flow failed: ${JSON.stringify(err)}`);
    }
    throw new Error("Home Connect device flow timed out");
  }

  #storeTokenResponse(data) {
    const now = Math.floor(Date.now() / 1000);
    this.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? this.tokens?.refresh_token,
      // treat token as expired 60s early to avoid race conditions
      expires_at: now + (data.expires_in ?? 86400) - 60,
    };
  }

  #accessTokenExpired() {
    if (!this.tokens) return true;
    return Math.floor(Date.now() / 1000) >= this.tokens.expires_at;
  }

  async #loadFromDisk() {
    try {
      const raw = await fs.readFile(this.tokenFile, "utf8");
      this.tokens = JSON.parse(raw);
      log.debug("Loaded tokens from disk");
    } catch (err) {
      if (err.code !== "ENOENT") log.warn({ err }, "Could not load token file");
    }
  }

  async #saveToDisk() {
    await fs.mkdir(path.dirname(this.tokenFile), { recursive: true });
    await fs.writeFile(this.tokenFile, JSON.stringify(this.tokens, null, 2), {
      mode: 0o600,
    });
  }
}
