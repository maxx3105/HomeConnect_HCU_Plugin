import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { childLogger } from "../logger.js";
import { MINIMAL_SCOPE, scopesFromAppliances } from "./scopes.js";

const log = childLogger("hc-auth");

export class HomeConnectAuth {
  constructor(overrideConfig = {}) {
    this.base         = overrideConfig.baseUrl      ?? config.homeConnect.baseUrl;
    this.clientId     = overrideConfig.clientId     ?? config.homeConnect.clientId;
    this.clientSecret = overrideConfig.clientSecret ?? config.homeConnect.clientSecret;
    this.scopes       = overrideConfig.scopes       ?? null;
    this.tokenFile    = path.resolve(config.tokenStore);
    this.tokens       = null;
    /** Callback: (code, link) → wird aufgerufen sobald Device Code bekannt */
    this.onDeviceCode = null;
  }

  async init() {
    await this.#loadFromDisk();
    if (!this.tokens?.refresh_token) {
      await this.#performDeviceFlow(this.scopes ?? MINIMAL_SCOPE);
    }
    if (this.#accessTokenExpired()) {
      await this.refresh();
    }
  }

  async upgradeScopes(appliances) {
    const fullScopes = scopesFromAppliances(appliances);
    if (fullScopes === (this.scopes ?? MINIMAL_SCOPE)) return false;
    log.info({ scopes: fullScopes }, "Scopes upgrade");
    this.scopes = fullScopes;
    this.tokens = null;
    await this.#performDeviceFlow(fullScopes);
    return true;
  }

  async getAccessToken() {
    if (this.#accessTokenExpired()) await this.refresh();
    return this.tokens.access_token;
  }

  async refresh() {
    log.info("Refreshe Access Token");
    const res = await fetch(`${this.base}/security/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: this.tokens.refresh_token,
        client_secret: this.clientSecret,
      }),
    });
    if (!res.ok) throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
    this.#storeTokenResponse(await res.json());
    await this.#saveToDisk();
  }

  async #performDeviceFlow(scopes) {
    log.info({ scopes }, "Starte Device Authorization Flow");
    const daRes = await fetch(`${this.base}/security/oauth/device_authorization`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.clientId, scope: scopes }),
    });
    if (!daRes.ok) throw new Error(`device_authorization failed: ${daRes.status} ${await daRes.text()}`);
    const da = await daRes.json();

    const code    = da.user_code;
    const link    = da.verification_uri_complete ?? `${da.verification_uri}?user_code=${da.user_code}`;
    const expires = da.expires_in ?? 300;

    log.warn(`\n${'='.repeat(60)}\n  OPEN: ${da.verification_uri}\n  CODE: ${code}\n  DIRECT: ${link}\n${'='.repeat(60)}`);

    // Callback aufrufen damit die UI den Code anzeigen kann
    if (this.onDeviceCode) {
      this.onDeviceCode({ code, link, expires });
    }

    const interval = (da.interval ?? 5) * 1000;
    const deadline = Date.now() + expires * 1000;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      const tokRes = await fetch(`${this.base}/security/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type:  "device_code",
          device_code: da.device_code,
          client_id:   this.clientId,
        }),
      });
      if (tokRes.ok) {
        this.#storeTokenResponse(await tokRes.json());
        await this.#saveToDisk();
        log.info("Autorisierung erfolgreich");
        return;
      }
      const err = await tokRes.json().catch(() => ({}));
      if (err.error === "authorization_pending" || err.error === "slow_down") continue;
      throw new Error(`device flow failed: ${JSON.stringify(err)}`);
    }
    throw new Error("Device flow timed out");
  }

  #storeTokenResponse(data) {
    const now = Math.floor(Date.now() / 1000);
    this.tokens = {
      access_token:  data.access_token,
      refresh_token: data.refresh_token ?? this.tokens?.refresh_token,
      expires_at:    now + (data.expires_in ?? 86400) - 60,
    };
  }

  #accessTokenExpired() {
    if (!this.tokens) return true;
    return Math.floor(Date.now() / 1000) >= this.tokens.expires_at;
  }

  async #loadFromDisk() {
    try {
      this.tokens = JSON.parse(await fs.readFile(this.tokenFile, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") log.warn({ err }, "Token-Datei nicht lesbar");
    }
  }

  async #saveToDisk() {
    await fs.mkdir(path.dirname(this.tokenFile), { recursive: true });
    await fs.writeFile(this.tokenFile, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });
  }
}
