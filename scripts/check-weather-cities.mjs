import { lookupWeatherLocation, verifyWeatherLocation } from "../src/lib/weatherApi.js";

const cases = [
  ["北京", "北京"], ["上海", "上海"], ["天津", "天津"], ["重庆", "重庆"],
  ["石家庄", "河北"], ["太原", "山西"], ["呼和浩特", "内蒙古"], ["沈阳", "辽宁"],
  ["大连", "辽宁"], ["长春", "吉林"], ["哈尔滨", "黑龙江"], ["南京", "江苏"],
  ["苏州", "江苏"], ["无锡", "江苏"], ["杭州", "浙江"], ["宁波", "浙江"],
  ["合肥", "安徽"], ["福州", "福建"], ["厦门", "福建"], ["南昌", "江西"],
  ["济南", "山东"], ["青岛", "山东"], ["郑州", "河南"], ["武汉", "湖北"],
  ["长沙", "湖南"], ["广州", "广东"], ["深圳", "广东"], ["东莞", "广东"],
  ["佛山", "广东"], ["南宁", "广西"], ["海口", "海南"], ["三亚", "海南"],
  ["成都", "四川"], ["贵阳", "贵州"], ["昆明", "云南"], ["西安", "陕西"],
  ["兰州", "甘肃"], ["西宁", "青海"], ["银川", "宁夏"], ["乌鲁木齐", "新疆"],
  ["拉萨", "西藏"],
];

const checkCity = async ([query, expectedProvince]) => {
  try {
    const signal = AbortSignal.timeout(30_000);
    const location = await lookupWeatherLocation(query, { signal });
    const weather = await verifyWeatherLocation(location, { signal });
    const provinceMatched = location.admin1.includes(expectedProvince);
    return {
      query,
      ok: provinceMatched,
      matched: `${location.name}（${location.admin1}）`,
      coordinates: `${location.latitude},${location.longitude}`,
      temperature: weather.temperature_2m,
      error: provinceMatched ? "" : `期望省级地区：${expectedProvince}`,
    };
  } catch (error) {
    return { query, ok: false, matched: "", coordinates: "", temperature: null, error: error.message };
  }
};

const results = [];
for (let index = 0; index < cases.length; index += 3) {
  results.push(...await Promise.all(cases.slice(index, index + 3).map(checkCity)));
}

const failures = results.filter((result) => !result.ok);
console.table(results);
console.log(`天气城市回归：${results.length - failures.length}/${results.length} 通过`);
if (failures.length) {
  console.error("失败城市：", failures.map((result) => `${result.query}: ${result.matched || result.error}`).join("；"));
  process.exitCode = 1;
}
