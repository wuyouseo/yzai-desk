const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const CHINESE_PATTERN = /[\u3400-\u9fff]/;
const ADMINISTRATIVE_SUFFIX = /(特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|自治州|地区|新区|林区|市|区|县|盟)$/;
const PROVINCE_NAMES = [
  "黑龙江", "内蒙古", "北京", "天津", "上海", "重庆", "河北", "山西", "辽宁", "吉林",
  "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东",
  "广西", "海南", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏",
  "新疆", "台湾", "香港", "澳门",
];
const FEATURE_SCORES = {
  PPLC: 820,
  PPLA: 780,
  PPLA2: 720,
  PPLA3: 640,
  ADM1: 560,
  ADM2: 500,
  PPL: 460,
  PPLA4: 380,
  ADM3: 340,
  PPLX: 260,
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const requestWithRetry = async (url, { signal, fetcher, attempts = 3 }) => {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetcher(url, { signal });
      const retryableStatus = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryableStatus || attempt === attempts - 1) return response;
      lastError = new Error(`天气服务暂时不可用（${response.status}）`);
    } catch (error) {
      lastError = error;
      if (signal?.aborted || attempt === attempts - 1) break;
    }
    await wait(300 * (2 ** attempt));
  }
  throw new Error(signal?.aborted ? "天气查询超时，请稍后重试" : `无法连接天气服务：${lastError?.message || "网络异常"}`);
};

const stripAdministrativeSuffix = (value) => String(value || "").trim().replace(ADMINISTRATIVE_SUFFIX, "");

const normalizePlaceName = (value) => stripAdministrativeSuffix(value)
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[\s'’·,，.。()-]/g, "");

const extractProvinceHint = (query) => {
  const normalized = String(query || "").replace(/\s/g, "");
  const province = PROVINCE_NAMES.find((name) => normalized.length > name.length && normalized.includes(name));
  if (!province) return { province: "", place: normalized };
  return { province, place: normalized.replace(province, "") };
};

const toPinyinSearch = async (value) => {
  const { pinyin } = await import("pinyin-pro");
  const syllables = pinyin(stripAdministrativeSuffix(value), { toneType: "none", type: "array" });
  return syllables.reduce((result, syllable, index) => {
    const separator = index > 0 && /^[aeo]/i.test(syllable) ? "'" : "";
    return `${result}${separator}${syllable}`;
  }, "");
};

const candidateScore = (location, query, provinceHint, preferChina) => {
  const population = Math.max(0, Number(location.population) || 0);
  const exactName = normalizePlaceName(location.name) === normalizePlaceName(query);
  const provinceMatches = provinceHint
    && normalizePlaceName(location.admin1).includes(normalizePlaceName(provinceHint));
  const provincePenalty = provinceHint && !provinceMatches ? -1200 : 0;
  return (exactName ? 1600 : 0)
    + (FEATURE_SCORES[location.feature_code] || 120)
    + Math.min(720, Math.log10(population + 1) * 105)
    + (preferChina && location.country_code === "CN" ? 520 : 0)
    + (provinceMatches ? 1300 : 0)
    + provincePenalty;
};

const fetchCandidates = async (name, { signal, fetcher, countryCode }) => {
  if (!name || name.length < 2) return [];
  const params = new URLSearchParams({ name, count: "20", language: "zh", format: "json" });
  if (countryCode) params.set("countryCode", countryCode);
  const response = await requestWithRetry(`${GEOCODING_ENDPOINT}?${params}`, { signal, fetcher });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error("天气服务返回了无法识别的数据");
  }
  if (!response.ok || payload?.error) {
    throw new Error(payload?.reason || `天气服务请求失败（${response.status}）`);
  }
  return Array.isArray(payload?.results) ? payload.results : [];
};

const mergeCandidates = (...groups) => {
  const unique = new Map();
  groups.flat().forEach((location) => {
    const key = location.id || `${location.latitude},${location.longitude}`;
    if (!unique.has(key)) unique.set(key, location);
  });
  return [...unique.values()];
};

export async function lookupWeatherLocation(query, { signal, fetcher = fetch } = {}) {
  const name = String(query || "").trim();
  if (name.length < 2) throw new Error("请输入至少 2 个字符的城市或地区名称");

  const hasChinese = CHINESE_PATTERN.test(name);
  const { province, place } = extractProvinceHint(name);
  const searchName = stripAdministrativeSuffix(place) || place;
  const countryCode = hasChinese ? "CN" : "";
  const directCandidates = await fetchCandidates(searchName, { signal, fetcher, countryCode });
  let pinyinCandidates = [];
  if (hasChinese) {
    const pinyinName = await toPinyinSearch(searchName);
    if (pinyinName && normalizePlaceName(pinyinName) !== normalizePlaceName(searchName)) {
      pinyinCandidates = await fetchCandidates(pinyinName, { signal, fetcher, countryCode });
    }
  }

  let candidates = mergeCandidates(directCandidates, pinyinCandidates);
  if (!candidates.length && countryCode) {
    candidates = await fetchCandidates(searchName, { signal, fetcher, countryCode: "" });
  }
  const ranked = candidates
    .map((location) => ({ location, score: candidateScore(location, searchName, province, hasChinese) }))
    .sort((left, right) => right.score - left.score);
  const location = ranked[0]?.location;
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!location || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("未找到该地区，请尝试输入“省份 + 城市”全称");
  }

  return {
    name: String(location.name || searchName),
    admin1: String(location.admin1 || ""),
    admin2: String(location.admin2 || ""),
    country: String(location.country || ""),
    countryCode: String(location.country_code || ""),
    featureCode: String(location.feature_code || ""),
    population: Number(location.population) || 0,
    latitude,
    longitude,
  };
}

export async function verifyWeatherLocation(location, { signal, fetcher = fetch } = {}) {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
    timezone: "auto",
  });
  const response = await requestWithRetry(`${FORECAST_ENDPOINT}?${params}`, { signal, fetcher });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error("地区已识别，但天气接口返回了无法识别的数据");
  }
  if (!response.ok || payload?.error || !payload?.current) {
    throw new Error(payload?.reason || "地区已识别，但暂时无法获取该地区天气");
  }
  return payload.current;
}
