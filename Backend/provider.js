import { config } from '../config/index.js';
import { openaiProvider } from './openaiProvider.js';
import { mockProvider } from './mockProvider.js';

// Every provider must implement:
//   parseResume(rawText) -> structured resume JSON
//   generateQuestion({ resume, stage, askedQuestions, lastAnswer }) -> { questionText, targetSkill }
//   evaluateAnswer({ question, answer, resume }) -> { score, feedback, shouldFollowUp }
//   generateReport({ resume, qaPairs }) -> { overallScore, strengths, gaps, summary }
export function getLlmProvider() {
  return config.useMockLlm ? mockProvider : openaiProvider;
}
