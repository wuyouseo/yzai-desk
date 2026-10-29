export const POMO_MIN_MINUTES = 1;
export const POMO_MAX_MINUTES = 240;

export function parsePomoMinutes(value) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) throw new Error("请输入 1 到 240 之间的整数分钟");
  const minutes = Number(text);
  if (minutes < POMO_MIN_MINUTES || minutes > POMO_MAX_MINUTES) throw new Error("请输入 1 到 240 之间的整数分钟");
  return minutes;
}

export function secondsForStart(seconds, total) {
  return seconds > 0 ? seconds : Math.max(1, total);
}
