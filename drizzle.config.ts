import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // drizzle-kit only reads this for `push`/`studio` (live-DB commands);
    // `generate` works entirely from schema.ts and needs no connection.
    url: process.env.DATABASE_URL || '',
  },
});
