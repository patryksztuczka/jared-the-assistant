import type { EventPublisher } from "./types";
import type { OutboxService } from "../services/events/outbox-service";

interface OutboxPublisherOptions {
  outboxService: OutboxService;
  publisher: EventPublisher;
  batchSize?: number;
  logger?: Pick<Console, "info" | "error">;
}

export class OutboxPublisher {
  private readonly outboxService: OutboxService;
  private readonly publisher: EventPublisher;
  private readonly batchSize: number;
  private readonly logger: Pick<Console, "info" | "error">;
  private isRunning = false;

  public constructor(options: OutboxPublisherOptions) {
    this.outboxService = options.outboxService;
    this.publisher = options.publisher;
    this.batchSize = options.batchSize ?? 10;
    this.logger = options.logger ?? console;
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
    const events = await this.outboxService.listRetryableEvents(this.batchSize);
    if (events.length === 0) {
      return 0;
    }

    for (const outboxEvent of events) {
      try {
        await this.publisher.publish(outboxEvent.event);
        await this.outboxService.markPublished(outboxEvent.id);

        this.logger.info("outbox.publish.success", {
          eventId: outboxEvent.id,
          correlationId: outboxEvent.event.correlationId,
        });
      } catch (error) {
        const safeMessage = error instanceof Error ? error.message : "unknown";
        await this.outboxService.markPublishFailed(outboxEvent.id, safeMessage);

        this.logger.error("outbox.publish.failed", {
          eventId: outboxEvent.id,
          correlationId: outboxEvent.event.correlationId,
          error: safeMessage,
        });
      }
    }

    return events.length;
  }

  private async poll() {
    while (this.isRunning) {
      try {
        const processed = await this.processOnce();
        if (processed === 0) {
          await Bun.sleep(250);
        }
      } catch (error) {
        this.logger.error("outbox.poll.error", {
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }
}
