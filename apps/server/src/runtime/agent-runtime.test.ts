import { describe, expect, test } from "bun:test";
import { EVENT_TYPE, type AgentEvent } from "../events/types";
import type { ChatMessageStore } from "../chat/message-store";
import type { ChatRunStore, RunStatus } from "../chat/run-store";
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
  test("sets run status to processing then completed on success", async () => {
    const bus = new FakeRuntimeBus();
    bus.queuedEntries.push({
      streamEntryId: "0-3",
      event: {
        id: "evt_req_run_success_1",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_run_success_1",
        payload: {
          runId: "run_success_1",
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          prompt: "hello run status",
        },
      },
    });

    const statuses: RunStatus[] = [];
    const runStore: ChatRunStore = {
      createQueuedRun: async () => {
        throw new Error("createQueuedRun should not be called in runtime test");
      },
      updateRunStatus: async (input) => {
        statuses.push(input.status);

        return {
          id: input.runId,
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          correlationId: "corr_run_success_1",
          status: input.status,
          safeError: input.safeError,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        };
      },
      getRunById: async () => {
        return undefined;
      },
    };

    const runtime = new AgentRuntime({
      bus,
      runStore,
      consumerGroup: "group_run_success",
      consumerName: "consumer_run_success",
      logger: { info: () => {}, error: () => {} },
    });

    const processed = await runtime.processOnce();

    expect(processed).toBe(1);
    expect(statuses).toEqual(["processing", "completed"]);
  });

  test("sets run status to processing then failed with safe error", async () => {
    const bus = new FakeRuntimeBus();
    bus.queuedEntries.push({
      streamEntryId: "0-4",
      event: {
        id: "evt_req_run_fail_1",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_run_fail_1",
        payload: {
          runId: "run_fail_1",
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          prompt: "hello run status fail",
          simulateFailure: true,
        },
      },
    });

    const statusUpdates: Array<{ status: RunStatus; safeError?: string }> = [];
    const runStore: ChatRunStore = {
      createQueuedRun: async () => {
        throw new Error("createQueuedRun should not be called in runtime test");
      },
      updateRunStatus: async (input) => {
        statusUpdates.push({
          status: input.status,
          safeError: input.safeError,
        });

        return {
          id: input.runId,
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          correlationId: "corr_run_fail_1",
          status: input.status,
          safeError: input.safeError,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        };
      },
      getRunById: async () => {
        return undefined;
      },
    };

    const runtime = new AgentRuntime({
      bus,
      runStore,
      consumerGroup: "group_run_fail",
      consumerName: "consumer_run_fail",
      logger: { info: () => {}, error: () => {} },
    });

    const processed = await runtime.processOnce();

    expect(processed).toBe(1);
    expect(statusUpdates).toEqual([
      {
        status: "processing",
        safeError: undefined,
      },
      {
        status: "failed",
        safeError: "Agent runtime failed to process the request.",
      },
    ]);
  });

  test("persists assistant message with thread and correlation from request flow", async () => {
    const bus = new FakeRuntimeBus();
    bus.queuedEntries.push({
      streamEntryId: "0-2",
      event: {
        id: "evt_req_persist_1",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_persist_1",
        payload: {
          runId: "run_persist_1",
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          prompt: "hello persistence",
        },
      },
    });

    const persistedAssistantMessages: Array<{
      threadId: string;
      content: string;
      correlationId: string;
    }> = [];

    const messageStore: ChatMessageStore = {
      createIncomingMessage: async (input) => {
        return {
          messageId: `msg_incoming_${input.correlationId}`,
          threadId: input.threadId,
        };
      },
      createAssistantMessage: async (input) => {
        persistedAssistantMessages.push(input);

        return {
          messageId: "msg_assistant_1",
          threadId: input.threadId,
        };
      },
      listMessagesByThreadId: async () => {
        return [];
      },
    };

    const runtime = new AgentRuntime({
      bus,
      messageStore,
      consumerGroup: "group_persist",
      consumerName: "consumer_persist",
      logger: { info: () => {}, error: () => {} },
    });

    const processed = await runtime.processOnce();

    expect(processed).toBe(1);
    expect(persistedAssistantMessages).toEqual([
      {
        threadId: "thr_abcdefghijklmnopqrstuvwx",
        content: "Handled prompt: hello persistence",
        correlationId: "corr_persist_1",
      },
    ]);
    expect(bus.published).toHaveLength(1);
    expect(bus.published[0]?.type).toBe(EVENT_TYPE.AGENT_RUN_COMPLETED);
  });

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
          runId: "run_default_1",
          threadId: "thr_abcdefghijklmnopqrstuvwx",
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
          runId: "run_1",
          threadId: "thr_zyxwvutsrqponmlkjihgfedc",
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
          runId: "run_2",
          threadId: "thr_abcdefghijklmnopqrstuvwx",
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
