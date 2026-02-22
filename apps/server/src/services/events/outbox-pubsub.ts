export interface OutboxPubSubEvent {
  type: "outbox.event_created";
}

export interface OutboxPubSub {
  subscribe(listener: (event: OutboxPubSubEvent) => void): () => void;
  publish(event: OutboxPubSubEvent): void;
}

export const createOutboxPubSub = (): OutboxPubSub => {
  const target = new EventTarget();

  return {
    subscribe(listener: (event: OutboxPubSubEvent) => void) {
      const handler = (e: Event) => {
        if (e instanceof CustomEvent) {
          listener(e.detail as OutboxPubSubEvent);
        }
      };

      target.addEventListener("outbox", handler);
      return () => {
        target.removeEventListener("outbox", handler);
      };
    },
    publish(event: OutboxPubSubEvent) {
      target.dispatchEvent(new CustomEvent("outbox", { detail: event }));
    },
  };
};
