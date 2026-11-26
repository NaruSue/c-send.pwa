const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const bridgeSource = fs.readFileSync(path.join(root, "desktop-bridge.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

async function testBrowserFallback() {
  const context = { console };
  vm.runInNewContext(bridgeSource, context);
  assert.equal(context.CsendDesktop.available, false);
  assert.equal(await context.CsendDesktop.getInfo(), null);
  assert.equal(await context.CsendDesktop.publishQuickList({ items: [] }), false);
  assert.equal(typeof await context.CsendDesktop.onItemUsed(() => {}), "function");
}

async function testTauriBridge() {
  const calls = [];
  const listeners = new Map();
  const context = {
    console,
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push({ command, args });
          if (command === "desktop_get_info") return { wrapperVersion: "0.0.1", os: "windows", capabilities: [] };
        }
      },
      event: {
        listen: async (name, callback) => {
          listeners.set(name, callback);
          return () => listeners.delete(name);
        }
      }
    }
  };
  vm.runInNewContext(bridgeSource, context);
  const api = context.CsendDesktop;
  assert.equal(api.available, true);
  assert.equal(api.apiVersion, 1);
  assert.deepEqual(await api.getInfo(), { wrapperVersion: "0.0.1", os: "windows", capabilities: [] });

  const rows = Array.from({ length: 24 }, (_, index) => ({
    id: `item-${index}`,
    title: `title-${index}`,
    value: `value-${index}`,
    mode: index === 0 ? "template" : "plain",
    tags: ["tag"],
    source: "local",
    secretExtra: "must not cross bridge"
  }));
  assert.equal(await api.publishQuickList({ items: rows }), true);
  const listCall = calls.find(call => call.command === "desktop_publish_quick_list");
  assert.equal(listCall.args.snapshot.items.length, 20);
  assert.equal(listCall.args.snapshot.items[0].mode, "template");
  assert.equal(listCall.args.snapshot.items[0].value, "value-0");
  assert.equal("secretExtra" in listCall.args.snapshot.items[0], false);

  let resolved;
  await api.onTemplateResolve(request => { resolved = request; });
  await listeners.get("c-send-template-resolve")({ payload: { requestId: "r1", itemId: "item-0", context: { clipboardText: "clip" } } });
  assert.deepEqual(resolved, { requestId: "r1", itemId: "item-0", context: { clipboardText: "clip" } });
  await api.respondTemplate("r1", "item-0", { text: "expanded" });
  const reply = calls.find(call => call.command === "desktop_respond_template");
  assert.equal(JSON.stringify(reply.args), JSON.stringify({ requestId: "r1", itemId: "item-0", payload: { text: "expanded" } }));

  let used;
  await api.onItemUsed(message => { used = message; });
  await listeners.get("c-send-item-used")({ payload: { itemId: "item-0", usedAt: "2026-11-27T00:00:00.000Z" } });
  assert.deepEqual(used, { itemId: "item-0", usedAt: "2026-11-27T00:00:00.000Z" });

  assert.equal(await api.setAlwaysOnTop(true), true);
  assert.equal(calls.at(-1).command, "desktop_set_always_on_top");
  assert.equal(JSON.stringify(calls.at(-1).args), JSON.stringify({ enabled: true }));
}

async function main() {
  await testBrowserFallback();
  await testTauriBridge();
  assert.match(html, /desktop-bridge\.js\?v=0\.2\.1/);
  assert.match(html, /CsendDesktop\.onTemplateResolve/);
  assert.match(html, /CsendDesktop\.onItemUsed/);
  console.log("Desktop bridge tests passed");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
