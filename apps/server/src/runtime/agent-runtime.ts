import { EVENT_TYPE, type AgentEvent, type AgentRunRequestedPayload } from "../events/types";
import type { StreamEntry } from "../events/redis-stream";

export interface RuntimeEventBus {
  publish(event: AgentEvent): Promise<void>;
  ensureConsumerGroup(groupName: string): Promise<void>;
  readGroup(
    groupName: string,
    consumerName: string,
    options?: { blockMs?: number; count?: number },
  ): Promise<StreamEntry[]>;
  acknowledge(groupName: string, streamEntryId: string): Promise<void>;
}

const GENERIC_RUNTIME_ERROR_MESSAGE = "Agent runtime failed to process the request.";

interface AgentRuntimeOptions {
  bus: RuntimeEventBus;
  consumerGroup: string;
  consumerName: string;
  logger?: Pick<Console, "info" | "error">;
}

export class AgentRuntime {
  private readonly bus: RuntimeEventBus;
  private readonly consumerGroup: string;
  private readonly consumerName: string;
  private readonly logger: Pick<Console, "info" | "error">;
  private isRunning = false;

  public constructor(options: AgentRuntimeOptions) {
    this.bus = options.bus;
    this.consumerGroup = options.consumerGroup;
    this.consumerName = options.consumerName;
    this.logger = options.logger ?? console;
  }

  public async init() {
    await this.bus.ensureConsumerGroup(this.consumerGroup);
  }

  public start() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    void this.poll();
  }

  public stop() {
    this.isRunning = false;
  }

  public async processOnce() {
    const entries = await this.bus.readGroup(this.consumerGroup, this.consumerName);
    if (entries.length === 0) {
      return 0;
    }

    for (const entry of entries) {
      await this.processEntry(entry.streamEntryId, entry.event);
    }

    return entries.length;
  }

  private async poll() {
    while (this.isRunning) {
      try {
        await this.processOnce();
      } catch (error) {
        this.logger.error("runtime.poll.error", {
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }

  private async processEntry(streamEntryId: string, event: AgentEvent) {
    if (event.type !== EVENT_TYPE.AGENT_RUN_REQUESTED) {
      await this.bus.acknowledge(this.consumerGroup, streamEntryId);
      return;
    }

    const requestedEvent = event as AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED>;

    try {
      const completedEvent = this.buildCompletedEvent(requestedEvent);
      await this.bus.publish(completedEvent);

      this.logger.info("runtime.event.processed", {
        eventId: event.id,
        correlationId: event.correlationId,
      });
    } catch {
      const failedEvent = this.buildFailedEvent(requestedEvent);
      await this.bus.publish(failedEvent);

      this.logger.error("runtime.event.failed", {
        eventId: event.id,
        correlationId: event.correlationId,
      });
    } finally {
      await this.bus.acknowledge(this.consumerGroup, streamEntryId);
    }
  }

  private buildCompletedEvent(event: AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED>) {
    const payload = event.payload as AgentRunRequestedPayload;
    if (payload.simulateFailure) {
      throw new Error("Simulated runtime failure");
    }

    return {
      id: crypto.randomUUID(),
      type: EVENT_TYPE.AGENT_RUN_COMPLETED,
      timestamp: new Date().toISOString(),
      correlationId: event.correlationId,
      payload: {
        requestEventId: event.id,
        output: `Handled prompt: ${payload.prompt}`,
      },
    };
  }

  private buildFailedEvent(event: AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED>) {
    return {
      id: crypto.randomUUID(),
      type: EVENT_TYPE.AGENT_RUN_FAILED,
      timestamp: new Date().toISOString(),
      correlationId: event.correlationId,
      payload: {
        requestEventId: event.id,
        error: GENERIC_RUNTIME_ERROR_MESSAGE,
      },
    };
  }
}
