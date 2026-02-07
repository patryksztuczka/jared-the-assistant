import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL ?? "file:./db/sqlite.db";

export const db = drizzle({
  connection: {
    url: databaseUrl,
  },
  schema,
});
