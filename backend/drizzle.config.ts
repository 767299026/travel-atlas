import { defineConfig } from 'drizzle-kit';
export default defineConfig({ dialect: 'mysql', schema: './backend/src/db/schema.ts', out: './backend/drizzle' });
