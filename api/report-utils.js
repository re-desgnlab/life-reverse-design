import crypto from 'node:crypto';

const MAX_EMAIL_LENGTH = 254;
const MAX_ANSWER_LENGTH = 200;
const EXPECTED_EXPERIMENT_TYPES = ['observation', 'micro_action', 'boundary_or_choice'];

export function setSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

export function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  const fetchSite = req.headers['sec-fetch-site'];
  const appHeader = req.headers['x-app-request'];
  const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const defaults = [
    'https://life-reverse-design-ranp.vercel.app',
    'https://life-reverse-design-ranp-git-psychology-v2-design-lab4.vercel.app'
  ];
  if (fetchSite && !['same-origin', 'same-site'].includes(fetchSite)) return false;
  if (process.env.NODE_ENV === 'production' && appHeader !== 'life-reverse-design') return false;
  if (!origin) return process.env.NODE_ENV !== 'production';
  return new Set([...defaults, ...configuredOrigins]).has(origin);
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export async function enforceReportRateLimit(req) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { success: true, disabled: true };

  const key = `ratelimit:save-report:${getClientIp(req)}`;
  const response = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, 3600, 'NX']
    ])
  });
  if (!response.ok) throw new Error('Rate limit service unavailable');
  const data = await response.json();
  return { success: Number(data?.[0]?.result || 0) <= 5, retryAfter: 3600 };
}

export function normalizeEmail(value) {
  const email = String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim()
    .toLowerCase();
  if (
    !email ||
    email.length > MAX_EMAIL_LENGTH ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) return null;
  return email;
}

export function normalizeName(value) {
  const name = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
  return name && name.length <= 80 ? name : null;
}

export function normalizeAdultBirthDate(value) {
  const birthDate = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const parsed = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthDate) return null;
  if (birthDate < '1900-01-01' || birthDate > getAdultCutoffDate()) return null;
  return birthDate;
}

export function validateAnswers(value) {
  return Array.isArray(value) &&
    value.length === 10 &&
    value.every((item) => {
      return typeof item === 'string' &&
        item.trim() &&
        item.length <= MAX_ANSWER_LENGTH;
    });
}

export function sanitizeReport(value) {
  if (!value || typeof value !== 'object') return null;
  if (
    !isText(value.summary) ||
    !hasTextFields(value.coreBlock, ['title', 'explanation']) ||
    !isTextArray(value.coreBlock.evidence, 2) ||
    !['high', 'medium', 'low'].includes(value.coreBlock.confidence) ||
    !hasTextFields(value.copingPattern, ['currentResponse', 'protectiveFunction', 'longTermCost']) ||
    !isTextArray(value.controllability?.controllable) ||
    !isTextArray(value.controllability?.influenceable) ||
    !isTextArray(value.controllability?.uncontrollable) ||
    !Array.isArray(value.resources) || value.resources.length !== 2 ||
    value.resources.some((item) => !hasTextFields(item, ['resource', 'application'])) ||
    !Array.isArray(value.boundaries) || value.boundaries.length !== 2 ||
    value.boundaries.some((item) => !hasTextFields(item, ['trigger', 'action']) || typeof item.expression !== 'string') ||
    !Array.isArray(value.experiments) || value.experiments.length !== 3 ||
    !isText(value.closingReminder)
  ) return null;

  for (let index = 0; index < value.experiments.length; index++) {
    const item = value.experiments[index];
    if (
      !hasTextFields(item, ['title', 'action', 'deadline', 'hypothesis', 'evidence', 'stopCondition']) ||
      item.type !== EXPECTED_EXPERIMENT_TYPES[index]
    ) return null;
  }

  const report = {
    summary: cleanText(value.summary, 600),
    coreBlock: {
      title: cleanText(value.coreBlock.title, 160),
      explanation: cleanText(value.coreBlock.explanation, 1200),
      evidence: value.coreBlock.evidence.map((item) => cleanText(item, 500)),
      confidence: value.coreBlock.confidence
    },
    copingPattern: {
      currentResponse: cleanText(value.copingPattern.currentResponse, 600),
      protectiveFunction: cleanText(value.copingPattern.protectiveFunction, 600),
      longTermCost: cleanText(value.copingPattern.longTermCost, 600)
    },
    controllability: {
      controllable: value.controllability.controllable.map((item) => cleanText(item, 400)),
      influenceable: value.controllability.influenceable.map((item) => cleanText(item, 400)),
      uncontrollable: value.controllability.uncontrollable.map((item) => cleanText(item, 400))
    },
    resources: value.resources.map((item) => ({
      resource: cleanText(item.resource, 400),
      application: cleanText(item.application, 600)
    })),
    boundaries: value.boundaries.map((item) => ({
      trigger: cleanText(item.trigger, 500),
      action: cleanText(item.action, 600),
      expression: cleanText(item.expression, 500)
    })),
    experiments: value.experiments.map((item) => ({
      title: cleanText(item.title, 120),
      type: item.type,
      action: cleanText(item.action, 800),
      deadline: cleanText(item.deadline, 120),
      hypothesis: cleanText(item.hypothesis, 600),
      evidence: cleanText(item.evidence, 600),
      stopCondition: cleanText(item.stopCondition, 500)
    })),
    closingReminder: cleanText(value.closingReminder, 500)
  };
  return JSON.stringify(report).length <= 30000 ? report : null;
}

export function createReportToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function encryptJson(value) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptJson(value) {
  const key = getEncryptionKey();
  const [ivText, tagText, dataText] = String(value || '').split('.');
  if (!ivText || !tagText || !dataText) throw new Error('Invalid encrypted payload');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivText, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataText, 'base64url')),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}

export function getStorageConfig() {
  const config = {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  if (Object.values(config).some((value) => !value)) return null;
  getEncryptionKey();
  return config;
}

export function getDeliveryConfig() {
  const storage = getStorageConfig();
  if (!storage) return null;
  const config = {
    ...storage,
    resendApiKey: process.env.RESEND_API_KEY,
    reportFromEmail: process.env.REPORT_FROM_EMAIL,
    reportPublicUrl: process.env.REPORT_PUBLIC_URL,
    reportTestRecipient: normalizeEmail(process.env.REPORT_TEST_RECIPIENT) || null
  };
  if (!config.resendApiKey || !config.reportFromEmail || !config.reportPublicUrl) return null;
  getEncryptionKey();
  return config;
}

export function supabaseHeaders(serviceKey, prefer) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

function getEncryptionKey() {
  const raw = process.env.REPORT_ENCRYPTION_KEY;
  if (!raw) throw new Error('Missing REPORT_ENCRYPTION_KEY');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('REPORT_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

function cleanText(value, maxLength) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/<[^>]*>/g, '')
    .slice(0, maxLength)
    .trim();
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasTextFields(value, fields) {
  return value && typeof value === 'object' && fields.every((field) => isText(value[field]));
}

function isTextArray(value, exactLength) {
  return Array.isArray(value) &&
    (exactLength === undefined ? value.length > 0 : value.length === exactLength) &&
    value.every(isText);
}

function getAdultCutoffDate() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date())
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${Number(parts.year) - 18}-${parts.month}-${parts.day}`;
}
