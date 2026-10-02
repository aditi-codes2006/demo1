// Mock provider: lets the app run and be tested end-to-end without a live
// OpenAI key. It does lightweight heuristic/rule-based logic rather than real
// LLM reasoning, so quality is rough by design — this is a dev/test double,
// not a replacement for the real provider. Importantly, it IS resume- and
// history-aware (not a static chatbot), so the orchestration logic built on
// top of it can be genuinely tested without live credentials.

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractEmail(text) {
  const match = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : '';
}

function extractPhone(text) {
  const match = text.match(/(\+?\d{1,3}[-\s]?)?\d{10}/);
  return match ? match[0] : '';
}

function extractName(text) {
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  return firstLine ? firstLine.slice(0, 60) : '';
}

const KNOWN_SKILLS = [
  'React', 'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'Node.js',
  'Express', 'MongoDB', 'SQL', 'HTML', 'CSS', 'Streamlit', 'OpenAI', 'Gemini',
  'Git', 'Docker', 'AWS', 'Machine Learning', 'Generative AI', 'Agentic AI',
];

function extractSkills(text) {
  const matches = KNOWN_SKILLS.filter((skill) => new RegExp(escapeRegex(skill), 'i').test(text));
  // Order by where each skill actually appears in the text (not the internal
  // KNOWN_SKILLS list order), so the first-mentioned technology is treated
  // as the primary one when generating questions.
  return matches
    .map((skill) => ({ skill, index: text.search(new RegExp(escapeRegex(skill), 'i')) }))
    .sort((a, b) => a.index - b.index)
    .map((m) => m.skill);
}

// Section-aware project extraction: only pulls entries that appear under an
// actual "Projects" heading, so prose elsewhere (summary/objective/about
// text) that happens to mention the word "projects" is never misclassified.
// Falls back to a conservative loose scan only if no Projects section exists
// at all, and that fallback explicitly excludes summary/objective/profile
// lines to avoid the original bug.

const PROJECTS_HEADER = /^projects?\s*:?\s*$/i;
const OTHER_SECTION_HEADER = /^(summary|objective|profile|about( me)?|experience|work experience|education|skills|technical skills|certifications|contact|references)\s*:?\s*$/i;
const NON_PROJECT_PROSE = /^(summary|objective|profile|about)\s*:/i;

function isBulletLine(line) {
  return /^[-•*]\s*/.test(line);
}

function stripBullet(line) {
  return line.replace(/^[-•*]\s*/, '');
}

function extractProjectsFromSection(lines) {
  const projects = [];
  let inProjectsSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (PROJECTS_HEADER.test(line)) {
      inProjectsSection = true;
      continue;
    }
    if (OTHER_SECTION_HEADER.test(line)) {
      inProjectsSection = false;
      continue;
    }
    if (!inProjectsSection) continue;

    if (isBulletLine(line)) {
      // A detail bullet belongs to the most recently opened project.
      const detail = stripBullet(line);
      const last = projects[projects.length - 1];
      if (last) {
        last.description = last.description ? `${last.description} ${detail}` : detail;
        last.techStack = Array.from(new Set([...last.techStack, ...extractSkills(detail)]));
      }
      continue;
    }

    // A new project entry: "Name - description" or a standalone title line.
    const dashSplit = line.split(/\s+-\s+/);
    if (dashSplit.length >= 2) {
      const [name, ...rest] = dashSplit;
      const description = rest.join(' - ').trim();
      projects.push({ name: name.trim(), description, techStack: extractSkills(line) });
    } else {
      projects.push({ name: line, description: '', techStack: extractSkills(line) });
    }
  }

  return projects;
}

// Conservative fallback for resumes with no explicit "Projects:" heading.
// Only matches lines that look like a real project title (contains a dash
// separator AND an app/tool-ish keyword) and never matches summary/objective
// prose lines, even if those lines contain the word "project(s)".
function extractProjectsFallback(lines) {
  const projects = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || NON_PROJECT_PROSE.test(line)) continue;
    if (
      / - /.test(line) &&
      line.length < 120 &&
      /\b(API|chatbot|assistant|model|app|system|tool|platform|dashboard|website|webpage)\b/i.test(line)
    ) {
      const [name, ...rest] = line.split(' - ');
      projects.push({ name: name.trim(), description: rest.join(' - ').trim(), techStack: extractSkills(line) });
    }
  }
  return projects;
}

function extractProjects(text) {
  const lines = text.split('\n');
  const sectioned = extractProjectsFromSection(lines);
  if (sectioned.length > 0) return sectioned;
  return extractProjectsFallback(lines);
}

async function parseResume(rawText) {
  return {
    name: extractName(rawText),
    email: extractEmail(rawText),
    phone: extractPhone(rawText),
    summary: 'Mock-generated summary (no live LLM configured) based on detected keywords.',
    skills: extractSkills(rawText),
    experience: [],
    projects: extractProjects(rawText),
    education: [],
    certifications: [],
  };
}

// --- Interview question generation -----------------------------------------
// Genuinely resume-contextual: the whole interview is anchored on ONE
// primary resume entity (selected by topicSelector.js — projects prioritized
// over experience, prioritized over bare skills), and questions progress
// through depth stages (UNDERSTANDING -> ... -> SYSTEM_DESIGN) on that same
// entity, rather than a generic template with a skill name substituted in.

function snippet(text, maxWords = 14) {
  if (!text) return '';
  const words = text.trim().split(/\s+/);
  return words.slice(0, maxWords).join(' ') + (words.length > maxWords ? '…' : '');
}

function extractMentionedTech(text, techStack = []) {
  if (!text) return null;
  const inStack = techStack.find((t) => new RegExp(escapeRegex(t), 'i').test(text));
  if (inStack) return inStack;
  return KNOWN_SKILLS.find((t) => new RegExp(escapeRegex(t), 'i').test(text)) || null;
}

function primaryTech(topic) {
  return topic.techStack && topic.techStack.length ? topic.techStack[0] : null;
}

// One builder set per resume-entity kind. Each stage function returns the
// question text for that specific depth stage, always referencing the
// concrete topic name (project name / role / skill) — never a bare generic
// template.
const PROJECT_STAGE_BUILDERS = {
  UNDERSTANDING: (topic, difficulty) => {
    const desc = snippet(topic.description, 16);
    return `[${difficulty}] Walk me through your ${topic.name} project${desc ? ` — you described it as "${desc}"` : ''}. What problem was it designed to solve, and how did it work at a high level?`;
  },
  TECHNICAL_DECISION: (topic, difficulty) => {
    const tech = primaryTech(topic) || 'the technology you used';
    return `[${difficulty}] Why did you choose ${tech} for ${topic.name}, and what did it enable that an alternative approach wouldn't have?`;
  },
  DEEP_TECHNICAL: (topic, difficulty, lastAnswerText) => {
    const tech = extractMentionedTech(lastAnswerText, topic.techStack) || primaryTech(topic) || 'that approach';
    return `[${difficulty}] You mentioned ${tech} in ${topic.name}. Walk me through how it actually works step by step — what happens from input to output?`;
  },
  CHALLENGE: (topic, difficulty) =>
    `[${difficulty}] What was the biggest technical limitation or challenge you ran into while building ${topic.name}, and how did you address it?`,
  ALTERNATIVE: (topic, difficulty) =>
    `[${difficulty}] If you rebuilt ${topic.name} today, what would you change about the architecture or technology choices, and why?`,
  SYSTEM_DESIGN: (topic, difficulty) =>
    `[${difficulty}] Suppose ${topic.name} suddenly had to support 10,000 concurrent users. Which part of your current design would become the bottleneck first, and how would you address it?`,
};

const EXPERIENCE_STAGE_BUILDERS = {
  UNDERSTANDING: (topic, difficulty) => {
    const desc = snippet(topic.description, 16);
    return `[${difficulty}] Walk me through your time as ${topic.name}${desc ? ` — specifically, "${desc}"` : ''}. What were you responsible for, and what was the biggest thing you built or shipped?`;
  },
  TECHNICAL_DECISION: (topic, difficulty) =>
    `[${difficulty}] For the work you did as ${topic.name}, what technical approach or tool did you choose, and why was it the right call?`,
  DEEP_TECHNICAL: (topic, difficulty, lastAnswerText) => {
    const tech = extractMentionedTech(lastAnswerText, topic.techStack) || 'that approach';
    return `[${difficulty}] You mentioned ${tech} in your work at ${topic.name}. Walk me through how you actually implemented it, step by step.`;
  },
  CHALLENGE: (topic, difficulty) =>
    `[${difficulty}] What was the hardest problem you ran into during your time as ${topic.name}, and how did you solve it?`,
  ALTERNATIVE: (topic, difficulty) =>
    `[${difficulty}] Looking back on your time as ${topic.name}, what would you do differently, and why?`,
  SYSTEM_DESIGN: (topic, difficulty) =>
    `[${difficulty}] If the systems you worked on as ${topic.name} had to handle 10x the load, what would need to change first?`,
};

const SKILL_STAGE_BUILDERS = {
  UNDERSTANDING: (topic, difficulty) =>
    `[${difficulty}] You listed ${topic.name} as a skill. Which project or experience gave you the most hands-on exposure to ${topic.name}, and what did you build with it?`,
  TECHNICAL_DECISION: (topic, difficulty) =>
    `[${difficulty}] Why was ${topic.name} a good fit for that use case, compared to alternatives you could have used?`,
  DEEP_TECHNICAL: (topic, difficulty, lastAnswerText) => {
    const tech = extractMentionedTech(lastAnswerText, topic.techStack) || topic.name;
    return `[${difficulty}] Go deeper on how you used ${tech} there — walk me through the implementation step by step.`;
  },
  CHALLENGE: (topic, difficulty) =>
    `[${difficulty}] What was the trickiest problem you ran into while using ${topic.name}, and how did you solve it?`,
  ALTERNATIVE: (topic, difficulty) =>
    `[${difficulty}] Looking back, would you use ${topic.name} again for that, or pick something else? Why?`,
  SYSTEM_DESIGN: (topic, difficulty) =>
    `[${difficulty}] If that system had to scale to 10,000 concurrent users, what would break first given how you used ${topic.name}?`,
};

const GENERAL_STAGE_BUILDERS = {
  UNDERSTANDING: (topic, difficulty) =>
    `[${difficulty}] Tell me about a piece of work you're proud of — what was it, and what problem did it solve?`,
  TECHNICAL_DECISION: (topic, difficulty) =>
    `[${difficulty}] What tools or approach did you choose for that, and why?`,
  DEEP_TECHNICAL: (topic, difficulty) =>
    `[${difficulty}] Walk me through how it actually worked, step by step.`,
  CHALLENGE: (topic, difficulty) =>
    `[${difficulty}] What was the biggest challenge you ran into, and how did you handle it?`,
  ALTERNATIVE: (topic, difficulty) =>
    `[${difficulty}] What would you change if you did it again?`,
  SYSTEM_DESIGN: (topic, difficulty) =>
    `[${difficulty}] How would that need to change to support 10,000 concurrent users?`,
};

const STAGE_BUILDERS_BY_KIND = {
  project: PROJECT_STAGE_BUILDERS,
  experience: EXPERIENCE_STAGE_BUILDERS,
  skill: SKILL_STAGE_BUILDERS,
  general: GENERAL_STAGE_BUILDERS,
};

function buildFollowUpQuestion(topic, difficulty, lastAnswerText) {
  const snip = snippet(lastAnswerText, 12);
  return `[${difficulty}] You said "${snip}" — can you go deeper on that? Specifically, how did you verify it actually worked, and what limitations or edge cases did you run into with ${topic.name}?`;
}

async function generateQuestion({ difficulty, primaryTopic, stage, decision, lastAnswerText }) {
  const topic = primaryTopic || { kind: 'general', name: 'your background', techStack: [] };

  if (decision === 'FOLLOW_UP') {
    return {
      questionText: buildFollowUpQuestion(topic, difficulty, lastAnswerText),
      topic: topic.name,
      targetSkill: primaryTech(topic) || topic.name,
    };
  }

  const builders = STAGE_BUILDERS_BY_KIND[topic.kind] || GENERAL_STAGE_BUILDERS;
  const builder = builders[stage] || builders.UNDERSTANDING;

  return {
    questionText: builder(topic, difficulty, lastAnswerText),
    topic: topic.name,
    targetSkill: primaryTech(topic) || topic.name,
  };
}

// --- Answer evaluation -------------------------------------------------------
// Produces a CONTINUOUS score (not a 3-bucket 3/6/9 flattening) from several
// independent, deterministic signals, and builds feedback/gaps that actually
// describe what THIS answer did or didn't cover — never a canned string.

const REASONING_RE = /\b(because|therefore|so that|since|which means|in order to|given that|as a result)\b/i;
const EXAMPLE_RE = /\b(for example|for instance|such as|e\.g\.|specifically|like when)\b/i;
const TRADEOFF_RE = /\b(trade-?off|on the other hand|versus|vs\.?\b|compared to|instead of|whereas|rather than)\b/i;
const LIMITATION_RE = /\b(limitation|however|drawback|didn'?t|couldn'?t|failed to|edge case|downside|issue with|problem was|not (ideal|perfect))\b/i;
const IMPLEMENTATION_RE = /\b(step|pipeline|function|endpoint|api|schema|query|algorithm|architecture|module|component|request|response)\b/i;
const SCALABILITY_RE = /\b(scale|scalab\w*|concurrent|load|cach\w*|bottleneck|latency|throughput|distribut\w*|queue|replicat\w*|rate.?limit\w*)\b/i;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'with', 'that', 'this', 'you', 'your',
  'was', 'were', 'have', 'has', 'did', 'how', 'what', 'why', 'walk', 'me', 'through',
  'about', 'would', 'could', 'from', 'into', 'when', 'then', 'they', 'them', 'these',
]);

function keywordOverlap(answerText, referenceText) {
  const refWords = (referenceText || '').toLowerCase().match(/[a-z0-9+]{4,}/g) || [];
  const uniqueRef = [...new Set(refWords.filter((w) => !STOP_WORDS.has(w)))].slice(0, 14);
  const lower = answerText.toLowerCase();
  return uniqueRef.filter((w) => lower.includes(w));
}

function countTechMentions(text, techStack = []) {
  const pool = new Set([...techStack, ...KNOWN_SKILLS]);
  let count = 0;
  pool.forEach((t) => {
    if (new RegExp(escapeRegex(t), 'i').test(text)) count += 1;
  });
  return count;
}

function detectSignals(text) {
  return {
    reasoning: REASONING_RE.test(text),
    examples: EXAMPLE_RE.test(text),
    tradeoffs: TRADEOFF_RE.test(text),
    limitations: LIMITATION_RE.test(text),
    implementation: IMPLEMENTATION_RE.test(text),
    scalability: SCALABILITY_RE.test(text),
  };
}

// Domain-appropriate scalability concepts for the SYSTEM_DESIGN stage /
// scalability gap phrasing, based on what the primary topic actually is.
function domainScalabilityConcepts(topicHay) {
  const hay = topicHay.toLowerCase();
  if (/gemini|openai|llm|generative|nlp|agent/.test(hay)) return 'rate limiting, caching, and model/API bottlenecks';
  if (/mongo|sql|database/.test(hay)) return 'indexing, replication, and query bottlenecks';
  if (/react|frontend|ui/.test(hay)) return 'bundle size, rendering performance, and CDN caching';
  return 'load balancing, caching, and horizontal scaling';
}

function computeAnswerScore({ text, questionText, topicHay, techStack }) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  let lengthScore = 0;
  if (wordCount >= 70) lengthScore = 2;
  else if (wordCount >= 35) lengthScore = 1.4;
  else if (wordCount >= 15) lengthScore = 0.7;

  const overlapHits = keywordOverlap(text, `${questionText} ${topicHay}`);
  const relevanceScore = Math.min(overlapHits.length * 0.3, 1.2);

  const techMentions = countTechMentions(text, techStack);
  const specificityScore = Math.min(techMentions * 0.4, 1.2);

  const signals = detectSignals(text);
  const reasoningScore = signals.reasoning ? 1 : 0;
  const exampleScore = signals.examples ? 0.8 : 0;
  const tradeoffScore = signals.tradeoffs ? 1 : 0;
  const limitationScore = signals.limitations ? 1 : 0;
  const implementationScore = signals.implementation ? 0.8 : 0;
  const scalabilityScore = signals.scalability ? 1 : 0;

  let raw =
    2.5 +
    lengthScore +
    relevanceScore +
    specificityScore +
    reasoningScore +
    exampleScore +
    tradeoffScore +
    limitationScore +
    implementationScore +
    scalabilityScore;

  // Hard caps for very short/empty-ish answers regardless of keyword stuffing.
  if (wordCount < 6) raw = Math.min(raw, 2.5);
  else if (wordCount < 15) raw = Math.min(raw, 4.5);

  const score = Math.max(1, Math.min(10, Math.round(raw * 10) / 10));
  return { score, wordCount, signals, techMentions, overlapHits };
}

function buildFeedbackAndGaps({ text, topicHay, topicName, stage, signals, score, overlapHits }) {
  const missing = [];
  if (!signals.tradeoffs) missing.push('trade-offs vs. alternative approaches');
  if (!signals.limitations) missing.push('limitations or edge cases encountered');
  if (!signals.implementation) missing.push('concrete implementation detail');
  if (!signals.examples) missing.push('a specific example');
  if (stage === 'SYSTEM_DESIGN' && !signals.scalability) {
    missing.unshift(domainScalabilityConcepts(topicHay));
  }

  const present = [];
  if (signals.reasoning) present.push('clear reasoning');
  if (signals.tradeoffs) present.push('trade-off awareness');
  if (signals.implementation) present.push('implementation detail');
  if (signals.examples) present.push('a concrete example');
  if (signals.scalability) present.push('scalability awareness');
  if (overlapHits.length >= 2) present.push('direct relevance to the question');

  let feedback;
  if (score >= 8.5) {
    feedback =
      `Strong answer on ${topicName} — clearly demonstrates ${present.slice(0, 2).join(' and ') || 'solid understanding'}` +
      (missing.length ? `. Could still touch on ${missing[0]}.` : ' with concrete depth.');
  } else if (score >= 6.5) {
    feedback =
      `Solid answer on ${topicName}${present.length ? `, showing ${present[0]}` : ''}, but doesn't discuss ${missing.slice(0, 2).join(' or ') || 'the finer trade-offs'}.`;
  } else if (score >= 4.5) {
    feedback = `Partial answer on ${topicName} — touches on the basics but lacks ${missing.slice(0, 2).join(' and ') || 'depth'}.`;
  } else {
    feedback = `Answer on ${topicName} ("${snippet(text, 8)}") was too brief to demonstrate real understanding — no ${missing.slice(0, 3).join(', ') || 'reasoning, examples, or implementation detail'} provided.`;
  }

  const gaps = [];
  if (score < 7.5 && missing.length) {
    const stageLabel = stage === 'SYSTEM_DESIGN' ? `${topicName} scalability` : topicName;
    gaps.push(`${stageLabel}: limited discussion of ${missing.slice(0, 3).join(', ')}.`);
  }

  return { feedback, gaps, strengths: present.map((p) => p.charAt(0).toUpperCase() + p.slice(1)) };
}

async function evaluateAnswer({ answer, question, topic, stage, primaryTopic }) {
  const text = (answer || '').trim();
  const topicName = topic || primaryTopic?.name || 'this topic';
  const topicHay = `${topicName} ${(primaryTopic?.techStack || []).join(' ')}`;

  const { score, wordCount, signals, overlapHits } = computeAnswerScore({
    text,
    questionText: question || '',
    topicHay,
    techStack: primaryTopic?.techStack || [],
  });

  const understandingLevel = score >= 7.5 ? 'deep' : score >= 5 ? 'moderate' : 'shallow';
  const suggestedDecision = understandingLevel === 'shallow' ? 'FOLLOW_UP' : 'NEW_TOPIC';

  const { feedback, gaps, strengths } = buildFeedbackAndGaps({
    text,
    topicHay,
    topicName,
    stage,
    signals,
    score,
    overlapHits,
  });

  return { score, feedback, strengths, gaps, understandingLevel, suggestedDecision };
}

// --- Final report narrative generation ---------------------------------------
// Mirrors what a real LLM call would produce, but built from templates driven
// entirely by the already-computed scoring/topic data passed in from
// reportGenerator.js — so output is grounded in THIS interview's actual
// topics/gaps, never generic advice. Contract matches openaiProvider.generateReport.

const TOPIC_ADVICE_RULES = [
  { match: /tf-?idf|cosine|nlp|embedding|vector/i, action: 'Revise TF-IDF, embeddings, semantic similarity, and vector databases — focus on when to use each and their trade-offs.' },
  { match: /react|frontend|ui|css/i, action: 'Practice explaining component architecture, state management choices, and performance trade-offs in your React projects.' },
  { match: /mongo|sql|database|data/i, action: 'Review schema design, indexing, and query performance trade-offs for the databases you\'ve used.' },
  { match: /api|system design|architecture|scalab/i, action: 'Practice designing scalable REST APIs and learn basic load balancing and caching concepts.' },
  { match: /python|node|express|backend/i, action: 'Revisit core backend concepts: request lifecycle, error handling, and how your services are structured end-to-end.' },
  { match: /gemini|openai|llm|generative|agent/i, action: 'Revisit your LLM integration: prompt design, error handling, and cost/latency trade-offs — practice explaining the "why" behind each choice.' },
];

function actionForTopic(topic, techStack = []) {
  const haystack = `${topic} ${techStack.join(' ')}`;
  const rule = TOPIC_ADVICE_RULES.find((r) => r.match.test(haystack));
  return rule
    ? rule.action
    : `Revisit ${topic} — practice explaining the underlying approach, why it was chosen, its limitations, and alternatives out loud.`;
}

function extractGapPhrasesFromStrings(gapStrings = []) {
  const phrases = new Set();
  for (const g of gapStrings) {
    const m = g.match(/limited discussion of (.+?)\.?$/i);
    if (m) m[1].split(',').forEach((part) => phrases.add(part.trim().replace(/^and\s+/, '')));
  }
  return Array.from(phrases);
}

function projectNarrative(t) {
  const stackNote = t.techStack?.length ? ` (${t.techStack.join(', ')})` : '';
  const gapPhrases = extractGapPhrasesFromStrings(t.questions.flatMap((q) => q.gaps || [])).slice(0, 2);
  const strengthWords = Array.from(
    new Set(t.questions.flatMap((q) => q.strengths || []).map((s) => s.toLowerCase()))
  ).slice(0, 2);

  if (t.understandingScore >= 7.5) {
    return (
      `Demonstrated strong understanding of ${t.topic}${stackNote}` +
      (strengthWords.length ? `, including ${strengthWords.join(' and ')}` : '') +
      '.' +
      (gapPhrases.length ? ` Could still strengthen discussion of ${gapPhrases.join(' and ')}.` : '')
    );
  }
  if (t.understandingScore >= 5) {
    return (
      `Showed moderate understanding of ${t.topic}${stackNote}` +
      (strengthWords.length ? `, including ${strengthWords.join(' and ')}` : '') +
      `; could strengthen discussion of ${gapPhrases.join(' and ') || 'trade-offs and implementation detail'}.`
    );
  }
  return `Project understanding could be strengthened for ${t.topic}${stackNote} — discussion lacked ${gapPhrases.join(' and ') || 'concrete technical depth on how it was built'}.`;
}

// Question-level narrative is just the real, content-aware per-answer
// feedback already computed by evaluateAnswer — never a re-templated bucket
// string, so no two answers get the same canned assessment unless they
// genuinely covered the same ground.
function questionNarrative(q) {
  return q.feedback || 'No detailed feedback available for this answer.';
}

async function generateReport({ interviewType, difficulty, categoryScores, overallScore, topics, detectedKnowledgeGaps }) {
  const strongTopics = topics.filter((t) => t.understandingScore >= 7.5);
  const weakTopics = topics.filter((t) => t.understandingScore < 6).sort((a, b) => a.understandingScore - b.understandingScore);

  const strengths = strongTopics.length
    ? strongTopics.map((t) => `Strong grasp of ${t.topic}, with clear reasoning (${t.understandingScore}/10).`)
    : ['Engaged consistently across all questions.'];

  let weaknesses = weakTopics.map(
    (t) => `Project understanding could be strengthened for ${t.topic} (${t.understandingScore}/10).`
  );

  // If the topic average looks fine, still surface specific weak individual
  // answers rather than hiding them behind a good overall average.
  const weakQuestions = topics
    .flatMap((t) => t.questions.filter((q) => q.score < 6).map((q) => ({ ...q, topicName: t.topic, techStack: t.techStack })))
    .sort((a, b) => a.score - b.score);
  if (weaknesses.length === 0 && weakQuestions.length > 0) {
    weaknesses = weakQuestions.slice(0, 2).map((q) => {
      const stageLabel = (q.stage || '').replace(/_/g, ' ').toLowerCase();
      return `The ${stageLabel || 'related'} answer on ${q.topicName} scored ${q.score}/10 — ${q.feedback}`;
    });
  }
  if (weaknesses.length === 0) weaknesses.push('No major weaknesses stood out.');

  const projectAssessments = {};
  const questionAssessments = {};
  topics.forEach((t) => {
    projectAssessments[t.topic] = projectNarrative(t);
    t.questions.forEach((q) => {
      questionAssessments[q.index] = questionNarrative(q);
    });
  });

  const recommendations = weakTopics.slice(0, 2).map((t) => {
    const gapPhrases = extractGapPhrasesFromStrings(t.questions.flatMap((q) => q.gaps || [])).slice(0, 2);
    return {
      topic: t.topic,
      reason:
        `Answers on ${t.topic} averaged ${t.understandingScore}/10` +
        (gapPhrases.length ? `, with limited discussion of ${gapPhrases.join(' and ')}.` : ', indicating limited technical depth.'),
      action: actionForTopic(t.topic, t.techStack),
    };
  });

  if (recommendations.length === 0 && weakQuestions.length > 0) {
    weakQuestions.slice(0, 2).forEach((q) => {
      const gapPhrases = extractGapPhrasesFromStrings(q.gaps || []).slice(0, 2);
      const stageLabel = (q.stage || '').replace(/_/g, ' ').toLowerCase();
      recommendations.push({
        topic: `${q.topicName}${stageLabel ? ` — ${stageLabel}` : ''}`,
        reason: `The ${stageLabel || 'related'} answer scored ${q.score}/10` + (gapPhrases.length ? `, missing ${gapPhrases.join(' and ')}.` : '.'),
        action: actionForTopic(`${q.topicName} ${stageLabel}`, q.techStack),
      });
    });
  }

  if (categoryScores.communication < 6) {
    recommendations.push({
      topic: 'Communication',
      reason: 'Several answers were brief and lacked a structured explanation.',
      action: 'Practice answering technical questions using a structured approach: concept → reasoning → example.',
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      topic: 'Depth on follow-ups',
      reason: 'Overall performance was solid across the interview, with no significant gaps detected.',
      action: 'Keep practicing explaining edge cases and limitations of your projects to sharpen depth even further.',
    });
  }

  const sortedByScore = [...topics].sort((a, b) => b.understandingScore - a.understandingScore);
  const strongest = sortedByScore[0];
  const weakest = sortedByScore[sortedByScore.length - 1];

  const interviewSummary =
    `Overall score: ${overallScore}/10 on a ${difficulty} ${interviewType} interview. ` +
    (strongest ? `Strongest area: ${strongest.topic} (${strongest.understandingScore}/10). ` : '') +
    (weakest && weakest !== strongest ? `Area needing the most attention: ${weakest.topic} (${weakest.understandingScore}/10).` : '');

  return {
    strengths,
    weaknesses,
    knowledgeGaps: Array.from(new Set((detectedKnowledgeGaps || []).filter(Boolean))),
    projectAssessments,
    questionAssessments,
    recommendations,
    interviewSummary: interviewSummary.trim(),
  };
}

export const mockProvider = { parseResume, generateQuestion, evaluateAnswer, generateReport };

// Exported for unit testing only — not part of the provider interface.
export const _internal = {
  extractProjects,
  extractSkills,
  extractMentionedTech,
  snippet,
  PROJECT_STAGE_BUILDERS,
  SKILL_STAGE_BUILDERS,
  computeAnswerScore,
  buildFeedbackAndGaps,
  detectSignals,
  domainScalabilityConcepts,
};
