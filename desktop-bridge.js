/* c-send PWA / Tauri 2 bridge. This is inactive in a regular browser. */
(() => {
  "use strict";

  const API_VERSION = 1;
  const EVENTS = Object.freeze({
    templateResolve: "c-send-template-resolve",
    itemUsed: "c-send-item-used",
    log: "c-send-log"
  });

  function tauri() {
    const api = globalThis.__TAURI__;
    return api?.core?.invoke && api?.event?.listen ? api : null;
  }

  function invoke(command, args) {
    const api = tauri();
    if (!api) return Promise.reject(new Error("デスクトップ連携は利用できません"));
    return api.core.invoke(command, args);
  }

  function listen(eventName, callback) {
    const api = tauri();
    if (!api || typeof callback !== "function") return Promise.resolve(() => {});
    return api.event.listen(eventName, event => callback(event?.payload));
  }

  function normalizeQuickList(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.items)) throw new TypeError("quick list items are required");
    return {
      apiVersion: API_VERSION,
      items: snapshot.items.slice(0, 20).map(item => {
        if (!item || typeof item.id !== "string" || !item.id || typeof item.title !== "string" || typeof item.value !== "string") {
          throw new TypeError("quick list items require an id, title, and value");
        }
        return {
          id: item.id,
          title: item.title,
          value: item.value,
          mode: item.mode === "template" ? "template" : "plain",
          tags: Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === "string") : [],
          source: typeof item.source === "string" ? item.source : ""
        };
      })
    };
  }

  globalThis.CsendDesktop = Object.freeze({
    apiVersion: API_VERSION,
    events: EVENTS,
    get available() { return Boolean(tauri()); },
    async getInfo() {
      if (!tauri()) return null;
      return invoke("desktop_get_info", { apiVersion: API_VERSION });
    },
    async publishQuickList(snapshot) {
      if (!tauri()) return false;
      await invoke("desktop_publish_quick_list", { snapshot: normalizeQuickList(snapshot) });
      return true;
    },
    onTemplateResolve(callback) { return listen(EVENTS.templateResolve, callback); },
    async respondTemplate(requestId, itemId, result) {
      if (!tauri()) return false;
      const payload = result?.error
        ? { error: "template_resolution_failed" }
        : { payload: { text: String(result?.text ?? "") } };
      await invoke("desktop_respond_template", {
        requestId: String(requestId).slice(0, 200),
        itemId: String(itemId).slice(0, 200),
        ...payload
      });
      return true;
    },
    onItemUsed(callback) { return listen(EVENTS.itemUsed, callback); },
    onLog(callback) { return listen(EVENTS.log, callback); },
    async setAlwaysOnTop(enabled) {
      if (typeof enabled !== "boolean") throw new TypeError("enabled must be a boolean");
      if (!tauri()) return false;
      await invoke("desktop_set_always_on_top", { enabled });
      return true;
    }
  });
})();
