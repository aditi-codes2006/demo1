// Picks ONE primary resume entity to anchor the entire interview on, per the
// required priority order:
//   1. Specific projects (richest one — longest description / most tech)
//   2. Internship/work experience
//   3. Specific technical skills (only when nothing more specific exists)
//   4. General fallback when the resume has nothing usable
//
// The whole 6-question interview walks through stages of depth on this ONE
// entity (see constants/interviewOptions.js QUESTION_STAGES), rather than
// hopping between unrelated resume topics — that's what makes questions
// resume-specific instead of "generic template + skill name inserted".

function scoreProject(p) {
  const descLen = (p.description || '').length;
  const techCount = (p.techStack || []).length;
  return descLen + techCount * 20;
}

export function selectPrimaryTopic(resume) {
  const projects = resume?.parsed?.projects || [];
  const experience = resume?.parsed?.experience || [];
  const skills = resume?.parsed?.skills || [];

  if (projects.length > 0) {
    const best = [...projects].sort((a, b) => scoreProject(b) - scoreProject(a))[0];
    return {
      kind: 'project',
      name: best.name,
      description: best.description || '',
      techStack: best.techStack && best.techStack.length ? best.techStack : [],
    };
  }

  if (experience.length > 0) {
    const e = experience[0];
    const name = e.role ? `${e.role}${e.organization ? ` at ${e.organization}` : ''}` : 'your work experience';
    return {
      kind: 'experience',
      name,
      description: (e.highlights || []).join(' '),
      techStack: [],
    };
  }

  if (skills.length > 0) {
    return { kind: 'skill', name: skills[0], description: '', techStack: [skills[0]] };
  }

  return { kind: 'general', name: 'your background', description: '', techStack: [] };
}
