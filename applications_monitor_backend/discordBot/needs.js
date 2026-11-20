/**
 * Pure rules for what a new client still needs. No I/O.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} planType
 * @returns {{resume: true, linkedin: boolean, coverLetter: boolean}}
 */
export function planNeeds(planType) {
  const plan = String(planType || '').trim().toLowerCase();
  return {
    resume: true,
    linkedin: plan === 'professional' || plan === 'executive',
    coverLetter: plan === 'executive',
  };
}

/**
 * A resume counts as linked when at least one entry has a non-blank link.
 * @param {{resumeLink?: Array<{link?: string}>}|null} userDoc
 */
export function isResumeLinked(userDoc) {
  const list = userDoc && Array.isArray(userDoc.resumeLink) ? userDoc.resumeLink : [];
  return list.some((r) => r && typeof r.link === 'string' && r.link.trim() !== '');
}

const LINKEDIN_DONE_STATUSES = [
  'linkedin_done',
  'cover_letter_in_progress',
  'cover_letter_done',
  'applications_ready',
  'applications_in_progress',
  'completed',
];

const COVER_LETTER_DONE_STATUSES = [
  'cover_letter_done',
  'applications_ready',
  'applications_in_progress',
  'completed',
];

// CONFIRM WITH TEAM: what "LinkedIn done" means is not agreed yet. For now it
// follows the onboarding job pipeline: any status at or past linkedin_done.
/**
 * @param {object|null} _userDoc unused for now, kept so the signature can grow
 * @param {{status?: string}|null} onboardingJob
 */
export function isLinkedInDone(_userDoc, onboardingJob) {
  return LINKEDIN_DONE_STATUSES.includes(onboardingJob?.status);
}

// CONFIRM WITH TEAM: what "cover letter done" means is not agreed yet. For now
// it is done when the job status is at or past cover_letter_done, OR the client
// has an uploaded cover letter with a url, OR a base cover letter key is set.
/**
 * @param {{coverLetters?: Array<{url?: string}>, baseCoverLetter?: {key?: string}}|null} userDoc
 * @param {{status?: string}|null} onboardingJob
 */
export function isCoverLetterDone(userDoc, onboardingJob) {
  if (COVER_LETTER_DONE_STATUSES.includes(onboardingJob?.status)) return true;
  const letters = userDoc && Array.isArray(userDoc.coverLetters) ? userDoc.coverLetters : [];
  if (letters.some((c) => c && typeof c.url === 'string' && c.url.trim() !== '')) return true;
  return Boolean(userDoc?.baseCoverLetter?.key);
}

/**
 * New = created within the last `windowDays` days. Missing or bad createdAt is not new.
 * @param {{createdAt?: Date|string}|null} userDoc
 * @param {Date} now
 * @param {number} windowDays
 */
export function isNewClient(userDoc, now, windowDays) {
  const created = userDoc?.createdAt ? new Date(userDoc.createdAt).getTime() : NaN;
  if (!Number.isFinite(created)) return false;
  return now.getTime() - created <= windowDays * DAY_MS;
}
