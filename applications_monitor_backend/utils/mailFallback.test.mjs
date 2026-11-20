// Gmail refusing the app password must not stop client mail: the milestone
// emails go out through SendGrid instead (19 Nov 2026: every send failed 535).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SMTP_USER = 'support@example.com';
process.env.SMTP_PASS = 'app-password';
process.env.SENDGRID_API_KEY = 'SG.test';
delete process.env.MAIL_FALLBACK;

const smtp = await import('./smtpSender.js');
const GMAIL_535 = 'Invalid login: 535-5.7.8 Username and Password not accepted. BadCredentials - gsmtp';

function withFetch(status, fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { status, ok: status < 300, headers: { get: () => 'id1' }, text: async () => 'no' };
  };
  return fn(calls).finally(() => { globalThis.fetch = real; smtp.__resetSmtpAuthState(); });
}

test('Gmail 535 falls back to SendGrid and skips Gmail while the login is known bad', () =>
  withFetch(202, async (calls) => {
    let gmail = 0;
    smtp.__setTransporter({ sendMail: async () => { gmail++; throw new Error(GMAIL_535); } });
    const a = await smtp.sendViaSmtp({ to: 'c@example.com', subject: 'Milestone', html: '<p>x</p>' });
    const b = await smtp.sendViaSmtp({ to: 'c@example.com', subject: 'Milestone 2', text: 'x' });
    assert.equal(a.channel, 'sendgrid');
    assert.equal(a.messageId, 'sendgrid:id1');
    assert.equal(a.from, 'noreply@flashfirehq.com');
    assert.match(a.smtpError, /535/);
    assert.equal(b.channel, 'sendgrid');
    assert.equal(gmail, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].reply_to.email, 'support@example.com');
  }));

test('a working Gmail login never touches SendGrid', () =>
  withFetch(202, async (calls) => {
    smtp.__setTransporter({ sendMail: async () => ({ messageId: '<m@gmail>' }) });
    const out = await smtp.sendViaSmtp({ to: 'c@example.com', subject: 's', text: 't' });
    assert.deepEqual(out, { messageId: '<m@gmail>', channel: 'smtp' });
    assert.equal(calls.length, 0);
  }));

test('both roads failing still throws, with both errors', () =>
  withFetch(500, async () => {
    smtp.__setTransporter({ sendMail: async () => { throw new Error('connect ETIMEDOUT'); } });
    await assert.rejects(smtp.sendViaSmtp({ to: 'c@example.com', subject: 's', text: 't' }), /smtp: connect ETIMEDOUT \| sendgrid_500/);
  }));

test('MAIL_FALLBACK=off keeps the old behaviour: the SMTP error is thrown', () =>
  withFetch(202, async (calls) => {
    process.env.MAIL_FALLBACK = 'off';
    try {
      smtp.__setTransporter({ sendMail: async () => { throw new Error(GMAIL_535); } });
      await assert.rejects(smtp.sendViaSmtp({ to: 'c@example.com', subject: 's', text: 't' }), /535/);
      assert.equal(calls.length, 0);
    } finally {
      delete process.env.MAIL_FALLBACK;
    }
  }));
