import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockProvider } from '../src/llm/mockProvider.js';
import { selectPrimaryTopic } from '../src/services/topicSelector.js';

const GENERIC_BAD_PATTERNS = [
  /tell me about a challenge you faced while working on \w+\.?\s*$/i,
  /what are your strengths in \w+\??\s*$/i,
  /why did you choose \w+\?\s*$/i, // bare "why did you choose <skill>" with no project context
];

function isGeneric(questionText) {
  return GENERIC_BAD_PATTERNS.some((re) => re.test(questionText.replace(/^\[\w+\]\s*/, '')));
}

const AI_ASSISTANT_RESUME = {
  parsed: {
    name: 'Aditi Mishra',
    skills: ['Python', 'React', 'NLP'],
    projects: [
      {
        name: 'AI College Assistant',
        description: 'Built an AI assistant using NLP and external APIs to answer student queries',
        techStack: ['Python', 'NLP', 'Gemini API'],
      },
    ],
    experience: [],
  },
};

const OTHER_RESUME = {
  parsed: {
    name: 'Jordan Lee',
    skills: ['Java', 'Spring Boot'],
    projects: [
      {
        name: 'Inventory Tracker',
        description: 'A warehouse inventory system with real-time stock alerts',
        techStack: ['Java', 'Spring Boot', 'PostgreSQL'],
      },
    ],
    experience: [],
  },
};

const SKILL_ONLY_RESUME = {
  parsed: { name: 'No Projects', skills: ['Java'], projects: [], experience: [] },
};

test('1. first question references the actual project name when a project exists', async () => {
  const primaryTopic = selectPrimaryTopic(AI_ASSISTANT_RESUME);
  const q = await mockProvider.generateQuestion({
    difficulty: 'Medium',
    primaryTopic,
    stage: 'UNDERSTANDING',
    decision: 'FIRST',
  });
  assert.match(q.questionText, /AI College Assistant/);
  assert.equal(q.topic, 'AI College Assistant');
});

test('2. TECHNICAL_DECISION stage question references an actual project technology', async () => {
  const primaryTopic = selectPrimaryTopic(AI_ASSISTANT_RESUME);
  const q = await mockProvider.generateQuestion({
    difficulty: 'Medium',
    primaryTopic,
    stage: 'TECHNICAL_DECISION',
    decision: 'NEW_TOPIC',
  });
  const mentionsRealTech = primaryTopic.techStack.some((t) => q.questionText.includes(t));
  assert.ok(mentionsRealTech, `expected one of ${primaryTopic.techStack} in: ${q.questionText}`);
});

test('3. project context is prioritized over a bare skill — topicSelector picks the project, not a skill', () => {
  const topic = selectPrimaryTopic(AI_ASSISTANT_RESUME);
  assert.equal(topic.kind, 'project');
  assert.equal(topic.name, 'AI College Assistant');
});

test('3b. skill-only fallback only kicks in when there is truly no project/experience', () => {
  const topic = selectPrimaryTopic(SKILL_ONLY_RESUME);
  assert.equal(topic.kind, 'skill');
  assert.equal(topic.name, 'Java');
});

test('4. UNDERSTANDING-stage question for a project cannot be answered with a bare generic definition (not a template+skill-name question)', async () => {
  const primaryTopic = selectPrimaryTopic(AI_ASSISTANT_RESUME);
  const q = await mockProvider.generateQuestion({
    difficulty: 'Medium',
    primaryTopic,
    stage: 'UNDERSTANDING',
    decision: 'FIRST',
  });
  assert.ok(!isGeneric(q.questionText), `question was too generic: ${q.questionText}`);
  // Must ask about what THIS project does, not a bare technology definition question.
  assert.match(q.questionText, /problem|solve|high level/i);
});

test('5. follow-up questions reference the previous answer, not just the topic', async () => {
  const primaryTopic = selectPrimaryTopic(AI_ASSISTANT_RESUME);
  const lastAnswerText = 'I used Python for the backend and NLP processing with a TF-IDF pipeline.';
  const q = await mockProvider.generateQuestion({
    difficulty: 'Medium',
    primaryTopic,
    stage: 'UNDERSTANDING',
    decision: 'FOLLOW_UP',
    lastAnswerText,
  });
  // The follow-up should quote/reference something from what the candidate actually said.
  assert.ok(
    q.questionText.includes('Python') || q.questionText.includes('backend') || q.questionText.includes('TF-IDF'),
    `follow-up did not reference the previous answer: ${q.questionText}`
  );
});

test('6. different resumes produce meaningfully different questions at every stage', async () => {
  const topicA = selectPrimaryTopic(AI_ASSISTANT_RESUME);
  const topicB = selectPrimaryTopic(OTHER_RESUME);

  for (const stage of ['UNDERSTANDING', 'TECHNICAL_DECISION', 'CHALLENGE', 'SYSTEM_DESIGN']) {
    const qA = await mockProvider.generateQuestion({ difficulty: 'Medium', primaryTopic: topicA, stage, decision: 'NEW_TOPIC' });
    const qB = await mockProvider.generateQuestion({ difficulty: 'Medium', primaryTopic: topicB, stage, decision: 'NEW_TOPIC' });
    assert.notEqual(qA.questionText, qB.questionText, `stage ${stage} produced identical questions for different resumes`);
    assert.match(qA.questionText, /AI College Assistant/);
    assert.match(qB.questionText, /Inventory Tracker/);
  }
});

test('7. the full stage progression covers understanding -> technical decision -> deep technical -> challenge -> alternative -> system design, all referencing the project', async () => {
  const primaryTopic = selectPrimaryTopic(AI_ASSISTANT_RESUME);
  const stages = ['UNDERSTANDING', 'TECHNICAL_DECISION', 'DEEP_TECHNICAL', 'CHALLENGE', 'ALTERNATIVE', 'SYSTEM_DESIGN'];
  const questionTexts = [];
  for (const stage of stages) {
    const q = await mockProvider.generateQuestion({ difficulty: 'Medium', primaryTopic, stage, decision: 'NEW_TOPIC', lastAnswerText: 'used NLP for query parsing' });
    assert.match(q.questionText, /AI College Assistant/, `stage ${stage} did not reference the project`);
    questionTexts.push(q.questionText);
  }
  // All 6 stage questions must be distinct from each other.
  assert.equal(new Set(questionTexts).size, 6);
});
