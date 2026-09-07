import crypto from 'node:crypto';
import { decryptJson, getStorageConfig, setSecurityHeaders, supabaseHeaders } from './report-utils.js';

export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!hasValidBridgeSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const storage = getStorageConfig();
    if (!storage) return res.status(503).json({ error: '資料庫尚未完成設定' });

    const id = typeof req.query?.id === 'string' ? req.query.id : null;
    const query = id
      ? `id=eq.${encodeURIComponent(id)}&limit=1`
      : 'order=created_at.desc&limit=100';
    const select = [
      'id', 'email', 'profile_encrypted', 'answers_encrypted', 'report_encrypted',
      'marketing_opt_in', 'email_status', 'source', 'created_at', 'opened_at', 'expires_at'
    ].join(',');
    const response = await fetch(
      `${storage.supabaseUrl}/rest/v1/diagnoses?select=${select}&${query}`,
      { headers: supabaseHeaders(storage.supabaseServiceKey) }
    );
    if (!response.ok) throw new Error(`Supabase query failed: ${response.status}`);
    const rows = await response.json();

    if (id) {
      if (!rows[0]) return res.status(404).json({ error: '找不到這筆紀錄' });
      return res.status(200).json({ record: decryptRecord(rows[0], true) });
    }

    const records = rows.map((row) => decryptRecord(row, false));
    const sent = records.filter((item) => item.emailStatus === 'sent').length;
    return res.status(200).json({
      records,
      metrics: {
        total: records.length,
        thisWeek: records.filter((item) => Date.now() - new Date(item.createdAt).getTime() <= 7 * 86400000).length,
        sentRate: records.length ? Math.round((sent / records.length) * 100) : 0
      }
    });
  } catch (error) {
    console.error('Admin bridge error:', error);
    return res.status(500).json({ error: '管理資料讀取失敗' });
  }
}

function hasValidBridgeSecret(req) {
  const expected = process.env.ADMIN_BRIDGE_SECRET || '';
  const authorization = String(req.headers.authorization || '');
  const submitted = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const left = Buffer.from(submitted);
  const right = Buffer.from(expected);
  return Boolean(expected) && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function decryptRecord(row, includePrivate) {
  const profile = decryptJson(row.profile_encrypted);
  const report = decryptJson(row.report_encrypted);
  const base = {
    id: row.id,
    name: profile?.name || '未提供',
    email: row.email,
    birthDate: profile?.birthDate || null,
    appId: row.source || 'direct',
    coreTitle: getCoreTitle(report),
    marketingOptIn: row.marketing_opt_in,
    emailStatus: row.email_status,
    createdAt: row.created_at,
    openedAt: row.opened_at,
    expiresAt: row.expires_at
  };
  if (!includePrivate) return base;
  return {
    ...base,
    answers: normalizeAnswers(decryptJson(row.answers_encrypted)),
    report
  };
}

function getCoreTitle(report) {
  return report?.coreBlock?.title || report?.core_block?.title ||
    report?.coreIssue?.title || report?.core_issue?.title ||
    report?.coreTitle || report?.summary || '已完成分析';
}

function normalizeAnswers(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().map((key) => value[key]);
  }
  return [];
}

