export const RUN_STREAM_EVENT_TYPE = {
  RUN_STARTED: "run.started",
  TOOL_STARTED: "tool.started",
  ASSISTANT_TOKEN: "assistant.token",
  ASSISTANT_MESSAGE: "assistant.message",
  RUN_COMPLETED: "run.completed",
  RUN_FAILED: "run.failed",
} as const;

interface RunStartedEvent {
  type: typeof RUN_STREAM_EVENT_TYPE.RUN_STARTED;
  payload: {
    runId: string;
    threadId: string;
    model: string;
  };
}

interface AssistantTokenEvent {
  type: typeof RUN_STREAM_EVENT_TYPE.ASSISTANT_TOKEN;
  payload: {
    runId: string;
    threadId: string;
    iteration: number;
    delta: string;
  };
}

interface ToolStartedEvent {
  type: typeof RUN_STREAM_EVENT_TYPE.TOOL_STARTED;
  payload: {
    runId: string;
    threadId: string;
    iteration: number;
    toolName: string;
  };
}

interface AssistantMessageEvent {
  type: typeof RUN_STREAM_EVENT_TYPE.ASSISTANT_MESSAGE;
  payload: {
    runId: string;
    threadId: string;
    message: string;
  };
}

interface RunCompletedEvent {
  type: typeof RUN_STREAM_EVENT_TYPE.RUN_COMPLETED;
  payload: {
    runId: string;
    threadId: string;
  };
}

interface RunFailedEvent {
  type: typeof RUN_STREAM_EVENT_TYPE.RUN_FAILED;
  payload: {
    runId: string;
    threadId: string;
    error: string;
  };
}

export type RunStreamEvent =
  | RunStartedEvent
  | ToolStartedEvent
  | AssistantTokenEvent
  | AssistantMessageEvent
  | RunCompletedEvent
  | RunFailedEvent;

type RunStreamListener = (event: RunStreamEvent) => void;

export interface RunStreamService {
  subscribe(runId: string, listener: RunStreamListener): () => void;
  publish(event: RunStreamEvent): void;
}

export class InMemoryRunStreamService implements RunStreamService {
  private readonly listenersByRunId = new Map<string, Set<RunStreamListener>>();

  public subscribe(runId: string, listener: RunStreamListener) {
    const listeners = this.listenersByRunId.get(runId) ?? new Set<RunStreamListener>();
    listeners.add(listener);
    this.listenersByRunId.set(runId, listeners);

    return () => {
      const currentListeners = this.listenersByRunId.get(runId);
      if (!currentListeners) {
        return;
      }

      currentListeners.delete(listener);
      if (currentListeners.size === 0) {
        this.listenersByRunId.delete(runId);
      }
    };
  }

  public publish(event: RunStreamEvent) {
    const listeners = this.listenersByRunId.get(event.payload.runId);
    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }
}
