import assert from 'node:assert/strict';
import analyze from '../api/analyze.js';

process.env.NODE_ENV = 'test';
delete process.env.GEMINI_API_KEY;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.TURNSTILE_SECRET_KEY;

const ordinaryAnswers = Array.from({ length: 10 }, (_, index) => `第${index + 1}題的一般成年人回答`);

const noConfirmation = createResponse();
await analyze({
  method: 'POST',
  headers: {},
  body: { answers: ordinaryAnswers, adultConfirmed: false }
}, noConfirmation);
assert.equal(noConfirmation.statusCode, 403);
assert.equal(noConfirmation.body.code, 'MINOR_SAFETY_RESTRICTION');

const explicitMinor = createResponse();
await analyze({
  method: 'POST',
  headers: {},
  body: {
    answers: ['我今年16歲，最近常跟父母吵架，想偷偷搬出去住。', ...ordinaryAnswers.slice(1)],
    adultConfirmed: true
  }
}, explicitMinor);
assert.equal(explicitMinor.statusCode, 403);
assert.equal(explicitMinor.body.code, 'MINOR_SAFETY_RESTRICTION');

const adultDiscussingChild = createResponse();
await analyze({
  method: 'POST',
  headers: {},
  body: {
    answers: ['我正在煩惱怎麼和我16歲的小孩溝通。', ...ordinaryAnswers.slice(1)],
    adultConfirmed: true
  }
}, adultDiscussingChild);
assert.equal(adultDiscussingChild.statusCode, 500);
assert.equal(adultDiscussingChild.body.code, 'MISSING_API_KEY');

console.log('minor-safety tests passed');

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
