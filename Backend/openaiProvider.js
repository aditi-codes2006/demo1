import OpenAI from 'openai';
import { config } from '../config/index.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

const RESUME_PARSE_SYSTEM_PROMPT = `You are a resume parsing engine. Extract structured information from the
resume text and respond with ONLY valid JSON (no markdown fences, no commentary) matching this shape:
{
  "name": string,
  "email": string,
  "phone": string,
  "summary": string,          // 1-2 sentence professional summary
  "skills": string[],
  "experience": [{ "role": string, "organization": string, "duration": string, "highlights": string[] }],
  "projects": [{ "name": string, "description": string, "techStack": string[] }],
  "education": [{ "degree": string, "institution": string, "year": string }],
  "certifications": string[]
}
If a field is not present in the resume, use an empty string or empty array as appropriate. Never invent facts
that aren't in the resume text.`;

async function parseResume(rawText) {
  const completion = await client.chat.completions.create({
    model: config.openaiModel,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: RESUME_PARSE_SYSTEM_PROMPT },
      { role: 'user', content: rawText.slice(0, 12000) },
    ],
  });
  const raw = completion.choices[0].message.content;
  return JSON.parse(raw);
}

const REPORT_SYSTEM_PROMPT = `You are writing the narrative portions of a candidate's final interview evaluation report.
Numeric scores (categoryScores, overallScore, and each topic's understandingScore) have ALREADY been computed by
code — do not invent or restate different numbers. Your job is only to explain and justify those numbers in
natural language, grounded strictly in the provided topics (actual questions/answers/evaluations per topic) and
resume. Respond with ONLY valid JSON:
{
  "strengths": string[],
  "weaknesses": string[],
  "knowledgeGaps": string[],
  "projectAssessments": { "<topic name>": string },
  "questionAssessments": { "<questionIndex as string>": string },
  "recommendations": [{ "topic": string, "reason": string, "action": string }],
  "interviewSummary": string
}
Rules:
- Every recommendation must reference a topic/gap that actually came up in THIS interview's topics array — never
  generic advice unrelated to what was asked.
- If a resume project (e.g. one using TF-IDF and cosine similarity) was covered and the candidate explained why
  the approach was chosen, how it works, its limitations, and possible improvements, reflect that as strong
  project understanding in projectAssessments. If the answer was shallow or incorrect, say project understanding
  "could be strengthened" for that topic — never say the candidate lied or fabricated their resume.
- Base weaknesses/knowledgeGaps only on topics where understandingScore is low or evaluations show gaps — do not
  invent weaknesses that aren't supported by the data.`;

async function generateReport({ resume, interviewType, difficulty, categoryScores, overallScore, topics, detectedKnowledgeGaps }) {
  const completion = await client.chat.completions.create({
    model: config.openaiModel,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: REPORT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({ resume, interviewType, difficulty, categoryScores, overallScore, topics, detectedKnowledgeGaps }),
      },
    ],
  });
  return JSON.parse(completion.choices[0].message.content);
}

const QUESTION_SYSTEM_PROMPT = `You are a technical interviewer AI conducting a resume-grounded interview. The
entire interview is anchored on ONE primary resume topic (see "primaryTopic" in the input — already selected by
priority: a specific project > internship/work experience > a specific skill, in that order). Your job is to
generate ONE question at a time that walks through this topic with increasing depth, in this exact stage order:

1. UNDERSTANDING — what the project/experience is and what problem it solved
2. TECHNICAL_DECISION — why specific technologies/approaches were chosen, and what they enabled
3. DEEP_TECHNICAL — how it actually works, step by step (implementation detail)
4. CHALLENGE — the biggest technical limitation or challenge encountered
5. ALTERNATIVE — what they would change if rebuilding it today
6. SYSTEM_DESIGN — how the design would need to change to handle significant scale (e.g. 10,000 concurrent users)

The "stage" field in the input tells you which of these to generate right now.

Respond with ONLY valid JSON (no markdown fences):
{ "questionText": string, "topic": string, "targetSkill": string }

Rules:
- "topic" must always be primaryTopic.name (or the closest matching resume entity) — do NOT invent a different topic.
- If decision is "FOLLOW_UP": stay on the SAME stage and probe deeper into what the candidate just said in
  lastAnswerText (quote or directly reference something specific they said) — do not advance to the next stage
  and do not switch topics. Ask them to justify, evaluate, or go deeper (e.g. "how did you verify that actually
  worked, and what limitations did you hit?").
- If decision is "NEW_TOPIC" or "FIRST": generate the question for the given "stage" on primaryTopic.
- ALWAYS reference primaryTopic.name, and primaryTopic.description/techStack when relevant, explicitly in the
  question text — never a bare generic template.
- NEVER ask about a technology just because it's in the skills list if primaryTopic already gives you a specific
  project/experience context to anchor on instead — only fall back to skill-only phrasing when primaryTopic.kind
  is "skill" (meaning no project/experience exists on the resume).
- Before finalizing, silently check: "Could this exact question have been asked to almost any candidate?" If yes,
  rewrite it so it could only be asked to someone who actually built/did what's described in primaryTopic — for
  example never emit something as generic as "Tell me about a challenge you faced while working on Java" when a
  specific project or experience is available; instead reference the specific project/technology/decision.`;

async function generateQuestion({ resume, interviewType, difficulty, primaryTopic, stage, decision, lastEvaluation, lastAnswerText, history = [] }) {
  const completion = await client.chat.completions.create({
    model: config.openaiModel,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: QUESTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          resume,
          interviewType,
          difficulty,
          primaryTopic,
          stage,
          decision,
          lastEvaluation,
          lastAnswerText,
          history,
        }),
      },
    ],
  });
  return JSON.parse(completion.choices[0].message.content);
}

const EVALUATION_SYSTEM_PROMPT = `You are grading a candidate's interview answer on a specific resume topic/stage. Respond with
ONLY valid JSON (no markdown fences):
{
  "score": number,               // 1-10, a genuine continuous assessment — NOT a rounded bucket like 3/6/8
  "feedback": string,             // one or two sentences, SPECIFIC to what this answer actually said
  "strengths": string[],
  "gaps": string[],
  "understandingLevel": "shallow" | "moderate" | "deep",
  "suggestedDecision": "FOLLOW_UP" | "NEW_TOPIC"
}
Score based on genuine signals actually present in the answer: relevance to the specific question, technical
specificity, reasoning ("because"/"therefore" style justification), concrete examples, trade-off awareness,
discussion of limitations/edge cases, implementation detail, and — for system-design-flavored questions —
scalability concepts (caching, bottlenecks, rate limiting, load). Do not default to a fixed "normal" score (e.g.
always 8) — a strong, well-reasoned answer covering several of these signals can and should score 8-10; a
shallow, generic, or unsupported answer should score well below that (4-7 or lower depending on severity).
Feedback and gaps must reference what THIS specific answer covered or missed — never a generic templated
sentence reused across different answers. If something is missing (e.g. trade-offs, limitations, scalability
discussion), name it specifically and tie it to the topic (e.g. "limited discussion of rate limiting and
caching for the Gemini integration"), not a vague "needs more detail".
Use "FOLLOW_UP" when the answer is shallow, vague, or leaves an important gap worth probing. Use "NEW_TOPIC" when
the candidate has demonstrated solid understanding and it's time to move on.`;

async function evaluateAnswer({ question, topic, stage, answer, resume, interviewType, difficulty, primaryTopic }) {
  const completion = await client.chat.completions.create({
    model: config.openaiModel,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: EVALUATION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({ question, topic, stage, answer, resume, interviewType, difficulty, primaryTopic }),
      },
    ],
  });
  return JSON.parse(completion.choices[0].message.content);
}

export const openaiProvider = { parseResume, generateQuestion, evaluateAnswer, generateReport };

