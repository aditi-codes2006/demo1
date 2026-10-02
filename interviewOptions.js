export const INTERVIEW_TYPES = [
  'Technical',
  'HR',
  'AIML',
  'FullStack',
  'ProjectDeepDive',
  'Mixed',
];

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

export const MAX_QUESTIONS = 6;

// The interview walks through ONE primary resume topic (a project, or the
// next-best resume entity) across these stages of increasing depth, so
// questions build on each other instead of hopping between unrelated topics.
// Deliberately 6 stages == MAX_QUESTIONS: a full interview (with zero
// follow-ups needed) walks the complete progression end to end.
export const QUESTION_STAGES = [
  'UNDERSTANDING', // Q1: what the project/experience is and what problem it solved
  'TECHNICAL_DECISION', // Q2: why specific technologies/approaches were chosen
  'DEEP_TECHNICAL', // Q3: how it actually works, step by step
  'CHALLENGE', // Q4: biggest limitation/challenge encountered
  'ALTERNATIVE', // Q5: what they'd change if rebuilding it today
  'SYSTEM_DESIGN', // Q6: how it would need to change to scale
];

// A topic gets at most one follow-up before we force a move to a new topic,
// so a weak answer doesn't trap the candidate in an infinite drill-down loop
// within the fixed 6-question budget.
export const MAX_FOLLOW_UPS_PER_TOPIC = 1;

export function isValidInterviewType(value) {
  return INTERVIEW_TYPES.includes(value);
}

export function isValidDifficulty(value) {
  return DIFFICULTIES.includes(value);
}
