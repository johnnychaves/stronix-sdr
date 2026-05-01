// Middleware de autenticação por cookie de sessão.
// Hash + verify ficam em db.js (scrypt do crypto built-in).
//
// Cookie: sdr_session=<uuid>; HttpOnly; SameSite=Lax; Secure (em prod); Path=/admin
// Sessão expira em 7 dias (controlado em db.createSession).

const db = require('./db');

const COOKIE_NAME = 'sdr_session';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Parser simples de cookie (sem dep nova). Lê o header 'cookie' e retorna mapa.
function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(COOKIE_MAX_AGE_MS / 1000)}`,
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
  const parts = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// Middleware: exige sessão válida. Em request HTML sem auth, redireciona pra /admin/login.
// Em request /api/* sem auth, retorna 401 JSON.
function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  const user = token ? db.getSessionUser(token) : null;

  if (!user) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return res.redirect('/admin/login');
  }

  req.user = user;
  req.sessionToken = token;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

// Ajuda views/HTML públicas a saber se já existe admin (modo bootstrap)
function isBootstrapMode() {
  return db.countAdmins() === 0;
}

module.exports = {
  COOKIE_NAME,
  COOKIE_MAX_AGE_MS,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  isBootstrapMode,
};
