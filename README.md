# Jarred

There are plenty of cool Jarreds out there. Jarred Dunn from Silicon Valley, the guy who somehow kept Pied Piper from imploding. Jarred Sumner, the creator of Bun, who decided the JavaScript ecosystem needed yet another runtime and was actually right about it. So when I needed a name for my AI agent SDK experiment, the choice was obvious. It had to be Jarred.

## What is Jarred?

Jarred is a personal, experimental TypeScript SDK for building AI agents. It's a flexible base for testing new concepts and exploring ideas — not something you should use in production. It gives you the primitives — agent loop, tool execution, session management, event streaming — without burying you in abstractions.

### Packages

- **`@jarred/agent-core`** — Core agent runtime with tool support and event system
- **`@jarred/agent-session`** — Session layer for multi-turn conversations

## Quick Start

```bash
pnpm add @jarred/agent-core
```

```typescript
import { Agent } from "@jarred/agent-core";

const agent = new Agent({
  model: "gpt-5-nano",
  instructions: "You are a helpful assistant.",
  tools: {},
});

const result = await agent.run({
  prompt: "Hello, what can you do?",
});
```

## Documentation

Full docs coming soon in [`/docs`](./docs/).

## License

MIT
