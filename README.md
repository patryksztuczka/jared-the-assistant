# Jarred

There are plenty of cool Jarreds out there. Jarred Dunn from Silicon Valley, the guy who somehow kept Pied Piper from imploding. Jarred Sumner, the creator of Bun, who decided the JavaScript ecosystem needed yet another runtime and was actually right about it. So when I needed a name for my AI agent SDK experiment, the choice was obvious. It had to be Jarred.

Huge shout-out to Mario Zechner, creator of pi agent. Maybe he is not Jarred, but he is also cool, and his code was genuinely helpful while I was discovering this topic.

## What is Jarred?

Jarred is a personal, experimental TypeScript SDK for building AI agents. It is a flexible base for testing new concepts and exploring ideas, not something you should use in production. It gives you the primitives - agent loop, tool execution, stateful message history, and event streaming - without burying you in abstractions.

Jarred is built on top of Vercel's AI SDK.

## Packages

- `@jarred/agent-core` - core agent runtime, event system, and built-in tools like `webfetch`, `readWorkingMemory`, and `updateWorkingMemory`

## Quick Start

```bash
pnpm add @jarred/agent-core
```

```ts
import { Agent, webfetch } from "@jarred/agent-core";

const agent = new Agent({
  initialState: {
    model: "gpt-5-nano",
    systemPrompt: "You are a helpful assistant.",
    tools: { webfetch },
    reasoning: {
      enabled: true,
      summary: "auto",
    },
  },
});

agent.subscribe((event) => {
  if (event.type === "agent.reasoning.delta") {
    process.stderr.write(event.delta);
  }

  if (event.type === "agent.token") {
    process.stdout.write(event.delta);
  }
});

await agent.prompt("Hello, what can you do?");
```

Disable reasoning summaries at runtime:

```ts
agent.setReasoning({ enabled: false });
```

## Examples

- `examples/api-server` - a small Hono server that streams agent events over SSE and keeps agent state per client IP
- `examples/chat-ui` - a minimal React chat app that connects to the API server and renders the streaming response

## Documentation

Full docs are still evolving. For now, the code in `packages/agent-core` and the apps in `examples` are the best references.

## License

MIT
