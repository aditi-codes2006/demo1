import 'dotenv/config';

export const config = {
  port: process.env.PORT || 4000,
  mongoUri: process.env.MONGODB_URI || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  // If no OpenAI key is configured, we fall back to a deterministic mock
  // LLM provider so the app is runnable/testable without live credentials.
  useMockLlm: !process.env.OPENAI_API_KEY,
  // If no Mongo URI is configured (or it's unreachable), we fall back to an
  // in-process memory store behind the same repository interface. This keeps
  // local/dev/test runs working without a live database.
  useMemoryDb: !process.env.MONGODB_URI,
  maxUploadSizeMb: 10,
};
