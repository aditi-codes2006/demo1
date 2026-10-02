import { createRequire } from 'module';
import { resumeRepository } from '../db/repositories/resumeRepository.js';
import { getLlmProvider } from '../llm/provider.js';

const MIN_TEXT_LENGTH = 50;

const require = createRequire(import.meta.url);
const PDF_PARSE_PATH = require.resolve('pdf-parse/lib/pdf-parse.js');
const PDF_JS_BUILD_PATH = require.resolve('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');

// pdf-parse (and the legacy pdf.js build it bundles) caches a `PDFJS`
// singleton at module scope and doesn't fully reset its internal document
// state between parses. In a long-running server process this causes
// intermittent "bad XRef entry" failures starting on the 2nd/3rd upload —
// reproduced and confirmed during testing. Forcing a fresh require of both
// modules before every parse avoids the stale/corrupted shared state.
function freshPdfParse() {
  delete require.cache[PDF_PARSE_PATH];
  delete require.cache[PDF_JS_BUILD_PATH];
  return require(PDF_PARSE_PATH);
}

export async function extractTextFromPdf(buffer) {
  const isolatedBuffer = Buffer.from(buffer);

  // The bundled pdf.js (v1.10.100) inside pdf-parse is old, unmaintained, and
  // has been observed (during testing) to intermittently throw "bad XRef
  // entry" on a valid, unchanged PDF when parsed repeatedly within the same
  // long-running process — root cause appears to be internal state in that
  // legacy build, not our data. A short bounded retry is the pragmatic fix
  // for this specific known flakiness; a cleaner long-term fix would be
  // migrating to the actively maintained `pdfjs-dist` package directly.
  const MAX_ATTEMPTS = 3;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const pdfParse = freshPdfParse();
      const result = await pdfParse(isolatedBuffer);
      return result.text.trim();
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Failed to parse PDF after ${MAX_ATTEMPTS} attempts: ${lastErr.message}`);
}

export async function processResumeUpload({ fileName, buffer }) {
  const rawText = await extractTextFromPdf(buffer);

  if (rawText.length < MIN_TEXT_LENGTH) {
    const err = new Error(
      'Could not extract readable text from this PDF. It may be a scanned image without a text layer.'
    );
    err.statusCode = 422;
    throw err;
  }

  const resume = await resumeRepository.create({ fileName, rawText });

  try {
    const llm = getLlmProvider();
    const parsed = await llm.parseResume(rawText);
    const updated = await resumeRepository.saveParsedData(resume.id, parsed);
    return updated;
  } catch (err) {
    await resumeRepository.markFailed(resume.id);
    err.statusCode = err.statusCode || 502;
    err.message = `Resume uploaded, but AI parsing failed: ${err.message}`;
    throw err;
  }
}

export async function getResumeById(id) {
  return resumeRepository.findById(id);
}
