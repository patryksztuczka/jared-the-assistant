# server

To install dependencies:

```bash
bun install
```

To run in watch mode:

```bash
bun run dev
```

To run tests:

```bash
bun run test
```

To run tests in watch mode:

```bash
bun run test:watch
```

To lint:

```bash
bun run lint
```

To auto-fix lint issues:

```bash
bun run lint:fix
```

To type-check:

```bash
bun run check-types
```

To format:

```bash
bun run format:write
```

To verify formatting:

```bash
bun run format
```

## Database (Drizzle ORM + SQLite)

This project is configured with Drizzle ORM and Drizzle Kit.

By default, the SQLite database file is local:

```bash
file:./db/sqlite.db
```

You can override this with `DATABASE_URL`.

Generate migrations from schema changes:

```bash
bun run db:generate
```

Apply migrations:

```bash
bun run db:migrate
```

Open Drizzle Studio:

```bash
bun run db:studio
```

Check migration drift:

```bash
bun run db:check
```

This project was created using `bun init` in bun v1.3.3. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
