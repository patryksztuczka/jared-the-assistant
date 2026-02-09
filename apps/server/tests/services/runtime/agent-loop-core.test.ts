import { describe, expect, test } from "bun:test";
import {
  AgentLoop,
  createInMemoryAgentLoopCheckpointStore,
  type AgentLoopEvent,
} from "../../../src/runtime/agent-loop-core";

interface TestState {
  value: number;
}

interface TestStep {
  incrementBy: number;
}

interface TestObservation {
  nextValue: number;
}

describe("AgentLoop", () => {
  test("finishes with success and saves checkpoint after evaluated step", async () => {
    const checkpointStore = createInMemoryAgentLoopCheckpointStore<TestState>();
    const emittedEventTypes: string[] = [];

    const loop = new AgentLoop<TestState, TestStep, TestObservation>({
      planner: {
        plan: async () => {
          return { incrementBy: 2 };
        },
      },
      executor: {
        execute: async ({ state, step }) => {
          return {
            nextValue: state.value + step.incrementBy,
          };
        },
      },
      evaluator: {
        evaluate: async ({ observation }) => {
          return {
            decision: "finish",
            reason: "success",
            nextState: {
              value: observation.nextValue,
            },
          };
        },
      },
      checkpointStore,
      eventEmitter: {
        emit: async (event: AgentLoopEvent<TestState, TestStep, TestObservation>) => {
          emittedEventTypes.push(event.type);
        },
      },
    });

    const result = await loop.run({
      sessionId: "run_success",
      initialState: { value: 1 },
      maxIterations: 3,
    });

    expect(result.reason).toBe("success");
    expect(result.iterations).toBe(1);
    expect(result.state).toEqual({ value: 3 });
    expect(checkpointStore.getBySessionId("run_success")).toEqual({ value: 3 });
    expect(emittedEventTypes).toEqual([
      "loop.started",
      "loop.iteration.started",
      "loop.step.planned",
      "loop.step.executed",
      "loop.step.evaluated",
      "loop.completed",
    ]);
  });

  test("returns budget_exhausted when evaluator keeps continuing", async () => {
    const checkpointStore = createInMemoryAgentLoopCheckpointStore<TestState>();

    const loop = new AgentLoop<TestState, TestStep, TestObservation>({
      planner: {
        plan: async () => {
          return { incrementBy: 1 };
        },
      },
      executor: {
        execute: async ({ state, step }) => {
          return {
            nextValue: state.value + step.incrementBy,
          };
        },
      },
      evaluator: {
        evaluate: async ({ observation }) => {
          return {
            decision: "continue",
            nextState: {
              value: observation.nextValue,
            },
          };
        },
      },
      checkpointStore,
    });

    const result = await loop.run({
      sessionId: "run_budget",
      initialState: { value: 0 },
      maxIterations: 2,
    });

    expect(result.reason).toBe("budget_exhausted");
    expect(result.iterations).toBe(2);
    expect(result.state).toEqual({ value: 2 });
    expect(checkpointStore.getBySessionId("run_budget")).toEqual({ value: 2 });
  });

  test("returns no_progress when evaluator decides there is no progress", async () => {
    const loop = new AgentLoop<TestState, TestStep, TestObservation>({
      planner: {
        plan: async () => {
          return { incrementBy: 0 };
        },
      },
      executor: {
        execute: async ({ state }) => {
          return {
            nextValue: state.value,
          };
        },
      },
      evaluator: {
        evaluate: async ({ state }) => {
          return {
            decision: "finish",
            reason: "no_progress",
            nextState: state,
          };
        },
      },
    });

    const result = await loop.run({
      sessionId: "run_no_progress",
      initialState: { value: 10 },
      maxIterations: 5,
    });

    expect(result.reason).toBe("no_progress");
    expect(result.iterations).toBe(1);
    expect(result.state).toEqual({ value: 10 });
  });

  test("returns error when planner or execution fails", async () => {
    const loop = new AgentLoop<TestState, TestStep, TestObservation>({
      planner: {
        plan: async () => {
          return { incrementBy: 1 };
        },
      },
      executor: {
        execute: async () => {
          throw new Error("tool execution failed");
        },
      },
      evaluator: {
        evaluate: async ({ state }) => {
          return {
            decision: "continue",
            nextState: state,
          };
        },
      },
    });

    const result = await loop.run({
      sessionId: "run_error",
      initialState: { value: 4 },
      maxIterations: 3,
    });

    expect(result.reason).toBe("error");
    expect(result.error).toContain("tool execution failed");
    expect(result.iterations).toBe(1);
    expect(result.state).toEqual({ value: 4 });
  });
});
