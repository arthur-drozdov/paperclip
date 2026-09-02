import { describe, expect, it } from "vitest";
import { evaluateHeartbeatDispatchBlackout } from "./heartbeat-dispatch-blackout.js";

const singaporeLeaderPolicy = {
  dispatchBlackouts: [
    {
      label: "Singapore peak hours",
      timeZone: "Asia/Singapore",
      daysOfWeek: [1, 2, 3, 4, 5],
      start: "14:00",
      end: "18:00",
    },
  ],
};

describe("heartbeat dispatch blackouts", () => {
  it.each([
    ["2026-09-02T05:59:00Z", false],
    ["2026-09-02T06:00:00Z", true],
    ["2026-09-02T09:59:00Z", true],
    ["2026-09-02T10:00:00Z", false],
    ["2026-09-05T07:00:00Z", false],
    ["2026-09-06T07:00:00Z", false],
  ])("evaluates the Singapore weekday boundary at %s", (timestamp, blocked) => {
    expect(
      evaluateHeartbeatDispatchBlackout(singaporeLeaderPolicy, new Date(timestamp)),
    ).toEqual({
      blocked,
      label: blocked ? "Singapore peak hours" : null,
    });
  });

  it("supports an overnight window using the weekday on which it starts", () => {
    const policy = {
      dispatchBlackouts: [{
        timeZone: "UTC",
        daysOfWeek: [5],
        start: "22:00",
        end: "02:00",
      }],
    };
    expect(evaluateHeartbeatDispatchBlackout(policy, new Date("2026-09-04T23:00:00Z")).blocked).toBe(true);
    expect(evaluateHeartbeatDispatchBlackout(policy, new Date("2026-09-05T01:00:00Z")).blocked).toBe(true);
    expect(evaluateHeartbeatDispatchBlackout(policy, new Date("2026-09-05T03:00:00Z")).blocked).toBe(false);
  });

  it("supports a full local day ending at 24:00", () => {
    const policy = {
      dispatchBlackouts: [{
        timeZone: "UTC",
        daysOfWeek: [3],
        start: "00:00",
        end: "24:00",
      }],
    };
    expect(evaluateHeartbeatDispatchBlackout(policy, new Date("2026-09-02T23:59:00Z")).blocked).toBe(true);
  });

  it("ignores malformed windows", () => {
    expect(evaluateHeartbeatDispatchBlackout({
      dispatchBlackouts: [
        { timeZone: "Not/AZone", daysOfWeek: [1], start: "14:00", end: "18:00" },
        { timeZone: "UTC", daysOfWeek: [], start: "14:00", end: "18:00" },
        { timeZone: "UTC", daysOfWeek: [1], start: "bad", end: "18:00" },
      ],
    }, new Date("2026-09-02T07:00:00Z"))).toEqual({ blocked: false, label: null });
  });
});
