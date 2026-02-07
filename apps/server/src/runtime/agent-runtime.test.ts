import { describe, expect, test } from "bun:test";
import { EVENT_TYPE, type AgentEvent } from "../events/types";
import { AgentRuntime, type RuntimeEventBus } from "./agent-runtime";

class FakeRuntimeBus implements RuntimeEventBus {
  public readonly published: AgentEvent[] = [];
  public readonly acknowledged: Array<{ groupName: string; streamEntryId: string }> = [];
  public readonly queuedEntries: Array<{ streamEntryId: string; event: AgentEvent }> = [];

  public async publish(event: AgentEvent) {
    this.published.push(event);
  }

  public async ensureConsumerGroup(groupName: string) {
    void groupName;
    return;
  }

  public async readGroup() {
    const next = this.queuedEntries.shift();
    return next ? [next] : [];
  }

  public async acknowledge(groupName: string, streamEntryId: string) {
    this.acknowledged.push({ groupName, streamEntryId });
  }
}

describe("AgentRuntime", () => {
  test("uses crypto ids for emitted events", async () => {
    const bus = new FakeRuntimeBus();
    bus.queuedEntries.push({
      streamEntryId: "0-1",
      event: {
        id: "evt_req_default_1",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_default_1",
        payload: {
          prompt: "hello default generator",
        },
      },
    });

    const runtime = new AgentRuntime({
      bus,
      consumerGroup: "group_default",
      consumerName: "consumer_default",
      logger: { info: () => {}, error: () => {} },
    });

    const processed = await runtime.processOnce();

    expect(processed).toBe(1);
    expect(bus.published).toHaveLength(1);
    expect(typeof bus.published[0]?.id).toBe("string");
    expect(bus.published[0]?.id.length).toBeGreaterThan(0);
    expect(bus.published[0]?.type).toBe(EVENT_TYPE.AGENT_RUN_COMPLETED);
    expect(bus.acknowledged).toEqual([{ groupName: "group_default", streamEntryId: "0-1" }]);
  });

  test("processes agent.run.requested and emits completed event", async () => {
    const bus = new FakeRuntimeBus();
    bus.queuedEntries.push({
      streamEntryId: "1-0",
      event: {
        id: "evt_req_1",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_1",
        payload: {
          prompt: "hello",
        },
      },
    });

    const runtime = new AgentRuntime({
      bus,
      consumerGroup: "group_a",
      consumerName: "consumer_a",
      logger: { info: () => {}, error: () => {} },
    });

    const processed = await runtime.processOnce();

    expect(processed).toBe(1);
    expect(bus.published).toHaveLength(1);
    expect(typeof bus.published[0]?.id).toBe("string");
    expect(bus.published[0]?.id.length).toBeGreaterThan(0);
    expect(typeof bus.published[0]?.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(bus.published[0]?.timestamp ?? ""))).toBe(false);
    expect(bus.published[0]?.type).toBe(EVENT_TYPE.AGENT_RUN_COMPLETED);
    expect(bus.published[0]?.correlationId).toBe("corr_1");
    expect(bus.published[0]?.payload).toEqual({
      requestEventId: "evt_req_1",
      output: "Handled prompt: hello",
    });
    expect(bus.acknowledged).toEqual([{ groupName: "group_a", streamEntryId: "1-0" }]);
  });

  test("emits failed event when runtime logic errors", async () => {
    const bus = new FakeRuntimeBus();
    bus.queuedEntries.push({
      streamEntryId: "2-0",
      event: {
        id: "evt_req_2",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_2",
        payload: {
          prompt: "hello",
          simulateFailure: true,
        },
      },
    });

    const runtime = new AgentRuntime({
      bus,
      consumerGroup: "group_b",
      consumerName: "consumer_b",
      logger: { info: () => {}, error: () => {} },
    });

    await runtime.processOnce();

    expect(bus.published).toHaveLength(1);
    expect(typeof bus.published[0]?.id).toBe("string");
    expect(bus.published[0]?.id.length).toBeGreaterThan(0);
    expect(typeof bus.published[0]?.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(bus.published[0]?.timestamp ?? ""))).toBe(false);
    expect(bus.published[0]?.type).toBe(EVENT_TYPE.AGENT_RUN_FAILED);
    expect(bus.published[0]?.correlationId).toBe("corr_2");
    expect(bus.published[0]?.payload).toEqual({
      requestEventId: "evt_req_2",
      error: "Agent runtime failed to process the request.",
    });
    expect(bus.acknowledged).toEqual([{ groupName: "group_b", streamEntryId: "2-0" }]);
  });
});
