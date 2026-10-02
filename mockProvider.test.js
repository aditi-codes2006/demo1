import assert from 'node:assert/strict';
import { test } from 'node:test';
import { _internal, mockProvider } from '../src/llm/mockProvider.js';

const { extractProjects } = _internal;

test('detects a real project entry under a Projects: heading', () => {
  const text = `
Aditi Mishra
Email: a@example.com

Summary: B.Tech CSE (AI) student, GenAI and full-stack projects.

Projects:
AI College Assistant - React + Gemini API chatbot for student queries
`;
  const projects = extractProjects(text);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, 'AI College Assistant');
  assert.match(projects[0].description, /chatbot/i);
});

test('does NOT classify summary/objective text as a project', () => {
  const text = `
Aditi Mishra

Summary: B.Tech CSE (AI) student, GenAI and full-stack projects.

Objective: Seeking an internship to apply my project experience in AI.

Skills: React, Python, MongoDB
`;
  const projects = extractProjects(text);
  assert.equal(projects.length, 0, `expected no projects, got: ${JSON.stringify(projects)}`);
});

test('handles multiple project entries correctly, including bullet detail lines', () => {
  const text = `
Aditi Mishra

Summary: Full-stack developer with several projects.

Projects:
AI College Assistant - React + Gemini API chatbot for student queries
- Added clarification step to reduce irrelevant answers
- Cached common queries client-side

AI Lost & Found Web App - React + Node.js app matching lost/found items
- Used embeddings for description similarity matching

Education:
B.Tech CSE, NIET, 2028
`;
  const projects = extractProjects(text);
  assert.equal(projects.length, 2, `expected 2 projects, got: ${JSON.stringify(projects)}`);

  assert.equal(projects[0].name, 'AI College Assistant');
  assert.match(projects[0].description, /clarification step/i);
  assert.match(projects[0].description, /Cached common queries/i);

  assert.equal(projects[1].name, 'AI Lost & Found Web App');
  assert.match(projects[1].description, /embeddings/i);

  // Bullets should not leak into the Education section or become their own
  // "project" entries.
  const names = projects.map((p) => p.name);
  assert.ok(!names.some((n) => /B\.Tech/i.test(n)));
});

test('fallback path (no Projects: heading) still excludes summary/objective lines', () => {
  const text = `
Jordan Lee
Profile: Passionate about building projects that solve real problems.
Built a Personal Portfolio Site - React + Tailwind static site
`;
  const projects = extractProjects(text);
  // The profile line must never appear as a project, even without a heading.
  assert.ok(!projects.some((p) => /Passionate about/i.test(p.name)));
});

test('parseResume end-to-end still returns skills/name/email alongside fixed project extraction', async () => {
  const text = `
Aditi Mishra
Email: maditi1095@gmail.com Phone: 9876543210

Summary: B.Tech CSE (AI) student, GenAI and full-stack projects.

Skills: React, JavaScript, Python, Node.js, MongoDB, OpenAI, Gemini, Machine Learning

Projects:
AI College Assistant - React + Gemini API chatbot for student queries
`;
  const parsed = await mockProvider.parseResume(text);
  assert.equal(parsed.name, 'Aditi Mishra');
  assert.equal(parsed.email, 'maditi1095@gmail.com');
  assert.equal(parsed.projects.length, 1);
  assert.equal(parsed.projects[0].name, 'AI College Assistant');
  assert.ok(parsed.skills.includes('React'));
});
