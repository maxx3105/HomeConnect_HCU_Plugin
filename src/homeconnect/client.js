import { config } from "../config.js";
import { childLogger } from "../logger.js";

const log = childLogger("hc-api");

/**
 * Minimaler REST-Client für die Home Connect API.
 * Spec: https://api-docs.home-connect.com/
 *
 * Alle GET-Antworten haben Form { data: {...} }. Fehler kommen mit { error: {...} }.
 */
export class HomeConnectClient {
  constructor(auth) {
    this.auth = auth;
    this.base = config.homeConnect.baseUrl;
  }

  async #request(method, pathname, { body, query } = {}) {
    const token = await this.auth.getAccessToken();
    const url = new URL(this.base + pathname);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.bsh.sdk.v1+json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/vnd.bsh.sdk.v1+json";

    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // Rate-Limit: HC liefert Retry-After in Sekunden
    if (res.status === 429) {
      const retry = parseInt(res.headers.get("Retry-After") ?? "10", 10);
      log.warn({ url: url.toString(), retry }, "HC rate limit hit, backing off");
      await new Promise((r) => setTimeout(r, retry * 1000));
      return this.#request(method, pathname, { body, query });
    }

    if (res.status === 204) return null;
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(
        `HC ${method} ${pathname} -> ${res.status}: ${json?.error?.description ?? text}`
      );
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json?.data ?? json;
  }

  // --- Appliance Discovery -------------------------------------------------
  /** Alle Geräte des Nutzers. */
  async listAppliances() {
    const data = await this.#request("GET", "/api/homeappliances");
    return data.homeappliances ?? [];
  }

  /** Einzelnes Gerät. */
  async getAppliance(haId) {
    return this.#request("GET", `/api/homeappliances/${haId}`);
  }

  // --- Status / Settings ---------------------------------------------------
  async getStatus(haId) {
    const d = await this.#request("GET", `/api/homeappliances/${haId}/status`);
    return d?.status ?? [];
  }

  async getSettings(haId) {
    const d = await this.#request("GET", `/api/homeappliances/${haId}/settings`);
    return d?.settings ?? [];
  }

  async setSetting(haId, settingKey, value) {
    return this.#request("PUT", `/api/homeappliances/${haId}/settings/${settingKey}`, {
      body: { data: { key: settingKey, value } },
    });
  }

  // --- Programs ------------------------------------------------------------
  async getActiveProgram(haId) {
    try {
      return await this.#request("GET", `/api/homeappliances/${haId}/programs/active`);
    } catch (err) {
      if (err.status === 404 || err.status === 409) return null;
      throw err;
    }
  }

  async getSelectedProgram(haId) {
    try {
      return await this.#request("GET", `/api/homeappliances/${haId}/programs/selected`);
    } catch (err) {
      if (err.status === 404 || err.status === 409) return null;
      throw err;
    }
  }

  async listAvailablePrograms(haId) {
    try {
      const d = await this.#request("GET", `/api/homeappliances/${haId}/programs/available`);
      return d?.programs ?? [];
    } catch (err) {
      if (err.status === 409) return [];
      throw err;
    }
  }

  async startProgram(haId, programKey, options = []) {
    return this.#request("PUT", `/api/homeappliances/${haId}/programs/active`, {
      body: { data: { key: programKey, options } },
    });
  }

  async stopProgram(haId) {
    return this.#request("DELETE", `/api/homeappliances/${haId}/programs/active`);
  }

  async selectProgram(haId, programKey, options = []) {
    return this.#request("PUT", `/api/homeappliances/${haId}/programs/selected`, {
      body: { data: { key: programKey, options } },
    });
  }

  // --- Commands (Partial Remote Start u. a.) -------------------------------
  async sendCommand(haId, commandKey, value = true) {
    return this.#request("PUT", `/api/homeappliances/${haId}/commands/${commandKey}`, {
      body: { data: { key: commandKey, value } },
    });
  }
}
