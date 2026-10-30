'use strict';
// ログインとセッション。スタッフが毎回ログインしなくて済むよう、
// セッションは長め（既定180日）にしてアプリ起動即操作できるようにする。
const crypto = require('node:crypto');
const { db } = require('./db');

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 180);
const COOKIE = 'es_session';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [, saltHex, keyHex] = String(stored).split('$');
  if (!saltHex || !keyHex) return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?, ?, ?)').run(sha(token), userId, expires);
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.login, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).get(sha(token), new Date().toISOString());
  return row || null;
}

function setSessionCookie(res, token, req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

// ログイン試行の簡易レート制限（IP ごと 10分で20回まで）
const attempts = new Map();
function loginAllowed(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60e3);
  list.push(now);
  attempts.set(ip, list);
  return list.length <= 20;
}

// API ミドルウェア
function requireUser(req, res, next) {
  // CSRF 対策：Cookie は SameSite=Strict、加えて変更系はカスタムヘッダー必須
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'es-staff') {
    return res.status(403).json({ error: '不正なリクエストです' });
  }
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'ログインしてください' });
  req.user = user;
  next();
}

function requireOwner(req, res, next) {
  if (req.user?.role !== 'owner') return res.status(403).json({ error: 'この操作は店主のみ可能です' });
  next();
}

module.exports = {
  COOKIE, hashPassword, verifyPassword, createSession, destroySession, parseCookies,
  userFromRequest, setSessionCookie, clearSessionCookie, loginAllowed, requireUser, requireOwner,
};
