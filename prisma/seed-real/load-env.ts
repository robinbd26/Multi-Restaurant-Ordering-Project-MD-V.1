// Imported FIRST by prisma/seed-real.ts: loads the same env files Next.js uses
// (.env.local wins over .env) before any app module reads process.env.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Missing file: the variables may come from the real environment instead.
  }
}

export {};
