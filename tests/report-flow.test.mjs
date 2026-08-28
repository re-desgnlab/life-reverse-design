import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import saveReport from '../api/save-report.js';
import readReport from '../api/report.js';
import { normalizeEmail, supabaseHeaders } from '../api/report-utils.js';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.RESEND_API_KEY = 'resend-test';
process.env.REPORT_FROM_EMAIL = 'report@example.com';
process.env.REPORT_PUBLIC_URL = 'https://example.vercel.app';
process.env.REPORT_TEST_RECIPIENT = 'test@example.com';
process.env.REPORT_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

assert.equal(normalizeEmail(' rldlab.official@\u200Bgmail.com '), 'rldlab.official@gmail.com');
assert.equal('Authorization' in supabaseHeaders('sb_secret_example'), false);
assert.equal(supabaseHeaders('legacy-service-role').Authorization, 'Bearer legacy-service-role');

const report = {
  summary: '這是一份測試摘要',
  coreBlock: {
    title: '測試核心卡點',
    explanation: '這是有回答線索支持的測試解釋',
    evidence: ['第一項具體線索', '第二項具體線索'],
    confidence: 'medium',
    ignored: 'must-not-be-stored'
  },
  copingPattern: {
    currentResponse: '目前做法',
    protectiveFunction: '短期保護',
    longTermCost: '長期代價'
  },
  controllability: {
    controllable: ['可控制'],
    influenceable: ['可影響'],
    uncontrollable: ['無法控制']
  },
  resources: [
    { resource: '資源一', application: '應用一' },
    { resource: '資源二', application: '應用二' }
  ],
  boundaries: [
    { trigger: '情況一', action: '動作一', expression: '說法一' },
    { trigger: '情況二', action: '動作二', expression: '' }
  ],
  experiments: [
    experiment('觀察', 'observation'),
    experiment('微行動', 'micro_action'),
    experiment('界線', 'boundary_or_choice')
  ],
  closingReminder: '把結果當作可以回測的假設',
  unexpectedTopLevel: 'must-not-be-stored'
};
const answers = Array.from({ length: 10 }, (_, index) => `第${index + 1}題回答`);
let insertedRow;
let emailPayload;
let contactPayload;

global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith('/rest/v1/diagnoses') && options.method === 'POST') {
    insertedRow = JSON.parse(options.body);
    return response([{ id: 'row-1' }], 201);
  }
  if (target.includes('/rest/v1/diagnoses?id=eq.row-1') && options.method === 'PATCH') {
    return response(null, 204);
  }
  if (target === 'https://api.resend.com/emails') {
    emailPayload = JSON.parse(options.body);
    return response({ id: 'email-1' }, 200);
  }
  if (target === 'https://api.resend.com/contacts') {
    contactPayload = JSON.parse(options.body);
    return response({ id: 'contact-1' }, 200);
  }
  if (target.includes('select=id,report_encrypted,expires_at')) {
    return response([{
      id: 'row-1',
      report_encrypted: insertedRow.report_encrypted,
      expires_at: insertedRow.expires_at
    }], 200);
  }
  throw new Error(`Unexpected fetch: ${target} ${options.method || 'GET'}`);
};

const saveResponse = createResponse();
await saveReport({
  method: 'POST',
  headers: {},
  body: {
    name: '測試者',
    birthDate: '1990-01-01',
    email: 'TEST@EXAMPLE.COM',
    answers,
    report,
    consent: true,
    adultConfirmed: true,
    marketingOptIn: true,
    source: 'newsletter&utm=unsafe'
  }
}, saveResponse);
assert.equal(saveResponse.statusCode, 200);
assert.equal(insertedRow.email, 'test@example.com');
assert.equal(insertedRow.adult_confirmed, true);
assert.ok(!insertedRow.profile_encrypted.includes('測試者'));
assert.equal(insertedRow.source, 'newsletterutmunsafe');
assert.equal(insertedRow.marketing_opt_in, true);
assert.ok(!insertedRow.answers_encrypted.includes(answers[0]));
assert.ok(!insertedRow.report_encrypted.includes(report.summary));
assert.equal(emailPayload.to[0], 'test@example.com');
assert.equal(contactPayload.email, 'test@example.com');

const token = new URL(saveResponse.body.reportUrl).searchParams.get('token');
assert.match(token, /^[A-Za-z0-9_-]{40,60}$/);
const readResponse = createResponse();
await readReport({ method: 'GET', headers: {}, query: { token } }, readResponse);
assert.equal(readResponse.statusCode, 200);
assert.equal(readResponse.body.report.summary, report.summary);
assert.equal('unexpectedTopLevel' in readResponse.body.report, false);
assert.equal('ignored' in readResponse.body.report.coreBlock, false);

const invalidResponse = createResponse();
await saveReport({
  method: 'POST', headers: {}, body: {
    name: '測試者', birthDate: '1990-01-01', adultConfirmed: true,
    email: 'bad', answers, report, consent: true
  }
}, invalidResponse);
assert.equal(invalidResponse.statusCode, 400);

const wrongRecipientResponse = createResponse();
await saveReport({
  method: 'POST',
  headers: {},
  body: {
    name: '測試者', birthDate: '1990-01-01', adultConfirmed: true,
    email: 'someone@example.com', answers, report, consent: true
  }
}, wrongRecipientResponse);
assert.equal(wrongRecipientResponse.statusCode, 403);
assert.equal(wrongRecipientResponse.body.code, 'TEST_RECIPIENT_ONLY');

const underageResponse = createResponse();
await saveReport({
  method: 'POST',
  headers: {},
  body: {
    name: '未成年測試者', birthDate: '2012-01-01', adultConfirmed: true,
    email: 'test@example.com', answers, report, consent: true
  }
}, underageResponse);
assert.equal(underageResponse.statusCode, 403);
assert.equal(underageResponse.body.code, 'ADULT_VERIFICATION_REQUIRED');

console.log('report-flow tests passed');

function experiment(title, type) {
  return {
    title,
    type,
    action: '具體行動',
    deadline: '三天內',
    hypothesis: '待驗證假設',
    evidence: '觀察證據',
    stopCondition: '出現不適即停止'
  };
}

function response(body, status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}
