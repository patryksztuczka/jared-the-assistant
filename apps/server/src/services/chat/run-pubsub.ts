import type { ChatRun } from "./run-service";
import type { RunLoopEventRecord } from "./loop-event-service";

export type RunPubSubEvent =
  | { type: "run.event"; data: RunLoopEventRecord }
  | { type: "run.status"; data: ChatRun };

export interface ChatRunPubSub {
  subscribe(runId: string, listener: (event: RunPubSubEvent) => void): () => void;
  publish(runId: string, event: RunPubSubEvent): void;
}

export const createChatRunPubSub = (): ChatRunPubSub => {
  const target = new EventTarget();

  return {
    subscribe(runId: string, listener: (event: RunPubSubEvent) => void) {
      const eventName = `run:${runId}`;
      const handler = (e: Event) => {
        if (e instanceof CustomEvent) {
          listener(e.detail as RunPubSubEvent);
        }
      };

      target.addEventListener(eventName, handler);
      return () => {
        target.removeEventListener(eventName, handler);
      };
    },
    publish(runId: string, event: RunPubSubEvent) {
      target.dispatchEvent(new CustomEvent(`run:${runId}`, { detail: event }));
    },
  };
};
