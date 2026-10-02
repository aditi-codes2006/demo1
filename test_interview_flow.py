import json
import subprocess
import sys

BASE = "http://localhost:4000"

def req(method, path, json_body=None, files=None):
    cmd = ["curl", "-s", "-m", "15", "-w", "\n__STATUS__:%{http_code}", "-X", method]
    if json_body is not None and not files:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(json_body)]
    if files:
        for field, path_ in files.items():
            cmd += ["-F", f"{field}=@{path_}"]
    cmd.append(BASE + path)
    result = subprocess.run(cmd, capture_output=True, text=True)
    out = result.stdout
    if not out or "__STATUS__:" not in out:
        return 0, f"curl failed: {result.stderr}"
    body, status = out.rsplit("__STATUS__:", 1)
    try:
        parsed = json.loads(body)
    except Exception:
        parsed = body
    return int(status), parsed

def show(label, status, body):
    print(f"\n--- {label} [{status}] ---")
    print(json.dumps(body, indent=2) if isinstance(body, (dict, list)) else body)

results = {"pass": 0, "fail": 0}
def check(label, cond):
    if cond:
        results["pass"] += 1
        print(f"  [OK] {label}")
    else:
        results["fail"] += 1
        print(f"  [FAIL] {label}")

# 1. Upload resume
status, body = req("POST", "/api/resume/upload", files={"resume": "/home/claude/sample_resume.pdf"})
show("upload resume", status, body)
check("upload returns 201", status == 201)
resume_id = body.get("resumeId")

# 2. Start interview (valid)
status, body = req("POST", "/api/interview/start", {
    "resumeId": resume_id, "interviewType": "ProjectDeepDive", "difficulty": "Medium"
})
show("start interview", status, body)
check("start returns 201", status == 201)
check("first question references resume content (project/skill), not generic", 
      any(k.lower() in body.get("question", {}).get("text", "").lower() for k in ["assistant", "webpage", "project", "college", "react", "gemini", "javascript", "python", "node"]))
interview_id = body.get("interviewId")
first_topic = body.get("question", {}).get("topic")
first_question_text = body.get("question", {}).get("text")
print(f"  topic covered: {first_topic}")

# 3. Submit a SHORT/shallow answer -> expect FOLLOW_UP
status, body = req("POST", "/api/interview/answer", {
    "interviewId": interview_id, "answer": "I used React and it worked fine."
})
show("answer 1 (shallow)", status, body)
check("answer 1 returns 200", status == 200)
check("shallow answer triggers FOLLOW_UP", body.get("decision") == "FOLLOW_UP")
check("follow-up question stays on same topic", body.get("nextQuestion", {}).get("topic") == first_topic)

# 4. Submit a LONG/detailed answer -> expect NEW_TOPIC
long_answer = (
    "I built the AI College Assistant using React for the frontend and the Gemini API for natural language "
    "understanding, because it let students ask free-form questions about deadlines and courses. The trickiest "
    "part was handling ambiguous queries, so I added a clarification step that asked a follow-up question "
    "before calling the LLM, which reduced irrelevant answers significantly. I also cached common queries "
    "client-side to reduce API cost and latency, therefore improving perceived responsiveness."
)
status, body = req("POST", "/api/interview/answer", {"interviewId": interview_id, "answer": long_answer})
show("answer 2 (detailed)", status, body)
check("answer 2 returns 200", status == 200)
check("detailed answer triggers NEW_TOPIC", body.get("decision") == "NEW_TOPIC")
second_topic = body.get("nextQuestion", {}).get("topic")
# NEW BEHAVIOR: the interview now stays anchored on ONE primary resume topic
# (e.g. the strongest project) across all 6 questions, progressing through
# depth stages (UNDERSTANDING -> TECHNICAL_DECISION -> ... -> SYSTEM_DESIGN)
# rather than jumping to a different resume topic. So the topic name should
# STAY THE SAME, but the question text must differ (deeper stage) from Q1.
check("topic stays anchored on the same primary resume topic across the interview", second_topic == first_topic)
check("question text actually changed/deepened for the new stage", body.get("nextQuestion", {}).get("text") != first_question_text)

# 5. Submit a third answer
status, body = req("POST", "/api/interview/answer", {
    "interviewId": interview_id, "answer": "Yes I have experience with MongoDB for storing session data in past projects."
})
show("answer 3", status, body)
check("answer 3 returns 200", status == 200)
check("questionNumber advanced to 4", body.get("questionNumber") == 4)

# 6. Check GET interview state after 3 answers
status, body = req("GET", f"/api/interview/{interview_id}")
show("GET interview state after 3 answers", status, body)
check("2 answers is wrong / should be 3 answers stored", len(body.get("answers", [])) == 3)
check("3 evaluations stored", len(body.get("evaluations", [])) == 3)
check("status still in_progress", body.get("status") == "in_progress")

# 7. Drive remaining questions to completion (MAX_QUESTIONS = 6)
last_status = None
for i in range(5):
    status, body = req("POST", "/api/interview/answer", {
        "interviewId": interview_id, "answer": f"Detailed answer number {i+4} explaining my reasoning because of trade-offs involved."
    })
    last_status = body.get("status")
    if last_status == "completed":
        show(f"final answer -> completion", status, body)
        break

check("interview eventually completes", last_status == "completed")

status, body = req("GET", f"/api/interview/{interview_id}")
check("final question count <= 6", len(body.get("questions", [])) <= 6)
check("GET after completion shows status completed", body.get("status") == "completed")

# 8. Invalid resumeId
status, body = req("POST", "/api/interview/start", {"resumeId": "nonexistent", "interviewType": "Technical", "difficulty": "Easy"})
show("invalid resumeId", status, body)
check("invalid resumeId returns 404", status == 404)

# 9. Unsupported interview type
status, body = req("POST", "/api/interview/start", {"resumeId": resume_id, "interviewType": "Astrology", "difficulty": "Easy"})
show("unsupported interviewType", status, body)
check("unsupported interviewType returns 400", status == 400)

# 10. Unsupported difficulty
status, body = req("POST", "/api/interview/start", {"resumeId": resume_id, "interviewType": "Technical", "difficulty": "Impossible"})
show("unsupported difficulty", status, body)
check("unsupported difficulty returns 400", status == 400)

# 11. Invalid interviewId on answer
status, body = req("POST", "/api/interview/answer", {"interviewId": "nonexistent", "answer": "test"})
show("invalid interviewId", status, body)
check("invalid interviewId returns 404", status == 404)

# 12. Empty answer
status, body = req("POST", "/api/interview/start", {"resumeId": resume_id, "interviewType": "Technical", "difficulty": "Easy"})
new_interview_id = body.get("interviewId")
status, body = req("POST", "/api/interview/answer", {"interviewId": new_interview_id, "answer": "   "})
show("empty answer", status, body)
check("empty answer returns 400", status == 400)

# 13. Answering an already-completed interview
status, body = req("POST", "/api/interview/answer", {
    "interviewId": interview_id, "answer": "one more please"
})
show("answer on completed interview", status, body)
check("completed interview answer returns 409", status == 409)

# ============ FINAL REPORT (/api/interview/finish) TESTS ============

# 14. Finish the completed interview -> full report
status, body = req("POST", "/api/interview/finish", {"interviewId": interview_id})
show("finish completed interview", status, body)
check("finish returns 200", status == 200)
check("overallScore present and in range 0-10", isinstance(body.get("overallScore"), (int, float)) and 0 <= body["overallScore"] <= 10)

cat_scores = body.get("categoryScores", {})
expected_categories = ["technicalKnowledge", "projectUnderstanding", "problemSolving", "communication", "confidence"]
check("all 5 category scores present and in range", all(
    k in cat_scores and isinstance(cat_scores[k], (int, float)) and 0 <= cat_scores[k] <= 10
    for k in expected_categories
))
check("strengths is a non-empty list", isinstance(body.get("strengths"), list) and len(body["strengths"]) > 0)
check("weaknesses is a list", isinstance(body.get("weaknesses"), list))
check("knowledgeGaps is a list", isinstance(body.get("knowledgeGaps"), list))
check("projectAssessment is a list with understandingScore in range", all(
    0 <= pa.get("understandingScore", -1) <= 10 for pa in body.get("projectAssessment", [])
))
check("projectAssessment references the real project (AI College Assistant)", 
      any("AI College Assistant" in pa.get("project", "") for pa in body.get("projectAssessment", [])))
check("questionAnalysis has exactly 6 entries", len(body.get("questionAnalysis", [])) == 6)
check("questionAnalysis scores all in range 0-10", all(
    qa.get("score") is None or 0 <= qa["score"] <= 10 for qa in body.get("questionAnalysis", [])
))
check("recommendations is a non-empty list of {topic, reason, action}", 
      isinstance(body.get("recommendations"), list) and len(body["recommendations"]) > 0 and
      all(set(["topic", "reason", "action"]).issubset(r.keys()) for r in body["recommendations"]))
check("interviewSummary is a non-empty string", isinstance(body.get("interviewSummary"), str) and len(body["interviewSummary"]) > 0)

# The shallow first answer ("I used React and it worked fine.") on the
# AI College Assistant project should surface as a knowledge gap / weakness
# somewhere in the report, since the follow-up on it was also fairly short
# relative to the later detailed answer.
report_text = json.dumps(body).lower()
import re as _re
check("report language avoids accusing the candidate of lying/fabrication", 
      not _re.search(r'\blying\b', report_text) and not _re.search(r'\blied\b', report_text) and "fabricat" not in report_text)

# 15. Finish an already-completed interview again -> returns the SAME cached report, not a new one
status, body2 = req("POST", "/api/interview/finish", {"interviewId": interview_id})
show("finish again (idempotency check)", status, body2)
check("finish again returns 200", status == 200)
check("second finish returns identical report (no duplicate generation)", body2 == body)

# 16. Finish an interview with fewer than 6 answered questions
status, body = req("POST", "/api/interview/start", {
    "resumeId": resume_id, "interviewType": "Technical", "difficulty": "Easy"
})
incomplete_interview_id = body.get("interviewId")
req("POST", "/api/interview/answer", {"interviewId": incomplete_interview_id, "answer": "A short first answer to move things along."})
status, body = req("POST", "/api/interview/finish", {"interviewId": incomplete_interview_id})
show("finish before 6 questions answered", status, body)
check("finishing incomplete interview returns 400", status == 400)

# 17. Finish with an invalid interviewId
status, body = req("POST", "/api/interview/finish", {"interviewId": "nonexistent"})
show("finish with invalid interviewId", status, body)
check("finish with invalid interviewId returns 404", status == 404)

# 18. Finish with missing interviewId in body
status, body = req("POST", "/api/interview/finish", {})
show("finish with missing interviewId", status, body)
check("finish with missing interviewId returns 400", status == 400)

print(f"\n\n=== RESULTS: {results['pass']} passed, {results['fail']} failed ===")
sys.exit(1 if results["fail"] else 0)
