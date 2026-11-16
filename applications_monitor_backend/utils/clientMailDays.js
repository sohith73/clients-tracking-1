// No client mail on Sundays (bsc, 2026-11-16).
//
// "Sunday" is the IST calendar day, the clock every mail cron here runs on.
// The dashboard backend holds its own copy of this rule for the daily summary,
// the onboarding sequence and the inbox alerts
// (flashfire-dashboard-backend Utils/clientMailDays.js). Change both.
//
// In this service:
//   milestone emails   the 21:00 IST sweep sends nothing on Sunday and leaves
//                      the milestones unsent, so Monday's sweep sends them;
//                      the admin send/resend buttons answer 409
//   Notifications tab  Scheduled rows that fall on Sunday move to Monday
// Staff test sends (milestoneKey test_*) are not client mail and still send.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** IST weekdays with no client mail. 0 = Sunday. */
export const CLIENT_MAIL_OFF_WEEKDAYS = new Set([0]);

/** Reason recorded when a client mail is held for the day. */
export const CLIENT_MAIL_HOLD_REASON = 'sunday_hold';

export const CLIENT_MAIL_HOLD_MESSAGE = 'No client emails go out on Sundays (IST). This one sends on Monday.';

function istWeekday(date) {
  return new Date(date.getTime() + IST_OFFSET_MS).getUTCDay();
}

/** Is `now` on an IST day when client mail is held? */
export function isClientMailOffDay(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return CLIENT_MAIL_OFF_WEEKDAYS.has(istWeekday(d));
}

/** 00:00 IST of the IST day containing `date`. */
function istMidnight(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_OFFSET_MS);
}

/**
 * The first instant at or after `at` when client mail may go out: `at` itself
 * on a normal day, otherwise 00:00 IST of the next allowed day.
 */
export function nextClientMailInstant(at) {
  let t = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(t.getTime())) return t;
  for (let i = 0; i < 7 && isClientMailOffDay(t); i++) {
    t = new Date(istMidnight(t).getTime() + DAY_MS);
  }
  return t;
}

/** The same clock time on the first allowed day at or after `at`. */
export function sameTimeNextClientMailDay(at) {
  let t = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(t.getTime())) return t;
  for (let i = 0; i < 7 && isClientMailOffDay(t); i++) t = new Date(t.getTime() + DAY_MS);
  return t;
}
