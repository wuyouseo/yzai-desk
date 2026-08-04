globalThis.window = {};
globalThis.localStorage = {
  getItem: () => JSON.stringify({
    settings: {
      ai_api_key: "legacy-key",
      ai_model: "deepseek-chat",
      ai_provider_catalog_version: 2,
      active_ai_provider_id: "deepseek-default",
      ai_providers: [
        {
          id: "deepseek-default",
          name: "DeepSeek",
          protocol: "openai",
          base_url: "https://api.deepseek.com",
          model_id: "deepseek-chat",
          api_key: "legacy-key",
        },
        {
          id: "agnes-image",
          name: "Agnes AI",
          protocol: "openai",
          base_url: "https://apihub.agnes-ai.com/v1",
          model_id: "agnes-image-2.5-flash",
          capability: "image",
          api_key: "agnes-legacy-key",
        },
      ],
    },
  }),
};

const api = await import("../src/lib/deskApi.js");
const data = await api.loadData();
const providers = data.settings.ai_providers;
const active = api.getActiveAIProvider(data.settings);
const deepseek = providers.find((provider) => provider.id === "deepseek-openai");
const agnes = providers.find((provider) => provider.id === "agnes-ai");
const result = {
  catalogVersion: data.settings.ai_provider_catalog_version,
  providerCount: providers.length,
  activeProviderId: active?.id,
  legacyKeyPreserved: deepseek?.api_key === "legacy-key",
  deepseekModel: deepseek?.model_id,
  agnesCapability: agnes?.capability,
  agnesModel: agnes?.model_id,
  agnesKeyPreserved: agnes?.api_key === "agnes-legacy-key",
};

if (
  result.catalogVersion !== 3
  || result.providerCount !== 6
  || result.activeProviderId !== "deepseek-openai"
  || !result.legacyKeyPreserved
  || result.agnesCapability !== "chat"
  || result.agnesModel !== "agnes-2.5-flash"
  || !result.agnesKeyPreserved
) {
  throw new Error(`AI provider migration check failed: ${JSON.stringify(result)}`);
}

console.log(JSON.stringify(result));
