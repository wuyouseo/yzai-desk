import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const AI_PROVIDER_CATALOG_VERSION = 3;

export const AI_PROVIDER_PRESETS = [
  {
    id: "deepseek-openai",
    name: "DeepSeek",
    protocol: "openai",
    base_url: "https://api.deepseek.com",
    model_id: "deepseek-v4-flash",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    capability: "chat",
    description: "OpenAI 兼容 · 国内直连",
    docs_url: "https://api-docs.deepseek.com/",
  },
  {
    id: "deepseek-anthropic",
    name: "DeepSeek（Anthropic）",
    protocol: "anthropic",
    base_url: "https://api.deepseek.com/anthropic",
    model_id: "deepseek-v4-flash",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    capability: "chat",
    description: "Anthropic Messages 兼容",
    docs_url: "https://api-docs.deepseek.com/",
  },
  {
    id: "kimi-default",
    name: "Kimi",
    protocol: "openai",
    base_url: "https://api.moonshot.cn/v1",
    model_id: "kimi-k3",
    models: ["kimi-k3", "kimi-k2.7-code-highspeed", "kimi-k2.6"],
    capability: "chat",
    description: "OpenAI 兼容 · 长上下文",
    docs_url: "https://platform.kimi.com/docs/overview",
  },
  {
    id: "openai-default",
    name: "OpenAI",
    protocol: "openai",
    base_url: "https://api.openai.com/v1",
    model_id: "gpt-4.1-mini",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"],
    capability: "chat",
    description: "Chat Completions 兼容",
    docs_url: "https://platform.openai.com/docs/api-reference/chat",
  },
  {
    id: "anthropic-default",
    name: "Anthropic",
    protocol: "anthropic",
    base_url: "https://api.anthropic.com",
    model_id: "claude-sonnet-4-5",
    models: ["claude-sonnet-4-5", "claude-haiku-4-5"],
    capability: "chat",
    description: "Messages API 兼容",
    docs_url: "https://docs.anthropic.com/en/api/messages",
  },
  {
    id: "agnes-ai",
    name: "Agnes AI",
    protocol: "openai",
    base_url: "https://apihub.agnes-ai.com/v1",
    model_id: "agnes-2.5-flash",
    models: ["agnes-2.5-flash", "agnes-2.0-flash", "agnes-2.5-pro"],
    capability: "chat",
    description: "OpenAI 兼容 · 文本生成",
    docs_url: "https://agnes-ai.cn/zh-Hans/docs/agnes-25-flash",
  },
];

const createPresetProvider = (preset) => ({ ...preset, api_key: "" });
const findPreset = (provider) => AI_PROVIDER_PRESETS.find((preset) => preset.id === provider?.id);

const normalizeProvider = (provider, index) => {
  const source = provider && typeof provider === "object" ? provider : {};
  const preset = findPreset(source);
  return {
    id: source.id || `provider-${index + 1}`,
    name: source.name || preset?.name || `自定义服务 ${index + 1}`,
    protocol: source.protocol === "anthropic" ? "anthropic" : "openai",
    base_url: source.base_url || preset?.base_url || "",
    model_id: source.model_id || preset?.model_id || "",
    models: Array.isArray(source.models) ? source.models.filter(Boolean) : (preset?.models || []),
    capability: "chat",
    description: source.description || preset?.description || "自定义兼容服务",
    docs_url: source.docs_url || preset?.docs_url || "",
    api_key: source.api_key || "",
  };
};

export const DEFAULT_DATA = {
  events: [
    {
      id: "welcome-event",
      title: "规划今天的三件要事",
      time: new Date(new Date().setHours(9, 30, 0, 0)).toISOString(),
      kind: "schedule",
      notes: "",
      remind: true,
      notified_at: null,
      recurring: "none",
      done: false,
    },
  ],
  notes: [
    {
      id: "welcome-note",
      title: "欢迎使用咏智桌面",
      content: "把临时想法、待办和重要片段留在这里。所有数据默认只保存在本机。",
      category: "灵感",
      updated_at: new Date().toISOString(),
      encrypted: false,
    },
  ],
  clipboard: [],
  quadrant_tasks: [],
  pomo_stats: {},
  pomo_minutes: {},
  pomo_state: null,
  ai_conversations: [],
  settings: {
    autostart: false,
    theme: "cloud",
    system_font: "system",
    font_size: 100,
    opacity: 88,
    blur: 22,
    widget_compatibility_mode: true,
    weather_city: "北京市",
    weather_lat: 39.9042,
    weather_lon: 116.4074,
    ai_api_key: "",
    ai_base_url: "https://api.deepseek.com",
    ai_model: "deepseek-chat",
    ai_provider_catalog_version: AI_PROVIDER_CATALOG_VERSION,
    active_ai_provider_id: "deepseek-openai",
    ai_providers: AI_PROVIDER_PRESETS.map(createPresetProvider),
    pomo_duration: 25,
    sensitive_auto_clear: true,
    note_password_config: null,
    mini_widgets: {
      calendar: { visible: false, position: null, size: { width: 300, height: 340 } },
      note: { visible: false, position: null, size: { width: 300, height: 250 } },
      focus: { visible: false, position: null, size: { width: 290, height: 240 } },
      weather: { visible: false, position: null, size: { width: 300, height: 175 } },
    },
  },
};

export const isTauri = () => Boolean(window.__TAURI_INTERNALS__);

export function applyAppearance(settings = {}) {
  const root = document.documentElement;
  const selectedFont = String(settings.system_font || "system").replace(/["\\]/g, "").trim();
  const fontSize = Math.min(125, Math.max(85, Number(settings.font_size) || 100));
  const viewportWidth = Math.max(320, Number(window.innerWidth) || 1280);
  const viewportBoost = Math.min(1.16, Math.max(1, 1 + (viewportWidth - 1280) / 8000));
  const readableScale = 1.32 * viewportBoost * (fontSize / 100);
  root.dataset.theme = settings.theme || "cloud";
  root.style.setProperty(
    "--app-font-family",
    selectedFont === "system"
      ? '"Segoe UI Variable Text", "Segoe UI Variable", "Microsoft YaHei UI", "PingFang SC", sans-serif'
      : `"${selectedFont}", "Microsoft YaHei UI", "Segoe UI Variable Text", sans-serif`,
  );
  root.style.setProperty("--font-scale", readableScale.toFixed(4));
}

const normalizeAIProviders = (settings) => {
  if (Array.isArray(settings.ai_providers) && settings.ai_providers.length) {
    return settings.ai_providers.map(normalizeProvider);
  }
  return [{
    ...createPresetProvider(AI_PROVIDER_PRESETS[0]),
    id: "deepseek-default",
    model_id: settings.ai_model || "deepseek-v4-flash",
    api_key: settings.ai_api_key || "",
  }];
};

const migrateAIProviderCatalog = (providers, storedSettings) => {
  if (Number(storedSettings.ai_provider_catalog_version) >= AI_PROVIDER_CATALOG_VERSION) return providers;
  const agnesPreset = AI_PROVIDER_PRESETS.find((provider) => provider.id === "agnes-ai");
  const normalized = providers.map((provider) => {
    if (provider.id === "deepseek-default") {
      return { ...provider, id: "deepseek-openai", model_id: provider.model_id === "deepseek-chat" ? "deepseek-v4-flash" : provider.model_id };
    }
    if (provider.id === "agnes-image") {
      return {
        ...provider,
        ...agnesPreset,
        id: "agnes-ai",
        api_key: provider.api_key || "",
        model_id: provider.model_id === "agnes-image-2.5-flash" ? agnesPreset.model_id : provider.model_id,
      };
    }
    return provider;
  });
  const presentIds = new Set(normalized.map((provider) => provider.id));
  return [...normalized, ...AI_PROVIDER_PRESETS.filter((preset) => !presentIds.has(preset.id)).map(createPresetProvider)];
};

const normalizeEvents = (events) => events.map((event) => {
  const kind = ["schedule", "reminder", "memo"].includes(event.kind) ? event.kind : "schedule";
  return {
    ...event,
    kind,
    notes: event.notes || "",
    remind: kind === "memo" ? false : event.remind !== false,
    notified_at: event.notified_at || null,
  };
});

const normalizeNotes = (notes) => notes
  .filter((note) => note && typeof note === "object" && !Array.isArray(note))
  .map((note, index) => {
    const updatedAt = new Date(note.updated_at);
    return {
      ...note,
      id: String(note.id || `legacy-note-${index + 1}`),
      title: String(note.title || "未命名备忘录"),
      content: typeof note.content === "string" ? note.content : "",
      category: String(note.category || "随记"),
      updated_at: Number.isNaN(updatedAt.getTime()) ? new Date(0).toISOString() : updatedAt.toISOString(),
      encrypted: Boolean(note.encrypted),
      pinned: Boolean(note.pinned),
      ciphertext: typeof note.ciphertext === "string" ? note.ciphertext : "",
      salt: typeof note.salt === "string" ? note.salt : "",
      iv: typeof note.iv === "string" ? note.iv : "",
    };
  });

const QUADRANT_IDS = [
  "urgent-important",
  "important-not-urgent",
  "urgent-not-important",
  "not-urgent-not-important",
];

const normalizeQuadrantTasks = (tasks) => (
  Array.isArray(tasks) ? tasks : []
).filter((task) => task && typeof task === "object" && !Array.isArray(task) && String(task.title || "").trim()).map((task, index) => ({
  id: String(task.id || `quadrant-task-${index + 1}`),
  title: String(task.title).trim().slice(0, 120),
  quadrant: QUADRANT_IDS.includes(task.quadrant) ? task.quadrant : "important-not-urgent",
  done: Boolean(task.done),
  created_at: task.created_at || new Date().toISOString(),
  updated_at: task.updated_at || task.created_at || new Date().toISOString(),
}));

const normalizeAIConversations = (conversations) => (
  Array.isArray(conversations) ? conversations : []
).filter((conversation) => conversation && Array.isArray(conversation.messages)).map((conversation, index) => ({
  id: conversation.id || `conversation-${index + 1}`,
  title: String(conversation.title || "新对话").slice(0, 80),
  created_at: conversation.created_at || new Date().toISOString(),
  updated_at: conversation.updated_at || conversation.created_at || new Date().toISOString(),
  messages: conversation.messages.filter((message) => message && ["user", "assistant", "system"].includes(message.role)).map((message) => ({
    id: message.id || `message-${Math.random().toString(36).slice(2)}`,
    role: message.role,
    content: String(message.content || ""),
    created_at: message.created_at || conversation.updated_at || new Date().toISOString(),
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
  })),
}));

const mergeData = (raw = {}) => {
  const storedSettings = { ...(raw.settings || {}) };
  delete storedSettings.widget_locked;
  delete storedSettings.widget_position;
  delete storedSettings.widget_size;
  const settings = { ...DEFAULT_DATA.settings, ...storedSettings };
  settings.mini_widgets = Object.fromEntries(
    Object.entries(DEFAULT_DATA.settings.mini_widgets).map(([kind, defaults]) => [
      kind,
      { ...defaults, ...(raw.settings?.mini_widgets?.[kind] || {}) },
    ]),
  );
  settings.theme = settings.theme === "dark" ? "obsidian" : settings.theme;
  settings.ai_providers = migrateAIProviderCatalog(normalizeAIProviders(settings), storedSettings);
  settings.ai_provider_catalog_version = AI_PROVIDER_CATALOG_VERSION;
  if (settings.active_ai_provider_id === "agnes-image") settings.active_ai_provider_id = "agnes-ai";
  const activeProvider = settings.ai_providers.find((provider) => provider.id === settings.active_ai_provider_id);
  if (!activeProvider || activeProvider.capability !== "chat") {
    settings.active_ai_provider_id = settings.ai_providers.find((provider) => provider.capability === "chat")?.id || settings.ai_providers[0]?.id;
  }
  return {
    ...DEFAULT_DATA,
    ...raw,
    events: normalizeEvents(Array.isArray(raw.events) ? raw.events : DEFAULT_DATA.events),
    notes: normalizeNotes(Array.isArray(raw.notes) ? raw.notes : DEFAULT_DATA.notes),
    clipboard: Array.isArray(raw.clipboard) ? raw.clipboard : [],
    quadrant_tasks: normalizeQuadrantTasks(raw.quadrant_tasks),
    pomo_stats: raw.pomo_stats || {},
    pomo_minutes: raw.pomo_minutes || {},
    pomo_state: raw.pomo_state || null,
    ai_conversations: normalizeAIConversations(raw.ai_conversations),
    settings,
  };
};

export const getActiveAIProvider = (settings = {}) => {
  const providers = normalizeAIProviders(settings);
  return providers.find((provider) => provider.id === settings.active_ai_provider_id && provider.capability === "chat")
    || providers.find((provider) => provider.capability === "chat")
    || providers[0];
};

export async function loadData() {
  if (isTauri()) return mergeData(await invoke("get_data"));

  try {
    return mergeData(JSON.parse(localStorage.getItem("yzai-desk-preview") || "{}"));
  } catch {
    return mergeData();
  }
}

export async function saveData(data, changedSections) {
  const normalized = mergeData(data);
  if (isTauri()) {
    const saved = await invoke("save_data", { data: normalized, changedSections: changedSections ?? null });
    return mergeData(saved);
  }
  localStorage.setItem("yzai-desk-preview", JSON.stringify(normalized));
  return normalized;
}

export async function callCommand(command, args = {}) {
  if (isTauri()) return invoke(command, args);
  return null;
}

export async function subscribe(event, handler) {
  if (!isTauri()) return () => {};
  return listen(event, ({ payload }) => handler(payload));
}

export function exportBackup(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `yzai-desk-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function readBackup(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!Array.isArray(data.events) || !Array.isArray(data.notes) || !data.settings) {
          throw new Error("这不是有效的咏智桌面备份文件");
        }
        resolve(mergeData(data));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error("无法读取备份文件"));
    reader.readAsText(file);
  });
}

const bytesToBase64 = (bytes) => {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const base64ToBytes = (value) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

let cachedNotePassword = "";

export const setCachedNotePassword = (password) => { cachedNotePassword = password || ""; };
export const getCachedNotePassword = () => cachedNotePassword;

async function derivePasswordVerifier(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" },
    material,
    256,
  );
  return new Uint8Array(bits);
}

export async function createNotePasswordConfig(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier = await derivePasswordVerifier(password, salt);
  return { salt: bytesToBase64(salt), verifier: bytesToBase64(verifier), updated_at: new Date().toISOString() };
}

export async function verifyNotePassword(password, config) {
  if (!password || !config?.salt || !config?.verifier) return false;
  const actual = await derivePasswordVerifier(password, base64ToBytes(config.salt));
  const expected = base64ToBytes(config.verifier);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  actual.forEach((value, index) => { difference |= value ^ expected[index]; });
  return difference === 0;
}

async function deriveNoteKey(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptNote(content, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveNoteKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(content),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
  };
}

export async function decryptNote(note, password) {
  try {
    const key = await deriveNoteKey(password, base64ToBytes(note.salt));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(note.iv) },
      key,
      base64ToBytes(note.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("密码不正确，无法解锁这条备忘录");
  }
}

export async function askAI(messages, settings, onChunk) {
  const provider = getActiveAIProvider(settings);
  if (!provider?.api_key) throw new Error("请先在系统设置中填写当前 AI 服务的 API Key");
  if (!provider.base_url) throw new Error("请填写 AI 服务的 Base URL");
  if (!provider.model_id) throw new Error("请填写 AI 服务的模型 ID");

  const base = provider.base_url.replace(/\/$/, "");
  const versionedBase = base.endsWith("/v1") ? base : `${base}/v1`;
  const isAnthropic = provider.protocol === "anthropic";
  const endpoint = isAnthropic ? `${versionedBase}/messages` : `${versionedBase}/chat/completions`;
  const headers = isAnthropic
    ? {
      "Content-Type": "application/json",
      "x-api-key": provider.api_key,
      "anthropic-version": "2023-06-01",
    }
    : {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.api_key}`,
    };
  const serializeMessage = (message) => {
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const textAttachments = attachments.filter((attachment) => attachment.kind === "text" && attachment.text);
    const text = [
      message.content || "",
      ...textAttachments.map((attachment) => `\n\n--- 附件：${attachment.name} ---\n${attachment.text}`),
    ].join("").trim();
    const richAttachments = attachments.filter((attachment) => ["image", "pdf"].includes(attachment.kind) && attachment.data_url);

    if (!richAttachments.length) return { role: message.role, content: text };
    if (isAnthropic) {
      return {
        role: message.role,
        content: [
          ...(text ? [{ type: "text", text }] : []),
          ...richAttachments.map((attachment) => {
            const data = attachment.data_url.split(",")[1] || "";
            if (attachment.kind === "pdf") {
              return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
            }
            return { type: "image", source: { type: "base64", media_type: attachment.type || "image/png", data } };
          }),
        ],
      };
    }
    return {
      role: message.role,
      content: [
        ...(text ? [{ type: "text", text }] : []),
        ...richAttachments.map((attachment) => attachment.kind === "pdf"
          ? { type: "file", file: { filename: attachment.name, file_data: attachment.data_url } }
          : { type: "image_url", image_url: { url: attachment.data_url, detail: "auto" } }),
      ],
    };
  };
  const providerMessages = messages.map(serializeMessage);
  const body = isAnthropic
    ? {
      model: provider.model_id,
      messages: providerMessages.filter((message) => message.role !== "system"),
      system: providerMessages.find((message) => message.role === "system")?.content,
      max_tokens: 2048,
      stream: true,
    }
    : {
      model: provider.model_id,
      messages: providerMessages,
      stream: true,
      temperature: 0.6,
    };

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI 服务返回 ${response.status}${detail ? `：${detail.slice(0, 160)}` : ""}`);
  }
  if (!response.body) throw new Error("当前 AI 服务不支持流式响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const body = line.slice(5).trim();
      if (!body || body === "[DONE]") continue;
      try {
        const payload = JSON.parse(body);
        const chunk = isAnthropic
          ? payload.type === "content_block_delta" ? payload.delta?.text || "" : ""
          : payload.choices?.[0]?.delta?.content || "";
        answer += chunk;
        onChunk(answer);
      } catch {
        // Ignore provider heartbeat lines that are not JSON payloads.
      }
    }
  }
  return answer;
}
