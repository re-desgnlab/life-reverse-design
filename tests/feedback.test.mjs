import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import feedback from '../api/feedback.js';
import { hashToken } from '../api/report-utils.js';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.REPORT_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const token = crypto.randomBytes(32).toString('base64url');
let storedRow;
global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes(`/diagnoses?select=id,expires_at&report_token_hash=eq.${hashToken(token)}`)) {
    return response([{ id: 'diagnosis-1', expires_at: new Date(Date.now() + 86400000).toISOString() }], 200);
  }
  if (target.includes('/external_feedback?select=id')) return response([], 200);
  if (target.endsWith('/rest/v1/external_feedback') && options.method === 'POST') {
    storedRow = JSON.parse(options.body);
    return response([{ id: 'feedback-1' }], 201);
  }
  throw new Error(`Unexpected fetch: ${target}`);
};

const result = createResponse();
await feedback({
  method: 'POST',
  headers: {},
  body: {
    token,
    helpful: 'partly',
    nextProblem: '先改善拖延',
    contentRequest: '想看時間管理內容',
    consent: true
  }
}, result);
assert.equal(result.statusCode, 201);
assert.equal(storedRow.source_type, 'product_feedback');
assert.equal(storedRow.source_record_id, 'diagnosis-1');
assert.deepEqual(storedRow.metadata, { helpful: 'partly' });
assert.ok(!JSON.stringify(storedRow).includes('email'));
assert.ok(!JSON.stringify(storedRow).includes('生日'));

const missingConsent = createResponse();
await feedback({ method: 'POST', headers: {}, body: { token, helpful: 'helpful' } }, missingConsent);
assert.equal(missingConsent.statusCode, 400);
assert.equal(missingConsent.body.code, 'FEEDBACK_CONSENT_REQUIRED');

console.log('feedback tests passed');

function response(body, status) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}
function createResponse() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}
