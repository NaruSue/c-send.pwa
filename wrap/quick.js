const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
if (typeof invoke !== "function" || typeof listen !== "function") throw new Error("Tauri bridge is unavailable");

const itemsEl = document.querySelector("#items");
const searchEl = document.querySelector("#search");
const statusEl = document.querySelector("#status");
let items = [];

function render() {
  const q = searchEl.value.trim().toLocaleLowerCase();
  const matches = items.filter(x => !q || [x.title, x.value, ...x.tags].some(v => String(v).toLocaleLowerCase().includes(q))).slice(0, 20);
  itemsEl.replaceChildren();
  for (const item of matches) {
    const button = document.createElement("button"); button.className = "item"; button.type = "button";
    const title = document.createElement("span"); title.className = "title"; title.textContent = item.title;
    const meta = document.createElement("span"); meta.className = "meta"; meta.textContent = `${item.tags.join(" · ")}${item.mode === "template" ? " · テンプレート" : ""}`;
    button.append(title, meta); button.addEventListener("click", async () => {
      button.disabled = true; statusEl.textContent = "コピー中…";
      try { await invoke("desktop_select_item", { itemId: item.id }); statusEl.textContent = "コピーしました"; }
      catch { statusEl.textContent = "コピーできませんでした"; button.disabled = false; }
    }); itemsEl.append(button);
  }
  if (!matches.length) { const empty = document.createElement("div"); empty.textContent = "項目がありません"; empty.style.padding = "16px 8px"; itemsEl.append(empty); }
}

await listen("quick-list-updated", event => { items = event.payload?.items || []; render(); });
await listen("quick-list-opened", () => { searchEl.value = ""; statusEl.textContent = ""; render(); searchEl.focus(); });
searchEl.addEventListener("input", render);
document.querySelector("#open").addEventListener("click", () => invoke("desktop_show_main"));
items = await invoke("desktop_get_quick_list"); render();
