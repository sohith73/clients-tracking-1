import test from 'node:test';
import assert from 'node:assert/strict';
import { planNeeds, isResumeLinked, isLinkedInDone, isCoverLetterDone, isNewClient } from './needs.js';

test('planNeeds by plan, case-insensitive and trimmed', () => {
  assert.deepEqual(planNeeds('Executive'), { resume: true, linkedin: true, coverLetter: true });
  assert.deepEqual(planNeeds('  professional '), { resume: true, linkedin: true, coverLetter: false });
  assert.deepEqual(planNeeds('Prime'), { resume: true, linkedin: false, coverLetter: false });
  assert.deepEqual(planNeeds('Ignite'), { resume: true, linkedin: false, coverLetter: false });
  assert.deepEqual(planNeeds('Free Trial'), { resume: true, linkedin: false, coverLetter: false });
  assert.deepEqual(planNeeds('weird'), { resume: true, linkedin: false, coverLetter: false });
  assert.deepEqual(planNeeds(undefined), { resume: true, linkedin: false, coverLetter: false });
});

test('isResumeLinked needs a non-blank link', () => {
  assert.equal(isResumeLinked(null), false);
  assert.equal(isResumeLinked({}), false);
  assert.equal(isResumeLinked({ resumeLink: [] }), false);
  assert.equal(isResumeLinked({ resumeLink: [{ name: 'a', link: '   ' }, { name: 'b', link: '' }] }), false);
  assert.equal(isResumeLinked({ resumeLink: [{ name: 'a', link: ' https://x/y ' }] }), true);
  assert.equal(isResumeLinked({ resumeLink: [{ name: 'a', link: '' }, { name: 'b', link: 'https://x' }] }), true);
});

test('isLinkedInDone follows job status', () => {
  for (const s of ['linkedin_done', 'cover_letter_in_progress', 'cover_letter_done', 'applications_ready', 'applications_in_progress', 'completed']) {
    assert.equal(isLinkedInDone({}, { status: s }), true, s);
  }
  for (const s of ['resume_in_progress', 'resume_approved', 'linkedin_in_progress']) {
    assert.equal(isLinkedInDone({}, { status: s }), false, s);
  }
  assert.equal(isLinkedInDone({}, null), false);
});

test('isCoverLetterDone via status, url, or base key', () => {
  assert.equal(isCoverLetterDone({}, { status: 'cover_letter_done' }), true);
  assert.equal(isCoverLetterDone({}, { status: 'completed' }), true);
  assert.equal(isCoverLetterDone({}, { status: 'cover_letter_in_progress' }), false);
  assert.equal(isCoverLetterDone({ coverLetters: [{ url: 'https://cl' }] }, null), true);
  assert.equal(isCoverLetterDone({ coverLetters: [{ url: '' }] }, null), false);
  assert.equal(isCoverLetterDone({ baseCoverLetter: { key: 'k' } }, null), true);
  assert.equal(isCoverLetterDone({ baseCoverLetter: {} }, null), false);
});

test('isNewClient uses createdAt window', () => {
  const now = new Date('2026-11-18T00:00:00Z');
  assert.equal(isNewClient({ createdAt: new Date('2026-11-10T00:00:00Z') }, now, 30), true);
  assert.equal(isNewClient({ createdAt: new Date('2026-09-01T00:00:00Z') }, now, 30), false);
  assert.equal(isNewClient({}, now, 30), false);
  assert.equal(isNewClient({ createdAt: 'nope' }, now, 30), false);
});
