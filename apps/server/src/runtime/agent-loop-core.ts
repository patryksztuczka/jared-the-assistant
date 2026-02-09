export type AgentLoopStopReason = "success" | "budget_exhausted" | "no_progress" | "error";

export interface AgentLoopPlanner<TState, TStep> {
  plan(input: { sessionId: string; iteration: number; state: TState }): Promise<TStep>;
}

export interface AgentLoopExecutor<TState, TStep, TObservation> {
  execute(input: {
    sessionId: string;
    iteration: number;
    state: TState;
    step: TStep;
  }): Promise<TObservation>;
}

export type AgentLoopEvaluation<TState> =
  | {
      decision: "continue";
      nextState: TState;
    }
  | {
      decision: "finish";
      reason: Extract<AgentLoopStopReason, "success" | "no_progress">;
      nextState: TState;
    };

export interface AgentLoopEvaluator<TState, TStep, TObservation> {
  evaluate(input: {
    sessionId: string;
    iteration: number;
    state: TState;
    step: TStep;
    observation: TObservation;
  }): Promise<AgentLoopEvaluation<TState>>;
}

export interface AgentLoopCheckpointStore<TState> {
  load(sessionId: string): Promise<TState | undefined>;
  save(sessionId: string, state: TState): Promise<void>;
}

type AgentLoopEventType =
  | "loop.started"
  | "loop.iteration.started"
  | "loop.step.planned"
  | "loop.step.executed"
  | "loop.step.evaluated"
  | "loop.completed"
  | "loop.error";

export interface AgentLoopEvent<TState, TStep, TObservation> {
  type: AgentLoopEventType;
  sessionId: string;
  iteration?: number;
  state?: TState;
  step?: TStep;
  observation?: TObservation;
  decision?: AgentLoopEvaluation<TState>["decision"];
  reason?: AgentLoopStopReason;
  error?: string;
}

export interface AgentLoopEventEmitter<TState, TStep, TObservation> {
  emit(event: AgentLoopEvent<TState, TStep, TObservation>): Promise<void>;
}

interface AgentLoopOptions<TState, TStep, TObservation> {
  planner: AgentLoopPlanner<TState, TStep>;
  executor: AgentLoopExecutor<TState, TStep, TObservation>;
  evaluator: AgentLoopEvaluator<TState, TStep, TObservation>;
  checkpointStore?: AgentLoopCheckpointStore<TState>;
  eventEmitter?: AgentLoopEventEmitter<TState, TStep, TObservation>;
}

interface AgentLoopRunInput<TState> {
  sessionId: string;
  initialState: TState;
  maxIterations: number;
  resumeFromCheckpoint?: boolean;
}

export interface AgentLoopRunResult<TState> {
  sessionId: string;
  state: TState;
  iterations: number;
  reason: AgentLoopStopReason;
  error?: string;
}

export class AgentLoop<TState, TStep, TObservation> {
  private readonly planner: AgentLoopPlanner<TState, TStep>;
  private readonly executor: AgentLoopExecutor<TState, TStep, TObservation>;
  private readonly evaluator: AgentLoopEvaluator<TState, TStep, TObservation>;
  private readonly checkpointStore?: AgentLoopCheckpointStore<TState>;
  private readonly eventEmitter: AgentLoopEventEmitter<TState, TStep, TObservation>;

  public constructor(options: AgentLoopOptions<TState, TStep, TObservation>) {
    this.planner = options.planner;
    this.executor = options.executor;
    this.evaluator = options.evaluator;
    this.checkpointStore = options.checkpointStore;
    this.eventEmitter = options.eventEmitter ?? createNoopAgentLoopEventEmitter();
  }

  public async run(input: AgentLoopRunInput<TState>) {
    const maxIterations = normalizeMaxIterations(input.maxIterations);
    const resumeFromCheckpoint = input.resumeFromCheckpoint ?? true;

    let state = input.initialState;

    if (resumeFromCheckpoint && this.checkpointStore) {
      const checkpoint = await this.checkpointStore.load(input.sessionId);
      if (checkpoint) {
        state = checkpoint;
      }
    }

    await this.eventEmitter.emit({
      type: "loop.started",
      sessionId: input.sessionId,
      state,
    });

    let iterations = 0;

    try {
      for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
        iterations = iteration;
        await this.eventEmitter.emit({
          type: "loop.iteration.started",
          sessionId: input.sessionId,
          iteration,
          state,
        });

        const step = await this.planner.plan({
          sessionId: input.sessionId,
          iteration,
          state,
        });

        await this.eventEmitter.emit({
          type: "loop.step.planned",
          sessionId: input.sessionId,
          iteration,
          step,
          state,
        });

        const observation = await this.executor.execute({
          sessionId: input.sessionId,
          iteration,
          state,
          step,
        });

        await this.eventEmitter.emit({
          type: "loop.step.executed",
          sessionId: input.sessionId,
          iteration,
          step,
          observation,
          state,
        });

        const evaluation = await this.evaluator.evaluate({
          sessionId: input.sessionId,
          iteration,
          state,
          step,
          observation,
        });

        state = evaluation.nextState;
        if (this.checkpointStore) {
          await this.checkpointStore.save(input.sessionId, state);
        }

        await this.eventEmitter.emit({
          type: "loop.step.evaluated",
          sessionId: input.sessionId,
          iteration,
          step,
          observation,
          state,
          decision: evaluation.decision,
        });

        if (evaluation.decision === "finish") {
          await this.eventEmitter.emit({
            type: "loop.completed",
            sessionId: input.sessionId,
            iteration,
            state,
            reason: evaluation.reason,
          });

          return {
            sessionId: input.sessionId,
            state,
            iterations: iteration,
            reason: evaluation.reason,
          } satisfies AgentLoopRunResult<TState>;
        }
      }

      await this.eventEmitter.emit({
        type: "loop.completed",
        sessionId: input.sessionId,
        state,
        reason: "budget_exhausted",
      });

      return {
        sessionId: input.sessionId,
        state,
        iterations: maxIterations,
        reason: "budget_exhausted",
      } satisfies AgentLoopRunResult<TState>;
    } catch (error) {
      const safeError = error instanceof Error ? error.message : "unknown";

      await this.eventEmitter.emit({
        type: "loop.error",
        sessionId: input.sessionId,
        state,
        reason: "error",
        error: safeError,
      });

      return {
        sessionId: input.sessionId,
        state,
        iterations,
        reason: "error",
        error: safeError,
      } satisfies AgentLoopRunResult<TState>;
    }
  }
}

export const createInMemoryAgentLoopCheckpointStore = <TState>() => {
  const stateBySessionId = new Map<string, TState>();

  const load = async (sessionId: string) => {
    return stateBySessionId.get(sessionId);
  };

  const save = async (sessionId: string, state: TState) => {
    stateBySessionId.set(sessionId, state);
  };

  const getBySessionId = (sessionId: string) => {
    return stateBySessionId.get(sessionId);
  };

  return {
    load,
    save,
    getBySessionId,
  } satisfies AgentLoopCheckpointStore<TState> & {
    getBySessionId(sessionId: string): TState | undefined;
  };
};

export const createNoopAgentLoopEventEmitter = <TState, TStep, TObservation>() => {
  const emit = async (event: AgentLoopEvent<TState, TStep, TObservation>) => {
    void event;
    return;
  };

  return {
    emit,
  } satisfies AgentLoopEventEmitter<TState, TStep, TObservation>;
};

const normalizeMaxIterations = (maxIterations: number) => {
  if (Number.isNaN(maxIterations) || maxIterations < 1) {
    return 1;
  }

  return Math.floor(maxIterations);
};
