import assert from "node:assert/strict";
import { askAI } from "../src/lib/deskApi.js";

const settings = { active_ai_provider_id: "test", ai_providers: [{ id: "test", name: "Test", protocol: "openai", base_url: "https://example.test/v1", model_id: "test-model", capability: "chat", api_key: "test-key" }] };
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n'));
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"世界"}}]}'));
      controller.close();
    },
  }), { status: 200 });
  const chunks = [];
  assert.equal(await askAI([{ role: "user", content: "test" }], settings, (text) => chunks.push(text)), "你好世界");
  assert.deepEqual(chunks, ["你好", "你好世界"]);
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  await assert.rejects(() => askAI([], settings, () => {}, { timeoutMs: 20 }), /超时/);
  const controller = new AbortController();
  const request = askAI([], settings, () => {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(request, /停止生成/);
  console.log("AI 流式结束、超时和主动停止检查通过");
} finally { globalThis.fetch = originalFetch; }
