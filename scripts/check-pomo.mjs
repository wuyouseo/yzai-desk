import assert from "node:assert/strict";
import { parsePomoMinutes, secondsForStart } from "../src/lib/pomo.js";

for (const minutes of [1, 15, 30, 45, 240]) assert.equal(parsePomoMinutes(String(minutes)), minutes);
for (const invalid of ["", "0", "241", "-1", "1.5", "abc"]) assert.throws(() => parsePomoMinutes(invalid), /1 到 240/);
assert.equal(secondsForStart(90, 1800), 90, "paused session resumes from remaining time");
assert.equal(secondsForStart(0, 1800), 1800, "completed session restarts at selected duration");
console.log("番茄时长范围、暂停继续和完成后重新开始检查通过");
