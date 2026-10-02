import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import { connectDb } from './db/connection.js';
import resumeRoutes from './routes/resumeRoutes.js';
import interviewRoutes from './routes/interviewRoutes.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: {
      db: config.useMemoryDb ? 'in-memory' : 'mongodb',
      llm: config.useMockLlm ? 'mock' : 'openai',
    },
  });
});

app.use('/api/resume', resumeRoutes);
app.use('/api/interview', interviewRoutes);

// Multer / generic error handler (must be after routes)
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || (err.message?.includes('PDF') ? 400 : 500);
  res.status(statusCode).json({ error: err.message || 'Unexpected server error.' });
});

async function start() {
  await connectDb();
  app.listen(config.port, () => {
    console.log(`[server] InterviewIQ backend listening on port ${config.port}`);
    console.log(`[server] DB mode: ${config.useMemoryDb ? 'in-memory' : 'mongodb'}, LLM mode: ${config.useMockLlm ? 'mock' : 'openai'}`);
  });
}

start();
