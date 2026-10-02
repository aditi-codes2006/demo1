import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeScores } from '../src/services/scoreEngine.js';

function buildInterview({ understandingLevels, decisionTypes, topics, suggestedDecisions }) {
  const questions = understandingLevels.map((_, i) => ({
    index: i,
    text: `Q${i}`,
    topic: topics[i],
    decisionType: decisionTypes[i],
  }));
  const evaluations = understandingLevels.map((level, i) => ({
    questionIndex: i,
    score: level === 'deep' ? 9 : level === 'moderate' ? 6 : 3,
    understandingLevel: level,
    suggestedDecision: suggestedDecisions[i],
    strengths: [],
    gaps: level === 'shallow' ? ['detail'] : [],
  }));
  const answers = understandingLevels.map((_, i) => ({ questionIndex: i, text: 'answer text' }));
  return { questions, evaluations, answers, interviewType: 'Mixed' };
}

test('overallScore is a weighted composite, not a plain average of raw scores', () => {
  // All questions "deep" (9 pts) except one lone shallow one that's a FOLLOW_UP
  // (weighted higher for technical/project categories) — a plain average of
  // raw scores would treat every question equally; our engine should not.
  const interview = buildInterview({
    understandingLevels: ['deep', 'deep', 'deep', 'deep', 'deep', 'shallow'],
    decisionTypes: ['FIRST', 'NEW_TOPIC', 'NEW_TOPIC', 'NEW_TOPIC', 'NEW_TOPIC', 'FOLLOW_UP'],
    topics: ['A', 'B', 'C', 'D', 'E', 'E'],
    suggestedDecisions: ['NEW_TOPIC', 'NEW_TOPIC', 'NEW_TOPIC', 'NEW_TOPIC', 'NEW_TOPIC', 'FOLLOW_UP'],
  });
  const resume = { parsed: { projects: [] } };
  const result = computeScores(interview, resume);

  const plainAverage = (9 * 5 + 3) / 6; // = 8.0
  // The engine's overallScore should differ from a naive average because the
  // shallow follow-up is weighted more heavily in technicalKnowledge, and
  // categoryScores are combined with different weights, not simply averaged.
  assert.notEqual(result.overallScore, Math.round(plainAverage * 10) / 10);
  assert.ok(result.overallScore > 0 && result.overallScore <= 10);
});

test('all category scores stay within the valid 0-10 range', () => {
  const interview = buildInterview({
    understandingLevels: ['shallow', 'moderate', 'deep', 'shallow', 'deep', 'moderate'],
    decisionTypes: ['FIRST', 'FOLLOW_UP', 'NEW_TOPIC', 'NEW_TOPIC', 'FOLLOW_UP', 'NEW_TOPIC'],
    topics: ['A', 'A', 'B', 'C', 'C', 'D'],
    suggestedDecisions: ['FOLLOW_UP', 'NEW_TOPIC', 'NEW_TOPIC', 'FOLLOW_UP', 'NEW_TOPIC', 'NEW_TOPIC'],
  });
  const resume = { parsed: { projects: [{ name: 'A', techStack: ['React'] }] } };
  const result = computeScores(interview, resume);

  for (const [key, val] of Object.entries(result.categoryScores)) {
    assert.ok(val >= 0 && val <= 10, `${key} out of range: ${val}`);
  }
  assert.ok(result.overallScore >= 0 && result.overallScore <= 10);
});

test('projectUnderstanding is derived only from project-tagged topics', () => {
  const interview = buildInterview({
    understandingLevels: ['deep', 'shallow'], // topic A (project) deep, topic B (skill) shallow
    decisionTypes: ['FIRST', 'NEW_TOPIC'],
    topics: ['A', 'B'],
    suggestedDecisions: ['NEW_TOPIC', 'FOLLOW_UP'],
  });
  const resume = { parsed: { projects: [{ name: 'A', techStack: [] }] } };
  const result = computeScores(interview, resume);
  // projectUnderstanding should reflect only the "deep" project answer (~9),
  // not be dragged down by the shallow non-project answer.
  assert.ok(result.categoryScores.projectUnderstanding >= 8);
});

test('high variance across answers lowers confidence relative to a consistent performer', () => {
  const consistent = buildInterview({
    understandingLevels: ['moderate', 'moderate', 'moderate', 'moderate', 'moderate', 'moderate'],
    decisionTypes: ['FIRST', 'NEW_TOPIC', 'NEW_TOPIC', 'NEW_TOPIC', 'NEW_TOPIC', 'NEW_TOPIC'],
    topics: ['A', 'B', 'C', 'D', 'E', 'F'],
    suggestedDecisions: Array(6).fill('NEW_TOPIC'),
  });
  const erratic = buildInterview({
    understandingLevels: ['deep', 'shallow', 'deep', 'shallow', 'deep', 'shallow'],
    decisionTypes: ['FIRST', 'NEW_TOPIC', 'NEW_TOPIC', 'NEW_TOPIC', 'NEW_TOPIC', 'NEW_TOPIC'],
    topics: ['A', 'B', 'C', 'D', 'E', 'F'],
    suggestedDecisions: Array(6).fill('NEW_TOPIC'),
  });
  const resume = { parsed: { projects: [] } };
  const consistentResult = computeScores(consistent, resume);
  const erraticResult = computeScores(erratic, resume);
  // Both average to roughly the same raw score (~6), but the erratic one
  // should score lower on confidence due to higher variance.
  assert.ok(erraticResult.categoryScores.confidence < consistentResult.categoryScores.confidence);
});
