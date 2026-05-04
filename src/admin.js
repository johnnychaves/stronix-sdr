const { Router } = require('express');
const agent = require('./agent');
const { getSystemPrompt, updateSystemPrompt, getConversations, clearConversation } = agent;
const wa = require('./whatsapp');
const { sendMessage, sendVoice, transcodeAudio } = wa;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Diretório onde gravamos áudios pra player no painel.
// Usa mesmo dir do DB (volume Railway persistente).
const MEDIA_DIR = process.env.MEDIA_DIR || (() => {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'database.sqlite');
  return path.join(path.dirname(dbPath), 'media');
})();
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  console.log(`[admin] criado MEDIA_DIR ${MEDIA_DIR}`);
}
const db = require('./db');
const auth = require('./auth');

const router = Router();

// ─────────────────────────────────────────────────────────────────────
// AUTH — endpoints públicos (NÃO passam pelo requireAuth)
// ─────────────────────────────────────────────────────────────────────

// Status: indica se está em modo bootstrap (nenhum admin criado ainda)
router.get('/api/auth/status', (req, res) => {
  res.json({
    bootstrap: auth.isBootstrapMode(),
    userCount: db.countUsers(),
  });
});

// Bootstrap: cria o PRIMEIRO admin. Só funciona se não tem nenhum admin ativo.
router.post('/api/auth/bootstrap', (req, res) => {
  if (!auth.isBootstrapMode()) {
    return res.status(403).json({ error: 'Bootstrap já concluído — use login normal' });
  }
  const { username, password, displayName, phone } = req.body || {};
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'username, password e displayName obrigatórios' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Senha precisa ter pelo menos 8 caracteres' });
  try {
    const id = db.createUser({ username, password, displayName, role: 'admin', phone });
    const session = db.createSession(id);
    auth.setSessionCookie(res, session.token);
    res.json({ ok: true, user: { id, username, displayName, role: 'admin' } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Login com username + senha
router.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username e password obrigatórios' });
  const u = db.authenticateUser(username, password);
  if (!u) return res.status(401).json({ error: 'Credenciais inválidas' });
  const session = db.createSession(u.id);
  auth.setSessionCookie(res, session.token);
  res.json({
    ok: true,
    user: { id: u.id, username: u.username, displayName: u.display_name, role: u.role },
  });
});

// Logout — invalida sessão atual e limpa cookie
router.post('/api/auth/logout', (req, res) => {
  const cookies = auth.parseCookies(req);
  const token = cookies[auth.COOKIE_NAME];
  if (token) db.deleteSession(token);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

// Tela de login HTML — pública (sem auth)
router.get('/login', (req, res) => {
  res.send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>STRONIX SDR — Login</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',system-ui,sans-serif;
  background:#0a1014;color:#e9edef;overflow:hidden;
}

/* ─── Tokens ─── */
:root{
  --brand:#00a884;--brand-dark:#008f72;--brand-light:#06cf9c;
  --brand-soft:rgba(0,168,132,.13);--brand-on:#001f17;
  --bg-0:#0a1014;--bg-1:#111b21;--bg-2:#1a2730;--bg-3:#202c33;--bg-4:#2a3942;
  --border-subtle:#1f2a30;--border:#222d34;--border-strong:#2a3942;
  --text-primary:#e9edef;--text-secondary:#aebac1;--text-muted:#8696a0;--text-faint:#67797f;
  --bubble-in:#202c33;--bubble-out:#005c4b;
  --shadow-sm:0 1px 2px rgba(0,0,0,.2);
  --shadow-md:0 4px 12px rgba(0,0,0,.35);
  --shadow-lg:0 12px 28px rgba(0,0,0,.5);
  --shadow-bubble:0 1px 1px rgba(0,0,0,.13);
  --glow-brand:0 4px 10px rgba(0,168,132,.25);
  --glow-brand-hi:0 6px 14px rgba(0,168,132,.40);
  --t-fast:.12s cubic-bezier(.2,.8,.2,1);
}

.shell{display:grid;grid-template-columns:1.05fr .95fr;height:100vh}

/* ─── Painel da marca (esquerda) ─── */
.brand{
  position:relative;
  background:
    radial-gradient(1100px 700px at 75% 10%,rgba(0,168,132,.22),transparent 55%),
    radial-gradient(900px 600px at 10% 95%,rgba(6,207,156,.10),transparent 60%),
    linear-gradient(165deg,#0a1014 0%,#111b21 50%,#0c1418 100%);
  padding:48px 56px;
  display:flex;flex-direction:column;justify-content:space-between;
  overflow:hidden;
}
.brand::before{
  content:"";position:absolute;inset:0;
  background-image:
    linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);
  background-size:48px 48px;
  mask-image:radial-gradient(ellipse 80% 70% at 50% 40%,#000 30%,transparent 80%);
  pointer-events:none;
}
.logo{display:flex;align-items:center;gap:14px;position:relative;z-index:1}
.logo .mark{
  width:44px;height:44px;border-radius:11px;
  background:linear-gradient(135deg,#00a884,#008f72);
  display:grid;place-items:center;color:#001f17;font-weight:800;font-size:24px;
  box-shadow:var(--glow-brand);letter-spacing:-1px;
}
.logo .word{font-weight:700;font-size:18px;letter-spacing:-.3px}
.logo .word .accent{color:var(--brand)}

.pitch{position:relative;z-index:1;max-width:480px}
.pitch .eyebrow{
  font-size:11px;font-weight:600;color:var(--brand);letter-spacing:.12em;text-transform:uppercase;
  margin-bottom:20px;
}
.pitch h1{
  font-size:42px;font-weight:700;line-height:1.1;letter-spacing:-1px;margin:0 0 18px;
}
.pitch h1 .em{
  background:linear-gradient(120deg,#00a884,#06cf9c);
  -webkit-background-clip:text;background-clip:text;color:transparent;
}
.pitch p{font-size:15px;line-height:1.55;color:var(--text-secondary);margin:0 0 28px;max-width:440px}

.preview{
  position:relative;z-index:1;
  background:rgba(17,27,33,.6);backdrop-filter:blur(12px);
  border:1px solid var(--border-subtle);border-radius:14px;
  padding:14px 16px 12px;max-width:380px;
  display:flex;flex-direction:column;gap:5px;
  box-shadow:var(--shadow-lg);
}
.preview .head{
  display:flex;align-items:center;gap:9px;
  padding-bottom:10px;border-bottom:1px solid var(--border-subtle);margin-bottom:8px;
}
.preview .av{
  width:30px;height:30px;border-radius:50%;
  background:linear-gradient(135deg,#f472b6,#db2777);
  display:grid;place-items:center;color:#fff;font-weight:700;font-size:12px;flex-shrink:0;
}
.preview .head .nm{font-weight:600;font-size:13px}
.preview .head .st{font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px}
.preview .head .st::before{content:"";width:6px;height:6px;border-radius:50%;background:#4ade80;display:inline-block}
.preview .b{
  padding:7px 11px 6px;border-radius:8px;font-size:13px;line-height:1.4;
  max-width:82%;box-shadow:var(--shadow-bubble);
}
.preview .b.in{background:var(--bubble-in);align-self:flex-start;border-top-left-radius:2px}
.preview .b.out{background:var(--bubble-out);align-self:flex-end;border-top-right-radius:2px}
.preview .b .t{font-size:10px;color:var(--text-muted);margin-top:1px;display:block;text-align:right}

.brand-foot{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:flex-end;font-size:12px;color:var(--text-muted)}
.brand-foot .addr{line-height:1.5}
.brand-foot .ig{color:var(--brand-light);font-weight:500}

/* ─── Painel do formulário (direita) ─── */
.form-wrap{
  background:var(--bg-1);
  display:flex;align-items:center;justify-content:center;
  padding:48px;position:relative;
}
.form{width:100%;max-width:380px;display:flex;flex-direction:column;gap:22px}
.form .top{display:flex;flex-direction:column;gap:6px}
.form h2{font-size:24px;font-weight:700;letter-spacing:-.3px}
.form .sub{font-size:14px;color:var(--text-secondary);line-height:1.5}

.field{display:flex;flex-direction:column;gap:7px}
.field label{font-size:12px;font-weight:600;color:var(--text-secondary);letter-spacing:.02em;text-transform:uppercase}
.field .ctl{
  position:relative;display:flex;align-items:center;
  background:var(--bg-2);border:1px solid var(--border);border-radius:9px;
  transition:all var(--t-fast);
}
.field .ctl:focus-within{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.field .ctl input{
  flex:1;background:transparent;border:none;outline:none;
  color:var(--text-primary);font:14px inherit;
  padding:12px 14px;
}
.field .ctl input::placeholder{color:var(--text-faint)}
.field .ctl .ic{padding:0 0 0 14px;color:var(--text-muted);display:grid;place-items:center;flex-shrink:0}
.field .ctl .ic svg{width:16px;height:16px;stroke-width:2;stroke:currentColor;fill:none;stroke-linecap:round;stroke-linejoin:round}
.field .ctl .toggle{padding:0 13px;color:var(--text-muted);background:none;border:none;cursor:pointer;font-size:11px;letter-spacing:.05em;font-weight:600;text-transform:uppercase;white-space:nowrap}
.field .ctl .toggle:hover{color:var(--brand)}

.opts{display:flex;justify-content:space-between;align-items:center;margin-top:-4px}
.opts .check{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--text-secondary);cursor:pointer;user-select:none}
.opts .check input{accent-color:var(--brand);width:15px;height:15px;cursor:pointer}

.submit{
  background:var(--brand);color:var(--brand-on);
  font:600 14px inherit;
  padding:13px 16px;border:none;border-radius:9px;
  cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;
  box-shadow:var(--glow-brand);transition:all var(--t-fast);
}
.submit:hover{background:var(--brand-light);box-shadow:var(--glow-brand-hi);transform:translateY(-1px)}
.submit:disabled{background:var(--bg-4);color:var(--text-muted);box-shadow:none;transform:none;cursor:not-allowed}
.submit svg{transition:transform var(--t-fast)}
.submit:hover:not(:disabled) svg{transform:translateX(2px)}

.err-msg{color:#f87171;font-size:13px;min-height:18px;line-height:1.4}

.divider{display:flex;align-items:center;gap:14px;color:var(--text-faint);font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600}
.divider::before,.divider::after{content:"";flex:1;height:1px;background:var(--border-subtle)}

.bootstrap-card{
  background:var(--bg-2);border:1px dashed var(--border-strong);border-radius:9px;
  padding:14px;display:flex;gap:12px;align-items:flex-start;
}
.bootstrap-card .bk-icn{
  width:32px;height:32px;border-radius:8px;background:var(--brand-soft);
  display:grid;place-items:center;color:var(--brand-light);flex-shrink:0;
}
.bootstrap-card .bk-body{font-size:12.5px;line-height:1.55;color:var(--text-secondary)}
.bootstrap-card .bk-body strong{color:var(--text-primary);font-weight:600}

/* ─── Campos extras do bootstrap (display:none por padrão) ─── */
.extra-fields{display:flex;flex-direction:column;gap:22px}

.form-footer{
  position:absolute;bottom:20px;left:0;right:0;text-align:center;
  font-size:11px;color:var(--text-faint);letter-spacing:.02em;
}

@media(max-width:880px){
  .shell{grid-template-columns:1fr}
  .brand{display:none}
  .form-wrap{padding:32px 24px}
  body{overflow:auto}
}
</style>
</head>
<body>

<div class="shell">

  <!-- Painel da marca -->
  <aside class="brand">
    <div class="logo">
      <div class="mark">S</div>
      <div class="word">STRONIX <span class="accent">SDR</span></div>
    </div>

    <div class="pitch">
      <div class="eyebrow">Painel da equipe · STRONIX Academia</div>
      <h1>O Johnny não dorme. <span class="em">Sua equipe sim.</span></h1>
      <p>Atendimento WhatsApp 24/7 com IA, handoff humano em um clique e agenda de visitas direto no painel. Tudo num lugar só.</p>

      <div class="preview" aria-hidden="true">
        <div class="head">
          <div class="av">MH</div>
          <div>
            <div class="nm">Maria Helena</div>
            <div class="st">online · respondendo</div>
          </div>
        </div>
        <div class="b in">Oi! Quero saber dos planos de musculação 💪<span class="t">14:30</span></div>
        <div class="b out">Que massa! Aula experimental é gratuita. Quarta de manhã serve?<span class="t">14:30 ✓✓</span></div>
        <div class="b in">Quarta às 9h fica show!<span class="t">14:31</span></div>
      </div>
    </div>

    <div class="brand-foot">
      <div class="addr">
        Av. Edgar Pires de Castro, 9392<br>
        Bairro Lageado · Porto Alegre/RS
      </div>
      <div class="ig">@stronixacademia</div>
    </div>
  </aside>

  <!-- Formulário -->
  <main class="form-wrap">
    <form class="form" id="form" onsubmit="return false">

      <div class="top">
        <h2 id="form-title">Bem-vindo de volta</h2>
        <p class="sub" id="form-sub">Entre com a conta da equipe pra acessar a inbox e agendamentos.</p>
      </div>

      <div class="field">
        <label for="username">Usuário</label>
        <div class="ctl">
          <span class="ic">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          </span>
          <input id="username" type="text" placeholder="seu.usuario" autocomplete="username" required>
        </div>
      </div>

      <div class="field">
        <label for="password">Senha <span id="pw-hint" style="color:var(--text-faint);font-weight:400;text-transform:none" hidden>(mín 8 caracteres)</span></label>
        <div class="ctl">
          <span class="ic">
            <svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          </span>
          <input id="password" type="password" placeholder="Sua senha" autocomplete="current-password" required>
          <button type="button" class="toggle" id="pw-toggle" onclick="(function(){const i=document.getElementById('password');const t=document.getElementById('pw-toggle');i.type=i.type==='password'?'text':'password';t.textContent=i.type==='password'?'Mostrar':'Ocultar'})()">Mostrar</button>
        </div>
      </div>

      <!-- Campos extras — modo bootstrap -->
      <div class="extra-fields" id="extra-fields" style="display:none">
        <div class="field">
          <label for="displayName">Nome completo</label>
          <div class="ctl">
            <span class="ic">
              <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </span>
            <input id="displayName" type="text" placeholder="Ex: Paula Rodrigues" autocomplete="name">
          </div>
        </div>
        <div class="field">
          <label for="phone">Telefone <span style="color:var(--text-faint);font-weight:400;text-transform:none">(opcional)</span></label>
          <div class="ctl">
            <span class="ic">
              <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.8 19.8 0 0 1 3.08 5.18 2 2 0 0 1 5.09 3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L9.09 10.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 23 18a2 2 0 0 1-.08.92z"/></svg>
            </span>
            <input id="phone" type="tel" placeholder="5551XXXXXXXXX" inputmode="numeric">
          </div>
        </div>
      </div>

      <div class="opts" id="opts-row">
        <label class="check"><input type="checkbox" checked>Manter conectada</label>
      </div>

      <button type="submit" class="submit" id="submit">
        Entrar no painel
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </button>

      <div class="err-msg" id="err"></div>

      <!-- Separador bootstrap -->
      <div class="divider" id="bootstrap-divider" style="display:none">Primeira vez aqui?</div>

      <!-- Card de bootstrap (aparece quando não há admin) -->
      <div class="bootstrap-card" id="bootstrap-card" style="display:none">
        <div class="bk-icn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
        </div>
        <div class="bk-body" id="bootstrap-msg">
          <strong>Configuração inicial.</strong><br>
          Nenhum admin cadastrado ainda. Preencha os campos acima para criar o primeiro admin com acesso total ao painel.
        </div>
      </div>

    </form>

    <div class="form-footer">© STRONIX 2026 · Painel SDR</div>
  </main>

</div>

<script>
  let isBootstrap = false;

  fetch('/admin/api/auth/status').then(r => r.json()).then(s => {
    isBootstrap = !!s.bootstrap;
    if (isBootstrap) {
      document.getElementById('form-title').textContent = 'Configuração inicial';
      document.getElementById('form-sub').textContent = 'Crie o primeiro admin pra liberar o acesso ao painel.';
      document.getElementById('extra-fields').style.display = 'flex';
      document.getElementById('opts-row').style.display = 'none';
      document.getElementById('submit').innerHTML = 'Criar admin e entrar <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
      document.getElementById('pw-hint').hidden = false;
      document.getElementById('password').autocomplete = 'new-password';
      document.getElementById('bootstrap-divider').style.display = 'flex';
      document.getElementById('bootstrap-card').style.display = 'flex';
    }
  }).catch(() => {});

  document.getElementById('form').addEventListener('submit', async () => {
    const btn = document.getElementById('submit');
    const err = document.getElementById('err');
    err.textContent = '';
    btn.disabled = true;

    const body = {
      username: document.getElementById('username').value.trim(),
      password: document.getElementById('password').value,
    };
    if (isBootstrap) {
      body.displayName = document.getElementById('displayName').value.trim();
      body.phone = document.getElementById('phone').value.trim();
    }

    const url = isBootstrap ? '/admin/api/auth/bootstrap' : '/admin/api/auth/login';
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        err.textContent = data.error || 'Erro desconhecido';
        btn.disabled = false;
        return;
      }
      location.href = '/admin';
    } catch {
      err.textContent = 'Falha de conexão — verifique sua rede';
      btn.disabled = false;
    }
  });
</script>
</body>
</html>`);
});

// ─────────────────────────────────────────────────────────────────────
// AUTH GATE — todas as rotas a seguir exigem usuário autenticado
// ─────────────────────────────────────────────────────────────────────
router.use(auth.requireAuth);

// Dados do usuário logado
router.get('/api/me', (req, res) => {
  res.json({ user: req.user });
});

// SSE — stream de eventos pro painel atualizar em tempo real (sem polling)
// Eventos: conversation.changed, connections.changed, appointments.changed
// Frontend escuta via EventSource e chama o load* correspondente.
router.get('/api/events', (req, res) => {
  const events = require('./events');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // proxies não bufferizam
  // Express 5 não tem flushHeaders por padrão em alguns contextos — força:
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  // Hello inicial (comentário SSE — não dispara onmessage no client)
  res.write(': sse-connected\n\n');
  // Evento de boas-vindas pro client saber que tá ok
  res.write('event: hello\ndata: {"ok":true}\n\n');

  function send(eventName, data) {
    try {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(data || {})}\n\n`);
    } catch (e) { /* ignora — conexão pode ter caído */ }
  }

  const onConv = (data) => send('conversation.changed', data);
  const onConn = () => send('connections.changed', {});
  const onAppt = () => send('appointments.changed', {});
  const onStud = () => send('students.changed', {});
  const onLeads = () => send('leads.changed', {});
  const onAlert = (data) => send('alert', data);
  const onV2 = (data) => send('v2.metrics.changed', data || {});
  events.bus.on('conversation.changed', onConv);
  events.bus.on('connections.changed', onConn);
  events.bus.on('appointments.changed', onAppt);
  events.bus.on('students.changed', onStud);
  events.bus.on('leads.changed', onLeads);
  events.bus.on('alert', onAlert);
  events.bus.on('v2.metrics.changed', onV2);

  // Heartbeat a cada 25s — alguns proxies cortam conexão idle após 30-60s
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch {}
  }, 25000);

  // Limpeza ao desconectar (browser fechou aba, refresh, etc)
  req.on('close', () => {
    clearInterval(heartbeat);
    events.bus.off('conversation.changed', onConv);
    events.bus.off('connections.changed', onConn);
    events.bus.off('appointments.changed', onAppt);
    events.bus.off('students.changed', onStud);
    events.bus.off('leads.changed', onLeads);
    events.bus.off('alert', onAlert);
    events.bus.off('v2.metrics.changed', onV2);
  });
});

// Status do provider WhatsApp (Meta sempre OK; Baileys precisa de QR/conexão)
router.get('/api/whatsapp/status', (req, res) => {
  const wa = require('./whatsapp');
  const provider = wa.PROVIDER;
  if (provider !== 'baileys') {
    return res.json({ provider, status: 'open', qr: null });
  }
  const baileys = wa.getBaileys();
  if (!baileys) return res.json({ provider, status: 'unavailable', qr: null });
  res.json({ provider, ...baileys.getStatus() });
});

// Desconecta sessão Baileys e apaga auth state — pra trocar de número
router.post('/api/baileys/disconnect', auth.requireAdmin, async (req, res) => {
  const wa = require('./whatsapp');
  if (wa.PROVIDER !== 'baileys') {
    return res.status(400).json({ error: 'Provider atual não é Baileys' });
  }
  const baileys = wa.getBaileys();
  if (!baileys) return res.status(503).json({ error: 'Baileys não inicializado' });
  try {
    await baileys.disconnect();
    res.json({ ok: true, message: 'Sessão desconectada. Acesse /admin/baileys/qr pra escanear novo QR.' });
  } catch (e) {
    console.error('[admin] erro ao desconectar Baileys:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Página HTML simples mostrando o QR code do Baileys (pra escanear com WhatsApp)
router.get('/baileys/qr', (req, res) => {
  const wa = require('./whatsapp');
  if (wa.PROVIDER !== 'baileys') {
    return res.status(400).send('<h1>WHATSAPP_PROVIDER não é baileys</h1>');
  }
  res.send(`<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><title>STRONIX SDR — Conectar WhatsApp</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { background:#0a1014; color:#e9edef; font-family:system-ui,-apple-system,sans-serif; min-height:100vh; margin:0; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { background:#111b21; border:1px solid #222d34; border-radius:14px; padding:32px; max-width:420px; width:100%; text-align:center; box-shadow:0 30px 80px rgba(0,0,0,.5); }
  h1 { font-size:18px; margin:0 0 8px; font-weight:600; }
  p { color:#aebac1; font-size:13px; line-height:1.5; margin:0 0 18px; }
  img.qr { width:280px; height:280px; background:#fff; padding:12px; border-radius:10px; }
  .status { padding:8px 14px; border-radius:999px; display:inline-block; font-size:12px; font-weight:600; margin-top:16px; }
  .open { background:rgba(0,168,132,.15); color:#06cf9c; }
  .qr   { background:rgba(251,191,36,.15); color:#fbbf24; }
  .close{ background:rgba(248,113,113,.15); color:#f87171; }
  ol { text-align:left; font-size:12.5px; color:#aebac1; line-height:1.7; padding-left:20px; margin-top:18px; }
  .me { font-family:ui-monospace,monospace; color:#e9edef; font-size:13px; background:#1a2730; padding:6px 12px; border-radius:6px; display:inline-block; margin:8px 0; }
  .btn-disconnect { background:transparent; border:1px solid #f87171; color:#f87171; padding:8px 14px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; margin-top:14px; transition:all .15s; }
  .btn-disconnect:hover { background:rgba(248,113,113,.1); }
  .btn-back { color:#06cf9c; text-decoration:none; font-size:12.5px; display:block; margin-top:18px; }
  .btn-back:hover { text-decoration:underline; }
</style></head><body>
<div class="card">
  <h1>📱 Conectar WhatsApp</h1>
  <div id="status-text">Carregando…</div>
  <div id="qr-area" style="margin:14px 0;"></div>
  <div id="actions"></div>
  <a class="btn-back" href="/admin">← Voltar pro painel</a>
</div>
<script>
async function refresh() {
  try {
    const s = await fetch('/admin/api/whatsapp/status').then(r => r.json());
    const txt = document.getElementById('status-text');
    const area = document.getElementById('qr-area');
    const actions = document.getElementById('actions');
    if (s.status === 'open') {
      txt.innerHTML = '<span class="status open">✓ Conectado</span>' +
        '<p style="margin-top:14px;">Tudo pronto. WhatsApp online:</p>' +
        '<div class="me">' + (s.me || '?') + '</div>';
      area.innerHTML = '';
      actions.innerHTML = '<button class="btn-disconnect" onclick="disconnect()">Desconectar e trocar de número</button>' +
        '<p style="font-size:11px; opacity:.6; margin-top:14px;">Use isso quando for trocar do número de teste pro número da academia.</p>';
    } else if (s.status === 'qr' && s.qr) {
      txt.innerHTML = '<span class="status qr">⏳ Aguardando escanear</span>';
      area.innerHTML = '<img class="qr" src="' + s.qr + '" alt="QR Code">';
      actions.innerHTML = '<ol>' +
        '<li>Abre o <strong>WhatsApp</strong> no celular do número que vai conectar</li>' +
        '<li>Vai em <strong>Configurações → Aparelhos conectados</strong></li>' +
        '<li>Toca em <strong>Conectar um aparelho</strong></li>' +
        '<li>Aponta a câmera pro QR acima</li>' +
        '</ol>';
    } else if (s.status === 'connecting') {
      txt.innerHTML = '<span class="status qr">🔄 Iniciando conexão…</span>';
      area.innerHTML = '';
      actions.innerHTML = '';
    } else if (s.provider !== 'baileys') {
      txt.innerHTML = '<span class="status close">⚠ Provider não é baileys</span>';
      actions.innerHTML = '<p>Setar WHATSAPP_PROVIDER=baileys no Railway primeiro.</p>';
    } else {
      txt.innerHTML = '<span class="status close">⚠ ' + s.status + '</span>';
      area.innerHTML = '';
      actions.innerHTML = '';
    }
  } catch (e) {
    document.getElementById('status-text').innerHTML = '<span class="status close">Erro: ' + e.message + '</span>';
  }
}
async function disconnect() {
  if (!confirm('Desconectar o número atual? Você precisará escanear um novo QR pra reconectar.')) return;
  const r = await fetch('/admin/api/baileys/disconnect', { method: 'POST' });
  const data = await r.json();
  if (r.ok) {
    alert('Desconectado. Aguardando novo QR...');
    setTimeout(refresh, 2000);
  } else {
    alert('Erro: ' + data.error);
  }
}
refresh();
setInterval(refresh, 3000);
</script></body></html>`);
});

// Lista enxuta dos users ativos pra renderizar nomes em mensagens enviadas por humanos
router.get('/api/users-public', (req, res) => {
  res.json(db.getAllUsers().filter(u => u.active).map(u => ({
    id: u.id,
    display_name: u.display_name,
    role: u.role,
  })));
});

// Knowledge base (academia_info) — qualquer user logado pode ler, só admin escreve
router.get('/api/academia-info', (req, res) => {
  res.json(db.getAllAcademiaInfo());
});

router.put('/api/academia-info/:key', auth.requireAdmin, (req, res) => {
  const ok = db.setAcademiaInfo(req.params.key, req.body?.value || '', req.user.id);
  if (!ok) return res.status(404).json({ error: 'Chave não encontrada' });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────
// Agent config (núcleo v2 + persona + timing + buffer) — admin only
// ─────────────────────────────────────────────────────────────────

const NUCLEO_V2_DEFAULT = require('./prompt-nucleo-v2');
const personaModule = require('./persona-v2');
const TIMING_DEFAULTS = {
  typing_delay_min_ms: 60 * 1000,
  typing_delay_max_ms: 180 * 1000,
  buffer_window_ms: 15 * 1000,
};

// GET retorna config atual + valores default pra UI mostrar diff e oferecer "Restaurar"
router.get('/api/agent-config', auth.requireAdmin, (req, res) => {
  const nucleoCustom = db.getAgentConfig('nucleo_v2', null);
  res.json({
    nucleo_v2: {
      current: nucleoCustom !== null ? nucleoCustom : NUCLEO_V2_DEFAULT,
      isCustom: nucleoCustom !== null,
      defaultLength: NUCLEO_V2_DEFAULT.length,
    },
    persona: {
      current: personaModule.getPersona(),
      default: personaModule.DEFAULT_PERSONA,
      isCustom: personaModule.isPersonaCustom(),
      hasPrevious: personaModule.hasPreviousPersona(),
      previous: personaModule.getPreviousPersona(),
      limits: personaModule.LIMITS,
    },
    typing_delay_min_ms: db.getAgentConfigNumber('typing_delay_min_ms', TIMING_DEFAULTS.typing_delay_min_ms, 0, 600 * 1000),
    typing_delay_max_ms: db.getAgentConfigNumber('typing_delay_max_ms', TIMING_DEFAULTS.typing_delay_max_ms, 0, 600 * 1000),
    buffer_window_ms: db.getAgentConfigNumber('buffer_window_ms', TIMING_DEFAULTS.buffer_window_ms, 1000, 120 * 1000),
    defaults: TIMING_DEFAULTS,
  });
});

// PUT salva uma chave do agent_config
router.put('/api/agent-config/:key', auth.requireAdmin, (req, res) => {
  const key = req.params.key;
  const allowed = ['nucleo_v2', 'persona', 'typing_delay_min_ms', 'typing_delay_max_ms', 'buffer_window_ms'];
  if (!allowed.includes(key)) return res.status(400).json({ error: 'Chave não permitida' });
  const value = req.body?.value;
  if (key === 'nucleo_v2') {
    if (typeof value !== 'string') return res.status(400).json({ error: 'value deve ser string' });
    if (value.length > 50000) return res.status(400).json({ error: 'Núcleo muito longo (máx 50000 chars)' });
    db.setAgentConfig(key, value, req.user.id);
  } else if (key === 'persona') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return res.status(400).json({ error: 'value deve ser objeto persona ({abertura, giriasQuentes, giriasProibidas, frasesProibidasExtra})' });
    }
    const saved = personaModule.setPersona(value, req.user.id);
    console.log(`[admin] agent_config[persona] atualizado por ${req.user.username}`);
    return res.json({ ok: true, persona: saved });
  } else {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'value deve ser número >= 0' });
    db.setAgentConfig(key, String(n), req.user.id);
  }
  console.log(`[admin] agent_config[${key}] atualizado por ${req.user.username}`);
  res.json({ ok: true });
});

// DELETE restaura ao default (apaga override do DB)
router.delete('/api/agent-config/:key', auth.requireAdmin, (req, res) => {
  const key = req.params.key;
  const allowed = ['nucleo_v2', 'persona', 'typing_delay_min_ms', 'typing_delay_max_ms', 'buffer_window_ms'];
  if (!allowed.includes(key)) return res.status(400).json({ error: 'Chave não permitida' });
  if (key === 'persona') {
    personaModule.resetPersona(req.user.id);
  } else {
    db.setAgentConfig(key, null, req.user.id);
  }
  console.log(`[admin] agent_config[${key}] restaurado ao default por ${req.user.username}`);
  res.json({ ok: true });
});

// POST /api/agent-config/persona/revert — restaura persona pra versão anterior (undo)
router.post('/api/agent-config/persona/revert', auth.requireAdmin, (req, res) => {
  const reverted = personaModule.revertPersona(req.user.id);
  if (!reverted) return res.status(404).json({ error: 'Sem versão anterior pra reverter' });
  console.log(`[admin] persona revertida pra versão anterior por ${req.user.username}`);
  res.json({ ok: true, persona: reverted });
});

// Prompt modules (28 módulos do Johnny v2) — leitura pública pra usuários
// logados, escrita só admin
router.get('/api/prompt-modules', (req, res) => {
  res.json(db.getAllPromptModules());
});

router.get('/api/prompt-modules/:name', (req, res) => {
  const m = db.getPromptModule(req.params.name);
  if (!m) return res.status(404).json({ error: 'Módulo não encontrado' });
  res.json(m);
});

router.put('/api/prompt-modules/:name', auth.requireAdmin, (req, res) => {
  const { content, title, category } = req.body || {};
  if (!content) return res.status(400).json({ error: 'content obrigatório' });
  try {
    db.upsertPromptModule({ name: req.params.name, content, title, category }, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/api/prompt-modules/:name/active', auth.requireAdmin, (req, res) => {
  const { active } = req.body || {};
  db.setPromptModuleActive(req.params.name, !!active, req.user.id);
  res.json({ ok: true });
});

// Lead state (debug — playground e admin podem ver/resetar)
router.get('/api/lead-state/:phone', (req, res) => {
  const s = db.getLeadState(req.params.phone);
  if (!s) return res.status(404).json({ error: 'Lead sem estado' });
  res.json(s);
});

router.delete('/api/lead-state/:phone', auth.requireAdmin, (req, res) => {
  db.resetLeadState(req.params.phone);
  res.json({ ok: true });
});

// Playground v2 — usa replyV2 isolado (não persiste lead_state). State
// simulado vive na request: cliente manda state atual, recebe state novo.
router.post('/api/playground/v2/message', async (req, res) => {
  const { history, message, state } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message obrigatória' });
  if (history && !Array.isArray(history)) return res.status(400).json({ error: 'history deve ser array' });
  if (message.length > 2000) return res.status(400).json({ error: 'message muito longa' });
  if (Array.isArray(history) && history.length > 50) return res.status(400).json({ error: 'history muito longo' });
  try {
    const { simulateReplyV2 } = require('./agent-v2');
    const result = await simulateReplyV2(history || [], message, state || null);
    res.json({
      text: result.text,
      state: result.state,
      parsed: result.parsed,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      cacheReadTokens: result.cacheReadTokens,
      cacheCreationTokens: result.cacheCreationTokens,
      latencyMs: result.latencyMs,
      estimatedCostUSD: (
        (result.tokensInput - (result.cacheReadTokens || 0)) * 3 / 1_000_000 +
        (result.cacheReadTokens || 0) * 0.30 / 1_000_000 +
        (result.tokensOutput) * 15 / 1_000_000
      ),
    });
  } catch (err) {
    console.error('[playground v2] erro:', err.message);
    res.status(500).json({ error: err.message || 'falha ao simular' });
  }
});

// Playground — simulação de conversa sem efeitos colaterais (não toca DB de
// conversas, não envia WhatsApp). Usa system prompt + knowledge base atuais.
router.post('/api/playground/message', async (req, res) => {
  const { history, message } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message obrigatória' });
  if (history && !Array.isArray(history)) return res.status(400).json({ error: 'history deve ser array' });
  if (message.length > 2000) return res.status(400).json({ error: 'message muito longa (máx 2000 chars)' });
  if (Array.isArray(history) && history.length > 50) return res.status(400).json({ error: 'history muito longo (máx 50 msgs)' });

  try {
    const t0 = Date.now();
    const result = await agent.simulateReply(history || [], message);
    const latencyMs = Date.now() - t0;
    res.json({
      text: result.text,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      cacheReadTokens: result.cacheReadTokens,
      cacheCreationTokens: result.cacheCreationTokens,
      latencyMs,
      // Estimativa de custo (Sonnet 4.5: $3/M input, $15/M output, $0.30/M cache read)
      estimatedCostUSD: (
        (result.tokensInput - (result.cacheReadTokens || 0)) * 3 / 1_000_000 +
        (result.cacheReadTokens || 0) * 0.30 / 1_000_000 +
        (result.tokensOutput) * 15 / 1_000_000
      ),
    });
  } catch (err) {
    console.error('[playground] erro:', err.message);
    res.status(500).json({ error: err.message || 'falha ao simular' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// USERS CRUD (admin only)
// ─────────────────────────────────────────────────────────────────────

router.get('/api/users', auth.requireAdmin, (req, res) => {
  res.json(db.getAllUsers());
});

router.post('/api/users', auth.requireAdmin, (req, res) => {
  const { username, password, displayName, role, phone } = req.body || {};
  if (!username || !password || !displayName || !role) {
    return res.status(400).json({ error: 'username, password, displayName e role obrigatórios' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Senha precisa ter pelo menos 8 caracteres' });
  if (!['admin', 'consultora'].includes(role)) return res.status(400).json({ error: 'role inválida' });
  try {
    const id = db.createUser({ username, password, displayName, role, phone });
    res.json({ ok: true, id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/api/users/:id', auth.requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'id inválido' });
  const target = db.getUserById(id);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });

  const { active, role, phone, displayName } = req.body || {};

  // Não pode desativar o último admin nem rebaixar o próprio role se é o último admin
  if ((active === false || (role && role !== 'admin' && target.role === 'admin')) && db.countAdmins() === 1) {
    return res.status(400).json({ error: 'Não pode desativar/rebaixar o último admin ativo' });
  }

  if (typeof active === 'boolean') db.setUserActive(id, active);
  if (role) db.setUserRole(id, role);
  if (phone !== undefined) db.setUserPhone(id, phone);
  if (displayName) db.setUserDisplayName(id, displayName);
  res.json({ ok: true });
});

router.post('/api/users/:id/password', auth.requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  // Self-reset OU admin
  if (req.user.id !== id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { password } = req.body || {};
  if (!password || password.length < 8) return res.status(400).json({ error: 'Senha precisa ter pelo menos 8 caracteres' });
  if (!db.getUserById(id)) return res.status(404).json({ error: 'Usuário não encontrado' });
  db.setUserPassword(id, password);
  res.json({ ok: true });
});

// Métricas agregadas dos últimos 30 dias (admin only)
router.get('/api/metrics', auth.requireAdmin, (req, res) => {
  res.json(db.getMetrics());
});

router.delete('/api/users/:id', auth.requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const target = db.getUserById(id);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (target.role === 'admin' && db.countAdmins() === 1) {
    return res.status(400).json({ error: 'Não pode excluir o último admin ativo' });
  }
  if (req.user.id === id) return res.status(400).json({ error: 'Você não pode excluir a si mesmo' });
  db.deleteUser(id);
  res.json({ ok: true });
});

// API — retorna o prompt atual
router.get('/api/prompt', (req, res) => {
  res.json({ prompt: getSystemPrompt() });
});

// API — salva novo prompt (sem reiniciar)
router.post('/api/prompt', (req, res) => {
  const { prompt } = req.body;
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt vazio' });
  updateSystemPrompt(prompt.trim());
  res.json({ ok: true });
});

// API — lista conversas ativas
router.get('/api/conversations', (req, res) => {
  res.json(getConversations());
});

// API — cria/inicializa contato (manual, pelo modal de nova conversa).
// Aceita número em qualquer formato BR comum, normaliza pra 5551XXXXXXXXX.
// Se já existe, retorna o existente. Se vier nome, atualiza.
router.post('/api/contacts/init', (req, res) => {
  const { phone: rawPhone, name } = req.body || {};
  if (!rawPhone) return res.status(400).json({ error: 'Telefone obrigatório' });

  const phone = normalizePhoneBR(rawPhone);
  if (!phone) return res.status(400).json({ error: 'Número inválido. Use formato (51) 99999-9999 ou 5551999999999.' });

  const existed = !!db.getContact(phone);
  db.getOrCreateContact(phone);
  if (name && name.trim()) {
    db.setContactName(phone, name);
  }
  console.log(`[admin] ${req.user.username} ${existed ? 'abriu' : 'criou'} contato ${phone}${name ? ' (' + name + ')' : ''}`);
  res.json({ phone, name: name || null, isNew: !existed });
});

// Normaliza número BR pra formato Meta (13 dígitos: 55 + DDD + 9 + 8 dígitos).
// Aceita: '5551995304633', '+5551995304633', '(51) 99530-4633', '51 99530-4633',
//         '51995304633' (sem DDI), '5551 9530-4633' (sem o 9). Retorna null se inválido.
function normalizePhoneBR(input) {
  let n = String(input || '').replace(/\D/g, '');
  if (!n) return null;
  // Remove o 0 inicial se houver (DDD com 0)
  if (n.startsWith('0')) n = n.slice(1);
  // Garante que começa com 55
  if (!n.startsWith('55')) {
    if (n.length === 11 || n.length === 10) n = '55' + n;
    else return null;
  }
  // Agora deve ter 12 ou 13 dígitos. Se 12, falta o 9 do mobile — adiciona.
  if (n.length === 12) {
    n = n.slice(0, 4) + '9' + n.slice(4);
  }
  if (n.length !== 13) return null;
  return n;
}

// API — limpa conversa de um número
router.delete('/api/conversations/:from', (req, res) => {
  const phone = req.params.from;
  clearConversation(phone);
  // Emite SSE pra outras abas/clientes atualizarem em tempo real
  // (sem isso, abas paralelas mostram conv fantasma até polling/refresh)
  try {
    require('./events').emitConversationChanged(phone);
    require('./events').emitLeadsChanged();
  } catch {}
  res.json({ ok: true });
});

// API — assume conversa (pool aberto: primeiro a clicar pega)
router.post('/api/conversations/:phone/assume', (req, res) => {
  const { phone } = req.params;
  db.getOrCreateContact(phone);
  const ok = db.assumeConversation(phone, req.user.id);
  if (!ok) {
    const a = db.getContactAssignment(phone);
    if (a.assignedUserId === req.user.id) return res.json({ ok: true, alreadyMine: true });
    const other = a.assignedUserId ? db.getUserById(a.assignedUserId) : null;
    return res.status(409).json({
      error: 'Conversa já assumida',
      by: other ? other.display_name : null,
    });
  }
  console.log(`[admin] ${req.user.username} assumiu conversa ${phone}`);
  res.json({ ok: true });
});

// API — transfere conversa pra outro user (consultora ou admin ativo).
// Só o atendente atual ou admin pode transferir. Notifica via WhatsApp
// quem recebeu (se tiver phone cadastrado).
router.post('/api/conversations/:phone/transfer', async (req, res) => {
  const { phone } = req.params;
  const { targetUserId } = req.body || {};
  const tid = parseInt(targetUserId, 10);
  if (!tid) return res.status(400).json({ error: 'targetUserId obrigatório' });
  if (tid === req.user.id) return res.status(400).json({ error: 'Não dá pra transferir pra si mesmo' });

  const contact = db.getContact(phone);
  if (!contact) return res.status(404).json({ error: 'Conversa não encontrada' });

  // Permissão: precisa ser o atendente atual OU admin
  const isCurrent = contact.assigned_user_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!isCurrent && !isAdmin) {
    return res.status(403).json({ error: 'Você precisa estar atendendo essa conversa pra transferir' });
  }

  const target = db.getUserById(tid);
  if (!target || !target.active) return res.status(400).json({ error: 'Usuário destino inválido ou inativo' });

  db.transferConversation(phone, tid);
  console.log(`[admin] ${req.user.username} transferiu conversa ${phone} pra ${target.username}`);

  // Notifica quem recebeu (fire-and-forget, não bloqueia resposta)
  try {
    const wa = require('./whatsapp');
    if (wa.notifyTransfer) {
      // Pega última msg pra dar contexto na notificação
      const lastMsg = db.getLastMessageForContact ? db.getLastMessageForContact(phone) : null;
      wa.notifyTransfer({
        leadPhone: phone,
        leadName: contact.name,
        fromUser: { display_name: req.user.displayName || req.user.username },
        toUser: { phone: target.phone, display_name: target.display_name },
        lastMessagePreview: lastMsg ? lastMsg.content : null,
      }).catch(() => {});
    }
  } catch {}

  res.json({
    ok: true,
    target: { id: target.id, displayName: target.display_name, role: target.role },
  });
});

// API — devolve conversa pra IA (libera assignment)
router.post('/api/conversations/:phone/release', (req, res) => {
  const a = db.getContactAssignment(req.params.phone);
  if (a.assignedUserId && a.assignedUserId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Você não pode devolver conversa de outra consultora' });
  }
  db.releaseConversation(req.params.phone);
  console.log(`[admin] ${req.user.username} devolveu conversa ${req.params.phone} pra IA`);
  res.json({ ok: true });
});

// API — consultora/admin envia mensagem na conversa (atendimento humano)
router.post('/api/conversations/:phone/reply', async (req, res) => {
  const { phone } = req.params;
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Texto vazio' });
  if (text.length > 4096) return res.status(400).json({ error: 'Texto longo demais (máx 4096)' });

  // Garante contato existe (na pior das hipóteses cria entrada)
  db.getOrCreateContact(phone);

  // Se ninguém assumiu ainda, o ato de mandar mensagem implica assumir.
  // Pool aberto: o primeiro a mandar pega. Flag autoAssumed avisa o frontend
  // pra mostrar toast claro "IA desligada — você assumiu".
  let autoAssumed = false;
  const assignment = db.getContactAssignment(phone);
  if (!assignment.assignedUserId) {
    db.assumeConversation(phone, req.user.id);
    autoAssumed = true;
    try { require('./events').emitConversationChanged(phone); } catch {}
  } else if (assignment.assignedUserId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Conversa já assumida por outra consultora' });
  }

  try {
    const sendResp = await sendMessage(phone, text);
    const wamid = sendResp?.messages?.[0]?.id || null;
    db.addMessageWithSender(phone, 'assistant', text, false, req.user.id, null, wamid);
    db.updateLastContact(phone);
    res.json({ ok: true, autoAssumed });
  } catch (err) {
    const meta = err.response?.data?.error;
    console.error('[admin] erro ao enviar reply humano:', meta || err.message);
    const ev = require('./events');
    if (meta && (meta.code === 131047 || /re-engagement|24-hour/i.test(meta.message || ''))) {
      ev.emitAlert({
        severity: 'warn',
        title: 'Mensagem não enviada (janela 24h)',
        message: `${phone} não respondeu nas últimas 24h. Use template ou aguarde resposta.`,
        code: 'window_24h_closed',
      });
      return res.status(400).json({
        error: 'Esse contato não respondeu nas últimas 24h. Pra reativar, peça pra ele te mandar uma mensagem primeiro (ou use template aprovada — em breve).',
        code: 'window_24h_closed',
      });
    }
    if (meta && meta.code === 131026) {
      ev.emitAlert({
        severity: 'warn',
        title: 'Número inválido',
        message: `${phone} não tem WhatsApp ativo.`,
        code: 'invalid_recipient',
      });
      return res.status(400).json({
        error: 'Número inválido ou não tem WhatsApp. Confere o telefone.',
        code: 'invalid_recipient',
      });
    }
    ev.emitAlert({
      severity: 'error',
      title: 'Falha ao enviar mensagem',
      message: `Erro mandando pra ${phone}: ${meta?.message || err.message || 'desconhecido'}`,
      code: 'send_failed',
    });
    res.status(500).json({ error: meta?.message || err.message || 'Falha ao enviar mensagem' });
  }
});

// API — serve arquivo de mídia (áudio) salvo localmente
router.get('/api/media/:filename', (req, res) => {
  const filename = req.params.filename;
  // Sanitização: só aceita nomes seguros (uuid + ext)
  if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(filename)) {
    return res.status(400).json({ error: 'Nome de arquivo inválido' });
  }
  const full = path.join(MEDIA_DIR, filename);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: 'Arquivo não encontrado' });
  }
  // Inferência simples de Content-Type pelo ext
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mime = ext === 'mp3' ? 'audio/mpeg'
            : ext === 'ogg' ? 'audio/ogg'
            : ext === 'mp4' || ext === 'm4a' ? 'audio/mp4'
            : 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  fs.createReadStream(full).pipe(res);
});

// API — consultora/admin envia áudio na conversa
router.post('/api/conversations/:phone/reply-audio', async (req, res) => {
  const { phone } = req.params;
  const { audioBase64, mimeType, durationMs } = req.body || {};
  if (!audioBase64) return res.status(400).json({ error: 'Áudio vazio' });
  if (!mimeType || typeof mimeType !== 'string') return res.status(400).json({ error: 'mimeType obrigatório' });

  const allowed = ['audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/webm', 'audio/m4a'];
  const baseMime = mimeType.split(';')[0].trim().toLowerCase();
  if (!allowed.some(a => baseMime === a)) {
    return res.status(400).json({ error: `Tipo de áudio não suportado: ${baseMime}` });
  }

  // Decode base64 (aceita data:audio/...;base64,XXX ou só XXX)
  const cleanB64 = audioBase64.replace(/^data:[^;]+;base64,/, '');
  let buffer;
  try {
    buffer = Buffer.from(cleanB64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Base64 inválido' });
  }
  if (buffer.length === 0) return res.status(400).json({ error: 'Áudio vazio (após decode)' });
  if (buffer.length > 16 * 1024 * 1024) return res.status(400).json({ error: 'Áudio maior que 16MB (limite WhatsApp)' });

  db.getOrCreateContact(phone);

  let autoAssumed = false;
  const assignment = db.getContactAssignment(phone);
  if (!assignment.assignedUserId) {
    db.assumeConversation(phone, req.user.id);
    autoAssumed = true;
    try { require('./events').emitConversationChanged(phone); } catch {}
  } else if (assignment.assignedUserId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Conversa já assumida por outra consultora' });
  }

  try {
    // WhatsApp Cloud API aceita oficialmente:
    //   - audio/ogg (codec MUST be opus)
    //   - audio/mp4 (codec MUST be AAC — não opus)
    //   - audio/mpeg (mp3)
    //   - audio/aac, audio/amr
    //
    // MediaRecorder em Chrome/Safari produz containers (webm, mp4) que ENVELOPAM
    // opus, mas a Meta exige AAC dentro de mp4 ou opus dentro de ogg. Quando
    // o codec/container não bate, a Meta aceita o upload silenciosamente,
    // retorna 200 no /messages e NÃO ENTREGA — sem webhook de erro.
    //
    // Solução robusta: SEMPRE transcoda pra ogg/opus via ffmpeg. Cobre todo
    // input de browser sem depender de detecção fina de codec.
    let finalBuffer, finalMime = 'audio/mpeg', finalExt = 'mp3';
    try {
      finalBuffer = await transcodeAudio(buffer, baseMime);
      console.log(`[admin] transcode ${baseMime} → audio/mpeg ok (${buffer.length} → ${finalBuffer.length} bytes)`);
    } catch (e) {
      console.error('[admin] transcode falhou:', e.message);
      return res.status(500).json({ error: 'Falha ao processar áudio (ffmpeg). ' + e.message });
    }

    // sendVoice abstrai upload+send (Meta) ou send direto (Baileys)
    const sendResp = await sendVoice(phone, finalBuffer, finalMime, `voice.${finalExt}`);
    const wamid = sendResp?.messages?.[0]?.id || null;

    // Salva o MP3 localmente pro player no painel
    const filename = `${crypto.randomUUID()}.${finalExt}`;
    const fullPath = path.join(MEDIA_DIR, filename);
    try {
      fs.writeFileSync(fullPath, finalBuffer);
    } catch (e) {
      console.error('[admin] falha ao salvar áudio em disco:', e.message);
      // não falha o envio — Meta já recebeu
    }

    const seconds = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : null;
    const label = seconds
      ? `🔊 Áudio enviado · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
      : '🔊 Áudio enviado';
    db.addMessageWithSender(phone, 'assistant', label, true, req.user.id, filename, wamid);
    db.updateLastContact(phone);
    console.log(`[admin] ${req.user.username} enviou áudio para ${phone} (${finalBuffer.length} bytes, ${finalMime}, wamid=${wamid})`);
    res.json({ ok: true, autoAssumed });
  } catch (err) {
    const meta = err.response?.data?.error;
    console.error('[admin] erro ao enviar audio:', meta || err.message);
    const ev = require('./events');
    if (meta && (meta.code === 131047 || /re-engagement|24-hour/i.test(meta.message || ''))) {
      ev.emitAlert({
        severity: 'warn',
        title: 'Áudio não enviado (janela 24h)',
        message: `${phone} não respondeu nas últimas 24h.`,
        code: 'window_24h_closed',
      });
      return res.status(400).json({
        error: 'Esse contato não respondeu nas últimas 24h. Pra mandar áudio, peça pra ele te mandar uma mensagem primeiro.',
        code: 'window_24h_closed',
      });
    }
    if (meta && meta.code === 131026) {
      ev.emitAlert({
        severity: 'warn',
        title: 'Número inválido',
        message: `${phone} não tem WhatsApp ativo.`,
        code: 'invalid_recipient',
      });
      return res.status(400).json({
        error: 'Número inválido ou não tem WhatsApp.',
        code: 'invalid_recipient',
      });
    }
    ev.emitAlert({
      severity: 'error',
      title: 'Falha ao enviar áudio',
      message: `Erro mandando áudio pra ${phone}: ${meta?.message || err.message || 'desconhecido'}`,
      code: 'send_audio_failed',
    });
    res.status(500).json({ error: meta?.message || err.message || 'Falha ao enviar áudio. Verifique se o número aceita áudio e tente novamente.' });
  }
});

// API — lista agendamentos
router.get('/api/appointments', (req, res) => {
  res.json(db.getAppointments(100));
});

// API — atualiza status do agendamento
router.patch('/api/appointments/:id', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'cancelled', 'no_show'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Status inválido' });
  db.updateAppointmentStatus(req.params.id, status);
  try { require('./events').emitAppointmentsChanged(); } catch {}
  res.json({ ok: true });
});

// API — lista reviews
router.get('/api/reviews', (req, res) => {
  res.json(db.getAllReviews());
});

// API — cria/atualiza review de uma conversa
router.put('/api/reviews/:phone', (req, res) => {
  const { rating, comment } = req.body;
  const validRatings = ['good', 'bad'];
  if (!validRatings.includes(rating)) return res.status(400).json({ error: 'Rating inválido' });
  if (!db.getContact(req.params.phone)) return res.status(404).json({ error: 'Conversa não encontrada' });
  db.upsertReview(req.params.phone, rating, comment);
  res.json({ ok: true });
});

// API — remove review
router.delete('/api/reviews/:phone', (req, res) => {
  db.deleteReview(req.params.phone);
  res.json({ ok: true });
});

// API — cria nota interna (sincronizada entre todas as consultoras)
router.post('/api/conversations/:phone/internal-notes', (req, res) => {
  const phone = req.params.phone;
  const content = (req.body && req.body.content) || '';
  if (!db.getContact(phone)) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (!String(content).trim()) return res.status(400).json({ error: 'Nota vazia' });
  if (String(content).length > 2000) return res.status(400).json({ error: 'Nota muito longa (máx 2000 chars)' });
  try {
    const note = db.addInternalNote(phone, req.user.id, content);
    try { require('./events').emitConversationChanged(phone); } catch {}
    res.json({
      ok: true,
      note: {
        id: note.id,
        content: note.content,
        createdAt: note.createdAt,
        userId: note.userId,
        userName: req.user.displayName || req.user.username,
      },
    });
  } catch (err) {
    console.error('[admin] erro ao criar nota interna:', err.message);
    res.status(500).json({ error: err.message || 'Falha ao criar nota' });
  }
});

// API — apaga nota interna (autor ou admin)
router.delete('/api/internal-notes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const isAdmin = req.user && req.user.role === 'admin';
  const result = db.deleteInternalNote(id, req.user.id, isAdmin);
  if (!result.ok) {
    if (result.reason === 'not_found') return res.status(404).json({ error: 'Nota não encontrada' });
    if (result.reason === 'forbidden') return res.status(403).json({ error: 'Você só pode apagar suas próprias notas' });
    return res.status(500).json({ error: 'Falha ao apagar' });
  }
  try {
    if (result.note && result.note.phone) {
      require('./events').emitConversationChanged(result.note.phone);
    }
  } catch {}
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────
// LEADS — contatos que NÃO são alunos. Cadastro manual de nome+phone
// ─────────────────────────────────────────────────────────────────────

// API — lista todos os leads (contatos que não são alunos)
router.get('/api/leads', (req, res) => {
  res.json(db.getAllLeads());
});

// API — cadastra/atualiza lead (phone + name)
router.put('/api/leads/:phone', (req, res) => {
  const { name } = req.body || {};
  const phone = (req.params.phone || '').replace(/\D/g, '');
  if (!phone || phone.length < 10) return res.status(400).json({ error: 'Phone inválido (mín 10 dígitos)' });
  if (db.isStudent(phone)) {
    return res.status(400).json({ error: 'Esse phone está cadastrado como aluno. Remova de Alunos primeiro.' });
  }
  // Garante contato existe (cria com first/last_contact_at = agora se for novo)
  db.getOrCreateContact(phone);
  // Atualiza nome (NULL pra limpar)
  db.setContactName(phone, name);
  try { require('./events').emitLeadsChanged(); } catch {}
  res.json({ ok: true, phone });
});

// API — remove lead (apaga contato + histórico)
router.delete('/api/leads/:phone', (req, res) => {
  const phone = (req.params.phone || '').replace(/\D/g, '');
  if (!phone) return res.status(400).json({ error: 'Phone inválido' });
  db.clearConversation(phone);
  try {
    require('./events').emitLeadsChanged();
    require('./events').emitConversationChanged(phone);
  } catch {}
  res.json({ ok: true });
});

// API — lista alunos cadastrados (desviam IA pra atendimento humano)
router.get('/api/students', (req, res) => {
  res.json(db.getAllStudents());
});

// API — cadastra/atualiza aluno
router.put('/api/students/:phone', (req, res) => {
  const { name, notes } = req.body;
  const phone = (req.params.phone || '').replace(/\D/g, '');
  if (!phone || phone.length < 10) return res.status(400).json({ error: 'Phone inválido' });
  db.upsertStudent(phone, name, notes);
  try { require('./events').emitStudentsChanged(); } catch {}
  res.json({ ok: true });
});

// API — remove aluno
router.delete('/api/students/:phone', (req, res) => {
  db.deleteStudent(req.params.phone);
  try { require('./events').emitStudentsChanged(); } catch {}
  res.json({ ok: true });
});

// API — bulk upsert (importação em massa de planilha de clientes ativos)
router.post('/api/students/bulk', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items deve ser array' });
  if (items.length === 0) return res.json({ inserted: 0, updated: 0, skipped: 0 });
  if (items.length > 5000) return res.status(400).json({ error: 'Máximo 5000 itens por chamada' });
  const result = db.bulkUpsertStudents(items);
  console.log(`[admin] bulk students: inserted=${result.inserted} updated=${result.updated} skipped=${result.skipped}`);
  res.json(result);
});

// ─────────────────────────────────────────────────────────────────────
// PR #37 — V2 MONITORING (admin only)
// ─────────────────────────────────────────────────────────────────────

// Lista conversas v2 com filtro opcional de status.
router.get('/api/v2/conversations', auth.requireAdmin, (req, res) => {
  const { status, limit } = req.query;
  const validStatus = ['em_andamento', 'agendou', 'handoff', 'perdeu'];
  const filter = (status && validStatus.includes(status)) ? status : null;
  const lim = Math.min(parseInt(limit, 10) || 200, 500);
  try {
    const rows = db.getV2Conversations({ status: filter, limit: lim });
    res.json({ conversations: rows, total: rows.length });
  } catch (err) {
    console.error('[v2/conversations] erro:', err.message);
    res.status(500).json({ error: 'falha ao listar conversas' });
  }
});

// Detalhe completo de uma conversa pra painel lateral.
router.get('/api/v2/conversation/:phone', auth.requireAdmin, (req, res) => {
  try {
    const detail = db.getV2ConversationDetail(req.params.phone);
    if (!detail) return res.status(404).json({ error: 'conversa v2 não encontrada' });
    res.json(detail);
  } catch (err) {
    console.error('[v2/conversation] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Métricas do período.
router.get('/api/v2/metrics', auth.requireAdmin, (req, res) => {
  const period = req.query.period || '7d';
  if (!db.V2_PERIODS[period]) return res.status(400).json({ error: 'period inválido (use: 1h | today | 7d | 14d | 30d)' });
  try {
    const m = db.getV2Metrics(period);
    res.json(m);
  } catch (err) {
    console.error('[v2/metrics] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Alertas ativos (banner vermelho).
router.get('/api/v2/alerts', auth.requireAdmin, (req, res) => {
  try {
    const alerts = db.getV2Alerts();
    res.json({ alerts, count: alerts.length });
  } catch (err) {
    console.error('[v2/alerts] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Avaliação 3-níveis (extends conversation_reviews).
router.put('/api/v2/review/:phone', auth.requireAdmin, (req, res) => {
  const { rating, comment } = req.body || {};
  if (!db.isValidReviewRating(rating)) {
    return res.status(400).json({ error: "rating deve ser 'good', 'aceitavel' ou 'bad'" });
  }
  // Confere que phone existe em contacts (FK)
  if (!db.getContact(req.params.phone)) {
    return res.status(404).json({ error: 'phone não encontrado em contacts' });
  }
  try {
    db.upsertReview(req.params.phone, rating, comment || null);
    // Notifica via SSE pra atualizar UI em tempo real
    try { require('./events').bus.emit('v2.metrics.changed', { phone: req.params.phone, type: 'review' }); } catch {}
    res.json({ ok: true, rating, comment: comment || null });
  } catch (err) {
    console.error('[v2/review] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Força geração de resumo agora (combinado no review do PR36).
router.post('/api/v2/force-resumo/:phone', auth.requireAdmin, async (req, res) => {
  try {
    const { updateResumoDinamicoBackground } = require('./resumo-dinamico');
    db.logV2Event(db.V2_EVENT_TYPES.FORCE_RESUMO, req.params.phone, null, { user: req.user?.id });
    const result = await updateResumoDinamicoBackground(req.params.phone);
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[v2/force-resumo] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Status atual da versão (env baseline + override + efetiva).
router.get('/api/v2/version', auth.requireAdmin, (req, res) => {
  const webhook = require('./webhook');
  res.json({
    env: webhook.AGENT_VERSION_ENV,
    override: db.getRuntimeFlag('agent_version_override'),
    current: webhook.getCurrentAgentVersion(),
  });
});

// Pausa v2: força AGENT_VERSION=v1 instantâneo. Com confirmação dupla no front.
router.post('/api/v2/pause', auth.requireAdmin, (req, res) => {
  const { confirm } = req.body || {};
  if (confirm !== 'PAUSAR_V2_AGORA') {
    return res.status(400).json({ error: "envie body { confirm: 'PAUSAR_V2_AGORA' } pra confirmar" });
  }
  db.setRuntimeFlag('agent_version_override', 'v1', req.user?.id);
  db.logV2Event(db.V2_EVENT_TYPES.VERSION_CHANGE, null, null, {
    action: 'pause',
    user: req.user?.id,
    user_name: req.user?.display_name,
  });
  console.warn(`[v2/pause] AGENT_VERSION=v1 forçado por ${req.user?.display_name || req.user?.id}`);
  try { require('./events').bus.emit('v2.metrics.changed', { type: 'version_change' }); } catch {}
  res.json({ ok: true, current: 'v1', message: 'v2 pausado. Próximas mensagens caem em v1.' });
});

// Resume: limpa override (volta pra env var).
router.post('/api/v2/resume', auth.requireAdmin, (req, res) => {
  const { confirm } = req.body || {};
  if (confirm !== 'RESUMIR_V2') {
    return res.status(400).json({ error: "envie body { confirm: 'RESUMIR_V2' } pra confirmar" });
  }
  db.setRuntimeFlag('agent_version_override', '', req.user?.id);
  db.logV2Event(db.V2_EVENT_TYPES.VERSION_CHANGE, null, null, {
    action: 'resume',
    user: req.user?.id,
    user_name: req.user?.display_name,
  });
  const webhook = require('./webhook');
  console.warn(`[v2/resume] override removido por ${req.user?.display_name || req.user?.id}, current=${webhook.getCurrentAgentVersion()}`);
  try { require('./events').bus.emit('v2.metrics.changed', { type: 'version_change' }); } catch {}
  res.json({ ok: true, current: webhook.getCurrentAgentVersion(), message: 'override removido. Volta pra env var.' });
});

// Export CSV de conversas v2 do período.
router.get('/api/v2/export', auth.requireAdmin, (req, res) => {
  const period = req.query.period || '7d';
  if (!db.V2_PERIODS[period]) return res.status(400).json({ error: 'period inválido' });
  try {
    const since = Date.now() - db.V2_PERIODS[period];
    const conversations = db.getV2Conversations({ limit: 10000 }).filter(c => c.last_contact_at >= since);
    const escapeCsv = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/\r?\n/g, ' ').replace(/"/g, '""');
      return /[",;]/.test(s) ? `"${s}"` : s;
    };
    const headers = [
      'phone', 'name', 'status', 'estagio_atual', 'objecao_ativa',
      'insistencias_valor', 'modalidade_recomendada', 'disponibilidade',
      'total_msgs_lead', 'total_msgs_johnny', 'review_rating', 'review_comment',
      'data_agendamento', 'hora_agendamento', 'last_contact_at', 'last_message',
    ];
    let csv = headers.join(';') + '\n';
    for (const c of conversations) {
      csv += [
        c.phone, c.name, c._status, c.estagio_atual, c.objecao_ativa,
        c.insistencias_valor, c.modalidade_recomendada, c.disponibilidade,
        c.total_mensagens_lead, c.total_mensagens_johnny, c.review_rating, c.review_comment,
        c.data_agendamento, c.hora_agendamento,
        c.last_contact_at ? new Date(c.last_contact_at).toISOString() : '',
        c.last_message,
      ].map(escapeCsv).join(';') + '\n';
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="v2-conversas-${period}-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('[v2/export] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Painel HTML
router.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>STRONIX SDR — Painel</title>
  <style>
    :root {
      /* Tipografia */
      --font-sans: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;
      --font-mono: ui-monospace, 'SF Mono', 'JetBrains Mono', 'Fira Code', monospace;

      /* Paleta — fundo */
      --bg-0: #0a1014;          /* mais escuro */
      --bg-1: #111b21;          /* sidebar */
      --bg-2: #1a2730;          /* base panels */
      --bg-3: #202c33;          /* hover/header */
      --bg-4: #2a3942;          /* active/elev */
      --bg-5: #34434c;          /* focus */

      /* Bordas */
      --border-subtle: #1f2a30;
      --border:        #222d34;
      --border-strong: #2a3942;

      /* Texto */
      --text-primary:   #e9edef;
      --text-secondary: #aebac1;
      --text-muted:     #8696a0;
      --text-faint:     #67797f;

      /* Brand */
      --brand:        #00a884;  /* verde principal */
      --brand-dark:   #008f72;
      --brand-light:  #06cf9c;
      --brand-soft:   #00a88422;

      /* Estados */
      --danger:    #f87171;
      --danger-bg: #2a1e1e;
      --warn:      #fbbf24;
      --warn-bg:   #2a261a;
      --info:      #818cf8;
      --info-bg:   #1a1a2e;
      --success:   #4ade80;
      --success-bg:#1e2a1e;

      /* Bubbles */
      --bubble-out: #005c4b;
      --bubble-out-human: #007e63;
      --bubble-in:  #202c33;

      /* Espaçamento (sistema 4px) */
      --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px;  --sp-4: 16px;  --sp-5: 20px;  --sp-6: 24px;
      --sp-8: 32px; --sp-10: 40px;

      /* Radius */
      --r-sm: 6px;  --r-md: 8px;  --r-lg: 12px;  --r-pill: 999px;

      /* Sombra */
      --shadow-md: 0 4px 12px rgba(0,0,0,.35);
      --shadow-lg: 0 12px 28px rgba(0,0,0,.5);

      /* Transições */
      --t-fast: .12s cubic-bezier(.2,.8,.2,1);
      --t-base: .2s  cubic-bezier(.2,.8,.2,1);

      /* Layout */
      --header-h: 56px;
      --tabs-h:   48px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
      font-family: var(--font-sans);
      font-feature-settings: "ss01", "cv11";
      -webkit-font-smoothing: antialiased;
      background: var(--bg-0);
      color: var(--text-primary);
      font-size: 14px;
      line-height: 1.5;
      overflow: hidden;
    }

    /* ─── HEADER ─── */
    header {
      background: var(--bg-1);
      border-bottom: 1px solid var(--border);
      padding: 0 var(--sp-6);
      display: flex; align-items: center; gap: var(--sp-4);
      height: var(--header-h);
    }
    header h1 {
      font-size: 16px; font-weight: 700; color: var(--text-primary);
      letter-spacing: -.01em;
      display: flex; align-items: center; gap: 8px;
    }
    header h1 .logo-icon {
      width: 28px; height: 28px; border-radius: 8px;
      background: linear-gradient(135deg, var(--brand), var(--brand-dark));
      display: inline-flex; align-items: center; justify-content: center;
      box-shadow: 0 0 0 1px rgba(255,255,255,.05) inset, 0 4px 10px rgba(0,168,132,.25);
      color: #001f17; font-size: 14px; font-weight: 800;
    }
    header h1 .brand-name { color: var(--text-primary); }
    header h1 .brand-suffix { color: var(--brand); font-weight: 700; }
    header .subtitle { font-size: 13px; color: var(--text-muted); font-weight: 400; }
    .badge {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--brand-soft); color: var(--brand);
      padding: 4px 10px; border-radius: var(--r-pill);
      font-size: 12px; font-weight: 600;
    }
    .badge::before {
      content: ''; width: 6px; height: 6px; border-radius: 50%;
      background: var(--brand); box-shadow: 0 0 0 3px rgba(0,168,132,.2);
      animation: pulse 2s ease infinite;
    }
    @keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(0,168,132,.05); } }

    .user-area { margin-left: auto; display: flex; align-items: center; gap: var(--sp-3); }
    #user-info { font-size: 13px; color: var(--text-secondary); font-weight: 500; }
    .btn-logout {
      background: transparent; border: 1px solid var(--border);
      color: var(--text-muted); padding: 6px 14px;
      border-radius: var(--r-md); font-size: 12px; font-weight: 500;
      cursor: pointer; transition: all var(--t-fast);
    }
    .btn-logout:hover { background: var(--bg-3); color: var(--text-primary); border-color: var(--border-strong); }

    /* ─── TABS (legacy — escondidas, substituídas pelo rail) ─── */
    .tabs { display: none; }
    .tab { display: none; }

    /* ════════════════════════════════════════════
       APP SHELL — rail esquerdo + content
       ════════════════════════════════════════════ */
    body { overflow: hidden; }
    .app { position: relative; height: 100vh; padding-left: 64px; }
    .app.pinned { padding-left: 240px; transition: padding-left var(--t-base); }

    /* ─── Rail esquerdo (icon-only, expande no hover) ─── */
    .rail {
      position: absolute; top: 0; left: 0; bottom: 0; z-index: 30;
      width: 64px; background: var(--bg-1); border-right: 1px solid var(--border-subtle);
      display: flex; flex-direction: column; align-items: stretch;
      transition: width var(--t-base), box-shadow var(--t-base);
      overflow: visible;
    }
    .rail:hover { width: 240px; box-shadow: var(--shadow-lg); }
    .rail.pinned { width: 240px; }

    .rail-brand {
      height: 64px; display: flex; align-items: center; gap: 12px; padding: 0 14px;
      border-bottom: 1px solid var(--border-subtle); overflow: hidden;
    }
    .rail-brand .mark {
      width: 36px; height: 36px; border-radius: 9px;
      background: linear-gradient(135deg, #00a884, #008f72);
      display: grid; place-items: center; color: #001f17; font-weight: 800; font-size: 19px;
      box-shadow: 0 4px 10px rgba(0,168,132,.25); flex-shrink: 0; letter-spacing: -1px;
    }
    .rail-brand .word {
      font-weight: 700; font-size: 15px; letter-spacing: -.2px; white-space: nowrap;
      opacity: 0; transform: translateX(-6px); transition: all var(--t-base);
    }
    .rail:hover .rail-brand .word, .rail.pinned .rail-brand .word { opacity: 1; transform: none; }
    .rail-brand .word .accent { color: var(--brand); }

    .rail nav { flex: 1; display: flex; flex-direction: column; padding: 10px 8px; gap: 2px; overflow-y: auto; overflow-x: hidden; }
    .rail nav::-webkit-scrollbar { display: none; }

    .nav-item {
      position: relative; display: grid; grid-template-columns: 32px 1fr auto; align-items: center; gap: 12px;
      height: 42px; padding: 0 8px; border-radius: 9px; cursor: pointer;
      color: var(--text-secondary); transition: all var(--t-fast); overflow: hidden;
    }
    .nav-item:hover { background: var(--bg-2); color: var(--text-primary); }
    .nav-item.active { background: var(--bg-3); color: var(--text-primary); }
    .nav-item.active::before {
      content: ""; position: absolute; left: -8px; top: 8px; bottom: 8px; width: 3px;
      background: var(--brand); border-radius: 0 3px 3px 0;
    }
    .nav-item .ic { width: 32px; height: 32px; display: grid; place-items: center; flex-shrink: 0; }
    .nav-item .ic svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .nav-item.active .ic { color: var(--brand); }
    .nav-item .lbl {
      font: 500 13.5px var(--font-sans); white-space: nowrap;
      opacity: 0; transform: translateX(-4px); transition: all var(--t-base);
    }
    .rail:hover .nav-item .lbl, .rail.pinned .nav-item .lbl { opacity: 1; transform: none; }
    .nav-item .nav-badge {
      background: var(--bg-3); color: var(--text-secondary); font: 600 11px var(--font-sans);
      padding: 1px 7px; border-radius: 999px; flex-shrink: 0;
      opacity: 0; transition: opacity var(--t-base);
    }
    .rail:hover .nav-item .nav-badge, .rail.pinned .nav-item .nav-badge { opacity: 1; }
    .nav-item.active .nav-badge { background: var(--brand-soft); color: var(--brand-light); }

    .nav-group { display: flex; flex-direction: column; }
    .nav-group .submenu {
      display: flex; flex-direction: column; gap: 1px; padding-left: 8px; margin: 2px 0 4px;
      max-height: 0; overflow: hidden; transition: max-height var(--t-base);
      opacity: 0;
    }
    .rail:hover .nav-group.open .submenu, .rail.pinned .nav-group.open .submenu { max-height: 300px; opacity: 1; }
    .sub-item {
      display: grid; grid-template-columns: 24px 1fr; gap: 10px; align-items: center;
      height: 34px; padding: 0 8px 0 16px; border-radius: 7px; cursor: pointer;
      color: var(--text-muted); font: 500 12.5px var(--font-sans);
      border-left: 1px solid var(--border-subtle); margin-left: 14px;
    }
    .sub-item:hover { color: var(--text-primary); background: var(--bg-2); }
    .sub-item.active { color: var(--brand); background: var(--brand-soft); }
    .sub-item .si { display: grid; place-items: center; }
    .sub-item .si svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .nav-group .nav-item .chev {
      width: 14px; height: 14px; color: var(--text-muted); transition: transform var(--t-fast); flex-shrink: 0;
      opacity: 0; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
    }
    .rail:hover .nav-group .nav-item .chev, .rail.pinned .nav-group .nav-item .chev { opacity: 1; }
    .nav-group.open > .nav-item .chev { transform: rotate(90deg); }

    .rail-foot { padding: 8px; border-top: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 4px; }
    .user-pill {
      display: grid; grid-template-columns: 32px 1fr auto; align-items: center; gap: 10px;
      padding: 6px 8px; border-radius: 9px; cursor: pointer; color: var(--text-secondary);
    }
    .user-pill:hover { background: var(--bg-2); }
    .user-pill .av {
      width: 32px; height: 32px; border-radius: 50%;
      background: linear-gradient(135deg, #f472b6, #db2777);
      display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 12px; flex-shrink: 0;
    }
    .user-pill .who { display: flex; flex-direction: column; min-width: 0; opacity: 0; transition: opacity var(--t-base); white-space: nowrap; }
    .rail:hover .user-pill .who, .rail.pinned .user-pill .who { opacity: 1; }
    .user-pill .who .nm { font: 600 12.5px var(--font-sans); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; }
    .user-pill .who .role { font-size: 10.5px; color: var(--text-muted); }
    .user-pill .pill-act { opacity: 0; transition: opacity var(--t-base); background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; }
    .user-pill .pill-act:hover { color: var(--danger); }
    .rail:hover .user-pill .pill-act, .rail.pinned .user-pill .pill-act { opacity: 1; }
    .user-pill .pill-act svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

    /* ─── Content (à direita do rail) ─── */
    .content { display: grid; grid-template-rows: 1fr; height: 100vh; overflow: hidden; min-width: 0; }

    /* Topbar contextual */
    .topbar {
      background: var(--bg-1); border-bottom: 1px solid var(--border-subtle);
      padding: 0 22px; display: flex; align-items: center; justify-content: space-between; gap: 14px;
    }
    .crumb { display: flex; align-items: center; gap: 10px; font-size: 13px; }
    .crumb .root { color: var(--text-muted); }
    .crumb .sep { color: var(--text-faint); }
    .crumb .now { color: var(--text-primary); font-weight: 600; font-size: 14px; }
    .crumb .now .crumb-tag { font-size: 11px; font-weight: 500; color: var(--text-muted); background: var(--bg-3); padding: 2px 7px; border-radius: 5px; margin-left: 8px; font-family: var(--font-mono); }
    .topbar .topbar-acts { display: flex; align-items: center; gap: 8px; }
    .status-pill { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-secondary); padding: 5px 11px; background: var(--bg-2); border: 1px solid var(--border-subtle); border-radius: 999px; }
    .status-pill .st-dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 0 3px rgba(74,222,128,.15); }

    /* Panel fica no row 1fr do grid .content, então preenche automaticamente
       a altura disponível. min-height: 0 evita overflow na grid. */
    .panel { display: none; min-height: 0; overflow-y: auto; padding: var(--sp-6); }
    .panel.active { display: block; }

    /* Botão de ação no topbar (ex: nova conversa) */
    .topbar-btn {
      width: 38px; height: 38px; border-radius: 8px;
      background: transparent; border: none; cursor: pointer;
      color: var(--text-secondary);
      display: flex; align-items: center; justify-content: center;
      transition: all var(--t-fast);
    }
    .topbar-btn:hover { background: var(--bg-3); color: var(--text-primary); }
    .topbar-btn:active { transform: scale(.95); }
    .topbar-btn svg { width: 19px; height: 19px; }

    /* ════════════════════════════════════════════════
       MODAL — backdrop + card centrado
       ════════════════════════════════════════════════ */
    .modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,.55);
      backdrop-filter: blur(3px);
      z-index: 200;
      display: flex; align-items: center; justify-content: center;
      animation: backdropIn .15s ease-out;
    }
    .modal-backdrop.hidden { display: none; }
    @keyframes backdropIn { from { opacity: 0; } to { opacity: 1; } }
    .modal-card {
      background: var(--bg-1);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.04) inset;
      max-width: 520px; width: calc(100vw - 32px);
      max-height: calc(100vh - 80px);
      display: flex; flex-direction: column;
      overflow: hidden;
      animation: modalIn .2s ease-out;
    }
    @keyframes modalIn {
      from { opacity: 0; transform: translateY(8px) scale(.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .modal-head {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex; align-items: center; justify-content: space-between;
    }
    .modal-title { font: 600 16px var(--font-sans); color: var(--text-primary); }
    .modal-close {
      width: 30px; height: 30px; border-radius: 8px;
      background: transparent; border: none; cursor: pointer;
      color: var(--text-muted);
      display: flex; align-items: center; justify-content: center;
      transition: all var(--t-fast);
    }
    .modal-close:hover { background: var(--bg-3); color: var(--text-primary); }

    /* Modal: Nova conversa específico */
    .new-chat-card { width: 540px; }
    .new-chat-search-row {
      padding: 14px 18px 8px;
      position: relative;
    }
    .new-chat-search-icon {
      position: absolute; left: 32px; top: 50%; transform: translateY(-50%);
      width: 16px; height: 16px; color: var(--text-muted);
    }
    .new-chat-search {
      width: 100%; box-sizing: border-box;
      background: var(--bg-2); border: 1px solid var(--border);
      border-radius: 10px;
      padding: 11px 14px 11px 38px;
      color: var(--text-primary); font: 14px var(--font-sans);
      outline: none;
      transition: border-color var(--t-fast), background var(--t-fast);
    }
    .new-chat-search::placeholder { color: var(--text-muted); }
    .new-chat-search:focus { border-color: var(--brand); background: var(--bg-1); }
    .new-chat-name-row {
      padding: 0 18px 8px;
    }
    .new-chat-name-row.hidden { display: none; }
    .new-chat-name {
      width: 100%; box-sizing: border-box;
      background: var(--bg-2); border: 1px solid var(--border);
      border-radius: 10px;
      padding: 11px 14px;
      color: var(--text-primary); font: 14px var(--font-sans);
      outline: none;
      transition: border-color var(--t-fast), background var(--t-fast);
    }
    .new-chat-name::placeholder { color: var(--text-muted); }
    .new-chat-name:focus { border-color: var(--brand); background: var(--bg-1); }

    .new-chat-results {
      flex: 1; overflow-y: auto;
      padding: 4px 8px 8px;
      min-height: 100px; max-height: 360px;
    }
    .new-chat-section {
      font: 600 11px var(--font-sans); color: var(--text-muted);
      text-transform: uppercase; letter-spacing: .06em;
      padding: 10px 10px 4px;
    }
    .new-chat-hint {
      padding: 24px 18px; text-align: center;
      color: var(--text-muted); font-size: 13px;
    }
    .new-chat-item {
      display: grid; grid-template-columns: auto 1fr auto; gap: 12px;
      align-items: center;
      padding: 10px;
      border-radius: 10px;
      cursor: pointer;
      transition: background var(--t-fast);
    }
    .new-chat-item:hover { background: var(--bg-3); }
    .new-chat-item.create { background: var(--brand-soft); }
    .new-chat-item.create:hover { background: rgba(0,168,132,.18); }
    .new-chat-item .av {
      width: 38px; height: 38px; border-radius: 50%;
      background: linear-gradient(135deg, var(--brand) 0%, var(--brand-dark) 100%);
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 700; font-size: 13px;
      flex-shrink: 0;
    }
    .new-chat-item.create .av { background: linear-gradient(135deg, #818cf8, #6366f1); }
    .new-chat-item .info { display: flex; flex-direction: column; min-width: 0; }
    .new-chat-item .nm { font: 600 14px var(--font-sans); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .new-chat-item .ph { font-size: 12px; color: var(--text-muted); font-family: var(--font-mono); }
    .new-chat-item .arrow { color: var(--text-faint); }

    .new-chat-foot {
      padding: 10px 18px;
      border-top: 1px solid var(--border-subtle);
      background: var(--bg-2);
      font-size: 11.5px; color: var(--text-muted);
      line-height: 1.5;
    }

    /* ════════════════════════════════════════════════
       BANNER + TOAST — sistema de notificação operacional
       ════════════════════════════════════════════════ */
    /* Banner persistente no topo (WhatsApp desconectado, etc) */
    .conn-banner {
      position: fixed; top: 0; left: 64px; right: 0;
      z-index: 150;
      background: linear-gradient(90deg, rgba(248,113,113,.18) 0%, rgba(248,113,113,.10) 100%);
      border-bottom: 1px solid rgba(248,113,113,.4);
      color: #fecaca;
      font: 600 13px var(--font-sans);
      padding: 9px 18px;
      display: flex; align-items: center; gap: 10px;
      cursor: pointer;
      animation: bannerSlideDown .25s ease-out;
      transition: filter var(--t-fast);
    }
    .conn-banner:hover { filter: brightness(1.15); }
    .conn-banner.hidden { display: none; }
    @keyframes bannerSlideDown {
      from { transform: translateY(-100%); }
      to   { transform: translateY(0); }
    }
    .app.pinned .conn-banner { left: 240px; }
    .conn-banner-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #f87171;
      box-shadow: 0 0 0 0 rgba(248,113,113,.7);
      animation: bannerPulse 1.5s ease-in-out infinite;
    }
    @keyframes bannerPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(248,113,113,.7); }
      50%      { box-shadow: 0 0 0 7px rgba(248,113,113,0); }
    }
    .conn-banner-text { flex: 1; }
    .conn-banner-cta { font-weight: 700; opacity: .9; }

    /* Toast stack — notificações transitórias */
    .toast-stack {
      position: fixed; top: 18px; right: 18px;
      display: flex; flex-direction: column; gap: 10px;
      z-index: 250;
      max-width: 360px; pointer-events: none;
    }
    .toast {
      background: var(--bg-3); border: 1px solid var(--border);
      border-left: 3px solid var(--brand);
      border-radius: 10px;
      padding: 11px 14px;
      box-shadow: var(--shadow-lg);
      pointer-events: auto;
      cursor: pointer;
      animation: toastIn .25s cubic-bezier(.22, 1, .36, 1);
      transition: transform var(--t-fast), opacity var(--t-fast);
    }
    .toast:hover { transform: translateX(-3px); }
    .toast.fading { opacity: 0; transform: translateX(40px); }
    .toast.warn  { border-left-color: var(--warn); }
    .toast.error { border-left-color: var(--danger); }
    .toast.info  { border-left-color: #818cf8; }
    @keyframes toastIn {
      from { opacity: 0; transform: translateX(40px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    .toast-title {
      font: 600 13px var(--font-sans);
      color: var(--text-primary);
      margin-bottom: 3px;
      display: flex; align-items: center; gap: 8px;
    }
    .toast-icon { font-size: 16px; line-height: 1; }
    .toast-msg {
      font-size: 12.5px; color: var(--text-secondary);
      line-height: 1.45;
    }
    .toast-close {
      position: absolute; top: 6px; right: 8px;
      background: none; border: none; cursor: pointer;
      color: var(--text-faint); font-size: 16px; line-height: 1;
      padding: 2px 6px;
    }
    .toast-close:hover { color: var(--text-primary); }
    .toast { position: relative; padding-right: 28px; }

    /* Hint do rail (primeira vez) */
    .rail-hint {
      position: fixed; left: 80px; bottom: 24px; background: var(--bg-3); border: 1px solid var(--border);
      padding: 8px 12px; border-radius: 8px; font-size: 11.5px; color: var(--text-secondary);
      display: flex; align-items: center; gap: 6px; box-shadow: var(--shadow-md); z-index: 100;
      pointer-events: none; opacity: 0; transition: opacity .3s;
    }
    .rail-hint.show { opacity: 1; }
    .rail-hint kbd { background: var(--bg-1); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font: 600 10px var(--font-mono); color: var(--text-primary); }

    /* Rola sob o rail em mobile (rail vira topbar fixa) */
    @media (max-width: 720px) {
      .app { padding-left: 0; padding-top: 56px; }
      .rail { left: 0; right: 0; bottom: auto; width: 100%; height: 56px; flex-direction: row; }
      .rail:hover, .rail.pinned { width: 100%; box-shadow: none; }
      .rail nav { flex-direction: row; padding: 6px 8px; }
      .rail-brand { display: none; }
      .nav-item .lbl { display: none; }
      .nav-item .nav-badge { display: none; }
      .rail-foot { display: none; }
      .topbar { padding: 0 14px; }
    }

    /* ─── PROMPT EDITOR ─── */
    .prompt-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--sp-4); }
    .prompt-header h2 { font-size: 14px; color: var(--text-secondary); font-weight: 500; }
    .prompt-meta { font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }

    textarea {
      width: 100%;
      background: var(--bg-2); color: var(--text-primary);
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      padding: var(--sp-5);
      font-family: var(--font-mono);
      font-size: 13px; line-height: 1.65;
      resize: none; outline: none;
      transition: border-color var(--t-fast), background var(--t-fast);
    }
    textarea:focus { border-color: var(--brand); background: var(--bg-1); }

    #prompt-text { height: calc(100vh - 260px); }

    .actions { display: flex; gap: var(--sp-3); margin-top: var(--sp-4); align-items: center; }
    .btn {
      padding: 9px 18px; border-radius: var(--r-md);
      border: none; font-size: 13.5px; font-weight: 600;
      cursor: pointer; transition: all var(--t-fast);
    }
    .btn-save  { background: var(--brand); color: #000; }
    .btn-save:hover  { background: var(--brand-light); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,168,132,.35); }
    .btn-save:disabled { background: var(--bg-4); color: var(--text-muted); cursor: not-allowed; transform: none; box-shadow: none; }
    .btn-reset { background: var(--bg-3); color: var(--text-secondary); }
    .btn-reset:hover { background: var(--bg-4); color: var(--text-primary); }
    .save-status { font-size: 13px; color: var(--brand); opacity: 0; transition: opacity var(--t-base); }
    .save-status.visible { opacity: 1; }

    .sections { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: var(--sp-4); }
    .section-pill {
      background: var(--brand-soft); color: var(--brand);
      border: 1px solid rgba(0,168,132,.2);
      padding: 4px 10px; border-radius: var(--r-pill);
      font-size: 11px; font-weight: 500; cursor: pointer;
      transition: all var(--t-fast);
    }
    .section-pill:hover { background: rgba(0,168,132,.15); border-color: rgba(0,168,132,.4); }

    /* ─── HEADERS DAS ABAS ─── */
    .conv-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--sp-5); }
    .conv-header h2 { font-size: 16px; color: var(--text-primary); font-weight: 600; letter-spacing: -.01em; }
    .refresh-btn {
      background: var(--bg-2); border: 1px solid var(--border);
      color: var(--text-secondary); padding: 7px 14px;
      border-radius: var(--r-md); font-size: 13px;
      cursor: pointer; transition: all var(--t-fast);
    }
    .refresh-btn:hover { border-color: var(--border-strong); color: var(--text-primary); background: var(--bg-3); }

    /* Filtros pills genéricos */
    .filter-bar { display: flex; gap: 6px; align-items: center; margin-bottom: var(--sp-4); flex-wrap: wrap; }
    .filter-btn {
      background: var(--bg-2); border: 1px solid var(--border);
      color: var(--text-muted); padding: 5px 12px;
      border-radius: var(--r-pill); font-size: 12px;
      cursor: pointer; transition: all var(--t-fast);
      white-space: nowrap;
    }
    .filter-btn:hover { color: var(--text-secondary); border-color: var(--border-strong); }
    .filter-btn.active { background: var(--brand-soft); border-color: rgba(0,168,132,.4); color: var(--brand); }

    /* ─── INBOX (3 COLUNAS — ESTILO WHATSAPP WEB PRO) ─── */
    /* Inbox sem padding e ocupa altura total disponível (apenas - 56px do topbar
       da .content grid; tabs antigas hidden não contam mais) */
    #tab-conversas { padding: 0; height: 100%; overflow: hidden; }
    #tab-conversas.active { display: flex; }
    .inbox-layout { display: flex; height: 100%; width: 100%; background: var(--bg-0); }
    .inbox-col { display: flex; flex-direction: column; overflow: hidden; }
    .inbox-col-left  { width: 380px; min-width: 320px; border-right: 1px solid var(--border); background: var(--bg-1); }
    .inbox-col-mid   { flex: 1; min-width: 0; background: var(--bg-0); }
    .inbox-col-right { width: 300px; min-width: 260px; border-left: 1px solid var(--border); background: var(--bg-1); }

    .inbox-col-header {
      padding: 0 var(--sp-4); height: var(--header-h);
      background: var(--bg-3); border-bottom: 1px solid var(--border);
      display: flex; align-items: center; gap: var(--sp-3); flex-shrink: 0;
    }
    .inbox-col-header h3 {
      font-size: 14px; font-weight: 600; color: var(--text-primary);
      flex: 1; letter-spacing: -.005em;
      display: flex; align-items: center; gap: 8px;
    }
    .inbox-col-header .count-badge {
      background: var(--bg-4); color: var(--text-secondary);
      padding: 2px 8px; border-radius: var(--r-pill);
      font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums;
    }
    .inbox-col-header .refresh-mini {
      background: transparent; border: none; color: var(--text-secondary);
      width: 32px; height: 32px; border-radius: var(--r-md);
      cursor: pointer; transition: all var(--t-fast);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
    }
    .inbox-col-header .refresh-mini:hover { background: var(--bg-4); color: var(--text-primary); }

    /* Search */
    .inbox-search { padding: var(--sp-2) var(--sp-3); background: var(--bg-1); position: relative; flex-shrink: 0; }
    .inbox-search svg { position: absolute; left: 24px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; color: var(--text-muted); pointer-events: none; }
    .inbox-search input {
      width: 100%; background: var(--bg-3);
      color: var(--text-primary); border: 1px solid transparent;
      border-radius: var(--r-md);
      padding: 9px 14px 9px 38px;
      font-size: 13px; outline: none; font-family: inherit;
      transition: all var(--t-fast);
    }
    .inbox-search input::placeholder { color: var(--text-muted); }
    .inbox-search input:focus { background: var(--bg-2); border-color: var(--brand); }

    /* Filtros pills (compactos dentro da inbox) */
    .inbox-filters {
      display: flex; gap: 4px;
      padding: var(--sp-2) var(--sp-3) var(--sp-3);
      background: var(--bg-1); overflow-x: auto;
      border-bottom: 1px solid var(--border-subtle);
      flex-shrink: 0;
    }
    .inbox-filters::-webkit-scrollbar { display: none; }
    .inbox-filters .filter-btn {
      font-size: 11.5px; padding: 4px 10px;
      white-space: nowrap; flex-shrink: 0;
      background: transparent; border-color: var(--border-subtle);
    }
    .inbox-filters .filter-btn:hover { background: var(--bg-3); }
    .inbox-filters .filter-btn.active { background: var(--brand-soft); border-color: rgba(0,168,132,.4); color: var(--brand); }

    /* Lista */
    .inbox-list { flex: 1; overflow-y: auto; }

    .inbox-item {
      display: flex; align-items: center; gap: var(--sp-3);
      padding: var(--sp-3) var(--sp-4);
      cursor: pointer;
      border-bottom: 1px solid var(--border-subtle);
      transition: background var(--t-fast);
      position: relative;
    }
    .inbox-item:hover { background: var(--bg-3); }
    .inbox-item.active {
      background: var(--bg-3);
    }
    .inbox-item.active::before {
      content: ''; position: absolute; left: 0; top: 0; bottom: 0;
      width: 3px; background: var(--brand);
    }

    .inbox-avatar {
      width: 46px; height: 46px; border-radius: 50%;
      background: linear-gradient(135deg, var(--brand) 0%, var(--brand-dark) 100%);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; font-weight: 600; color: #fff;
      flex-shrink: 0; position: relative;
      letter-spacing: .02em;
      box-shadow: 0 2px 6px rgba(0,0,0,.25);
    }
    .inbox-avatar.human { background: linear-gradient(135deg, #f59e0b, #d97706); }
    .inbox-avatar.mine  { background: linear-gradient(135deg, var(--success), #16a34a); }
    .inbox-avatar .ai-dot {
      position: absolute; bottom: -2px; right: -2px;
      width: 16px; height: 16px; border-radius: 50%;
      background: var(--info); border: 2px solid var(--bg-1);
      font-size: 9px; line-height: 12px;
      display: flex; align-items: center; justify-content: center;
    }

    .inbox-item-body { flex: 1; min-width: 0; }
    .inbox-item-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 2px; }
    .inbox-item-name { font-size: 14.5px; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -.005em; }
    .inbox-item-time { font-size: 11px; color: var(--text-muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }
    .inbox-item-bot  { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .inbox-item-preview { font-size: 13px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
    .inbox-item-tags { display: flex; gap: 4px; align-items: center; }

    .inbox-mini-badge {
      font-size: 10px; padding: 2px 7px; border-radius: var(--r-pill);
      font-weight: 600; line-height: 1.4; letter-spacing: .01em;
    }
    .inbox-mini-badge.ai    { background: var(--info-bg); color: var(--info); }
    .inbox-mini-badge.human { background: var(--warn-bg); color: var(--warn); }
    .inbox-mini-badge.mine  { background: var(--success-bg); color: var(--success); }
    .inbox-mini-badge.review.good { background: var(--success-bg); color: var(--success); }
    .inbox-mini-badge.review.bad  { background: var(--danger-bg); color: var(--danger); }

    /* Chat empty */
    .chat-empty {
      flex: 1; display: flex; align-items: center; justify-content: center;
      color: var(--text-muted); font-size: 14px; flex-direction: column;
      gap: var(--sp-3); padding: var(--sp-10); text-align: center;
    }
    .chat-empty-icon {
      font-size: 56px; opacity: .25;
      filter: grayscale(.4);
    }
    .chat-empty-title { font-size: 18px; font-weight: 500; color: var(--text-secondary); margin-top: var(--sp-2); }
    .chat-empty-sub   { font-size: 13px; color: var(--text-muted); max-width: 320px; }

    /* Chat header */
    .chat-header {
      padding: 0 var(--sp-5); height: var(--header-h);
      background: var(--bg-3); border-bottom: 1px solid var(--border);
      display: flex; align-items: center; gap: var(--sp-4);
      flex-shrink: 0; position: relative;
    }
    .chat-header-avatar {
      width: 40px; height: 40px; border-radius: 50%;
      background: linear-gradient(135deg, var(--brand), var(--brand-dark));
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 600; color: #fff;
      flex-shrink: 0;
      box-shadow: 0 2px 6px rgba(0,0,0,.25);
    }
    .chat-header-info { flex: 1; min-width: 0; }
    .chat-header-name { font-size: 15px; font-weight: 600; color: var(--text-primary); letter-spacing: -.005em; }
    .chat-header-status { font-size: 12px; color: var(--text-muted); margin-top: 1px; }
    .chat-header-actions { display: flex; gap: 6px; align-items: center; }

    .chat-action-btn {
      background: transparent; color: var(--text-secondary);
      border: 1px solid var(--border-strong);
      padding: 7px 14px; border-radius: var(--r-md);
      font-size: 12.5px; font-weight: 500;
      cursor: pointer; transition: all var(--t-fast);
      display: inline-flex; align-items: center; gap: 6px;
    }
    .chat-action-btn:hover { background: var(--bg-4); color: var(--text-primary); border-color: var(--text-muted); }
    .chat-action-btn.primary { background: var(--brand); border-color: var(--brand); color: #001f17; font-weight: 700; }
    .chat-action-btn.primary:hover { background: var(--brand-light); border-color: var(--brand-light); color: #001f17; box-shadow: 0 4px 10px rgba(0,168,132,.3); }
    .chat-action-btn.icon { padding: 7px 9px; font-size: 14px; }
    .chat-action-btn.danger { color: var(--danger); border-color: rgba(248,113,113,.25); }
    .chat-action-btn.danger:hover { background: var(--danger-bg); border-color: var(--danger); color: var(--danger); }

    /* Chat messages */
    .chat-messages {
      flex: 1; overflow-y: auto;
      padding: var(--sp-4) 14px var(--sp-3);   /* horizontal era 8% — agora 14px fixos pra balões irem perto da borda */
      background-color: var(--bg-0);
      background-image:
        linear-gradient(0deg, rgba(10,16,20,.94), rgba(10,16,20,.94)),
        radial-gradient(1200px 800px at 50% -100px, rgba(0,168,132,.04), transparent 60%);
      display: flex; flex-direction: column; gap: 2px;
    }

    .bubble-row { display: flex; padding: 1px 0; }
    .bubble-row.in  { justify-content: flex-start; }
    .bubble-row.out { justify-content: flex-end; }
    /* Espaço extra entre grupos de remetentes diferentes (separação visual) */
    .bubble-row:not(.grouped) { margin-top: 8px; }
    .bubble-row:not(.grouped):first-child { margin-top: 0; }
    /* Bubbles agrupadas (mesmo sender consecutivo) — sem tail, cantos
       arredondados uniformes pra visual de "thread" coesa */
    .bubble.grouped::before { display: none !important; }
    .bubble.in.grouped { border-top-left-radius: 12px; }
    .bubble.out.grouped { border-top-right-radius: 12px; }

    /* ════════════════════════════════════════════════
       BUBBLES — design upgrade (WhatsApp-style)
       ════════════════════════════════════════════════ */
    .bubble {
      max-width: 65%;
      min-width: 80px;
      padding: 8px 11px 9px;
      border-radius: 12px;
      font-size: 14.5px; line-height: 1.42;
      color: var(--text-primary);
      overflow-wrap: anywhere; word-break: break-word;
      white-space: pre-wrap;
      position: relative;
      box-shadow: 0 1px 1.5px rgba(0,0,0,.18);
      animation: bubbleIn .2s ease-out;
      transition: box-shadow .2s ease;
    }
    .bubble:hover { box-shadow: 0 2px 6px rgba(0,0,0,.28); }
    @keyframes bubbleIn {
      from { opacity: 0; transform: translateY(4px) scale(.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* IN (recebida do lead) — verde-cinza, tail no canto top-left */
    .bubble.in {
      background: var(--bubble-in);
      border-top-left-radius: 4px;
    }
    .bubble.in::before {
      content: ''; position: absolute;
      top: 0; left: -7px; width: 0; height: 0;
      border-style: solid;
      border-width: 0 7px 10px 0;
      border-color: transparent var(--bubble-in) transparent transparent;
      filter: drop-shadow(-1px 1px 0 rgba(0,0,0,.05));
    }

    /* OUT (enviada — IA) — verde brand, tail no canto top-right */
    .bubble.out {
      background: linear-gradient(180deg, var(--bubble-out) 0%, #00513e 100%);
      border-top-right-radius: 4px;
    }
    .bubble.out::before {
      content: ''; position: absolute;
      top: 0; right: -7px; width: 0; height: 0;
      border-style: solid;
      border-width: 0 0 10px 7px;
      border-color: transparent transparent transparent var(--bubble-out);
      filter: drop-shadow(1px 1px 0 rgba(0,0,0,.05));
    }

    /* OUT humano (consultora) — verde-azulado pra distinguir da IA */
    .bubble.out.human {
      background: linear-gradient(180deg, #0d6f60 0%, #0a5a4e 100%);
    }
    .bubble.out.human::before {
      border-color: transparent transparent transparent #0d6f60;
    }

    /* Footer (timestamp + checks) — float pra direita, fica inline em msgs
       curtas e empurra pra próxima linha em msgs longas (técnica WhatsApp Web) */
    .bubble-meta {
      float: right;
      font-size: 10.5px;
      color: rgba(255,255,255,.55);
      margin: 6px 0 -2px 8px;
      padding: 2px 0 0 0;
      display: inline-flex;
      align-items: center; gap: 3px;
      font-variant-numeric: tabular-nums;
      user-select: none;
      line-height: 1;
    }
    .bubble.in .bubble-meta { color: var(--text-faint); }
    /* Quebra de linha invisível depois do meta pra garantir clearfix */
    .bubble::after {
      content: ''; display: block; clear: both;
    }

    /* Checkmarks de status (✓ enviado / ✓✓ entregue / ✓✓ azul = lido) */
    .msg-check {
      display: inline-block; font-size: 13px; line-height: 1;
      margin-left: 2px; letter-spacing: -3px;
      color: rgba(255,255,255,.55);
      transition: color .25s ease;
    }
    .msg-check.delivered { color: rgba(255,255,255,.75); }
    .msg-check.read { color: #53bdeb; }
    .msg-check.failed { color: var(--danger); letter-spacing: 0; }

    /* Links auto-detectados dentro do balão */
    .bubble a {
      color: #8ad4ff;
      text-decoration: underline;
      text-underline-offset: 2px;
      word-break: break-all;
    }
    .bubble a:hover { color: #b3e2ff; }
    .bubble.in a { color: #66b8ec; }

    /* Player de áudio dentro da bubble */
    .bubble-audio {
      display: block; width: 280px; max-width: 100%;
      height: 36px; outline: none;
      margin: 2px 0 4px;
      border-radius: 8px;
    }
    .bubble-audio::-webkit-media-controls-panel {
      background: rgba(255,255,255,.08);
    }

    /* Nome de quem mandou (consultora) */
    .bubble-sender {
      font-size: 12.5px;
      color: #6ee7b7;
      font-weight: 600;
      margin-bottom: 3px;
      letter-spacing: -.005em;
      display: block;
    }
    .bubble.out.human .bubble-sender { color: #93dffe; }

    .day-divider { display: flex; justify-content: center; margin: var(--sp-4) 0 var(--sp-3); }
    .day-divider span {
      background: var(--bg-2); color: var(--text-muted);
      padding: 4px 12px; border-radius: var(--r-pill);
      font-size: 11.5px; font-weight: 500;
      box-shadow: 0 1px 2px rgba(0,0,0,.2);
    }

    /* System note (handoff events inline na thread) */
    .system-note {
      align-self: center;
      background: rgba(251,191,36,.10); border: 1px solid rgba(251,191,36,.25);
      color: #fbbf24; font: 500 11.5px var(--font-sans);
      padding: 6px 14px; border-radius: 8px;
      display: inline-flex; align-items: center; gap: 6px;
      margin: var(--sp-3) 0;
    }

    /* Handoff banner — acima do composer quando você assumiu o atendimento */
    .handoff-banner {
      background: linear-gradient(90deg, rgba(0,168,132,.18) 0%, rgba(0,168,132,.10) 100%);
      border-top: 1px solid rgba(0,168,132,.35);
      border-left: 3px solid var(--brand);
      color: var(--brand-light); font: 500 12.5px var(--font-sans);
      padding: 10px 18px;
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      flex-shrink: 0;
      animation: handoffSlideIn .25s ease;
    }
    @keyframes handoffSlideIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .handoff-banner > div { display: flex; align-items: center; gap: 8px; }
    .handoff-banner .hb-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--brand);
      box-shadow: 0 0 0 0 rgba(0,168,132,.45);
      animation: hbPulse 2s ease-in-out infinite;
    }
    @keyframes hbPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(0,168,132,.45); }
      50% { box-shadow: 0 0 0 6px rgba(0,168,132,0); }
    }
    .handoff-banner button {
      background: rgba(0,168,132,.18); border: 1px solid rgba(0,168,132,.4);
      color: var(--brand-light);
      font: 600 11.5px var(--font-sans); cursor: pointer;
      padding: 4px 12px; border-radius: 6px;
      transition: all var(--t-fast);
    }
    .handoff-banner button:hover {
      background: rgba(0,168,132,.32);
      color: #fff;
    }

    /* Botão "Transferir" no handoff-banner — visual secundário, ao lado de Devolver */
    .handoff-banner .btn-transfer {
      background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.15);
      color: var(--brand-light);
      font: 600 11.5px var(--font-sans);
      cursor: pointer;
      padding: 4px 10px;
      border-radius: 6px;
      margin-right: 6px;
      display: inline-flex; align-items: center; gap: 4px;
      transition: all var(--t-fast);
    }
    .handoff-banner .btn-transfer:hover {
      background: rgba(255,255,255,.14);
      color: #fff;
      border-color: rgba(255,255,255,.3);
    }
    .handoff-banner .hb-actions { display: flex; align-items: center; }

    /* Modal Transferir — reusa modal-backdrop / modal-card / modal-head */
    .transfer-card { width: 480px; max-width: 92vw; max-height: 80vh; display: flex; flex-direction: column; }
    .transfer-help {
      padding: 12px 18px 0;
      font-size: 12.5px;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .transfer-list {
      padding: 12px 18px 18px;
      overflow-y: auto;
      display: flex; flex-direction: column; gap: 6px;
    }
    .transfer-item {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px;
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      cursor: pointer;
      transition: all var(--t-fast);
    }
    .transfer-item:hover {
      background: var(--bg-3);
      border-color: var(--brand);
      transform: translateX(2px);
    }
    .transfer-item .ti-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: linear-gradient(135deg, var(--brand) 0%, var(--brand-dark, #007a60) 100%);
      color: #001f17;
      display: flex; align-items: center; justify-content: center;
      font: 700 13px var(--font-sans);
      flex-shrink: 0;
    }
    .transfer-item.is-admin .ti-avatar {
      background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
      color: #fff;
    }
    .transfer-item .ti-body { flex: 1; min-width: 0; }
    .transfer-item .ti-name {
      font: 600 13.5px var(--font-sans); color: var(--text-primary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .transfer-item .ti-meta {
      font: 500 11.5px var(--font-sans); color: var(--text-muted);
      margin-top: 2px;
    }
    .transfer-item .ti-arrow {
      color: var(--text-muted); font-size: 16px;
      transition: transform var(--t-fast);
    }
    .transfer-item:hover .ti-arrow { color: var(--brand); transform: translateX(2px); }
    .transfer-empty {
      padding: 24px 12px;
      text-align: center; color: var(--text-muted);
      font-size: 13px;
    }

    /* Hint sutil acima do composer quando IA tá atendendo —
       avisa que a próxima msg vai assumir o atendimento */
    .ai-active-hint {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 14px;
      background: rgba(70, 130, 180, .08);
      border-top: 1px solid rgba(70, 130, 180, .2);
      color: var(--text-secondary);
      font: 500 11.5px var(--font-sans);
      flex-shrink: 0;
    }
    .ai-active-hint .aih-icon {
      font-size: 14px; opacity: .85;
    }
    .ai-active-hint strong { color: var(--text-primary); }

    /* Toast especial pro auto-assume — mais nítido que toast genérico */
    .toast.auto-assumed {
      background: linear-gradient(135deg, rgba(0,168,132,.95) 0%, rgba(0,140,110,.95) 100%);
      color: #fff; border: 1px solid rgba(0,168,132,.6);
      box-shadow: 0 8px 24px rgba(0,168,132,.25);
    }
    .toast.auto-assumed .toast-title { color: #fff; }
    .toast.auto-assumed .toast-msg { color: rgba(255,255,255,.9); }
    .toast.auto-assumed .toast-close { color: rgba(255,255,255,.7); }
    .toast.auto-assumed .toast-close:hover { color: #fff; }

    /* ─── Right detail panel (ficha do lead) ─── */
    .detail {
      width: 320px; min-width: 280px; flex-shrink: 0;
      background: var(--bg-1); border-left: 1px solid var(--border-subtle);
      overflow-y: auto; padding: 18px; min-height: 0;
    }
    .detail h3 {
      margin: 0 0 12px; font-size: 11px; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: .06em; font-weight: 600;
    }
    .detail-section { margin-bottom: 24px; }
    .detail-empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      height: 100%; padding: 32px 16px; text-align: center; gap: 8px;
    }
    .detail-empty-icon { font-size: 36px; opacity: .35; margin-bottom: 4px; }
    .detail-empty-title { font: 600 14px var(--font-sans); color: var(--text-secondary); }
    .detail-empty-sub { font-size: 12.5px; color: var(--text-muted); line-height: 1.5; max-width: 220px; }

    .detail-profile {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding-bottom: 18px; border-bottom: 1px solid var(--border-subtle); margin-bottom: 18px;
    }
    .detail-profile .av {
      width: 64px; height: 64px; border-radius: 50%;
      background: linear-gradient(135deg, #818cf8, #6366f1);
      display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 22px;
      box-shadow: var(--shadow-md);
    }
    .detail-profile .nm { font: 600 16px var(--font-sans); color: var(--text-primary); text-align: center; }
    .detail-profile .ph { font-size: 12.5px; color: var(--text-muted); font-family: var(--font-mono); }

    .kv { display: flex; flex-direction: column; gap: 9px; font-size: 13px; }
    .kv .row { display: flex; flex-direction: column; gap: 2px; }
    .kv .k { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
    .kv .v { color: var(--text-primary); }
    .kv .v.brand { color: var(--brand-light); font-weight: 600; }

    .detail-appt {
      background: var(--bg-2); border: 1px solid var(--border-subtle); border-radius: 10px;
      padding: 12px; display: flex; flex-direction: column; gap: 6px;
    }
    .detail-appt .when { font: 600 14px var(--font-sans); color: var(--text-primary); }
    .detail-appt .when .pill {
      display: inline-block; margin-left: 6px; font-size: 10px; padding: 2px 7px;
      background: rgba(74,222,128,.15); color: #4ade80;
      border-radius: 999px; font-weight: 600;
    }
    .detail-appt .what { font-size: 12.5px; color: var(--text-secondary); line-height: 1.4; }

    .tagrow { display: flex; flex-wrap: wrap; gap: 5px; }
    .detail-tag {
      font: 500 11px var(--font-sans);
      padding: 3px 9px; border-radius: 999px;
      background: var(--bg-3); color: var(--text-secondary);
      border: 1px solid var(--border-subtle);
    }
    .detail-tag.brand { background: var(--brand-soft); color: var(--brand-light); border-color: rgba(0,168,132,.3); }

    .detail-note {
      font-size: 12.5px; color: var(--text-secondary); line-height: 1.5;
      background: var(--bg-2); border-radius: 8px; padding: 10px;
      border-left: 2px solid var(--brand);
    }
    .detail-note.empty {
      border-left-color: var(--border-subtle); color: var(--text-faint); font-style: italic;
    }

    /* ════════════════════════════════════════════════
       COMPOSER — padrão WhatsApp Web
       [+] [───── pill com textarea + emoji ─────] [mic|send]
       ════════════════════════════════════════════════ */
    .chat-input-wrap { flex-shrink: 0; }
    .chat-input-bar {
      padding: 8px 14px;
      background: var(--bg-3); border-top: 1px solid var(--border);
      display: flex; gap: 8px; align-items: flex-end;
    }

    /* Botão circular base (compartilhado por +, mic, send) */
    .composer-btn {
      width: 44px; height: 44px; border-radius: 50%;
      border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: all var(--t-fast);
      background: transparent; color: var(--text-secondary);
    }
    .composer-btn:hover { background: var(--bg-4); color: var(--text-primary); }
    .composer-btn:active { transform: scale(.94); }
    .composer-btn svg {
      width: 22px; height: 22px;
      stroke: currentColor; fill: none;
      stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
    }

    /* + de anexo (esquerda) — abre menu de imagens/arquivos no futuro */
    .chat-attach { font-size: 26px; line-height: 1; font-weight: 300; }

    /* Pill que envolve textarea + emoji (centro, expansível) */
    .chat-input-pill {
      flex: 1; min-width: 0;
      background: var(--bg-2);
      border: 1px solid transparent;
      border-radius: 22px;
      padding: 0 4px 0 16px;
      display: flex; align-items: flex-end;
      transition: background var(--t-fast), border-color var(--t-fast);
      min-height: 44px;
    }
    .chat-input-pill:focus-within {
      background: var(--bg-1);
      border-color: rgba(0,168,132,.35);
    }
    .chat-input {
      flex: 1; min-width: 0;
      background: transparent; color: var(--text-primary);
      border: none; outline: none; resize: none;
      padding: 11px 0 11px 0;
      font-size: 14.5px; font-family: inherit;
      line-height: 1.4;
      min-height: 22px; max-height: 160px;
    }
    .chat-input::placeholder { color: var(--text-muted); }

    /* Botões de ícone DENTRO da pill (note toggle + emoji), gray monocromático */
    .chat-emoji, .chat-note-toggle {
      width: 36px; height: 36px;
      border-radius: 50%; border: none;
      background: transparent; color: var(--text-muted);
      cursor: pointer; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      padding: 0; margin-bottom: 4px;
      transition: background var(--t-fast), color var(--t-fast);
    }
    .chat-emoji svg, .chat-note-toggle svg {
      width: 20px; height: 20px;
      stroke: currentColor; fill: none;
      stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
    }
    .chat-emoji:hover, .chat-note-toggle:hover {
      background: var(--bg-4); color: var(--text-secondary);
    }
    .chat-emoji.active { background: var(--brand-soft); color: var(--brand); }

    /* Mic / Send — só um aparece por vez (toggle por has-text) */
    .chat-mic, .chat-send {
      width: 44px; height: 44px; border-radius: 50%;
      border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: all var(--t-fast);
    }
    .chat-mic { background: transparent; color: var(--text-secondary); }
    .chat-mic:hover { background: var(--bg-4); color: var(--text-primary); }
    .chat-mic:active { transform: scale(.94); }
    .chat-mic svg { width: 22px; height: 22px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

    .chat-send {
      background: var(--brand); color: #001f17;
      box-shadow: 0 4px 10px rgba(0,168,132,.25);
    }
    .chat-send:hover { background: var(--brand-light); transform: scale(1.06); box-shadow: 0 6px 14px rgba(0,168,132,.4); }
    .chat-send:active { transform: scale(.96); }
    .chat-send:disabled { background: var(--bg-4); color: var(--text-muted); cursor: not-allowed; transform: none; box-shadow: none; }
    .chat-send svg { width: 22px; height: 22px; }

    /* Toggle: tem texto → mostra send, esconde mic | sem texto → ao contrário */
    .chat-input-bar.has-text .chat-mic { display: none; }
    .chat-input-bar:not(.has-text) .chat-send { display: none; }

    /* Painel de emojis (popup acima do composer) */
    .chat-input-wrap { position: relative; }
    .emoji-panel {
      position: absolute; bottom: calc(100% + 4px); left: 12px;
      width: 360px; max-width: calc(100% - 24px);
      height: 320px;
      background: var(--bg-3); border: 1px solid var(--border);
      border-radius: 12px; box-shadow: var(--shadow-lg);
      z-index: 50; overflow: hidden;
      display: flex; flex-direction: column;
      animation: emojiPanelIn .15s ease-out;
    }
    @keyframes emojiPanelIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .emoji-panel.hidden { display: none; }
    .emoji-tabs {
      display: flex; flex-shrink: 0;
      background: var(--bg-2); border-bottom: 1px solid var(--border-subtle);
    }
    .emoji-tab {
      flex: 1; padding: 8px 4px;
      background: none; border: none; cursor: pointer;
      font-size: 20px; line-height: 1;
      border-bottom: 2px solid transparent;
      transition: border-color var(--t-fast), background var(--t-fast);
      opacity: .65;
    }
    .emoji-tab:hover { opacity: 1; background: rgba(255,255,255,.04); }
    .emoji-tab.active { border-bottom-color: var(--brand); opacity: 1; }
    .emoji-grid {
      flex: 1; overflow-y: auto;
      display: grid; grid-template-columns: repeat(8, 1fr);
      gap: 2px; padding: 8px;
    }
    .emoji-cell {
      background: none; border: none; cursor: pointer;
      font-size: 22px; line-height: 1;
      padding: 6px; border-radius: 6px;
      transition: background var(--t-fast), transform var(--t-fast);
    }
    .emoji-cell:hover { background: var(--bg-4); transform: scale(1.15); }
    .emoji-cell:active { transform: scale(1); }

    /* Modo gravação — substitui temporariamente a input bar */
    .chat-input-bar.recording {
      gap: var(--sp-3);
    }
    .rec-status {
      flex: 1; display: flex; align-items: center; gap: 10px;
      padding: 11px 16px; background: var(--bg-2); border-radius: var(--r-md);
      color: var(--text-primary); font-size: 14px;
    }
    .rec-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: #f87171; flex-shrink: 0;
      animation: recPulse 1s ease-in-out infinite;
    }
    @keyframes recPulse {
      0%,100% { box-shadow: 0 0 0 0 rgba(248,113,113,.7); opacity: 1; }
      50%     { box-shadow: 0 0 0 6px rgba(248,113,113,0); opacity: .85; }
    }
    .rec-label { color: var(--text-secondary); font-size: 13px; }
    .rec-timer { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--text-primary); font-size: 14px; }
    .rec-cancel, .rec-stop, .audio-send {
      width: 44px; height: 44px; border-radius: 50%;
      border: none; cursor: pointer; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      transition: all var(--t-fast);
    }
    .rec-cancel { background: var(--bg-4); color: var(--text-secondary); }
    .rec-cancel:hover { background: var(--danger-bg); color: var(--danger); }
    .rec-stop { background: #f87171; color: #001f17; box-shadow: 0 4px 10px rgba(248,113,113,.25); }
    .rec-stop:hover { background: #ef4444; transform: scale(1.05); }
    .rec-cancel svg, .rec-stop svg, .audio-send svg {
      width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;
    }
    .rec-stop svg { fill: currentColor; stroke: none; }

    /* Modo preview — depois de gravar, antes de enviar */
    .chat-input-bar.preview {
      gap: var(--sp-3);
    }
    .rec-audio {
      flex: 1; height: 40px; outline: none;
    }
    .rec-audio::-webkit-media-controls-panel { background: var(--bg-2); }
    .rec-duration {
      font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums;
      padding: 0 4px; flex-shrink: 0;
    }
    .audio-send { background: var(--brand); color: #001f17; box-shadow: 0 4px 10px rgba(0,168,132,.25); }
    .audio-send:hover:not(:disabled) { background: var(--brand-light); transform: scale(1.05); }
    .audio-send:disabled { background: var(--bg-4); color: var(--text-muted); cursor: not-allowed; box-shadow: none; }

    .chat-input-disabled {
      padding: var(--sp-4); text-align: center;
      color: var(--text-muted); font-size: 13px;
      background: var(--bg-2); border-top: 1px solid var(--border);
      display: flex; align-items: center; justify-content: center; gap: var(--sp-3);
    }
    .chat-input-disabled-text { line-height: 1.5; }
    .btn-primary-small {
      background: var(--brand); color: #001f17;
      border: none; padding: 7px 16px; border-radius: var(--r-md);
      font-size: 12.5px; font-weight: 600; cursor: pointer;
      transition: all var(--t-fast);
    }
    .btn-primary-small:hover { background: var(--brand-light); transform: translateY(-1px); }

    /* Sidebar direita */
    .actives-empty {
      padding: var(--sp-8) var(--sp-5); text-align: center;
      color: var(--text-muted); font-size: 13px;
      line-height: 1.6;
    }
    .actives-empty-icon { font-size: 32px; opacity: .35; margin-bottom: var(--sp-2); }
    .active-item {
      padding: var(--sp-3) var(--sp-4); cursor: pointer;
      border-bottom: 1px solid var(--border-subtle);
      transition: background var(--t-fast);
      position: relative;
    }
    .active-item:hover { background: var(--bg-3); }
    .active-item.selected { background: var(--bg-3); }
    .active-item.selected::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--brand); }

    .active-item-name { font-size: 14px; font-weight: 600; color: var(--text-primary); letter-spacing: -.005em; }
    .active-item-meta { font-size: 11.5px; color: var(--text-muted); margin-top: 3px; font-variant-numeric: tabular-nums; }
    .active-item-consult {
      font-size: 12px; color: var(--warn);
      margin-top: 5px; display: flex; align-items: center; gap: 4px;
    }
    .active-item.is-mine .active-item-consult { color: var(--success); }

    /* Review popup */
    .review-popup {
      position: absolute; top: calc(var(--header-h) + 4px); right: var(--sp-4);
      background: var(--bg-3); border: 1px solid var(--border-strong);
      border-radius: var(--r-lg);
      padding: var(--sp-4); width: 340px;
      box-shadow: var(--shadow-lg);
      z-index: 10;
    }
    .review-popup.hidden { display: none; }
    .review-popup-title { font-size: 12px; color: var(--text-muted); margin-bottom: var(--sp-3); font-weight: 500; }
    .review-popup-actions { display: flex; gap: 6px; margin-bottom: var(--sp-3); flex-wrap: wrap; }

    .rate-btn {
      background: var(--bg-2); border: 1px solid var(--border-strong);
      color: var(--text-secondary); padding: 6px 12px;
      border-radius: var(--r-md); font-size: 13px;
      cursor: pointer; transition: all var(--t-fast);
    }
    .rate-btn:hover { border-color: var(--text-muted); }
    .rate-btn.active.good { background: var(--success-bg); border-color: var(--success); color: var(--success); }
    .rate-btn.active.bad  { background: var(--danger-bg); border-color: var(--danger); color: var(--danger); }
    .rate-btn.clear { color: var(--text-muted); font-size: 12px; }

    .review-comment {
      width: 100%; background: var(--bg-2); color: var(--text-primary);
      border: 1px solid var(--border-strong); border-radius: var(--r-md);
      padding: 10px 12px; font-size: 13px; font-family: inherit;
      resize: vertical; min-height: 70px; outline: none;
      transition: border-color var(--t-fast);
    }
    .review-comment:focus { border-color: var(--brand); }

    /* Responsivo */
    @media (max-width: 1200px) {
      .inbox-col-right { display: none; }
      .detail { display: none; }
    }
    @media (max-width: 800px) {
      .inbox-col-left { width: 100%; }
      .inbox-col-mid { display: none; }
      .inbox-layout.has-selected .inbox-col-left { display: none; }
      .inbox-layout.has-selected .inbox-col-mid  { display: flex; }
    }

    /* ─── STUDENTS / USERS / TABLES ─── */
    .student-form {
      background: var(--bg-2); border: 1px solid var(--border);
      border-radius: var(--r-lg); padding: var(--sp-4);
      margin-bottom: var(--sp-4);
      display: flex; gap: var(--sp-2); flex-wrap: wrap; align-items: center;
    }
    .student-form input, .student-form select {
      background: var(--bg-1); color: var(--text-primary);
      border: 1px solid var(--border); border-radius: var(--r-md);
      padding: 9px 12px; font-size: 13px; outline: none;
      font-family: inherit; transition: border-color var(--t-fast);
    }
    .student-form input:focus, .student-form select:focus { border-color: var(--brand); }
    .student-form input.phone { width: 180px; }
    .student-form input.name { width: 220px; }
    .student-form input.notes { flex: 1; min-width: 200px; }

    .btn-add {
      background: var(--brand); color: #001f17;
      border: none; padding: 9px 18px; border-radius: var(--r-md);
      font-size: 13px; font-weight: 600; cursor: pointer;
      transition: all var(--t-fast);
    }
    .btn-add:hover { background: var(--brand-light); transform: translateY(-1px); box-shadow: 0 4px 10px rgba(0,168,132,.3); }

    .student-help {
      font-size: 12.5px; color: var(--text-muted);
      margin-bottom: var(--sp-4); line-height: 1.6;
      background: var(--bg-2); border: 1px solid var(--border);
      border-radius: var(--r-md); padding: var(--sp-3) var(--sp-4);
      border-left: 3px solid var(--brand);
    }
    .student-help code { font-family: var(--font-mono); font-size: 12px; background: var(--bg-1); padding: 1px 6px; border-radius: 4px; color: var(--brand); }

    .student-row {
      background: var(--bg-2); border: 1px solid var(--border);
      border-radius: var(--r-md); padding: var(--sp-3) var(--sp-4);
      display: flex; gap: var(--sp-3); align-items: center;
      margin-bottom: 6px;
      transition: border-color var(--t-fast);
    }
    .student-row:hover { border-color: var(--border-strong); }
    .student-row .phone { font-family: var(--font-mono); font-size: 13px; color: var(--text-secondary); min-width: 150px; }
    .student-row .name { font-size: 14px; color: var(--text-primary); min-width: 180px; font-weight: 500; }
    .student-row .notes { font-size: 12px; color: var(--text-muted); flex: 1; }
    .student-row .btn-clear { font-size: 12px; }

    /* ════════════════════════════════════════════════
       KNOWLEDGE BASE (academia_info)
       ════════════════════════════════════════════════ */
    .kb-category {
      margin-bottom: 18px;
      background: var(--bg-2); border: 1px solid var(--border);
      border-radius: var(--r-lg); overflow: hidden;
    }
    .kb-category-title {
      padding: 10px 16px;
      background: var(--bg-3); color: var(--text-secondary);
      font: 600 12px var(--font-sans);
      text-transform: uppercase; letter-spacing: .06em;
      border-bottom: 1px solid var(--border-subtle);
    }
    .kb-item {
      display: grid; grid-template-columns: 220px 1fr;
      gap: 14px; padding: 12px 16px;
      border-bottom: 1px solid var(--border-subtle);
      align-items: start;
    }
    .kb-item:last-child { border-bottom: none; }
    .kb-label {
      font: 500 13px var(--font-sans); color: var(--text-primary);
    }
    .kb-desc {
      font-size: 11.5px; color: var(--text-muted); margin-top: 3px;
      line-height: 1.4;
    }
    .kb-input {
      width: 100%; box-sizing: border-box;
      background: var(--bg-1); color: var(--text-primary);
      border: 1px solid var(--border); border-radius: var(--r-md);
      padding: 9px 12px; font: 14px var(--font-sans);
      font-family: inherit; outline: none; resize: vertical;
      min-height: 38px; transition: border-color var(--t-fast);
    }
    .kb-input:focus { border-color: var(--brand); }
    .kb-saving { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
    .kb-saving.ok { color: var(--brand-light); }
    .kb-saving.err { color: var(--danger); }

    /* ════════════════════════════════════════════════
       MÓDULOS DO PROMPT (28 cards expansíveis)
       ════════════════════════════════════════════════ */
    .modulo-item {
      border-bottom: 1px solid var(--border-subtle);
      transition: opacity var(--t-fast);
    }
    .modulo-item:last-child { border-bottom: none; }
    .modulo-item.inactive { opacity: .5; }
    .modulo-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; cursor: pointer;
      transition: background var(--t-fast);
    }
    .modulo-head:hover { background: var(--bg-3); }
    .modulo-title { font: 600 14px var(--font-sans); color: var(--text-primary); margin-bottom: 2px; }
    .modulo-meta { font-size: 11.5px; color: var(--text-muted); font-family: var(--font-mono); }
    .modulo-chev { color: var(--text-muted); flex-shrink: 0; transition: transform var(--t-fast); }
    .modulo-body { padding: 0 16px 16px; }
    .modulo-textarea {
      width: 100%; box-sizing: border-box;
      min-height: 240px; max-height: 600px;
      background: var(--bg-1); color: var(--text-primary);
      border: 1px solid var(--border); border-radius: var(--r-md);
      padding: 12px;
      font: 13px var(--font-mono);
      resize: vertical; outline: none;
      transition: border-color var(--t-fast);
    }
    .modulo-textarea:focus { border-color: var(--brand); }
    .modulo-actions {
      display: flex; gap: 10px; align-items: center; margin-top: 10px;
    }

    /* ════════════════════════════════════════════════
       PLAYGROUND (testar agente)
       ════════════════════════════════════════════════ */
    .playground-wrap {
      display: flex; flex-direction: column;
      height: calc(100vh - 200px);
      background: var(--bg-1); border: 1px solid var(--border);
      border-radius: var(--r-lg); overflow: hidden;
    }
    .playground-thread {
      flex: 1; overflow-y: auto; padding: 18px 22px;
      background: var(--bg-0);
      display: flex; flex-direction: column; gap: 8px;
    }
    .playground-hint {
      align-self: center; padding: 32px 18px;
      color: var(--text-muted); font-size: 13px;
      text-align: center; max-width: 400px;
    }
    .pg-bubble {
      max-width: 70%; padding: 9px 12px; border-radius: 12px;
      font-size: 14px; line-height: 1.4;
      white-space: pre-wrap; overflow-wrap: anywhere;
      box-shadow: 0 1px 1.5px rgba(0,0,0,.18);
    }
    .pg-bubble.user {
      align-self: flex-end;
      background: linear-gradient(180deg, var(--bubble-out) 0%, #00513e 100%);
      color: var(--text-primary);
      border-top-right-radius: 4px;
    }
    .pg-bubble.assistant {
      align-self: flex-start;
      background: var(--bubble-in); color: var(--text-primary);
      border-top-left-radius: 4px;
    }
    .pg-bubble.thinking {
      align-self: flex-start; opacity: .6; font-style: italic;
      color: var(--text-muted);
    }
    .playground-stats {
      display: flex; gap: 14px; padding: 8px 16px;
      background: var(--bg-2); border-top: 1px solid var(--border-subtle);
      font-size: 11px; color: var(--text-muted);
      font-family: var(--font-mono);
    }
    .playground-stats span { white-space: nowrap; }
    .playground-input-bar {
      display: flex; gap: 10px; padding: 12px 16px;
      background: var(--bg-2); border-top: 1px solid var(--border);
    }
    .playground-input-bar textarea {
      flex: 1; background: var(--bg-1); color: var(--text-primary);
      border: 1px solid var(--border); border-radius: var(--r-md);
      padding: 10px 14px; font: 14px var(--font-sans);
      resize: none; outline: none; min-height: 40px; max-height: 140px;
    }
    .playground-input-bar textarea:focus { border-color: var(--brand); }

    /* Layout do playground com painel debug à direita (v2) */
    .pg-layout {
      display: grid; grid-template-columns: 1fr 280px; gap: 14px;
      height: calc(100vh - 200px);
    }
    .pg-layout .playground-wrap { height: 100%; }
    .pg-debug {
      background: var(--bg-2); border: 1px solid var(--border);
      border-radius: var(--r-lg); padding: 14px; overflow-y: auto;
    }
    .pg-debug.hidden { display: none; }
    .pg-debug + * { display: none; }
    .pg-layout:has(.pg-debug.hidden) { grid-template-columns: 1fr; }
    .pg-debug h3 {
      font: 600 12px var(--font-sans); color: var(--text-secondary);
      text-transform: uppercase; letter-spacing: .06em;
      margin: 0 0 12px;
      padding-bottom: 8px; border-bottom: 1px solid var(--border-subtle);
    }
    .pg-state-content { font-size: 12px; color: var(--text-primary); }
    .pg-state-row {
      display: flex; flex-direction: column; gap: 2px;
      padding: 8px 0; border-bottom: 1px solid var(--border-subtle);
    }
    .pg-state-row:last-child { border-bottom: none; }
    .pg-state-row .k {
      font-size: 10.5px; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: .04em; font-weight: 600;
    }
    .pg-state-row .v {
      font-size: 12.5px; color: var(--text-primary); font-weight: 500;
      font-family: var(--font-mono);
    }

    /* ════════════════════════════════════════════════
       CONEXÕES (cards de WhatsApp conectado)
       ════════════════════════════════════════════════ */
    .connection-card {
      background: var(--bg-2); border: 1px solid var(--border);
      border-radius: var(--r-lg); padding: 18px;
      margin-bottom: 14px;
      transition: border-color var(--t-fast);
    }
    .connection-card:hover { border-color: var(--border-strong); }
    .connection-card.disabled { opacity: .5; cursor: not-allowed; }
    .conn-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px; margin-bottom: 14px;
    }
    .conn-title-wrap { display: flex; gap: 14px; align-items: center; flex: 1; min-width: 0; }
    .conn-icon { font-size: 28px; line-height: 1; }
    .conn-provider { font: 600 15px var(--font-sans); color: var(--text-primary); margin-bottom: 2px; }
    .conn-status-text { font-size: 12.5px; color: var(--text-muted); line-height: 1.5; }
    .conn-status {
      padding: 4px 10px; border-radius: 999px;
      font: 600 11px var(--font-sans); white-space: nowrap; flex-shrink: 0;
    }
    .conn-status.open  { background: rgba(0,168,132,.15); color: var(--brand-light); }
    .conn-status.qr    { background: rgba(251,191,36,.15); color: var(--warn); }
    .conn-status.close { background: rgba(248,113,113,.15); color: var(--danger); }
    .conn-body {
      display: flex; flex-direction: column; gap: 8px;
      padding: 12px 0; border-top: 1px solid var(--border-subtle);
    }
    .conn-row {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 13px;
    }
    .conn-row .k { color: var(--text-muted); }
    .conn-row .v { color: var(--text-primary); font-weight: 500; }
    .conn-phone { font-family: var(--font-mono); }
    .conn-qr-wrap {
      display: flex; gap: 18px; align-items: center;
      padding: 16px 0; border-top: 1px solid var(--border-subtle);
    }
    .conn-qr {
      width: 200px; height: 200px;
      background: #fff; padding: 10px; border-radius: 10px;
      flex-shrink: 0;
    }
    .conn-instructions {
      flex: 1; padding-left: 18px; margin: 0;
      font-size: 13px; color: var(--text-secondary); line-height: 1.7;
    }
    .conn-actions { padding-top: 14px; border-top: 1px solid var(--border-subtle); }
    .btn-disconnect-conn {
      background: transparent; border: 1px solid var(--danger);
      color: var(--danger); padding: 8px 14px;
      border-radius: var(--r-md); font: 600 12.5px var(--font-sans);
      cursor: pointer; transition: all var(--t-fast);
    }
    .btn-disconnect-conn:hover { background: rgba(248,113,113,.1); }
    .conn-meta-note {
      font-size: 12.5px; color: var(--text-muted); line-height: 1.5;
    }
    .conn-meta-note code {
      background: var(--bg-3); padding: 2px 6px; border-radius: 4px;
      font-family: var(--font-mono); font-size: 12px; color: var(--brand-light);
    }
    .student-row .btn-msg-student {
      background: var(--brand-soft); color: var(--brand-light);
      border: 1px solid rgba(0,168,132,.3);
      padding: 6px 11px; border-radius: var(--r-md);
      font: 600 12px var(--font-sans); cursor: pointer;
      transition: all var(--t-fast);
    }
    .student-row .btn-msg-student:hover { background: var(--brand); color: var(--brand-on); border-color: var(--brand); }

    .btn-clear {
      background: transparent; border: 1px solid var(--border-strong);
      color: var(--text-muted); padding: 6px 12px;
      border-radius: var(--r-md); font-size: 12px;
      cursor: pointer; transition: all var(--t-fast);
    }
    .btn-clear:hover { border-color: var(--danger); color: var(--danger); background: var(--danger-bg); }

    /* Agendamentos */
    .appt-card {
      background: var(--bg-2); border: 1px solid var(--border);
      border-radius: var(--r-md); padding: var(--sp-3) var(--sp-4);
      display: grid; grid-template-columns: 32px 1fr 1.2fr auto auto;
      gap: var(--sp-4); align-items: center;
      margin-bottom: 8px; transition: border-color var(--t-fast);
    }
    .appt-card:hover { border-color: var(--border-strong); }
    .appt-icon { font-size: 22px; opacity: .85; }
    .appt-when-text { font-size: 14.5px; color: var(--text-primary); font-weight: 600; letter-spacing: -.005em; }
    .appt-modality { font-size: 12px; color: var(--brand); margin-top: 2px; text-transform: capitalize; }
    .appt-lead-name { font-size: 13.5px; color: var(--text-primary); font-weight: 500; }
    .appt-lead-phone { font-size: 12px; color: var(--text-muted); margin-top: 2px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
    .appt-date { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
    .appt-status-select {
      background: var(--bg-3); color: var(--text-secondary);
      border: 1px solid var(--border-strong);
      border-radius: var(--r-md); padding: 6px 10px;
      font-size: 12px; font-family: inherit; cursor: pointer;
      outline: none; transition: border-color var(--t-fast);
    }
    .appt-status-select:hover { border-color: var(--text-muted); }
    .appt-status-select:focus { border-color: var(--brand); }
    .appt-status-select[data-status="confirmed"] { color: var(--success); border-color: rgba(74,222,128,.25); }
    .appt-status-select[data-status="cancelled"] { color: var(--danger); border-color: rgba(248,113,113,.25); }
    .appt-status-select[data-status="no_show"] { color: var(--text-muted); }

    /* Cards de métrica */
    .metric-card {
      background: var(--bg-2); border: 1px solid var(--border);
      border-radius: var(--r-lg); padding: var(--sp-5);
      transition: all var(--t-fast);
    }
    .metric-card:hover { border-color: var(--border-strong); transform: translateY(-2px); box-shadow: var(--shadow-md); }
    .metric-card-label { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; font-weight: 500; }
    .metric-card-value { font-size: 32px; font-weight: 700; color: var(--text-primary); letter-spacing: -.02em; line-height: 1; font-variant-numeric: tabular-nums; }
    .metric-card-sub { font-size: 11.5px; color: var(--text-muted); margin-top: 6px; }

    /* Empty states */
    .empty {
      text-align: center; padding: var(--sp-10) var(--sp-5);
      color: var(--text-muted); font-size: 13px;
    }

    /* Scrollbars (global) */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

    /* Selecção de texto */
    ::selection { background: var(--brand-soft); color: var(--text-primary); }

    /* ─────────────────────────────────────────────────────────────────────
       PR #37 — Monitor v2 (admin tooling)
       ───────────────────────────────────────────────────────────────────── */
    .v2m { display: grid; grid-template-columns: 1fr 380px; gap: 16px; }
    @media (max-width: 1100px) { .v2m { grid-template-columns: 1fr; } }
    .v2m-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
    .v2m-side { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px; max-height: calc(100vh - 200px); overflow-y: auto; }

    .v2m-alerts { display: flex; flex-direction: column; gap: 8px; }
    .v2m-alert { padding: 12px 14px; border-radius: 10px; display: flex; align-items: center; gap: 10px; font-size: 13px; }
    .v2m-alert.critical { background: #4a1d1d; color: #ffd0d0; border-left: 4px solid #ff4d4d; }
    .v2m-alert.warning { background: #4a3b1d; color: #fff0c0; border-left: 4px solid #ffc54d; }
    .v2m-alert .ico { font-size: 18px; }
    .v2m-alert .body { flex: 1; }
    .v2m-alert .body strong { display: block; }
    .v2m-alert .body span { font-size: 12px; opacity: 0.85; }

    .v2m-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .v2m-filters select { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-primary); padding: 6px 10px; border-radius: 8px; font-size: 13px; }
    .v2m-filters .v2m-pill { padding: 6px 12px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); font-size: 12px; cursor: pointer; user-select: none; }
    .v2m-filters .v2m-pill.active { background: var(--brand-soft); border-color: var(--brand); color: var(--text-primary); }
    .v2m-filters .v2m-pill .ct { opacity: 0.7; margin-left: 4px; }

    .v2m-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .v2m-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
    .v2m-card .lbl { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .v2m-card .val { font-size: 22px; font-weight: 600; color: var(--text-primary); margin-top: 4px; }
    .v2m-card .sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
    .v2m-card.alert-bg { background: #4a1d1d33; border-color: #ff4d4d55; }

    .v2m-funil { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
    .v2m-funil h4 { margin: 0 0 10px 0; font-size: 13px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .v2m-funil-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; font-size: 13px; }
    .v2m-funil-row .name { width: 180px; color: var(--text-primary); }
    .v2m-funil-row .bar { flex: 1; height: 18px; background: var(--surface-2); border-radius: 4px; position: relative; overflow: hidden; }
    .v2m-funil-row .bar > div { height: 100%; background: var(--brand); border-radius: 4px; transition: width 0.3s; }
    .v2m-funil-row .ct { width: 40px; text-align: right; color: var(--text-muted); }

    .v2m-list { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; max-height: 60vh; overflow-y: auto; }
    .v2m-conv { padding: 12px 14px; border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.1s; }
    .v2m-conv:hover { background: var(--surface-2); }
    .v2m-conv.selected { background: var(--brand-soft); border-left: 3px solid var(--brand); }
    .v2m-conv .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 8px; }
    .v2m-conv .top .ph { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; color: var(--text-muted); }
    .v2m-conv .top .badges { display: flex; gap: 4px; align-items: center; }
    .v2m-conv .badge { padding: 2px 7px; border-radius: 999px; font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.3px; }
    .v2m-conv .badge.b-em_andamento { background: #2d4f7a; color: #b8d8ff; }
    .v2m-conv .badge.b-agendou { background: #1d4d2d; color: #c0ffc0; }
    .v2m-conv .badge.b-handoff { background: #4d3d1d; color: #ffe0a0; }
    .v2m-conv .badge.b-perdeu { background: #3d3d3d; color: #aaa; }
    .v2m-conv .stage { font-size: 11px; color: var(--text-muted); }
    .v2m-conv .preview { font-size: 12px; color: var(--text-primary); margin-top: 4px; line-height: 1.3; max-height: 32px; overflow: hidden; text-overflow: ellipsis; }
    .v2m-conv .modules { font-size: 10px; color: var(--brand-light); margin-top: 4px; font-family: 'SF Mono', Menlo, monospace; }
    .v2m-conv .review-mark { font-size: 14px; }

    .v2m-detail h3 { margin: 0 0 8px 0; font-size: 14px; }
    .v2m-detail .field { margin-bottom: 10px; }
    .v2m-detail .field .k { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .v2m-detail .field .v { font-size: 13px; color: var(--text-primary); margin-top: 2px; word-break: break-word; }
    .v2m-detail .review-buttons { display: flex; gap: 6px; margin: 10px 0; }
    .v2m-detail .review-buttons button { flex: 1; padding: 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-primary); cursor: pointer; font-size: 13px; transition: all 0.1s; }
    .v2m-detail .review-buttons button:hover { background: var(--surface); }
    .v2m-detail .review-buttons button.r-good { border-color: #1d4d2d; }
    .v2m-detail .review-buttons button.r-good.active { background: #1d4d2d; color: #c0ffc0; }
    .v2m-detail .review-buttons button.r-aceitavel { border-color: #4d3d1d; }
    .v2m-detail .review-buttons button.r-aceitavel.active { background: #4d3d1d; color: #ffe0a0; }
    .v2m-detail .review-buttons button.r-bad { border-color: #4a1d1d; }
    .v2m-detail .review-buttons button.r-bad.active { background: #4a1d1d; color: #ffd0d0; }
    .v2m-detail textarea { width: 100%; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-primary); border-radius: 8px; padding: 8px; font-size: 13px; resize: vertical; min-height: 60px; box-sizing: border-box; }
    .v2m-detail .actions { display: flex; gap: 6px; margin-top: 8px; }
    .v2m-detail .actions button { padding: 6px 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-primary); cursor: pointer; }
    .v2m-detail .actions button:hover { background: var(--surface); }
    .v2m-detail .msgs { margin-top: 12px; max-height: 320px; overflow-y: auto; }
    .v2m-detail .msg { padding: 6px 8px; margin-bottom: 4px; border-radius: 6px; font-size: 12px; }
    .v2m-detail .msg.user { background: var(--surface-2); }
    .v2m-detail .msg.assistant { background: var(--brand-soft); }
    .v2m-detail .msg .who { font-size: 10px; color: var(--text-muted); text-transform: uppercase; }

    .v2m-controls { display: flex; flex-direction: column; gap: 12px; padding: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
    .v2m-controls .ctl-row { display: flex; gap: 10px; align-items: center; }
    .v2m-pause-btn { background: #ff4d4d; color: white; border: none; padding: 12px 18px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .v2m-pause-btn:hover { background: #ff6b6b; }
    .v2m-pause-btn:disabled { background: #444; cursor: not-allowed; }
    .v2m-resume-btn { background: var(--brand); color: white; border: none; padding: 8px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; }

    .v2m-tour-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 9000; display: flex; align-items: center; justify-content: center; }
    .v2m-tour-card { background: var(--surface); border: 1px solid var(--border-strong); border-radius: 12px; padding: 22px; max-width: 460px; box-shadow: 0 16px 48px rgba(0,0,0,0.5); }
    .v2m-tour-card h3 { margin: 0 0 8px 0; }
    .v2m-tour-card p { font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
    .v2m-tour-card .actions { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
    .v2m-tour-card .step { font-size: 11px; color: var(--text-muted); }
    .v2m-tour-card button { background: var(--brand); color: white; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; }
    .v2m-tour-card .skip { background: transparent; color: var(--text-muted); }

    /* ════════════════════════════════════════════════
       POLISH PR — Optimistic UI, Reply, Quick Replies, Notes, Skeleton, Empty
       ════════════════════════════════════════════════ */

    /* Optimistic UI — bubble pendente / falha */
    .bubble.pending { opacity: .62; }
    .bubble.failed-send {
      background: linear-gradient(180deg, #6b2222 0%, #5a1818 100%) !important;
    }
    .bubble.failed-send::before {
      border-color: transparent transparent transparent #6b2222 !important;
    }
    .bubble.failed-send .retry-send {
      display: inline-block;
      background: rgba(255,255,255,.18); color: #fff;
      border: none; border-radius: 4px;
      padding: 2px 8px; font-size: 11px; font-weight: 600;
      margin-left: 6px; cursor: pointer;
    }
    .bubble.failed-send .retry-send:hover { background: rgba(255,255,255,.28); }
    .msg-check.pending {
      color: rgba(255,255,255,.5);
      animation: ckPulse 1.4s ease-in-out infinite;
    }
    @keyframes ckPulse {
      0%, 100% { opacity: .5; }
      50% { opacity: 1; }
    }

    /* Reply / quote — botão hover na bubble + preview na composer + render do quote */
    .bubble-action-reply {
      position: absolute; top: 4px;
      background: rgba(0,0,0,.45); color: #fff;
      border: none; border-radius: 50%;
      width: 22px; height: 22px;
      font-size: 12px; cursor: pointer;
      opacity: 0; transition: opacity .15s ease;
      display: flex; align-items: center; justify-content: center;
      z-index: 2;
    }
    .bubble-row.in .bubble-action-reply { right: -28px; }
    .bubble-row.out .bubble-action-reply { left: -28px; }
    .bubble-row:hover .bubble-action-reply { opacity: 1; }
    .bubble-action-reply:hover { background: rgba(0,0,0,.7); }

    .bubble-quote {
      display: block;
      border-left: 3px solid rgba(255,255,255,.5);
      padding: 4px 8px;
      background: rgba(255,255,255,.08);
      font-size: 12.5px;
      color: rgba(255,255,255,.78);
      margin-bottom: 6px;
      border-radius: 4px;
      white-space: pre-wrap;
      overflow: hidden;
      max-height: 4.4em;
    }
    .bubble.in .bubble-quote {
      border-left-color: rgba(0,0,0,.28);
      background: rgba(0,0,0,.07);
      color: rgba(0,0,0,.62);
    }

    .composer-reply-preview {
      display: flex; align-items: stretch; gap: 8px;
      padding: 8px 12px;
      background: var(--bg-3);
      border-left: 3px solid var(--brand);
      border-radius: 6px 6px 0 0;
      animation: crpSlideDown .18s ease;
    }
    @keyframes crpSlideDown {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .composer-reply-preview .crp-body { flex: 1; min-width: 0; overflow: hidden; }
    .composer-reply-preview .crp-label {
      font-size: 11px; font-weight: 600;
      color: var(--brand); margin-bottom: 2px;
    }
    .composer-reply-preview .crp-text {
      font-size: 12.5px; color: var(--text-secondary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .composer-reply-preview .crp-close {
      background: transparent; border: none;
      color: var(--text-muted); cursor: pointer;
      font-size: 18px; line-height: 1;
      padding: 0 6px; border-radius: 4px;
    }
    .composer-reply-preview .crp-close:hover {
      color: var(--text-primary); background: rgba(255,255,255,.08);
    }

    /* Quick replies — dropdown acima do composer */
    .chat-input-bar { position: relative; }
    .quick-reply-dropdown {
      position: absolute;
      bottom: calc(100% + 4px);
      left: 0; right: 0;
      background: var(--bg-2);
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      box-shadow: 0 -8px 24px rgba(0,0,0,.4);
      max-height: 240px;
      overflow-y: auto;
      z-index: 50;
    }
    .quick-reply-dropdown.hidden { display: none; }
    .quick-reply-item {
      padding: 8px 12px; cursor: pointer;
      display: flex; flex-direction: column; gap: 2px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .quick-reply-item:last-child { border-bottom: none; }
    .quick-reply-item.active { background: var(--brand-soft); }
    .quick-reply-item:hover { background: var(--bg-3); }
    .quick-reply-item .qr-trigger {
      font-size: 12px; font-weight: 600; color: var(--brand);
      font-family: ui-monospace, 'SF Mono', monospace;
    }
    .quick-reply-item .qr-text {
      font-size: 13px; color: var(--text-secondary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .quick-reply-empty {
      padding: 16px 12px; text-align: center;
      font-size: 12px; color: var(--text-muted);
    }

    /* Quick replies — gerenciamento (tab Configurações) */
    .qr-mgmt-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
    .qr-mgmt-item {
      display: flex; gap: 10px; align-items: center;
      padding: 10px 12px;
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .qr-mgmt-item input.qr-trigger-input {
      width: 110px; font-family: ui-monospace, 'SF Mono', monospace;
      background: var(--bg-3); border: 1px solid var(--border);
      border-radius: 6px; padding: 6px 10px;
      color: var(--brand); font-size: 13px; font-weight: 600;
    }
    .qr-mgmt-item input.qr-text-input {
      flex: 1; min-width: 0;
      background: var(--bg-3); border: 1px solid var(--border);
      border-radius: 6px; padding: 6px 10px;
      color: var(--text-primary); font-size: 13px;
    }
    .qr-mgmt-item button.qr-del {
      background: transparent; color: var(--text-muted);
      border: none; cursor: pointer; padding: 4px 8px;
      font-size: 16px; border-radius: 4px;
    }
    .qr-mgmt-item button.qr-del:hover {
      color: var(--danger); background: rgba(248,113,113,.1);
    }
    .qr-mgmt-add {
      margin-top: 10px; padding: 8px 14px;
      background: var(--brand); color: #001f17;
      border: none; border-radius: 6px;
      font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .qr-mgmt-add:hover { filter: brightness(1.1); }

    /* Notas internas — toggle no composer (ícone cinza, ativo vira amber sutil) */
    /* Estilo base de tamanho/layout vem de .chat-emoji, .chat-note-toggle (compartilhado) */
    .chat-note-toggle.active {
      color: #f9c869;
      background: rgba(243, 156, 18, .14);
    }
    .chat-input-pill.note-mode {
      background: rgba(243, 156, 18, .08);
      border-color: rgba(243, 156, 18, .42);
    }
    .chat-input-pill.note-mode .chat-input::placeholder {
      color: rgba(249, 200, 105, .55);
    }
    /* Bubble nota interna — formato out (lado direito + tail), cor amber pra distinguir */
    .bubble-row.note { justify-content: flex-end; }
    .bubble-row.note .bubble-action-reply { display: none; }
    .bubble.note {
      background: linear-gradient(180deg, #3a2f1a 0%, #2f2614 100%);
      max-width: 65%;
      border-top-right-radius: 4px;
      box-shadow: 0 1px 1.5px rgba(0,0,0,.25);
    }
    .bubble.note::before {
      content: ''; position: absolute;
      top: 0; right: -7px; width: 0; height: 0;
      border-style: solid;
      border-width: 0 0 10px 7px;
      border-color: transparent transparent transparent #3a2f1a;
      filter: drop-shadow(1px 1px 0 rgba(0,0,0,.05));
    }
    .bubble.note:hover { box-shadow: 0 2px 6px rgba(0,0,0,.35); }
    .bubble.note .note-header {
      font-size: 11px; font-weight: 700;
      color: #f9c869;
      letter-spacing: .03em;
      margin-bottom: 4px;
      text-transform: uppercase;
    }
    .bubble.note .note-body {
      color: #e8d5b0; font-size: 13.5px;
      line-height: 1.45;
    }
    .bubble.note .bubble-meta {
      color: rgba(249, 200, 105, .55);
    }
    .bubble.note .note-delete {
      background: transparent; border: none;
      color: rgba(249, 200, 105, .55);
      font-size: 14px; cursor: pointer;
      padding: 0 4px;
      margin-left: 4px;
      border-radius: 3px;
      opacity: 0;
      transition: opacity .15s ease;
    }
    .bubble.note:hover .note-delete { opacity: 1; }
    .bubble.note .note-delete:hover {
      color: var(--danger);
      background: rgba(248, 113, 113, .1);
    }
    .bubble.note.pending { opacity: .62; }
    .bubble.note.failed-send {
      background: linear-gradient(180deg, #6b2222 0%, #5a1818 100%) !important;
    }
    .bubble.note.failed-send::before {
      border-color: transparent transparent transparent #6b2222 !important;
    }

    /* Aba Agente — config v2 (núcleo + timing + buffer) */
    .agente-section {
      margin-top: 18px;
      padding: 16px 18px;
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .agente-section-title {
      font-size: 14px; font-weight: 600;
      color: var(--text-primary);
      margin: 0 0 12px;
      display: flex; align-items: center; gap: 8px;
    }
    .agente-config-row {
      display: flex; gap: 16px;
      align-items: flex-start;
      padding: 10px 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .agente-config-row:last-child { border-bottom: none; }
    .agente-config-label {
      flex: 1; min-width: 0;
      font-size: 13px; color: var(--text-secondary);
      display: flex; flex-direction: column; gap: 3px;
    }
    .agente-config-hint {
      font-size: 11.5px; color: var(--text-muted);
      font-style: italic;
    }
    .agente-config-input {
      display: flex; align-items: center; gap: 8px;
      flex-shrink: 0;
    }
    .agente-config-input input[type="number"] {
      width: 80px; padding: 7px 10px;
      background: var(--bg-3); border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 14px; font-weight: 600;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .agente-config-input input[type="number"]:focus {
      border-color: var(--brand); outline: none;
    }
    .agente-config-suffix {
      font-size: 12px; color: var(--text-muted);
      min-width: 60px;
    }
    .agente-restore {
      background: transparent; border: 1px solid var(--border);
      color: var(--text-muted);
      width: 28px; height: 28px;
      border-radius: 50%; cursor: pointer;
      font-size: 14px;
      transition: all var(--t-fast);
    }
    .agente-restore:hover {
      color: var(--brand);
      border-color: var(--brand);
      background: var(--brand-soft);
    }
    /* Estilos do textarea/botões do núcleo removidos junto com a section. */

    /* Persona — voz e tom da marca (aba Agente) */
    .persona-row { display: block; padding: 10px 0; border-bottom: 1px solid var(--border-subtle); }
    .persona-row:last-child { border-bottom: none; }
    .persona-row .persona-label {
      font-size: 13px; color: var(--text-secondary); font-weight: 600;
      display: block; margin-bottom: 4px;
    }
    .persona-row .persona-hint {
      font-size: 11.5px; color: var(--text-muted); font-style: italic;
      display: block; margin-bottom: 8px;
    }
    .persona-row input[type="text"], .persona-row textarea {
      width: 100%; padding: 8px 10px;
      background: var(--bg-3); border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 13px; font-family: inherit;
      box-sizing: border-box;
    }
    .persona-row textarea { min-height: 90px; resize: vertical; line-height: 1.45; }
    .persona-row input[type="text"]:focus, .persona-row textarea:focus {
      border-color: var(--brand); outline: none;
    }
    .persona-actions {
      margin-top: 10px;
      display: flex; align-items: center; gap: 10px;
      font-size: 12px; color: var(--text-muted);
    }
    .persona-actions .persona-status {
      font-size: 12px; color: var(--text-muted);
    }
    .persona-actions .persona-status.custom { color: var(--brand); font-weight: 600; }
    .persona-actions .persona-restore-btn {
      background: transparent; border: 1px solid var(--border);
      color: var(--text-muted); padding: 5px 10px;
      border-radius: 6px; cursor: pointer;
      font-size: 12px;
    }
    .persona-actions .persona-restore-btn:hover {
      color: var(--brand); border-color: var(--brand); background: var(--brand-soft);
    }
    .persona-warn {
      margin-top: 10px;
      padding: 10px 12px;
      background: rgba(249, 200, 105, .08);
      border: 1px solid rgba(249, 200, 105, .25);
      border-radius: 6px;
      font-size: 12px; color: var(--text-secondary);
      line-height: 1.5;
    }
    .persona-warn strong { color: #f9c869; }
    .persona-warn code {
      background: rgba(0,0,0,.25); padding: 1px 5px; border-radius: 3px;
      font-size: 11.5px;
    }

    /* Skeleton loaders — substituem "Carregando..." textuais */
    .skeleton-list {
      padding: 8px;
      display: flex; flex-direction: column; gap: 8px;
    }
    .skeleton-card {
      height: 64px;
      border-radius: 8px;
      background: linear-gradient(90deg,
        var(--bg-2) 0%,
        var(--bg-3) 50%,
        var(--bg-2) 100%);
      background-size: 200% 100%;
      animation: skShimmer 1.4s ease-in-out infinite;
    }
    .skeleton-card.compact { height: 44px; }
    .skeleton-card.tall { height: 80px; }
    @keyframes skShimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* Empty state — versão melhor com microcopy + ação opcional */
    .empty-state {
      text-align: center;
      padding: 36px 20px;
      color: var(--text-muted);
      font-size: 13px;
    }
    .empty-state .es-icon {
      font-size: 32px; opacity: .35;
      margin-bottom: 8px;
    }
    .empty-state .es-title {
      font-size: 14px; font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }
    .empty-state .es-sub {
      font-size: 12.5px; color: var(--text-muted);
      max-width: 280px; margin: 0 auto 12px;
      line-height: 1.5;
    }
    .empty-state button {
      background: transparent; color: var(--brand);
      border: 1px solid var(--brand);
      border-radius: 6px;
      padding: 6px 14px;
      font-size: 12.5px; font-weight: 500;
      cursor: pointer;
      transition: all .15s ease;
    }
    .empty-state button:hover {
      background: var(--brand-soft);
    }
  </style>
</head>
<body>

<div class="app" id="app">

  <!-- ════════ Rail esquerdo ════════ -->
  <aside class="rail" id="rail">
    <div class="rail-brand">
      <div class="mark">S</div>
      <div class="word">STRONIX <span class="accent">SDR</span></div>
    </div>

    <nav>
      <div class="nav-item" data-nav="conversas" onclick="switchTab('conversas', this)" title="Conversas">
        <span class="ic"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
        <span class="lbl">Conversas</span>
        <span class="nav-badge" id="nav-badge-conv">0</span>
      </div>

      <div class="nav-item" data-nav="agendamentos" onclick="switchTab('agendamentos', this)" title="Agendamentos">
        <span class="ic"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
        <span class="lbl">Agendamentos</span>
        <span class="nav-badge" id="nav-badge-appt">0</span>
      </div>

      <div class="nav-item" data-nav="leads" onclick="switchTab('leads', this)" title="Leads cadastrados">
        <span class="ic"><svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg></span>
        <span class="lbl">Leads</span>
        <span class="nav-badge" id="nav-badge-leads">0</span>
      </div>

      <div class="nav-item" data-nav="alunos" onclick="switchTab('alunos', this)" title="Alunos">
        <span class="ic"><svg viewBox="0 0 24 24"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg></span>
        <span class="lbl">Alunos</span>
        <span class="nav-badge" id="nav-badge-students">0</span>
      </div>

      <div class="nav-item admin-only" data-nav="metrics" onclick="switchTab('metrics', this)" title="Métricas" style="display:none">
        <span class="ic"><svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-6"/></svg></span>
        <span class="lbl">Métricas</span>
      </div>

      <div class="nav-item admin-only" data-nav="v2-monitor" onclick="switchTab('v2-monitor', this)" title="Monitoramento v2" style="display:none">
        <span class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></span>
        <span class="lbl">Monitor v2</span>
        <span class="nav-badge" id="nav-badge-v2-alerts" style="background:var(--danger);display:none">0</span>
      </div>

      <div style="height:14px"></div>

      <div class="nav-group" id="cfg-group">
        <div class="nav-item" onclick="document.getElementById('cfg-group').classList.toggle('open')" title="Configurações">
          <span class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
          <span class="lbl">Configurações</span>
          <svg class="chev" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
        </div>
        <div class="submenu">
          <div class="sub-item admin-only" data-nav="agente" onclick="event.stopPropagation();switchTab('agente', this)" style="display:none">
            <span class="si"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/><circle cx="12" cy="6" r="1"/></svg></span>
            <span>Agente</span>
          </div>
          <div class="sub-item" data-nav="prompt" onclick="event.stopPropagation();switchTab('prompt', this)">
            <span class="si"><svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 16h.01M16 16h.01"/></svg></span>
            <span>Prompt do agente <span style="font-size:10px;opacity:.6">(v1 fallback)</span></span>
          </div>
          <div class="sub-item" data-nav="conhecimento" onclick="event.stopPropagation();switchTab('conhecimento', this)">
            <span class="si"><svg viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></span>
            <span>Conhecimento</span>
          </div>
          <div class="sub-item admin-only" data-nav="modulos" onclick="event.stopPropagation();switchTab('modulos', this)" style="display:none">
            <span class="si"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></span>
            <span>Módulos do prompt</span>
          </div>
          <div class="sub-item" data-nav="playground" onclick="event.stopPropagation();switchTab('playground', this)">
            <span class="si"><svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>
            <span>Testar agente</span>
          </div>
          <div class="sub-item" data-nav="atalhos" onclick="event.stopPropagation();switchTab('atalhos', this)">
            <span class="si"><svg viewBox="0 0 24 24"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg></span>
            <span>Atalhos rápidos</span>
          </div>
          <div class="sub-item admin-only" data-nav="users" onclick="event.stopPropagation();switchTab('users', this)" style="display:none">
            <span class="si"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
            <span>Usuários &amp; permissões</span>
          </div>
          <div class="sub-item admin-only" data-nav="conexoes" onclick="event.stopPropagation();switchTab('conexoes', this)" style="display:none">
            <span class="si"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg></span>
            <span>Conexões WhatsApp</span>
          </div>
        </div>
      </div>
    </nav>

    <div class="rail-foot">
      <div class="user-pill" title="Sua conta">
        <div class="av" id="rail-avatar">··</div>
        <div class="who">
          <div class="nm" id="rail-username">—</div>
          <div class="role" id="rail-userrole">—</div>
        </div>
        <button class="pill-act" onclick="logout()" title="Sair">
          <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>
    </div>
  </aside>

  <!-- ════════ Conteúdo ════════ -->
  <div class="content">

    <!-- Tabs legacy (escondidas, só mantidas pra compat com JS antigo) -->
    <div class="tabs" aria-hidden="true">
      <div class="tab active" onclick="switchTab('prompt')">Prompt</div>
      <div class="tab" onclick="switchTab('conversas')">Conversas</div>
      <div class="tab" onclick="switchTab('agendamentos')">Agendamentos</div>
      <div class="tab" onclick="switchTab('alunos')">Alunos</div>
      <div class="tab admin-only" onclick="switchTab('users')">Usuários</div>
      <div class="tab admin-only" onclick="switchTab('metrics')">Métricas</div>
    </div>

<div id="tab-agente" class="panel">
  <div class="conv-header">
    <h2>🤖 Agente v2 — configurações</h2>
    <button class="refresh-btn" onclick="loadAgentConfig()">↻ Atualizar</button>
  </div>
  <div class="student-help">
    Configurações de comportamento do agente v2. Mudanças aplicam <strong>na próxima resposta</strong> da IA, sem redeploy.<br>
    <strong>Tempo de digitação</strong> = quanto a IA "leva pra digitar" antes de mandar a resposta (simula humano em vez de bot que responde instantâneo).<br>
    <strong>Janela de buffer</strong> = quanto tempo aguarda o lead parar de digitar antes de processar batch de mensagens.<br>
    Pra editar <strong>conteúdo do que a IA fala</strong> (regras, objeções, knowledge base): vai em <strong>Módulos do prompt</strong> e <strong>Conhecimento</strong>.
  </div>

  <!-- Section: timing -->
  <div class="agente-section">
    <h3 class="agente-section-title">⏱️ Tempo de resposta</h3>
    <div class="agente-config-row">
      <div class="agente-config-label">
        Delay mínimo (resposta curta)
        <span class="agente-config-hint">Quanto tempo a IA "demora" pra responder mensagens curtas</span>
      </div>
      <div class="agente-config-input">
        <input type="number" id="ac-typing-min" min="0" max="600" step="1" oninput="onAgenteConfigChange('typing_delay_min_ms', this, 1000)">
        <span class="agente-config-suffix">segundos</span>
        <button class="agente-restore" onclick="restoreAgenteConfig('typing_delay_min_ms')" title="Restaurar default (60s)">↺</button>
      </div>
    </div>
    <div class="agente-config-row">
      <div class="agente-config-label">
        Delay máximo (resposta longa, 300+ chars)
        <span class="agente-config-hint">Resposta longa demora mais — proporcional ao tamanho</span>
      </div>
      <div class="agente-config-input">
        <input type="number" id="ac-typing-max" min="0" max="600" step="1" oninput="onAgenteConfigChange('typing_delay_max_ms', this, 1000)">
        <span class="agente-config-suffix">segundos</span>
        <button class="agente-restore" onclick="restoreAgenteConfig('typing_delay_max_ms')" title="Restaurar default (180s)">↺</button>
      </div>
    </div>
  </div>

  <!-- Section: buffer -->
  <div class="agente-section">
    <h3 class="agente-section-title">📥 Janela de buffer (debounce)</h3>
    <div class="agente-config-row">
      <div class="agente-config-label">
        Tempo de espera antes de processar batch
        <span class="agente-config-hint">Lead manda "oi" → "tem aula?" → "qual valor?" em poucos segundos. Buffer agrupa antes de chamar a IA. 5-30s é razoável.</span>
      </div>
      <div class="agente-config-input">
        <input type="number" id="ac-buffer" min="1" max="120" step="1" oninput="onAgenteConfigChange('buffer_window_ms', this, 1000)">
        <span class="agente-config-suffix">segundos</span>
        <button class="agente-restore" onclick="restoreAgenteConfig('buffer_window_ms')" title="Restaurar default (15s)">↺</button>
      </div>
    </div>
  </div>

  <!-- Section: persona (identidade e tom da marca) -->
  <div class="agente-section">
    <h3 class="agente-section-title">🎭 Identidade e tom da marca <span id="persona-status-pill" class="persona-status">(Default)</span></h3>
    <div class="student-help" style="margin:0 0 14px">
      Aqui ajusta <strong>quem é o agente e como ele fala</strong>: nome, nome do negócio, jeito, abertura, gírias. Mudança aplica na próxima resposta da IA.
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-nome-agente">Nome do agente</label>
      <span class="persona-hint">Como ele se apresenta. Aparece em "Sou o {nome} da {negócio}".</span>
      <input type="text" id="ac-persona-nome-agente" maxlength="60" oninput="onPersonaChange()" placeholder="Ex.: Johnny">
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-nome-negocio">Nome do negócio</label>
      <span class="persona-hint">Como o lugar é chamado. Aparece em vários pontos do prompt.</span>
      <input type="text" id="ac-persona-nome-negocio" maxlength="60" oninput="onPersonaChange()" placeholder="Ex.: STRONIX">
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-descricao-jeito">Jeito do agente (1-3 frases)</label>
      <span class="persona-hint">Descreve o tom e a personalidade. Ex.: caloroso, próximo, abre conversa com energia, conhece todo mundo pelo nome.</span>
      <textarea id="ac-persona-descricao-jeito" maxlength="800" oninput="onPersonaChange()" placeholder="Ex.: caloroso, próximo, jeito amigo. Conhece todo mundo pelo nome. Recebe lead com energia, sem papo de vendedor."></textarea>
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-abertura">Abertura padrão (1ª mensagem)</label>
      <span class="persona-hint">Frase exata que a IA usa pra começar com lead novo. Mantém curto, 1 linha.</span>
      <input type="text" id="ac-persona-abertura" maxlength="200" oninput="onPersonaChange()" placeholder="Ex.: Opa beleza! Sou o Johnny da STRONIX 👋">
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-girias-quentes">Gírias e expressões quentes (uma por linha)</label>
      <span class="persona-hint">Substitutos pras frases performáticas — a IA usa essas em vez de "Excelente!"/"Com certeza!".</span>
      <textarea id="ac-persona-girias-quentes" oninput="onPersonaChange()" placeholder="Bah&#10;Tri&#10;Beleza&#10;Show"></textarea>
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-girias-proibidas">Frases proibidas (uma por linha)</label>
      <span class="persona-hint">A IA NUNCA escreve essas. Use pra cortar clichê de vendedor que não soa Stronix.</span>
      <textarea id="ac-persona-girias-proibidas" oninput="onPersonaChange()" placeholder="Excelente!&#10;Com certeza!&#10;Fico feliz em ajudar"></textarea>
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-frases-extra">Frases proibidas extras da marca (uma por linha)</label>
      <span class="persona-hint">Lista que tu vai engordando quando ouvir algo que não soa Stronix. Opcional, pode deixar vazio.</span>
      <textarea id="ac-persona-frases-extra" oninput="onPersonaChange()" placeholder="(opcional)"></textarea>
    </div>

    <div class="persona-warn">
      <strong>⚠️ O que NÃO escrever aqui:</strong> esses campos são de <strong>identidade e tom</strong>, não de <strong>regra ou roteiro</strong>. Regras de venda, scripts e conhecimento factual ficam em outros lugares.
      <br><br>
      <strong>❌ Não escreve:</strong> <code>"Sempre passa o valor do plano logo no início"</code> — isso é regra de venda, vai em <strong>Configurações → Módulos do prompt → planos_e_precos</strong>.
      <br>
      <strong>❌ Não escreve:</strong> <code>"Se o lead pedir aula, oferece terça às 9h"</code> — isso é roteiro, fica no módulo <strong>fluxo_aula_experimental</strong>.
      <br>
      <strong>❌ Não escreve:</strong> <code>"Nosso plano custa R$199"</code> — isso é conhecimento factual, vai em <strong>Configurações → Conhecimento</strong>.
    </div>

    <div class="persona-actions">
      <button class="persona-restore-btn" type="button" onclick="restorePersona()">↺ Restaurar default</button>
      <button class="persona-restore-btn" id="persona-revert-btn" type="button" onclick="revertPersona()" style="display:none">↶ Voltar para versão anterior</button>
      <span id="persona-save-status" class="persona-status"></span>
    </div>
  </div>

  <!-- Section: perguntas do roteiro (binárias) -->
  <div class="agente-section">
    <h3 class="agente-section-title">💬 Perguntas do roteiro</h3>
    <div class="student-help" style="margin:0 0 14px">
      Aqui ajusta <strong>como cada pergunta do roteiro é feita</strong>. A estrutura (qual pergunta vem em cada estágio) NÃO muda — só o jeito de abordar.
      <br><br>
      <strong>⚠️ Regra de ouro:</strong> mantém formato <strong>binário (A ou B)</strong>. Pergunta aberta tipo "qual seu objetivo?" quebra a qualificação porque o lead diverge.
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-binaria-treinando">1. Qualificação inicial — está treinando?</label>
      <span class="persona-hint">Primeira binária, logo após a saudação. Default: "Tu tá treinando ou parado?"</span>
      <input type="text" id="ac-persona-binaria-treinando" maxlength="200" oninput="onPersonaChange()" placeholder="Ex.: Tu tá treinando ou parado?">
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-binaria-objetivo">2. Qualificação do objetivo</label>
      <span class="persona-hint">Default: "Mais resultado físico ou mais qualidade de vida no dia a dia?"</span>
      <input type="text" id="ac-persona-binaria-objetivo" maxlength="200" oninput="onPersonaChange()" placeholder="Ex.: Mais resultado físico ou mais qualidade de vida no dia a dia?">
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-binaria-objetivo-drill">2.1 Drill se "resultado físico"</label>
      <span class="persona-hint">Default: "ganhar massa ou emagrecer?"</span>
      <input type="text" id="ac-persona-binaria-objetivo-drill" maxlength="200" oninput="onPersonaChange()" placeholder="Ex.: ganhar massa ou emagrecer?">
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-binaria-nome">3. Captura de nome</label>
      <span class="persona-hint">Não é binária — pergunta aberta de informação. Default: "A propósito, como é teu nome?"</span>
      <input type="text" id="ac-persona-binaria-nome" maxlength="200" oninput="onPersonaChange()" placeholder="Ex.: A propósito, como é teu nome?">
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-binaria-turno">4. Disponibilidade — turno</label>
      <span class="persona-hint">Default: "manhã ou final do dia?"</span>
      <input type="text" id="ac-persona-binaria-turno" maxlength="200" oninput="onPersonaChange()" placeholder="Ex.: manhã ou final do dia?">
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-binaria-dia">5. Proposta de visita — dia</label>
      <span class="persona-hint">Default: "Posso te encaixar terça ou quarta, qual rola pra ti?"</span>
      <input type="text" id="ac-persona-binaria-dia" maxlength="200" oninput="onPersonaChange()" placeholder="Ex.: Posso te encaixar terça ou quarta, qual rola pra ti?">
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-binaria-hora">6. Drill de hora</label>
      <span class="persona-hint">Default: "Tem 9h ou 10h, qual prefere?"</span>
      <input type="text" id="ac-persona-binaria-hora" maxlength="200" oninput="onPersonaChange()" placeholder="Ex.: Tem 9h ou 10h, qual prefere?">
    </div>

    <h3 class="agente-section-title" style="margin-top:24px;font-size:13px;border-top:1px solid var(--border-subtle);padding-top:18px">🔁 Defletores quando lead pede valor</h3>
    <div class="student-help" style="margin:0 0 14px;font-size:12px">
      Quando o lead pede preço, a IA <strong>defletir 2x</strong> antes de passar valor (passa só na 3ª insistência — essa lógica é fixa). Aqui customiza o JEITO de defletir.
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-defletor-1">1ª insistência (defletor brando)</label>
      <span class="persona-hint">Vem antes da pergunta da fase atual. Default: "Claro, já chegamos lá. Mas antes me conta..."</span>
      <input type="text" id="ac-persona-defletor-1" maxlength="200" oninput="onPersonaChange()" placeholder="Ex.: Claro, já chegamos lá. Mas antes me conta...">
    </div>

    <div class="persona-row">
      <label class="persona-label" for="ac-persona-defletor-2">2ª insistência (defletor + drill)</label>
      <span class="persona-hint">Vem antes do drill da fase atual. Default: "Bem rapidinho antes..."</span>
      <input type="text" id="ac-persona-defletor-2" maxlength="200" oninput="onPersonaChange()" placeholder="Ex.: Bem rapidinho antes...">
    </div>
  </div>

  <!-- Aviso: pra editar o conteúdo do prompt, vai em Módulos do prompt -->
  <div class="agente-section">
    <h3 class="agente-section-title">📚 Editar conteúdo do agente</h3>
    <div class="student-help" style="margin:0">
      O <strong>conteúdo do agente</strong> (regras de venda, knowledge base, objeções, situações) é editado em <strong>Configurações → Módulos do prompt</strong> (28 módulos sob demanda) e <strong>Configurações → Conhecimento</strong> (preços, horários, modalidades). Esse é o jeito oficial de personalizar o que o agente fala.
    </div>
  </div>
</div>

<div id="tab-prompt" class="panel active">
  <div class="prompt-header">
    <h2>Instruções do agente — edite e salve sem reiniciar o servidor</h2>
    <span class="prompt-meta" id="char-count"></span>
  </div>

  <div class="sections" id="sections"></div>

  <textarea id="prompt-text" spellcheck="false" oninput="onPromptChange()"></textarea>

  <div class="actions">
    <button class="btn btn-save" id="btn-save" onclick="savePrompt()" disabled>Salvar alterações</button>
    <button class="btn btn-reset" onclick="resetPrompt()">Desfazer</button>
    <span class="save-status" id="save-status">✓ Salvo com sucesso</span>
  </div>
</div>

<div id="tab-conversas" class="panel">
  <div class="inbox-layout" id="inbox-layout">
    <!-- ─── Sidebar esquerda: lista de conversas ─── -->
    <div class="inbox-col inbox-col-left">
      <div class="inbox-col-header">
        <h3>Conversas <span class="count-badge" id="filter-count">0</span></h3>
        <button class="refresh-mini" id="new-chat-btn" onclick="openNewChat(event)" title="Nova conversa" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="refresh-mini" onclick="loadConversations({force:true})" title="Atualizar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>
        </button>
      </div>
      <div class="inbox-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="inbox-search-input" placeholder="Buscar por nome, telefone ou mensagem" oninput="onSearchChange()">
      </div>
      <div class="inbox-filters" id="filter-bar">
        <button class="filter-btn active" data-filter="all" onclick="setFilter('all')">Todas</button>
        <button class="filter-btn" data-filter="ai" onclick="setFilter('ai')">🤖 IA</button>
        <button class="filter-btn" data-filter="human" onclick="setFilter('human')">👤 Humano</button>
        <button class="filter-btn" data-filter="mine" onclick="setFilter('mine')">⭐ Minhas</button>
        <button class="filter-btn" data-filter="unrated" onclick="setFilter('unrated')">Não avaliadas</button>
        <button class="filter-btn" data-filter="bad" onclick="setFilter('bad')">👎</button>
        <button class="filter-btn" data-filter="good" onclick="setFilter('good')">👍</button>
      </div>
      <div class="inbox-list" id="inbox-list">
        <div class="skeleton-list"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>
      </div>
    </div>

    <!-- ─── Centro: chat da conversa selecionada ─── -->
    <div class="inbox-col inbox-col-mid" id="chat-area">
      <div class="chat-empty">
        <div class="chat-empty-icon">💬</div>
        <div class="chat-empty-title">Selecione uma conversa</div>
        <div class="chat-empty-sub">Escolha alguém na lista ao lado pra ver as mensagens, assumir o atendimento ou responder direto pelo painel.</div>
      </div>
    </div>

    <!-- ─── Sidebar direita: ficha do lead ─── -->
    <aside class="detail" id="lead-detail">
      <div class="detail-empty">
        <div class="detail-empty-icon">👤</div>
        <div class="detail-empty-title">Ficha do lead</div>
        <div class="detail-empty-sub">Selecione uma conversa pra ver as informações do contato, status do atendimento e próximos passos.</div>
      </div>
    </aside>
  </div>
</div>

<div id="tab-agendamentos" class="panel">
  <div class="conv-header">
    <h2>Agendamentos</h2>
    <button class="refresh-btn" onclick="loadAppointments()">↻ Atualizar</button>
  </div>
  <div id="appt-list">
    <div class="skeleton-list"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>
  </div>
</div>

<div id="tab-users" class="panel">
  <div class="conv-header">
    <h2>Usuários do painel — admins e consultoras</h2>
    <button class="refresh-btn" onclick="loadUsers()">↻ Atualizar</button>
  </div>
  <div class="student-help">
    Cada pessoa que precisa acessar o painel ganha um login próprio. <strong>Admins</strong> têm acesso total (editam prompt, criam usuários, veem métricas). <strong>Consultoras</strong> só veem inbox + agendamentos + alunos pra atender.<br>
    Telefone (opcional, formato 5551XXXXXXXX) é usado pra notificar via WhatsApp quando lead em atendimento humano envia mensagem.
  </div>
  <div class="student-form">
    <input class="phone" id="u-username" placeholder="Usuário (login)" maxlength="40" style="width:160px">
    <input class="name" id="u-displayname" placeholder="Nome completo" style="width:200px">
    <select id="u-role" style="background:#0f0f0f;color:#d4d4d4;border:1px solid #2a2a2a;border-radius:6px;padding:8px 10px;font-size:13px">
      <option value="consultora">Consultora</option>
      <option value="admin">Admin</option>
    </select>
    <input class="phone" id="u-phone" placeholder="Phone (opcional)" maxlength="13" style="width:140px">
    <input id="u-password" type="password" placeholder="Senha (mín 8)" style="background:#0f0f0f;color:#d4d4d4;border:1px solid #2a2a2a;border-radius:6px;padding:8px 10px;font-size:13px;width:140px">
    <button class="btn-add" onclick="addUser()">Adicionar</button>
  </div>
  <div id="users-list">
    <div class="skeleton-list"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>
  </div>
</div>

<div id="tab-metrics" class="panel">
  <div class="conv-header">
    <h2>Métricas (últimos 30 dias)</h2>
    <button class="refresh-btn" onclick="loadMetrics()">↻ Atualizar</button>
  </div>
  <div id="metrics-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:14px"></div>
</div>

<!-- ───────── PR #37 — Monitor v2 (admin only) ───────── -->
<div id="tab-v2-monitor" class="panel">
  <div class="conv-header">
    <h2>Monitor v2 — janela de validação</h2>
    <div style="display:flex;gap:8px;align-items:center">
      <select id="v2m-period" onchange="v2mLoadAll()" title="Período">
        <option value="today">Hoje</option>
        <option value="7d" selected>7 dias</option>
        <option value="14d">14 dias</option>
        <option value="30d">30 dias</option>
      </select>
      <button class="refresh-btn" onclick="v2mLoadAll()">↻ Atualizar</button>
    </div>
  </div>

  <!-- Banner alertas (se houver) -->
  <div id="v2m-alerts" class="v2m-alerts" style="margin-top:12px"></div>

  <div class="v2m" style="margin-top:14px">
    <!-- Coluna principal: métricas + lista -->
    <div class="v2m-main">

      <!-- Cards de métricas -->
      <div id="v2m-metrics" class="v2m-metrics"></div>

      <!-- Funil -->
      <div id="v2m-funil" class="v2m-funil" style="display:none"></div>

      <!-- Filtros de status -->
      <div class="v2m-filters" style="margin-top:6px">
        <span style="font-size:12px;color:var(--text-muted)">Status:</span>
        <span class="v2m-pill active" data-status="" onclick="v2mFilterStatus(this, '')">Todas <span class="ct" id="v2m-ct-all">0</span></span>
        <span class="v2m-pill" data-status="em_andamento" onclick="v2mFilterStatus(this, 'em_andamento')">Em andamento <span class="ct" id="v2m-ct-em_andamento">0</span></span>
        <span class="v2m-pill" data-status="agendou" onclick="v2mFilterStatus(this, 'agendou')">Agendou <span class="ct" id="v2m-ct-agendou">0</span></span>
        <span class="v2m-pill" data-status="handoff" onclick="v2mFilterStatus(this, 'handoff')">Handoff <span class="ct" id="v2m-ct-handoff">0</span></span>
        <span class="v2m-pill" data-status="perdeu" onclick="v2mFilterStatus(this, 'perdeu')">Perdeu <span class="ct" id="v2m-ct-perdeu">0</span></span>
        <span style="margin-left:14px;font-size:12px;color:var(--text-muted)">Avaliação:</span>
        <select id="v2m-review-filter" onchange="v2mRenderList()">
          <option value="">Todas</option>
          <option value="none">Não avaliadas</option>
          <option value="bad">Só ❌</option>
          <option value="aceitavel">Só ⚠️</option>
          <option value="good">Só ✅</option>
        </select>
      </div>

      <!-- Lista de conversas v2 -->
      <div id="v2m-list" class="v2m-list">
        <div class="skeleton-list"><div class="skeleton-card tall"></div><div class="skeleton-card tall"></div><div class="skeleton-card tall"></div></div>
      </div>

      <!-- Controles -->
      <div class="v2m-controls" id="v2m-controls">
        <div style="font-size:12px;color:var(--text-muted)">Versão atual: <strong id="v2m-version-badge">—</strong></div>
        <div class="ctl-row">
          <button class="v2m-pause-btn" id="v2m-pause-btn" onclick="v2mPauseV2()">⏸ Pausar v2 imediatamente</button>
          <button class="v2m-resume-btn" id="v2m-resume-btn" onclick="v2mResumeV2()" style="display:none">▶ Retomar (volta pra env)</button>
          <a class="v2m-resume-btn" id="v2m-export-btn" href="#" onclick="v2mExportCsv(event)">⬇ Exportar CSV do período</a>
        </div>
      </div>
    </div>

    <!-- Coluna lateral: detalhe da conversa selecionada -->
    <div class="v2m-side v2m-detail" id="v2m-detail">
      <div style="text-align:center;padding:30px 10px;color:var(--text-muted);font-size:13px">
        💡 Selecione uma conversa pra ver o detalhe + avaliar
      </div>
    </div>
  </div>
</div>

<!-- Tour de onboarding (overlay) -->
<div id="v2m-tour" class="v2m-tour-overlay" style="display:none">
  <div class="v2m-tour-card">
    <div class="step" id="v2m-tour-step">Passo 1 de 4</div>
    <h3 id="v2m-tour-title">Bem-vindo ao Monitor v2</h3>
    <p id="v2m-tour-text">Aqui você acompanha em tempo real todas as conversas do agente v2.</p>
    <div class="actions">
      <button class="skip" onclick="v2mTourSkip()">Pular</button>
      <button onclick="v2mTourNext()" id="v2m-tour-next">Próximo</button>
    </div>
  </div>
</div>

<div id="tab-modulos" class="panel">
  <div class="conv-header">
    <h2>Módulos do prompt</h2>
    <button class="refresh-btn" onclick="loadModulos()">↻ Atualizar</button>
  </div>
  <div class="student-help">
    Cada módulo é um pedaço do conhecimento do Johnny carregado <strong>sob demanda</strong> (Roteador decide quando entram no contexto). Editar aqui muda comportamento da IA <strong>na próxima resposta</strong>, sem redeploy.
    <br>Total: <strong>28 módulos</strong> divididos em conhecimento, objeções, situações e sistema.
  </div>
  <div id="modulos-list">
    <div class="skeleton-list"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>
  </div>
</div>

<div id="tab-conhecimento" class="panel">
  <div class="conv-header">
    <h2>Conhecimento da academia</h2>
    <button class="refresh-btn" onclick="loadKnowledge()">↻ Atualizar</button>
  </div>
  <div class="student-help">
    Edite aqui os <strong>dados que a IA usa</strong> nas conversas (planos, horários, modalidades, promo do mês). Mudança aqui aparece <strong>na próxima resposta da IA</strong> sem precisar mexer no prompt. Salva automático ao sair do campo.
    <br>Deixa o campo <strong>vazio</strong> pra a IA não mencionar aquela informação.
  </div>
  <div id="kb-list">
    <div class="skeleton-list"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>
  </div>
</div>

<div id="tab-playground" class="panel">
  <div class="conv-header">
    <h2>Testar agente</h2>
    <div style="display:flex;gap:10px;align-items:center">
      <select id="pg-version" onchange="onPlaygroundVersionChange()" style="background:var(--bg-2);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px">
        <option value="v2" selected>v2 (núcleo + módulos — em produção)</option>
        <option value="v1">v1 (prompt monolítico — fallback de emergência)</option>
      </select>
      <select id="pg-cenario" onchange="loadCenario()" style="background:var(--bg-2);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px;display:none">
        <option value="">— Carregar cenário —</option>
      </select>
      <button class="refresh-btn" onclick="resetPlayground()">↻ Resetar</button>
    </div>
  </div>
  <div class="student-help">
    Simule conversa com a IA <strong>sem afetar produção</strong>. Útil pra testar mudanças antes de soltar pra leads reais. Cada msg consome ~R$ 0,01-0,03 da cota Anthropic. <strong>v2:</strong> ativa máquina de estado + módulos sob demanda + parser de tags (Bateria E).
  </div>
  <div class="pg-layout">
    <div class="playground-wrap">
      <div class="playground-thread" id="playground-thread">
        <div class="playground-hint">Comece digitando uma mensagem que um lead enviaria. Ex: "oi, quanto custa?"</div>
      </div>
      <div class="playground-stats" id="playground-stats" style="display:none">
        <span id="pg-tokens">—</span>
        <span id="pg-latency">—</span>
        <span id="pg-cost">—</span>
      </div>
      <div class="playground-input-bar">
        <textarea id="playground-input" placeholder="Digite como se fosse o lead..." rows="2" onkeydown="onPlaygroundKey(event)"></textarea>
        <button class="btn-add" id="playground-send-btn" onclick="sendPlayground()">Enviar</button>
      </div>
    </div>
    <aside class="pg-debug hidden" id="pg-debug">
      <h3>Estado simulado</h3>
      <div id="pg-state-content" class="pg-state-content">—</div>
    </aside>
  </div>
</div>

<div id="tab-conexoes" class="panel">
  <div class="conv-header">
    <h2>Conexões WhatsApp</h2>
    <button class="refresh-btn" onclick="loadConnections()">↻ Atualizar</button>
  </div>
  <div class="student-help">
    Aqui você gerencia o número de WhatsApp que a plataforma usa pra enviar e receber mensagens. Por enquanto a plataforma suporta <strong>1 número conectado por vez</strong>.
  </div>
  <div id="connections-list">
    <div class="skeleton-list"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>
  </div>
</div>

<div id="tab-atalhos" class="panel">
  <div class="conv-header">
    <h2>Atalhos rápidos — snippets pra acelerar respostas</h2>
  </div>
  <div class="student-help">
    Cria snippets que tu usa direto na composer digitando <code>/</code> + nome (ex: <code>/aula</code>, <code>/valores</code>). Aparece dropdown com lista, ↑↓ pra navegar, Enter pra expandir, Esc fecha.<br>
    Salvos no <strong>seu navegador</strong> (localStorage). Não sincroniza entre consultoras nem entre dispositivos — cada uma configura os seus.
  </div>
  <div id="qr-mgmt-list" class="qr-mgmt-list"></div>
  <button class="qr-mgmt-add" onclick="qrMgmtAdd()">+ Adicionar atalho</button>
</div>

<div id="tab-leads" class="panel">
  <div class="conv-header">
    <h2>Leads cadastrados — contatos que estão no funil</h2>
    <button class="refresh-btn" onclick="loadLeads()">↻ Atualizar</button>
  </div>
  <div class="student-help">
    Cadastra aqui leads (telefone + nome) que vc quer adicionar manualmente — útil pra prospecção ativa, follow-up de indicações, etc.<br>
    A IA também <strong>cadastra automaticamente</strong> via tag <code>[NOME:Fulano]</code> quando o lead se apresenta na conversa. Cadastros existentes podem ter o nome editado clicando.<br>
    Formato do telefone: <code>5551995304633</code> (com DDI 55 + DDD + número, sem espaços nem traços).
  </div>
  <div class="student-form">
    <input class="phone" id="lead-phone" placeholder="55519XXXXXXXX" maxlength="13">
    <input class="name" id="lead-name" placeholder="Nome">
    <button class="btn-add" onclick="addLead()">Adicionar</button>
  </div>
  <div id="leads-list">
    <div class="skeleton-list"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>
  </div>
</div>

<div id="tab-alunos" class="panel">
  <div class="conv-header">
    <h2>Alunos cadastrados — IA não atende, encaminha pra equipe</h2>
    <button class="refresh-btn" onclick="loadStudents()">↻ Atualizar</button>
  </div>
  <div class="student-help">
    Cadastra aqui o telefone dos alunos atuais da STRONIX. Quando algum deles mandar mensagem, a IA <strong>não responde</strong> — manda só uma resposta padrão dizendo que vai passar pra equipe e te notifica no WhatsApp.<br>
    Formato do telefone: <code>5551995304633</code> (com DDI 55 + DDD + número, sem espaços nem traços).
  </div>
  <div class="student-form">
    <input class="phone" id="st-phone" placeholder="55519XXXXXXXX" maxlength="13">
    <input class="name" id="st-name" placeholder="Nome completo">
    <input class="notes" id="st-notes" placeholder="Notas (plano, observações...) — opcional">
    <button class="btn-add" onclick="addStudent()">Adicionar</button>
  </div>
  <div id="students-list">
    <div class="skeleton-list"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>
  </div>
</div>

  </div><!-- /.content -->
</div><!-- /.app -->

<div class="rail-hint" id="rail-hint">Passe o mouse no rail para expandir · <kbd>⌘</kbd> <kbd>B</kbd> para fixar</div>

<!-- Banner persistente — aparece quando WhatsApp tá fora -->
<div class="conn-banner hidden" id="conn-banner" onclick="switchTab('conexoes')">
  <span class="conn-banner-dot"></span>
  <span class="conn-banner-text" id="conn-banner-text">WhatsApp desconectado</span>
  <span class="conn-banner-cta">Resolver →</span>
</div>

<!-- Stack de toasts (canto sup direito) -->
<div class="toast-stack" id="toast-stack"></div>

<!-- Modal: Nova conversa -->
<div class="modal-backdrop hidden" id="new-chat-backdrop" onclick="if(event.target===this)closeNewChat()">
  <div class="modal-card new-chat-card" role="dialog" aria-label="Nova conversa">
    <div class="modal-head">
      <div class="modal-title">Nova conversa</div>
      <button class="modal-close" onclick="closeNewChat()" type="button" title="Fechar (Esc)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="new-chat-search-row">
      <svg class="new-chat-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input class="new-chat-search" id="new-chat-input" placeholder="Buscar por nome ou digitar número (ex: 51 99530-4633)" oninput="onNewChatInput()" onkeydown="onNewChatKey(event)" autocomplete="off">
    </div>
    <div class="new-chat-name-row hidden" id="new-chat-name-wrap">
      <input class="new-chat-name" id="new-chat-name" placeholder="Nome do contato (opcional)" autocomplete="off" onkeydown="onNewChatKey(event)">
    </div>
    <div class="new-chat-results" id="new-chat-results">
      <div class="new-chat-hint">Digite pra buscar contatos cadastrados ou um número novo.</div>
    </div>
    <div class="new-chat-foot">
      <span>⚠️ Para mandar mensagem inicial pra um número que <strong>nunca</strong> falou com a STRONIX, a Meta exige template aprovada (em breve). Se o lead já mandou msg nas últimas 24h, dá certo na hora.</span>
    </div>
  </div>
</div>

<!-- Modal: Transferir conversa pra outro user -->
<div class="modal-backdrop hidden" id="transfer-backdrop" onclick="if(event.target===this)closeTransferModal()">
  <div class="modal-card transfer-card" role="dialog" aria-label="Transferir conversa">
    <div class="modal-head">
      <div class="modal-title">🔄 Transferir conversa</div>
      <button class="modal-close" onclick="closeTransferModal()" type="button" title="Fechar (Esc)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="transfer-help" id="transfer-help">Selecione pra quem você quer passar o atendimento. A pessoa vai receber notificação no WhatsApp (se tiver telefone cadastrado).</div>
    <div class="transfer-list" id="transfer-list">
      <div class="transfer-empty">Carregando usuários…</div>
    </div>
  </div>
</div>

<script>
  let originalPrompt = '';

  async function loadPrompt() {
    const res = await fetch('/admin/api/prompt');
    const { prompt } = await res.json();
    originalPrompt = prompt;
    document.getElementById('prompt-text').value = prompt;
    updateCharCount(prompt);
    buildSectionPills(prompt);
    document.getElementById('btn-save').disabled = true;
  }

  function onPromptChange() {
    const current = document.getElementById('prompt-text').value;
    updateCharCount(current);
    document.getElementById('btn-save').disabled = current === originalPrompt;
  }

  function updateCharCount(text) {
    const lines = text.split('\\n').length;
    document.getElementById('char-count').textContent = \`\${text.length.toLocaleString()} caracteres · \${lines} linhas\`;
  }

  function buildSectionPills(prompt) {
    const sections = [...prompt.matchAll(/^([A-ZÁÉÍÓÚÂÊÎÔÛÀÃÕÇ ]+:)/gm)].map(m => m[1]);
    const container = document.getElementById('sections');
    container.innerHTML = sections.map(s =>
      \`<div class="section-pill" onclick="jumpToSection('\${s}')">\${s}</div>\`
    ).join('');
  }

  function jumpToSection(section) {
    const ta = document.getElementById('prompt-text');
    const idx = ta.value.indexOf(section);
    if (idx === -1) return;
    ta.focus();
    ta.setSelectionRange(idx, idx + section.length);
    // Scroll to position
    const lines = ta.value.substring(0, idx).split('\\n').length;
    const lineHeight = 21;
    ta.scrollTop = (lines - 3) * lineHeight;
  }

  async function savePrompt() {
    const prompt = document.getElementById('prompt-text').value;
    const btn = document.getElementById('btn-save');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    const res = await fetch('/admin/api/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    btn.textContent = 'Salvar alterações';
    if (res.ok) {
      originalPrompt = prompt;
      buildSectionPills(prompt);
      const status = document.getElementById('save-status');
      status.classList.add('visible');
      setTimeout(() => status.classList.remove('visible'), 2500);
    } else {
      alert('Erro ao salvar. Tente novamente.');
      btn.disabled = false;
    }
  }

  function resetPrompt() {
    document.getElementById('prompt-text').value = originalPrompt;
    document.getElementById('btn-save').disabled = true;
    updateCharCount(originalPrompt);
  }

  let allConversations = [];
  let currentFilter = 'all';
  let searchQuery = '';
  let selectedPhone = null;
  let chatScrollPinned = true; // se usuário tá no fim do chat, mantém autoscroll

  // ─── Polish PR — estado das features novas ───
  // Optimistic UI: msgs do usuário renderizadas instantâneo, antes do servidor confirmar.
  // Map<phone, [{tempId, text, status: 'pending'|'failed', createdAt, replyTo?}]>
  const pendingMessages = new Map();

  // Reply/citar: msg sendo citada pelo composer (null = nenhuma).
  let replyingTo = null; // { phone, text }

  // Quick replies (slash commands): snippets em localStorage.
  let quickReplies = []; // [{ trigger, text }]
  const QR_STORAGE_KEY = 'quickReplies';
  const QR_DEFAULTS = [
    { trigger: '/aula', text: 'Posso te marcar pra terça às 9h ou quarta às 10h pra fazer a aula experimental?' },
    { trigger: '/valores', text: 'Os planos vão de R$ 149 (mensal) até R$ 99/mês (anual). Qual encaixa melhor pro teu objetivo?' },
    { trigger: '/horario', text: 'A academia abre de segunda a sexta das 6h às 22h30, sábado das 9h às 13h.' },
    { trigger: '/endereco', text: 'Estamos na Av. Edgar Pires de Castro, 9392, Lageado, Porto Alegre/RS. Tem estacionamento gratuito.' },
    { trigger: '/agendar', text: 'Beleza! Que dia da semana fica melhor pra ti — terça, quarta, quinta ou sexta?' },
    { trigger: '/ola', text: 'Oi! Aqui é a STRONIX, tudo certo? Como posso te ajudar?' },
  ];
  let qrDropdownActive = false;
  let qrDropdownIndex = 0;
  let qrDropdownMatches = [];

  // Notas internas — modo toggle no composer + bubble inline na conversa.
  // Sincronizadas via backend (POST /internal-notes), todas as consultoras veem.
  let noteModeActive = false;

  // ─── Polish helpers ───
  function loadQuickReplies() {
    try {
      const saved = localStorage.getItem(QR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          quickReplies = parsed.filter(x => x && typeof x.trigger === 'string' && typeof x.text === 'string');
          return;
        }
      }
    } catch {}
    // Primeira carga: seed com defaults
    quickReplies = QR_DEFAULTS.slice();
    saveQuickReplies();
  }
  function saveQuickReplies() {
    try { localStorage.setItem(QR_STORAGE_KEY, JSON.stringify(quickReplies)); } catch {}
  }
  function setReplyTo(phone, mid) {
    const c = allConversations.find(x => x.from === phone);
    if (!c) return;
    const m = c.history.find(x => String(x.id) === String(mid));
    if (!m || !m.content) return;
    // Remove qualquer quote prévia da msg citada (não cita citação)
    const cleanText = stripQuotePrefix(m.content);
    const trimmed = cleanText.replace(/\\s+/g, ' ').trim().slice(0, 80);
    if (!trimmed) return;
    replyingTo = { phone, text: trimmed };
    // Re-renderiza a barra de input pra mostrar o preview
    const wrap = document.getElementById('chat-input-wrap');
    if (wrap) {
      wrap.dataset.mode = 'fresh'; // força rebuild
      syncChatInputBar(c);
    }
    setTimeout(() => document.getElementById('chat-input')?.focus(), 50);
  }
  function clearReplyTo() {
    replyingTo = null;
    const c = allConversations.find(x => x.from === selectedPhone);
    if (c) {
      const wrap = document.getElementById('chat-input-wrap');
      if (wrap) { wrap.dataset.mode = 'fresh'; syncChatInputBar(c); }
    }
    setTimeout(() => document.getElementById('chat-input')?.focus(), 50);
  }
  function stripQuotePrefix(text) {
    // Remove linhas iniciais que começam com "> " (quote)
    if (!text) return text;
    const lines = text.split('\\n');
    let i = 0;
    while (i < lines.length && /^&gt;\\s|^>\\s|^>$/.test(lines[i])) i++;
    // Pula uma linha em branco logo após o quote
    while (i < lines.length && lines[i].trim() === '') i++;
    return lines.slice(i).join('\\n');
  }
  function extractQuoteAndBody(text) {
    // Para render: separa o bloco de quote (linhas iniciando com "> ") do corpo.
    if (!text) return { quote: '', body: text };
    const lines = text.split('\\n');
    const quoteLines = [];
    let i = 0;
    while (i < lines.length && /^>\\s?/.test(lines[i])) {
      quoteLines.push(lines[i].replace(/^>\\s?/, ''));
      i++;
    }
    if (!quoteLines.length) return { quote: '', body: text };
    while (i < lines.length && lines[i].trim() === '') i++;
    return { quote: quoteLines.join('\\n'), body: lines.slice(i).join('\\n') };
  }
  function tempId() {
    return 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }
  function getMergedHistory(c) {
    // Concatena histórico real (mensagens + notas internas) + pendentes locais,
    // ordenado por createdAt pra render cronológico.
    const pend = pendingMessages.get(c.from) || [];
    const notes = (c.internalNotes || []).map(n => ({
      id: n.id,
      content: n.content,
      createdAt: n.createdAt,
      userId: n.userId,
      userName: n.userName,
      _isNote: true,
    }));
    const pendingItems = pend.map(p => ({
      id: p.tempId,
      role: p.isNote ? null : 'assistant',
      content: p.text,
      createdAt: p.createdAt,
      sentByUserId: (typeof me !== 'undefined' && me) ? me.id : null,
      userName: (typeof me !== 'undefined' && me) ? (me.displayName || me.username) : null,
      _pendingStatus: p.status,           // 'pending' | 'failed'
      _isNote: !!p.isNote,
    }));
    const all = c.history.concat(notes).concat(pendingItems);
    return all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  function clearPendingForServerMatch(phone, sentText) {
    // Quando uma msg confirma no servidor, remove a pending equivalente.
    // Match: mesmo phone + mesmo texto + status pending. Pega a mais antiga.
    const arr = pendingMessages.get(phone);
    if (!arr || !arr.length) return;
    const idx = arr.findIndex(p => p.status === 'pending' && p.text === sentText);
    if (idx >= 0) {
      arr.splice(idx, 1);
      if (!arr.length) pendingMessages.delete(phone);
    }
  }
  // Quick replies — dropdown UI
  function ensureQRDropdown() {
    let dd = document.getElementById('qr-dropdown');
    if (dd) return dd;
    const bar = document.getElementById('chat-input-bar');
    if (!bar) return null;
    dd = document.createElement('div');
    dd.id = 'qr-dropdown';
    dd.className = 'quick-reply-dropdown hidden';
    bar.appendChild(dd);
    return dd;
  }
  function hideQRDropdown() {
    qrDropdownActive = false;
    qrDropdownIndex = 0;
    qrDropdownMatches = [];
    const dd = document.getElementById('qr-dropdown');
    if (dd) dd.classList.add('hidden');
  }
  function showQRDropdownIfTriggered(textarea) {
    const v = textarea.value;
    // Trigger: textarea começa com "/" e ainda não tem espaço/quebra (busca em progresso)
    if (!v.startsWith('/') || /[\\s\\n]/.test(v)) {
      hideQRDropdown();
      return;
    }
    const query = v.toLowerCase();
    qrDropdownMatches = quickReplies.filter(qr => qr.trigger.toLowerCase().startsWith(query));
    if (!qrDropdownMatches.length && quickReplies.length) {
      // Mostra todos se nada bateu (pra descobrir os disponíveis)
      qrDropdownMatches = quickReplies.slice();
    }
    const dd = ensureQRDropdown();
    if (!dd) return;
    if (!quickReplies.length) {
      dd.innerHTML = '<div class="quick-reply-empty">Sem atalhos cadastrados. Configurações → Atalhos rápidos.</div>';
      dd.classList.remove('hidden');
      qrDropdownActive = true;
      qrDropdownIndex = -1;
      return;
    }
    qrDropdownActive = true;
    if (qrDropdownIndex >= qrDropdownMatches.length) qrDropdownIndex = 0;
    if (qrDropdownIndex < 0) qrDropdownIndex = 0;
    dd.innerHTML = qrDropdownMatches.map((qr, i) =>
      '<div class="quick-reply-item ' + (i === qrDropdownIndex ? 'active' : '') +
      '" onmousedown="event.preventDefault();qrPick(' + i + ')">' +
      '<div class="qr-trigger">' + escapeHtml(qr.trigger) + '</div>' +
      '<div class="qr-text">' + escapeHtml(qr.text.slice(0, 90)) + '</div>' +
      '</div>'
    ).join('');
    dd.classList.remove('hidden');
  }
  function qrMoveActive(delta) {
    if (!qrDropdownMatches.length) return;
    qrDropdownIndex = (qrDropdownIndex + delta + qrDropdownMatches.length) % qrDropdownMatches.length;
    const dd = document.getElementById('qr-dropdown');
    if (!dd) return;
    [...dd.querySelectorAll('.quick-reply-item')].forEach((el, i) => {
      el.classList.toggle('active', i === qrDropdownIndex);
    });
  }
  function qrPick(idx) {
    const qr = qrDropdownMatches[idx];
    if (!qr) return;
    const ta = document.getElementById('chat-input');
    if (!ta) return;
    ta.value = qr.text;
    ta.focus();
    // Coloca cursor no fim
    ta.selectionStart = ta.selectionEnd = qr.text.length;
    autoGrowChat(ta);
    hideQRDropdown();
  }
  // Quick replies management — aba Configurações
  function qrMgmtRender() {
    const list = document.getElementById('qr-mgmt-list');
    if (!list) return;
    if (!quickReplies.length) {
      list.innerHTML = '<div class="empty-state"><div class="es-title">Nenhum atalho ainda</div><div class="es-sub">Clica em "Adicionar atalho" pra criar o primeiro.</div></div>';
      return;
    }
    list.innerHTML = quickReplies.map((qr, i) =>
      '<div class="qr-mgmt-item">' +
        '<input class="qr-trigger-input" value="' + escapeHtml(qr.trigger) + '" placeholder="/atalho" onchange="qrMgmtUpdateTrigger(' + i + ', this.value)">' +
        '<input class="qr-text-input" value="' + escapeHtml(qr.text) + '" placeholder="Texto que vai expandir" onchange="qrMgmtUpdateText(' + i + ', this.value)">' +
        '<button class="qr-del" onclick="qrMgmtDelete(' + i + ')" title="Remover">✕</button>' +
      '</div>'
    ).join('');
  }
  function qrMgmtAdd() {
    quickReplies.push({ trigger: '/novo', text: '' });
    saveQuickReplies();
    qrMgmtRender();
    // Foca no campo trigger do novo item
    setTimeout(() => {
      const inputs = document.querySelectorAll('.qr-mgmt-item .qr-trigger-input');
      const last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.select(); }
    }, 50);
  }
  function qrMgmtUpdateTrigger(i, val) {
    if (!quickReplies[i]) return;
    let v = String(val || '').trim();
    if (v && !v.startsWith('/')) v = '/' + v;
    if (!v) v = '/atalho';
    quickReplies[i].trigger = v;
    saveQuickReplies();
  }
  function qrMgmtUpdateText(i, val) {
    if (!quickReplies[i]) return;
    quickReplies[i].text = String(val || '');
    saveQuickReplies();
  }
  function qrMgmtDelete(i) {
    if (!confirm('Remover este atalho?')) return;
    quickReplies.splice(i, 1);
    saveQuickReplies();
    qrMgmtRender();
  }
  // Inicializa quick replies no boot
  loadQuickReplies();

  // Polling + notificações: estado pra detectar mensagens novas
  let pollTimer = null;
  let lastSeenLastContact = {}; // phone → lastContactAt do último load
  let unreadCount = 0;
  let baseTitle = document.title;

  function startPolling() {
    if (pollTimer) return;
    // Quando SSE está saudável, polling roda em frequência baixa (30s)
    // como safety-net. Sem SSE, mantém os 5s originais.
    const pollInterval = (typeof sseHealthy !== 'undefined' && sseHealthy) ? 30000 : 5000;
    pollTimer = setInterval(loadConversations, pollInterval);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function updateTitleCounter() {
    document.title = unreadCount > 0 ? \`(\${unreadCount}) \${baseTitle}\` : baseTitle;
  }

  function detectNewMessages(convs) {
    let newOnesForMe = 0;
    for (const c of convs) {
      const prev = lastSeenLastContact[c.from];
      if (prev !== undefined && c.lastContactAt > prev && c.lastMessage && c.lastMessage.role === 'user') {
        // Mensagem nova vinda do lead/aluno. Conta como "minha" se eu assumi ou está sem dono
        const isMine = me && c.assignedUserId === me.id;
        const isUnassigned = !c.assignedUserId;
        if (isMine || isUnassigned) {
          newOnesForMe++;
          showBrowserNotification(c, isMine);
        }
      }
      lastSeenLastContact[c.from] = c.lastContactAt;
    }
    if (newOnesForMe > 0 && document.hidden) {
      unreadCount += newOnesForMe;
      updateTitleCounter();
    }
  }

  function showBrowserNotification(c, isMine) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden) return; // Só notifica se aba não está visível
    const tag = 'sdr-' + c.from;
    const title = isMine ? '👤 Sua conversa: nova mensagem' : '⏳ Nova conversa sem dono';
    const body = c.lastMessage ? c.lastMessage.content.slice(0, 100) : '';
    new Notification(title, { body, tag });
  }

  function clearUnreadOnFocus() {
    if (!document.hidden) {
      unreadCount = 0;
      updateTitleCounter();
    }
  }
  document.addEventListener('visibilitychange', clearUnreadOnFocus);
  window.addEventListener('focus', clearUnreadOnFocus);

  const RATE_LABEL = { good: '👍 Gostei', bad: '👎 Não gostei' };

  // Helpers
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // Auto-linka URLs em texto JÁ ESCAPADO (HTML-safe). Use após escapeHtml.
  function linkify(escaped) {
    return escaped.replace(/(https?:\\/\\/[^\\s<]+|www\\.[^\\s<]+)/g, url => {
      const href = url.startsWith('www.') ? 'https://' + url : url;
      return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
  }
  function getInitials(c) {
    const name = c.name || c.assignedUserName;
    if (name && name.trim()) {
      const parts = name.split(/\\s+/);
      return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '👤';
    }
    return c.fromDisplay.slice(-2).toUpperCase();
  }
  function fmtPhone(phone) {
    const n = String(phone || '').replace(/\\D/g, '');
    if (n.startsWith('55') && n.length === 13) return '(' + n.slice(2,4) + ') ' + n.slice(4,9) + '-' + n.slice(9);
    return phone;
  }
  function fmtRelativeTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (min < 1) return 'agora';
    if (min < 60) return min + ' min';
    if (h < 24) return h + 'h';
    if (d < 7) return d + 'd';
    return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
  function fmtMessageTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  }
  function fmtDayDivider(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(d, today)) return 'Hoje';
    if (sameDay(d, yesterday)) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  async function loadConversations(opts = {}) {
    try {
      const res = await fetch('/admin/api/conversations');
      if (!res.ok) return;
      const fresh = await res.json();
      detectNewMessages(fresh);
      allConversations = fresh;
      renderInboxList();
      renderLeadDetail();
      // Render parcial: durante polling, NÃO reescreve o DOM do chat se já está
      // montado com a conversa correta. Só atualiza mensagens novas + header.
      // opts.force = true força rebuild completo (usado em selectConv, troca de aba).
      if (opts.force) {
        renderChat();
      } else {
        updateChatIncremental();
      }
    } catch (e) { /* polling silencioso */ }
  }

  // Atualiza só o necessário sem destruir input + foco
  function updateChatIncremental() {
    if (!selectedPhone) return;
    const c = allConversations.find(x => x.from === selectedPhone);
    if (!c) { renderChat(); return; }
    const msgsEl = document.getElementById('chat-messages');
    const headerEl = document.getElementById('chat-header-status');
    if (!msgsEl || !headerEl) {
      renderChat();
      return;
    }
    // Atualiza status + ações no header
    syncChatHeader(c);
    // Re-renderiza mensagens se mudou contagem OU status de entrega
    const stamp = messagesStamp(c);
    if (msgsEl.dataset.stamp !== stamp) {
      const currentCount = msgsEl.dataset.msgCount ? parseInt(msgsEl.dataset.msgCount, 10) : 0;
      msgsEl.innerHTML = renderChatMessages(c);
      msgsEl.dataset.msgCount = c.history.length;
      msgsEl.dataset.stamp = stamp;
      // Só rola pro fim se chegou msg nova (não em mudança de status)
      if (chatScrollPinned && c.history.length !== currentCount) {
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }
    }
    // Sincroniza estado do input bar (caso tenha mudado de assumida pra livre etc)
    syncChatInputBar(c);
  }

  function syncChatHeader(c) {
    const isHuman = !!c.assignedUserId;
    const isMine  = isHuman && me && c.assignedUserId === me.id;
    const status = isHuman
      ? (isMine ? '🟢 Em atendimento (você)' : '🟡 Em atendimento (' + escapeHtml(c.assignedUserName) + ')')
      : '🤖 IA atendendo';
    const headerEl = document.getElementById('chat-header-status');
    if (headerEl) headerEl.innerHTML = status + ' · ' + fmtPhone(c.from);

    // Botões de ação do header (só re-render se mudou)
    const actionsEl = document.getElementById('chat-header-actions');
    if (!actionsEl) return;
    const isAdmin = me && me.role === 'admin';
    // Key inclui isAdmin pra forçar rebuild quando role muda (raro mas possível)
    const desiredKey = (isHuman ? (isMine ? 'release' : 'view') : 'assume') + (isAdmin ? '-a' : '');
    if (actionsEl.dataset.key === desiredKey) return;
    actionsEl.dataset.key = desiredKey;
    let actionBtns = '';
    const transferBtn = '<button class="chat-action-btn" onclick="openTransferModal(\\'' + c.from + '\\')" title="Transferir esse atendimento pra outra pessoa do time">🔄 Transferir</button>';
    if (!isHuman) {
      // IA atendendo: admin pode transferir direto pra alguém (skip auto-assume),
      // consultora não tem permissão de transferir conversa que não é dela.
      actionBtns = (isAdmin ? transferBtn : '') +
        '<button class="chat-action-btn primary" onclick="assumeConv(event, \\'' + c.from + '\\')">Assumir</button>';
    } else if (isMine || isAdmin) {
      // Você (ou admin) tá atendendo: Transferir + Devolver pra IA
      actionBtns = transferBtn +
        '<button class="chat-action-btn" onclick="releaseConv(event, \\'' + c.from + '\\')">Devolver pra IA</button>';
    }
    actionsEl.innerHTML =
      actionBtns +
      '<button class="chat-action-btn icon" onclick="toggleReviewPopup(event)" title="Avaliar conversa">📝</button>' +
      '<button class="chat-action-btn icon danger" onclick="clearConv(event, \\'' + c.from + '\\')" title="Limpar conversa">🗑️</button>';
  }

  function syncChatInputBar(c) {
    const isHuman = !!c.assignedUserId;
    const isMine  = isHuman && me && c.assignedUserId === me.id;
    const canReply = isMine || (me && me.role === 'admin');
    const wrap = document.getElementById('chat-input-wrap');
    if (!wrap) return;
    // Não rebuild durante gravação ou preview de áudio (preserva o estado da UI temporária).
    if (wrap.dataset.mode === 'recording' || wrap.dataset.mode === 'preview') return;
    const desiredMode = canReply ? 'reply' : (isHuman ? 'taken' : 'ai');
    if (wrap.dataset.mode === desiredMode) return;
    // Estado mudou (ex: alguém assumiu, ou eu assumi/devolvi). Reconstrói só essa barra.
    wrap.dataset.mode = desiredMode;
    wrap.innerHTML = buildInputBar(c);
  }

  function filterConversations() {
    const q = searchQuery.toLowerCase().trim();
    return allConversations.filter(c => {
      // Filtro de seção
      if (currentFilter === 'ai' && c.assignedUserId) return false;
      if (currentFilter === 'human' && !c.assignedUserId) return false;
      if (currentFilter === 'mine' && (!me || c.assignedUserId !== me.id)) return false;
      if (currentFilter === 'unrated' && c.review) return false;
      if ((currentFilter === 'good' || currentFilter === 'bad') && (!c.review || c.review.rating !== currentFilter)) return false;
      // Search
      if (q) {
        const hay = [c.name, c.from, c.fromDisplay, c.lastMessage?.content].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderInboxList() {
    const convs = filterConversations()
      .slice()
      .sort((a, b) => (b.lastContactAt || 0) - (a.lastContactAt || 0));

    document.getElementById('filter-count').textContent =
      \`\${convs.length}\${convs.length !== allConversations.length ? ' de ' + allConversations.length : ''}\`;
    const navBadge = document.getElementById('nav-badge-conv');
    if (navBadge) navBadge.textContent = String(allConversations.length);

    const list = document.getElementById('inbox-list');
    if (!convs.length) {
      const hasFilter = currentFilter !== 'all' || (searchQuery && searchQuery.trim());
      if (hasFilter) {
        list.innerHTML =
          '<div class="empty-state">' +
            '<div class="es-icon">🔍</div>' +
            '<div class="es-title">Nenhuma conversa com esse filtro</div>' +
            '<div class="es-sub">Tenta limpar o filtro ou busca pra ver todas as conversas.</div>' +
            '<button onclick="clearInboxFilters()" type="button">Limpar filtro</button>' +
          '</div>';
      } else {
        list.innerHTML =
          '<div class="empty-state">' +
            '<div class="es-icon">💬</div>' +
            '<div class="es-title">Aguardando primeira conversa</div>' +
            '<div class="es-sub">Quando alguém mandar mensagem pro WhatsApp da academia, vai aparecer aqui em tempo real.</div>' +
          '</div>';
      }
      return;
    }

    list.innerHTML = convs.map(c => {
      const isHuman = !!c.assignedUserId;
      const isMine  = isHuman && me && c.assignedUserId === me.id;
      const isSelected = selectedPhone === c.from;
      const avatarClass = isMine ? 'mine' : (isHuman ? 'human' : '');
      const initials = getInitials(c);
      const aiDot = !isHuman ? '<div class="ai-dot">🤖</div>' : '';
      const lastMsg = c.lastMessage;
      const lastPrefix = lastMsg ? (lastMsg.role === 'user' ? '' : (lastMsg.sentByUserId ? '👨‍💼 ' : '🤖 ')) : '';
      const lastText = lastMsg ? escapeHtml(lastMsg.content).slice(0, 80) : '<i>sem mensagens</i>';
      const time = fmtRelativeTime(c.lastContactAt);
      const tags = [];
      if (isMine) tags.push('<span class="inbox-mini-badge mine">você</span>');
      else if (isHuman) tags.push('<span class="inbox-mini-badge human">' + escapeHtml(c.assignedUserName) + '</span>');
      if (c.review) tags.push('<span class="inbox-mini-badge review ' + c.review.rating + '">' + (c.review.rating === 'good' ? '👍' : '👎') + '</span>');

      return \`
        <div class="inbox-item \${isSelected ? 'active' : ''}" onclick="selectConv('\${c.from}')">
          <div class="inbox-avatar \${avatarClass}">\${initials}\${aiDot}</div>
          <div class="inbox-item-body">
            <div class="inbox-item-top">
              <div class="inbox-item-name">\${escapeHtml(c.name || fmtPhone(c.from))}</div>
              <div class="inbox-item-time">\${time}</div>
            </div>
            <div class="inbox-item-bot">
              <div class="inbox-item-preview">\${lastPrefix}\${lastText}</div>
              <div class="inbox-item-tags">\${tags.join('')}</div>
            </div>
          </div>
        </div>
      \`;
    }).join('');
  }

  function renderLeadDetail() {
    const panel = document.getElementById('lead-detail');
    if (!panel) return;
    if (!selectedPhone) {
      panel.innerHTML = \`
        <div class="detail-empty">
          <div class="detail-empty-icon">👤</div>
          <div class="detail-empty-title">Ficha do lead</div>
          <div class="detail-empty-sub">Selecione uma conversa pra ver as informações do contato, status do atendimento e próximos passos.</div>
        </div>
      \`;
      return;
    }
    const c = allConversations.find(x => x.from === selectedPhone);
    if (!c) { panel.innerHTML = ''; return; }

    const initials = getInitials(c);
    const phone = fmtPhone(c.from);
    const isHuman = !!c.assignedUserId;
    const isMine = isHuman && me && c.assignedUserId === me.id;

    const stage = isHuman
      ? (isMine ? '👤 Atendido por você' : \`👤 \${escapeHtml(c.assignedUserName || '—')}\`)
      : '🤖 IA atendendo';

    const firstContact = c.firstContactAt ? fmtAbsoluteDate(c.firstContactAt) : '—';
    const lastContact = c.lastContactAt ? fmtRelativeTime(c.lastContactAt) : '—';

    const tags = [];
    if (isMine) tags.push('<span class="detail-tag brand">⭐ Minha</span>');
    else if (isHuman) tags.push('<span class="detail-tag">👤 Humano</span>');
    else tags.push('<span class="detail-tag brand">🤖 IA</span>');
    tags.push(\`<span class="detail-tag">\${c.messageCount} msgs</span>\`);
    if (c.review) {
      tags.push(\`<span class="detail-tag">\${c.review.rating === 'good' ? '👍 Aprovada' : '👎 Revisar'}</span>\`);
    }

    const noteHtml = (c.review && c.review.comment)
      ? \`<div class="detail-note">\${escapeHtml(c.review.comment)}</div>\`
      : '<div class="detail-note empty">Sem notas internas. Use a avaliação 👍/👎 + comentário pra registrar feedback.</div>';

    panel.innerHTML = \`
      <div class="detail-profile">
        <div class="av">\${initials}</div>
        <div class="nm">\${escapeHtml(c.name || 'Sem nome')}</div>
        <div class="ph">\${phone}</div>
      </div>

      <section class="detail-section">
        <h3>Status do lead</h3>
        <div class="kv">
          <div class="row"><span class="k">Origem</span><span class="v">WhatsApp</span></div>
          <div class="row"><span class="k">Primeiro contato</span><span class="v">\${firstContact}</span></div>
          <div class="row"><span class="k">Último contato</span><span class="v">há \${lastContact}</span></div>
          <div class="row"><span class="k">Atendimento</span><span class="v \${isHuman ? '' : 'brand'}">\${stage}</span></div>
        </div>
      </section>

      <section class="detail-section">
        <h3>Tags</h3>
        <div class="tagrow">\${tags.join('')}</div>
      </section>

      <section class="detail-section">
        <h3>Avaliação & notas</h3>
        \${noteHtml}
      </section>

    \`;
  }

  function fmtAbsoluteDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderChat() {
    const area = document.getElementById('chat-area');
    if (!selectedPhone) {
      area.innerHTML = '<div class="chat-empty"><div class="chat-empty-icon">💬</div><div>Selecione uma conversa pra ver as mensagens</div></div>';
      return;
    }
    const c = allConversations.find(x => x.from === selectedPhone);
    if (!c) {
      area.innerHTML = '<div class="chat-empty"><div class="chat-empty-icon">⚠️</div><div>Conversa não encontrada</div></div>';
      return;
    }
    area.innerHTML = \`
      <div class="chat-header">
        <div class="chat-header-avatar">\${getInitials(c)}</div>
        <div class="chat-header-info">
          <div class="chat-header-name">\${escapeHtml(c.name || fmtPhone(c.from))}</div>
          <div class="chat-header-status" id="chat-header-status"></div>
        </div>
        <div class="chat-header-actions" id="chat-header-actions"></div>
        <div class="review-popup hidden" id="review-popup"></div>
      </div>
      <div class="chat-messages" id="chat-messages" onscroll="onChatScroll()" data-msg-count="\${c.history.length}">
        \${renderChatMessages(c)}
      </div>
      <div class="chat-input-wrap" id="chat-input-wrap"></div>
    \`;
    syncChatHeader(c);
    syncReviewPopup(c);
    document.getElementById('chat-input-wrap').dataset.mode = 'fresh';
    syncChatInputBar(c);

    if (chatScrollPinned) {
      const cm = document.getElementById('chat-messages');
      if (cm) cm.scrollTop = cm.scrollHeight;
    }
  }

  function renderChatMessages(c) {
    const merged = getMergedHistory(c);
    if (!merged.length) {
      return '<div class="chat-empty"><div style="opacity:.5;font-size:13px">Sem mensagens ainda</div></div>';
    }
    let lastDay = '';
    let lastGroupKey = '';
    return merged.map(m => {
      const day = fmtDayDivider(m.createdAt || c.firstContactAt);
      let dayHtml = '';
      let dayChanged = false;
      if (day !== lastDay) {
        dayHtml = '<div class="day-divider"><span>' + day + '</span></div>';
        lastDay = day;
        dayChanged = true;
      }
      const isPending = m._pendingStatus === 'pending';
      const isFailed  = m._pendingStatus === 'failed';
      const pendingCls = isPending ? ' pending' : (isFailed ? ' failed-send' : '');

      // ─── Bubble nota interna ───
      if (m._isNote) {
        const noteAuthor = m.userName || (m.sentByUserId ? (getUserDisplay(m.sentByUserId) || 'Atendente') : 'Atendente');
        const canDelete = !isPending && !isFailed && !!m.id && me && (m.userId === me.id || me.role === 'admin');
        const noteStatus = isPending
          ? '<span class="msg-check pending" title="Salvando…">⏱</span>'
          : (isFailed ? '<span class="msg-check failed" title="Falhou">⚠</span>' : '');
        const deleteBtn = canDelete
          ? '<button class="note-delete" onclick="deleteNote(' + m.id + ')" title="Apagar nota" type="button">×</button>'
          : '';
        lastGroupKey = ''; // notas quebram agrupamento de bubbles normais
        return dayHtml +
          '<div class="bubble-row note" data-mid="' + (m.id || '') + '">' +
            '<div class="bubble note' + pendingCls + '">' +
              '<div class="note-header">📝 Nota interna · ' + escapeHtml(noteAuthor) + '</div>' +
              '<div class="note-body">' + linkify(escapeHtml(m.content || '')) + '</div>' +
              '<div class="bubble-meta">' + fmtMessageTime(m.createdAt) + noteStatus + deleteBtn + '</div>' +
            '</div>' +
          '</div>';
      }

      const isOut = m.role === 'assistant';
      const fromHuman = m.sentByUserId;
      const senderName = fromHuman ? (getUserDisplay(fromHuman) || 'Atendente') : '';
      const inOrOut = isOut ? 'out' : 'in';
      const humanCls = fromHuman ? ' human' : '';

      // Group consecutive messages from same sender (role + user id)
      const groupKey = m.role + ':' + (m.sentByUserId || '');
      const isGrouped = !dayChanged && groupKey === lastGroupKey;
      lastGroupKey = groupKey;

      // Sender label só na PRIMEIRA msg do grupo (não repete em cada bubble)
      const senderHtml = (isOut && fromHuman && !isGrouped)
        ? '<div class="bubble-sender">' + escapeHtml(senderName) + '</div>'
        : '';

      // Player de áudio inline (se a msg tem mediaPath salvo)
      let bodyHtml;
      if (m.wasAudio && m.mediaPath) {
        bodyHtml = senderHtml +
          '<audio class="bubble-audio" controls preload="metadata" src="/admin/api/media/' + encodeURIComponent(m.mediaPath) + '"></audio>';
      } else {
        // Reply/quote: linhas que começam com "> " viram bloco visual citado.
        const split = extractQuoteAndBody(m.content || '');
        let inner = '';
        if (split.quote) {
          inner += '<div class="bubble-quote">' + linkify(escapeHtml(split.quote)) + '</div>';
        }
        inner += linkify(escapeHtml(split.body));
        bodyHtml = senderHtml + inner;
      }

      // Checkmarks de status (só pra msgs OUTgoing — IA ou consultora)
      let statusHtml = '';
      if (isOut) {
        if (isPending) {
          statusHtml = '<span class="msg-check pending" title="Enviando…">⏱</span>';
        } else if (isFailed) {
          statusHtml = '<span class="msg-check failed" title="Falhou">⚠</span>' +
            '<button class="retry-send" onclick="retrySend(\\'' + c.from + '\\', \\'' + (m.id || '') + '\\')" type="button">Tentar de novo</button>';
        } else {
          const st = m.deliveryStatus;
          if (st === 'read') {
            statusHtml = '<span class="msg-check read" title="Lido">✓✓</span>';
          } else if (st === 'delivered') {
            statusHtml = '<span class="msg-check delivered" title="Entregue">✓✓</span>';
          } else if (st === 'sent' || m.wamid) {
            statusHtml = '<span class="msg-check sent" title="Enviado">✓</span>';
          } else if (st === 'failed') {
            statusHtml = '<span class="msg-check failed" title="Falhou">⚠</span>';
          }
        }
      }

      // Botão reply hover (não exibe em pending nem failed nem áudio)
      const canReply = !isPending && !isFailed && !!m.id && !(m.wasAudio && m.mediaPath);
      const replyBtn = canReply
        ? '<button class="bubble-action-reply" type="button" onclick="setReplyTo(\\'' + c.from + '\\', \\'' + m.id + '\\')" title="Responder">↩</button>'
        : '';

      const groupCls = isGrouped ? ' grouped' : '';
      return dayHtml +
        '<div class="bubble-row ' + inOrOut + groupCls + '" data-mid="' + (m.id || '') + '">' +
          '<div class="bubble ' + inOrOut + humanCls + groupCls + pendingCls + '">' +
            bodyHtml +
            '<div class="bubble-meta">' + fmtMessageTime(m.createdAt) + statusHtml + '</div>' +
          '</div>' +
          replyBtn +
        '</div>';
    }).join('');
  }

  // "Stamp" das mensagens pra detectar mudanças (count, último delivered/read).
  // Usado no render parcial pra evitar re-render quando nada mudou, e forçar
  // re-render quando o status muda mesmo sem msg nova.
  function messagesStamp(c) {
    const notes = c.internalNotes || [];
    if (!c.history.length && !notes.length) return '0';
    const last = c.history.length ? c.history[c.history.length - 1] : null;
    let maxStatus = 0;
    for (const m of c.history) {
      if (m.readAt && m.readAt > maxStatus) maxStatus = m.readAt;
      else if (m.deliveredAt && m.deliveredAt > maxStatus) maxStatus = m.deliveredAt;
    }
    // Inclui notas no stamp pra que SSE/polling re-renderize quando alguém adiciona/apaga
    const lastNote = notes.length ? notes[notes.length - 1] : null;
    return c.history.length + '|' + (last ? last.createdAt : 0) + '|' + maxStatus +
           '|n' + notes.length + '|' + (lastNote ? lastNote.createdAt : 0);
  }

  function buildInputBar(c) {
    const isHuman = !!c.assignedUserId;
    const isMine  = isHuman && me && c.assignedUserId === me.id;
    const isOtherHuman = isHuman && !isMine && me && me.role !== 'admin';
    // Auto-assume: se IA tá atendendo (ninguém assumiu), qualquer pessoa pode
    // digitar — a 1ª mensagem assume automaticamente.
    const canReply = !isOtherHuman;
    if (canReply) {
      let banner = '';
      if (isMine) {
        banner = \`<div class="handoff-banner">
             <div><span class="hb-dot"></span><strong>Você está atendendo</strong> · IA pausada</div>
             <div class="hb-actions">
               <button class="btn-transfer" onclick="openTransferModal('\${c.from}')" title="Transferir esse atendimento pra outra pessoa do time" type="button">🔄 Transferir</button>
               <button onclick="releaseConv(event, '\${c.from}')">Devolver pra IA</button>
             </div>
           </div>\`;
      } else if (!isHuman) {
        banner = \`<div class="ai-active-hint">
             <span class="aih-icon">🤖</span>
             <span>IA atendendo · <strong>sua próxima mensagem pausa a IA</strong> e assume o atendimento</span>
           </div>\`;
      }
      const replyPreview = (replyingTo && replyingTo.phone === c.from)
        ? \`<div class="composer-reply-preview" id="composer-reply-preview">
             <div class="crp-body">
               <div class="crp-label">Respondendo a</div>
               <div class="crp-text">\${escapeHtml(replyingTo.text)}</div>
             </div>
             <button class="crp-close" onclick="clearReplyTo()" title="Cancelar resposta" type="button">×</button>
           </div>\`
        : '';
      const pillCls = noteModeActive ? 'chat-input-pill note-mode' : 'chat-input-pill';
      const noteToggleCls = noteModeActive ? 'chat-note-toggle active' : 'chat-note-toggle';
      const placeholder = noteModeActive
        ? 'Anote algo sobre esse lead (só o time vê)...'
        : 'Digite uma mensagem como ' + escapeHtml(me.displayName) + '... (use / pra atalhos)';
      return \`
        \${banner}
        <div class="emoji-panel hidden" id="emoji-panel"></div>
        \${replyPreview}
        <div class="chat-input-bar" id="chat-input-bar">
          <button class="composer-btn chat-attach" onclick="onAttachClick(event)" title="Anexar arquivo, imagem ou documento" type="button">+</button>
          <div class="\${pillCls}" id="chat-input-pill">
            <textarea class="chat-input" id="chat-input" placeholder="\${placeholder}" rows="1" onkeydown="handleChatKey(event, '\${c.from}')" oninput="autoGrowChat(this)" onblur="setTimeout(hideQRDropdown, 150)"></textarea>
            <button class="\${noteToggleCls}" id="chat-note-toggle" onclick="toggleNoteMode(event, '\${c.from}')" title="Adicionar nota interna (só o time vê)" type="button">
              <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>
            </button>
            <button class="chat-emoji" id="chat-emoji-btn" onclick="toggleEmojiPanel(event)" title="Inserir emoji" type="button">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
            </button>
          </div>
          <button class="chat-mic" onclick="startRecording('\${c.from}')" title="Gravar áudio" type="button">
            <svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          </button>
          <button class="chat-send" onclick="sendChatReply('\${c.from}')" title="Enviar (Enter)" type="button">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21l20.99-9L2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      \`;
    }
    // Cai aqui se canReply === false → outra consultora tá atendendo
    return \`<div class="chat-input-disabled">
      <span class="chat-input-disabled-text">Conversa em atendimento por <strong>\${escapeHtml(c.assignedUserName)}</strong></span>
    </div>\`;
  }

  function syncReviewPopup(c) {
    const el = document.getElementById('review-popup');
    if (!el) return;
    const r = c.review;
    el.innerHTML = \`
      <div class="review-popup-title">Avaliar essa conversa</div>
      <div class="review-popup-actions">
        <button class="rate-btn good \${r && r.rating === 'good' ? 'active' : ''}" onclick="rateConv('\${c.from}', 'good')">👍 Gostei</button>
        <button class="rate-btn bad \${r && r.rating === 'bad' ? 'active' : ''}" onclick="rateConv('\${c.from}', 'bad')">👎 Não gostei</button>
        \${r ? \`<button class="rate-btn clear" onclick="clearReview('\${c.from}')">remover</button>\` : ''}
      </div>
      <textarea class="review-comment" id="review-cmt" placeholder="Anote o que foi bom ou ruim aqui (opcional)..." oninput="onCommentChange('\${c.from}')">\${escapeHtml(r?.comment || '')}</textarea>
    \`;
  }

  function selectConv(phone) {
    // Cancela estados órfãos da conv anterior antes de trocar:
    // - replyingTo apontava pra msg da conv anterior (visualmente confuso se voltar)
    // - noteModeActive: sem reset, modo nota fica ativo na conv nova (composer amber + msg vai como nota)
    // - recState: gravação de áudio ativa fica zumbi com mic capturando em background
    if (recState) {
      try { cancelRecording(); } catch {}
    }
    replyingTo = null;
    noteModeActive = false;
    selectedPhone = phone;
    chatScrollPinned = true;
    renderInboxList();
    renderLeadDetail();
    renderChat();
    document.getElementById('inbox-layout').classList.add('has-selected');
    setTimeout(() => document.getElementById('chat-input')?.focus(), 50);
  }

  // ─────────────────────────────────────────────────────────────────
  // Modal Nova Conversa
  // ─────────────────────────────────────────────────────────────────
  async function openNewChat(e) {
    if (e) e.stopPropagation();
    // Garante que estamos na aba conversas (faz sentido abrir só aqui)
    if (document.getElementById('tab-conversas') && !document.getElementById('tab-conversas').classList.contains('active')) {
      switchTab('conversas');
    }
    const bd = document.getElementById('new-chat-backdrop');
    if (!bd) return;
    bd.classList.remove('hidden');
    const inp = document.getElementById('new-chat-input');
    const nameInp = document.getElementById('new-chat-name');
    if (inp) { inp.value = ''; inp.focus(); }
    if (nameInp) nameInp.value = '';
    document.getElementById('new-chat-name-wrap').classList.add('hidden');
    renderNewChatResults('');
    // Carrega alunos em background pra busca incluir aluno mesmo se a aba
    // Alunos nunca foi aberta nesta sessão
    if (!allStudents.length) {
      try {
        const r = await fetch('/admin/api/students');
        if (r.ok) allStudents = await r.json();
      } catch {}
    }
  }

  function closeNewChat() {
    const bd = document.getElementById('new-chat-backdrop');
    if (bd) bd.classList.add('hidden');
  }

  // ─────────────────────────────────────────────────────────────────
  // Transferir conversa — modal com lista de users ativos
  // ─────────────────────────────────────────────────────────────────
  let transferTargetPhone = null;

  async function openTransferModal(phone) {
    transferTargetPhone = phone;
    const bd = document.getElementById('transfer-backdrop');
    if (!bd) return;
    bd.classList.remove('hidden');
    const list = document.getElementById('transfer-list');
    if (list) list.innerHTML = '<div class="transfer-empty">Carregando usuários…</div>';
    try {
      const r = await fetch('/admin/api/users-public');
      if (!r.ok) throw new Error('falha ao carregar');
      const users = await r.json();
      // Filtra: exclui self
      const eligible = users.filter(u => !me || u.id !== me.id);
      if (!eligible.length) {
        list.innerHTML = '<div class="transfer-empty">Não há outras pessoas cadastradas pra receber. Cadastre consultoras em Configurações → Usuários.</div>';
        return;
      }
      list.innerHTML = eligible.map(u => {
        const initials = (u.display_name || '')
          .split(/\\s+/).slice(0, 2)
          .map(p => (p[0] || '').toUpperCase())
          .join('') || '?';
        const roleLabel = u.role === 'admin' ? 'Admin' : 'Consultora';
        const isAdminCls = u.role === 'admin' ? ' is-admin' : '';
        return '<div class="transfer-item' + isAdminCls + '" onclick="doTransfer(' + u.id + ', \\'' + escapeHtml(u.display_name) + '\\')">' +
                 '<div class="ti-avatar">' + escapeHtml(initials) + '</div>' +
                 '<div class="ti-body">' +
                   '<div class="ti-name">' + escapeHtml(u.display_name) + '</div>' +
                   '<div class="ti-meta">' + roleLabel + '</div>' +
                 '</div>' +
                 '<div class="ti-arrow">→</div>' +
               '</div>';
      }).join('');
    } catch (e) {
      list.innerHTML = '<div class="transfer-empty">Erro ao carregar usuários. Tenta de novo.</div>';
    }
  }

  function closeTransferModal() {
    const bd = document.getElementById('transfer-backdrop');
    if (bd) bd.classList.add('hidden');
    transferTargetPhone = null;
  }

  async function doTransfer(targetUserId, targetDisplayName) {
    if (!transferTargetPhone) return;
    const phone = transferTargetPhone;
    closeTransferModal();
    try {
      const r = await fetch('/admin/api/conversations/' + phone + '/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        showToast({ severity: 'warn', title: 'Não consegui transferir', message: data.error || 'Tenta de novo' });
        return;
      }
      showToast({ severity: 'info', title: '🔄 Atendimento transferido', message: 'Passou pra ' + targetDisplayName + '. Notificamos no WhatsApp.' });
      await loadConversations();
    } catch (e) {
      showToast({ severity: 'warn', title: 'Sem conexão', message: 'Tenta de novo' });
    }
  }

  // Detecta se input parece com número BR (ignora texto puro com letras).
  // Aceita dígitos + espaços + + - ( ) e considera "número" se tiver pelo menos 8 dígitos.
  function looksLikePhone(input) {
    const stripped = String(input || '').replace(/[\\s\\-\\(\\)\\+]/g, '');
    return /^\\d+$/.test(stripped) && stripped.length >= 8;
  }

  // Normaliza telefone BR no FRONTEND (mesmas regras do backend) — pra preview
  function normalizePhoneFrontend(input) {
    let n = String(input || '').replace(/\\D/g, '');
    if (!n) return null;
    if (n.startsWith('0')) n = n.slice(1);
    if (!n.startsWith('55')) {
      if (n.length === 11 || n.length === 10) n = '55' + n;
      else return null;
    }
    if (n.length === 12) n = n.slice(0, 4) + '9' + n.slice(4);
    if (n.length !== 13) return null;
    return n;
  }

  function onNewChatInput() {
    const inp = document.getElementById('new-chat-input');
    const value = inp ? inp.value : '';
    // Mostra campo de nome se for número detectado
    const nameWrap = document.getElementById('new-chat-name-wrap');
    if (nameWrap) {
      const isPhone = looksLikePhone(value);
      const normalized = isPhone ? normalizePhoneFrontend(value) : null;
      const exists = normalized && allConversations.some(c => c.from === normalized);
      // Mostra campo de nome só quando vai criar contato novo
      nameWrap.classList.toggle('hidden', !(isPhone && normalized && !exists));
    }
    renderNewChatResults(value);
  }

  function renderNewChatResults(query) {
    const out = document.getElementById('new-chat-results');
    if (!out) return;
    const q = (query || '').trim();
    if (!q) {
      out.innerHTML = '<div class="new-chat-hint">Digite pra buscar contatos cadastrados ou um número novo.</div>';
      return;
    }

    const isPhone = looksLikePhone(q);
    const normalized = isPhone ? normalizePhoneFrontend(q) : null;

    // Match em contatos existentes
    const qLower = q.toLowerCase();
    const qDigits = q.replace(/\\D/g, '');
    const conversationPhones = new Set(allConversations.map(c => c.from));
    const convMatches = allConversations.filter(c => {
      const nm = (c.name || '').toLowerCase();
      const ph = c.from || '';
      return nm.includes(qLower) || (qDigits && ph.includes(qDigits));
    }).slice(0, 15);

    // Match em alunos cadastrados (que ainda não têm conversa aberta — senão duplica)
    const studentMatches = (allStudents || []).filter(s => {
      if (conversationPhones.has(s.phone)) return false;
      const nm = (s.name || '').toLowerCase();
      const ph = s.phone || '';
      return nm.includes(qLower) || (qDigits && ph.includes(qDigits));
    }).slice(0, 10);

    let html = '';
    if (convMatches.length) {
      html += '<div class="new-chat-section">Contatos cadastrados</div>';
      html += convMatches.map(c => \`
        <div class="new-chat-item" onclick="pickExistingContact('\${c.from}')">
          <div class="av">\${getInitials(c)}</div>
          <div class="info">
            <span class="nm">\${escapeHtml(c.name || 'Sem nome')}</span>
            <span class="ph">\${fmtPhone(c.from)}</span>
          </div>
          <span class="arrow">→</span>
        </div>
      \`).join('');
    }

    if (studentMatches.length) {
      html += '<div class="new-chat-section">🎓 Alunos cadastrados</div>';
      html += studentMatches.map(s => {
        const initials = (s.name || '').trim().split(/\\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase() || '🎓';
        const safeName = JSON.stringify(s.name || '').replace(/"/g, '&quot;');
        return \`
          <div class="new-chat-item" onclick="messageStudent('\${s.phone}', \${safeName})">
            <div class="av" style="background:linear-gradient(135deg,#fbbf24,#d97706)">\${initials}</div>
            <div class="info">
              <span class="nm">\${escapeHtml(s.name || 'Aluno sem nome')}</span>
              <span class="ph">\${fmtPhone(s.phone)} · aluno cadastrado</span>
            </div>
            <span class="arrow">→</span>
          </div>
        \`;
      }).join('');
    }

    // Opção de criar nova conversa se input é número válido E não existe ainda
    if (isPhone && normalized) {
      const existing = allConversations.find(c => c.from === normalized);
      if (!existing) {
        html += '<div class="new-chat-section">Iniciar nova conversa</div>';
        html += \`
          <div class="new-chat-item create" onclick="createNewContact('\${normalized}')">
            <div class="av">+</div>
            <div class="info">
              <span class="nm">Iniciar com \${fmtPhone(normalized)}</span>
              <span class="ph">Vai criar contato novo no painel</span>
            </div>
            <span class="arrow">→</span>
          </div>
        \`;
      }
    }

    if (!html) {
      html = '<div class="new-chat-hint">Nenhum contato encontrado.<br>Digite um número de WhatsApp pra iniciar conversa nova.</div>';
    }
    out.innerHTML = html;
  }

  function onNewChatKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeNewChat();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Enter aciona a primeira opção visível
      const first = document.querySelector('#new-chat-results .new-chat-item');
      if (first) first.click();
    }
  }

  function pickExistingContact(phone) {
    closeNewChat();
    selectConv(phone);
  }

  async function createNewContact(phone) {
    const nameInp = document.getElementById('new-chat-name');
    const name = nameInp ? nameInp.value.trim() : '';
    try {
      const r = await fetch('/admin/api/contacts/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name: name || null }),
      });
      const data = await r.json();
      if (!r.ok) {
        alert('Erro: ' + (data.error || 'falha ao criar contato'));
        return;
      }
      closeNewChat();
      // Recarrega conversas e seleciona
      await loadConversations({ force: true });
      selectConv(data.phone);
    } catch (err) {
      alert('Falha de conexão: ' + err.message);
    }
  }

  function onSearchChange() {
    searchQuery = document.getElementById('inbox-search-input').value;
    renderInboxList();
  }

  function onChatScroll() {
    const cm = document.getElementById('chat-messages');
    if (!cm) return;
    chatScrollPinned = cm.scrollTop + cm.clientHeight >= cm.scrollHeight - 60;
  }

  function autoGrowChat(el) {
    if (!el) return;
    const min = 22, max = 160;
    el.style.height = 'auto';
    const sh = el.scrollHeight;
    el.style.height = Math.min(max, Math.max(min, sh)) + 'px';
    // Alterna mic/send conforme tem texto ou não
    const bar = document.getElementById('chat-input-bar');
    if (bar) {
      bar.classList.toggle('has-text', el.value.trim().length > 0);
    }
    // Slash commands: detecta "/" no início e mostra dropdown
    showQRDropdownIfTriggered(el);
  }

  // + (anexo) — placeholder até implementar upload de imagem/arquivo
  function onAttachClick(e) {
    if (e) e.stopPropagation();
    alert('Em breve: enviar imagens, documentos e arquivos. Por enquanto use texto e áudio.');
  }

  function handleChatKey(e, phone) {
    // Quick reply dropdown — navegação por teclado
    if (qrDropdownActive && qrDropdownMatches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); qrMoveActive(1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); qrMoveActive(-1); return; }
      if (e.key === 'Tab') { e.preventDefault(); qrPick(qrDropdownIndex); return; }
      if (e.key === 'Escape') { e.preventDefault(); hideQRDropdown(); return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        qrPick(qrDropdownIndex);
        return;
      }
    }
    // Esc cancela reply preview se ativo
    if (e.key === 'Escape' && replyingTo && replyingTo.phone === phone) {
      e.preventDefault();
      clearReplyTo();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatReply(phone);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Emoji picker
  // ─────────────────────────────────────────────────────────────────
  const EMOJI_CATEGORIES = [
    { id: 'recent',   icon: '🕒', emojis: [] },
    { id: 'smileys',  icon: '😊', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','🤡','😈','👿','💀','👻','👽','🤖','💩'] },
    { id: 'gestures', icon: '👍', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👋','🤚','🖐️','✋','🖖','👏','🙌','🤲','🤝','🙏','✍️','💪','🦾','🦵','🦶','👂','👃','🧠','👀','👁️','💋','💄','👅','👄','🦷','🤳','💅','👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵'] },
    { id: 'hearts',   icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💌','💋','💯','💢','💥','💫','💦','💨','🕳️','💣','🔥','✨','⭐','🌟','💎'] },
    { id: 'sport',    icon: '🏋️', emojis: ['💪','🏋️','🏋️‍♂️','🏋️‍♀️','🏃','🏃‍♂️','🏃‍♀️','🚴','🚴‍♂️','🚴‍♀️','🚵','🤸','🤾','⛹️','🥊','🥋','🧘','🧘‍♂️','🧘‍♀️','🏊','🏊‍♂️','🏊‍♀️','🏄','⛷️','🏂','🏆','🥇','🥈','🥉','🎯','⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🎱','🏓','🏸','🥅','⛳','🎮','🕹️'] },
    { id: 'food',     icon: '🍔', emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🥪','🥙','🧆','🌮','🌯','🥗','🍝','🍜','🍲','🥘','🍣','🍱','🍤','🍩','🍪','🎂','🍰','🍦','🍧','🍨','🥧','🍫','🍬','🍭','☕','🍵','🧃','🥤','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾'] },
    { id: 'party',    icon: '🎉', emojis: ['🎉','🎊','🎈','🎁','🎂','🍾','🥂','🍻','🌹','💐','🌷','🌸','🌺','🌻','🎀','🎗️','🎟️','🎫','🎖️','🏅','🏆','🎯','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎵','🎶','🥁','🎷','🎺','🎸','🎻'] },
    { id: 'objects',  icon: '✅', emojis: ['✅','❌','✔️','❎','⭕','🚫','⛔','📛','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔇','🔈','🔉','🔊','📣','📢','💬','💭','🗯️','♨️','💤','⚡','🌈','🚀','✈️','🛫','🛬','🚗','🏠','🏢','🏪','📱','💻','⌚','📷','📹','💡','🔑','🔒','🔓','🔔','🎯','🚩','📍','📌'] },
  ];
  let emojiActiveCat = 'smileys';
  let emojiRecent = [];
  try {
    const saved = localStorage.getItem('emojiRecent');
    if (saved) emojiRecent = JSON.parse(saved).slice(0, 32);
  } catch {}

  function toggleEmojiPanel(e) {
    if (e) e.stopPropagation();
    const panel = document.getElementById('emoji-panel');
    const btn = document.getElementById('chat-emoji-btn');
    if (!panel) return;
    const wasHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (btn) btn.classList.toggle('active', wasHidden);
    if (wasHidden) {
      // Renderiza painel quando abre
      renderEmojiPanel();
    }
  }

  function renderEmojiPanel() {
    const panel = document.getElementById('emoji-panel');
    if (!panel) return;
    // Tabs sempre — mas esconde "recent" se vazio
    const cats = EMOJI_CATEGORIES.filter(c => c.id !== 'recent' || emojiRecent.length > 0);
    if (!cats.find(c => c.id === emojiActiveCat)) emojiActiveCat = 'smileys';
    const tabsHtml = cats.map(c =>
      '<button class="emoji-tab' + (c.id === emojiActiveCat ? ' active' : '') +
        '" data-cat="' + c.id + '" type="button" onclick="event.stopPropagation();selectEmojiCat(\\'' + c.id + '\\')">' + c.icon + '</button>'
    ).join('');
    const activeCat = cats.find(c => c.id === emojiActiveCat);
    const emojis = activeCat.id === 'recent' ? emojiRecent : activeCat.emojis;
    const gridHtml = emojis.map(e =>
      '<button class="emoji-cell" type="button" onclick="event.stopPropagation();insertEmoji(\\'' + e.replace(/'/g, "\\\\'") + '\\')">' + e + '</button>'
    ).join('');
    panel.innerHTML =
      '<div class="emoji-tabs">' + tabsHtml + '</div>' +
      '<div class="emoji-grid">' + gridHtml + '</div>';
  }

  function selectEmojiCat(catId) {
    emojiActiveCat = catId;
    renderEmojiPanel();
  }

  function insertEmoji(emoji) {
    const ta = document.getElementById('chat-input');
    if (!ta) return;
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd || 0;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    ta.value = before + emoji + after;
    ta.selectionStart = ta.selectionEnd = start + emoji.length;
    ta.focus();
    autoGrowChat(ta);
    // Atualiza recentes (move pro topo)
    emojiRecent = [emoji, ...emojiRecent.filter(e => e !== emoji)].slice(0, 32);
    try { localStorage.setItem('emojiRecent', JSON.stringify(emojiRecent)); } catch {}
  }

  // Click fora do painel fecha
  document.addEventListener('click', e => {
    const panel = document.getElementById('emoji-panel');
    const btn = document.getElementById('chat-emoji-btn');
    if (!panel || panel.classList.contains('hidden')) return;
    if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
    panel.classList.add('hidden');
    if (btn) btn.classList.remove('active');
  });
  // Esc fecha emoji panel e modal de nova conversa
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const panel = document.getElementById('emoji-panel');
    if (panel && !panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
      const btn = document.getElementById('chat-emoji-btn');
      if (btn) btn.classList.remove('active');
    }
    const newChat = document.getElementById('new-chat-backdrop');
    if (newChat && !newChat.classList.contains('hidden')) {
      newChat.classList.add('hidden');
    }
    const transfer = document.getElementById('transfer-backdrop');
    if (transfer && !transfer.classList.contains('hidden')) {
      closeTransferModal();
    }
  });

  async function sendChatReply(phone) {
    const ta = document.getElementById('chat-input');
    if (!ta) return;
    let text = ta.value.trim();
    if (!text) return;

    // Modo nota interna: posta nota em vez de reply, e desativa o modo após enviar.
    if (noteModeActive) {
      await sendInternalNote(phone, text);
      return;
    }

    // Reply/citar: prepend quote ao texto enviado
    if (replyingTo && replyingTo.phone === phone && replyingTo.text) {
      text = '> ' + replyingTo.text + '\\n\\n' + text;
    }
    const wasReplyTo = replyingTo;
    replyingTo = null;

    // Optimistic UI: empurra bubble pendente imediatamente.
    const tid = tempId();
    const arr = pendingMessages.get(phone) || [];
    arr.push({ tempId: tid, text, status: 'pending', createdAt: Date.now() });
    pendingMessages.set(phone, arr);

    // Limpa input e reconstrói bar (pra remover preview de reply se tinha)
    ta.value = '';
    autoGrowChat(ta);
    hideQRDropdown();
    chatScrollPinned = true;

    // Re-render do chat com bubble pending visível
    const c = allConversations.find(x => x.from === phone);
    if (c) {
      const msgsEl = document.getElementById('chat-messages');
      if (msgsEl) {
        msgsEl.innerHTML = renderChatMessages(c);
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }
      // Se a barra de input tinha reply preview, força rebuild pra remover
      if (wasReplyTo) {
        const wrap = document.getElementById('chat-input-wrap');
        if (wrap) { wrap.dataset.mode = 'fresh'; syncChatInputBar(c); }
      }
    }

    try {
      const r = await fetch('/admin/api/conversations/' + phone + '/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        markPendingFailed(phone, tid, data.error || 'falha ao enviar');
        return;
      }
      const data = await r.json().catch(() => ({}));
      // Auto-assume: 1ª mensagem em conversa que era da IA → toast claro
      if (data && data.autoAssumed) {
        showAutoAssumedToast();
      }
      // Sucesso: remove a pending (servidor vai mandar via SSE/loadConversations o real)
      clearPendingByTempId(phone, tid);
      await loadConversations();
      const ta2 = document.getElementById('chat-input');
      if (ta2) ta2.focus();
    } catch (e2) {
      markPendingFailed(phone, tid, 'sem conexão');
    }
  }

  // Toast nítido pro auto-assume da IA (1ª msg da consultora desliga IA)
  function showAutoAssumedToast() {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const id = 'toast-auto-' + Date.now();
    const el = document.createElement('div');
    el.className = 'toast auto-assumed';
    el.id = id;
    el.innerHTML =
      '<button class="toast-close" onclick="dismissToast(\\'' + id + '\\')" type="button">×</button>' +
      '<div class="toast-title"><span class="toast-icon">✋</span>Você assumiu o atendimento</div>' +
      '<div class="toast-msg">A IA pausou. Pra ela voltar, clica em "Devolver pra IA" no topo do chat.</div>';
    stack.appendChild(el);
    setTimeout(() => dismissToast(id), 6000);
  }

  function markPendingFailed(phone, tid, reason) {
    const arr = pendingMessages.get(phone);
    if (!arr) return;
    const p = arr.find(x => x.tempId === tid);
    if (p) p.status = 'failed';
    // Re-render pra mostrar estado failed
    const c = allConversations.find(x => x.from === phone);
    if (c && phone === selectedPhone) {
      const msgsEl = document.getElementById('chat-messages');
      if (msgsEl) msgsEl.innerHTML = renderChatMessages(c);
    }
    showToast({ title: '⚠️ Mensagem não enviou', message: reason || 'Tenta de novo' });
  }
  function clearPendingByTempId(phone, tid) {
    const arr = pendingMessages.get(phone);
    if (!arr) return;
    const idx = arr.findIndex(x => x.tempId === tid);
    if (idx >= 0) {
      arr.splice(idx, 1);
      if (!arr.length) pendingMessages.delete(phone);
    }
  }
  function retrySend(phone, mid) {
    const arr = pendingMessages.get(phone);
    if (!arr) return;
    const p = arr.find(x => x.tempId === mid);
    if (!p) return;
    // Volta pra pending e re-tenta
    p.status = 'pending';
    const c = allConversations.find(x => x.from === phone);
    if (c) {
      const msgsEl = document.getElementById('chat-messages');
      if (msgsEl) msgsEl.innerHTML = renderChatMessages(c);
    }
    fetch('/admin/api/conversations/' + phone + '/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: p.text }),
    }).then(r => {
      if (r.ok) {
        clearPendingByTempId(phone, mid);
        loadConversations();
      } else {
        return r.json().catch(() => ({})).then(data => markPendingFailed(phone, mid, data.error || 'falha'));
      }
    }).catch(() => markPendingFailed(phone, mid, 'sem conexão'));
  }

  // ─────────────────────────────────────────────────────────────────
  // Notas internas — toggle no composer + envio + delete
  // ─────────────────────────────────────────────────────────────────
  function toggleNoteMode(e, phone) {
    if (e) e.stopPropagation();
    noteModeActive = !noteModeActive;
    // Limpa reply preview se ativo (quote não combina com nota interna)
    if (noteModeActive && replyingTo && replyingTo.phone === phone) {
      replyingTo = null;
    }
    // Força rebuild da barra de input pra refletir o estado
    const c = allConversations.find(x => x.from === phone);
    if (c) {
      const wrap = document.getElementById('chat-input-wrap');
      if (wrap) { wrap.dataset.mode = 'fresh'; syncChatInputBar(c); }
    }
    setTimeout(() => document.getElementById('chat-input')?.focus(), 50);
  }

  async function sendInternalNote(phone, text) {
    const ta = document.getElementById('chat-input');
    if (!text || !text.trim()) return;
    const trimmed = text.trim();
    if (trimmed.length > 2000) {
      showToast({ severity: 'warn', title: 'Nota muito longa', message: 'Máx 2000 caracteres' });
      return;
    }

    // Optimistic UI: empurra pending note
    const tid = tempId();
    const arr = pendingMessages.get(phone) || [];
    arr.push({ tempId: tid, text: trimmed, status: 'pending', createdAt: Date.now(), isNote: true });
    pendingMessages.set(phone, arr);

    // Limpa input + sai do modo nota + força rebuild
    if (ta) { ta.value = ''; autoGrowChat(ta); }
    noteModeActive = false;
    chatScrollPinned = true;
    const c = allConversations.find(x => x.from === phone);
    if (c) {
      const wrap = document.getElementById('chat-input-wrap');
      if (wrap) { wrap.dataset.mode = 'fresh'; syncChatInputBar(c); }
      const msgsEl = document.getElementById('chat-messages');
      if (msgsEl) {
        msgsEl.innerHTML = renderChatMessages(c);
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }
    }

    try {
      const r = await fetch('/admin/api/conversations/' + phone + '/internal-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        markPendingFailed(phone, tid, data.error || 'falha ao salvar nota');
        return;
      }
      clearPendingByTempId(phone, tid);
      await loadConversations();
      const ta2 = document.getElementById('chat-input');
      if (ta2) ta2.focus();
    } catch (e2) {
      markPendingFailed(phone, tid, 'sem conexão');
    }
  }

  async function deleteNote(noteId) {
    if (!confirm('Apagar essa nota interna? Não dá pra recuperar.')) return;
    try {
      const r = await fetch('/admin/api/internal-notes/' + noteId, { method: 'DELETE' });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        showToast({ severity: 'warn', title: 'Não consegui apagar', message: data.error || 'Tenta de novo' });
        return;
      }
      await loadConversations();
    } catch (e) {
      showToast({ severity: 'warn', title: 'Sem conexão', message: 'Tenta de novo' });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Gravação de áudio pelo composer (consultora/admin manda voz)
  // ─────────────────────────────────────────────────────────────────
  let recState = null;          // { mediaRecorder, stream, chunks, startTime, mimeType, blob, duration, phone }
  let recTimerInterval = null;
  let recAudioUrl = null;        // URL.createObjectURL — limpa no cancel/send

  function pickRecorderMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    const candidates = [
      'audio/mp4',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/webm;codecs=opus',
      'audio/webm',
    ];
    for (const m of candidates) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
    }
    return null;
  }

  async function startRecording(phone) {
    if (recState) return;
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
      alert('Seu navegador não suporta gravar áudio.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      console.error('[audio] getUserMedia falhou', e);
      alert('Não consegui acessar o microfone. Permita o acesso nas configurações do navegador.');
      return;
    }
    const mime = pickRecorderMime();
    let mr;
    try {
      mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      console.error('[audio] MediaRecorder init falhou', e);
      stream.getTracks().forEach(t => t.stop());
      alert('Falha ao iniciar gravação.');
      return;
    }
    const chunks = [];
    mr.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    mr.onstop = () => onRecordingStop();
    mr.onerror = e => { console.error('[audio] mediarecorder error', e); cancelRecording(); };

    recState = {
      mediaRecorder: mr, stream, chunks,
      startTime: Date.now(),
      mimeType: mr.mimeType || mime || 'audio/webm',
      blob: null, duration: 0, phone,
    };
    mr.start();
    swapInputToRecording(phone);
    startRecTimer();

    // Cap de 5min — evita arquivos absurdos e roubar contexto
    setTimeout(() => {
      if (recState && recState.mediaRecorder && recState.mediaRecorder.state === 'recording') {
        stopRecording();
      }
    }, 5 * 60 * 1000);
  }

  function startRecTimer() {
    const tEl = () => document.getElementById('rec-timer');
    const tick = () => {
      if (!recState) return;
      const sec = Math.floor((Date.now() - recState.startTime) / 1000);
      const m = Math.floor(sec / 60), s = sec % 60;
      const el = tEl();
      if (el) el.textContent = m + ':' + String(s).padStart(2, '0');
    };
    tick();
    clearInterval(recTimerInterval);
    recTimerInterval = setInterval(tick, 250);
  }

  function stopRecording() {
    if (!recState || !recState.mediaRecorder) return;
    if (recState.mediaRecorder.state !== 'inactive') {
      recState.mediaRecorder.stop();
    }
  }

  function onRecordingStop() {
    if (!recState) return;
    clearInterval(recTimerInterval);
    recTimerInterval = null;
    const blob = new Blob(recState.chunks, { type: recState.mimeType });
    recState.blob = blob;
    recState.duration = Date.now() - recState.startTime;
    if (recState.stream) recState.stream.getTracks().forEach(t => t.stop());
    swapInputToPreview(recState.phone);
  }

  function cancelRecording() {
    clearInterval(recTimerInterval);
    recTimerInterval = null;
    if (recState) {
      try {
        if (recState.mediaRecorder && recState.mediaRecorder.state !== 'inactive') {
          recState.mediaRecorder.stop();
        }
      } catch {}
      if (recState.stream) recState.stream.getTracks().forEach(t => t.stop());
    }
    if (recAudioUrl) { try { URL.revokeObjectURL(recAudioUrl); } catch {} recAudioUrl = null; }
    const phone = recState ? recState.phone : selectedPhone;
    recState = null;
    // Volta pra input bar normal
    const c = allConversations.find(x => x.from === phone);
    const wrap = document.getElementById('chat-input-wrap');
    if (wrap && c) {
      wrap.dataset.mode = 'fresh';
      syncChatInputBar(c);
    }
  }

  function swapInputToRecording(phone) {
    const wrap = document.getElementById('chat-input-wrap');
    if (!wrap) return;
    wrap.dataset.mode = 'recording';
    wrap.innerHTML = \`
      <div class="chat-input-bar recording">
        <button class="rec-cancel" onclick="cancelRecording()" title="Cancelar gravação">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="rec-status">
          <span class="rec-dot"></span>
          <span class="rec-label">Gravando</span>
          <span class="rec-timer" id="rec-timer">0:00</span>
        </div>
        <button class="rec-stop" onclick="stopRecording()" title="Parar (vai pro preview)">
          <svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
        </button>
      </div>
    \`;
  }

  function swapInputToPreview(phone) {
    const wrap = document.getElementById('chat-input-wrap');
    if (!wrap || !recState || !recState.blob) return;
    wrap.dataset.mode = 'preview';
    if (recAudioUrl) { try { URL.revokeObjectURL(recAudioUrl); } catch {} }
    recAudioUrl = URL.createObjectURL(recState.blob);
    const sec = Math.max(1, Math.round(recState.duration / 1000));
    const dur = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    wrap.innerHTML = \`
      <div class="chat-input-bar preview">
        <button class="rec-cancel" onclick="cancelRecording()" title="Descartar">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6 17.6 20a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
        <audio controls src="\${recAudioUrl}" class="rec-audio"></audio>
        <span class="rec-duration">\${dur}</span>
        <button class="audio-send" id="audio-send-btn" onclick="sendAudioRecording('\${phone}')" title="Enviar áudio">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21l20.99-9L2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    \`;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function sendAudioRecording(phone) {
    if (!recState || !recState.blob) return;
    const sendBtn = document.getElementById('audio-send-btn');
    if (sendBtn) sendBtn.disabled = true;
    const blob = recState.blob;
    const mimeType = (blob.type || recState.mimeType || 'audio/webm').split(';')[0].trim();
    const durationMs = recState.duration;
    try {
      const buf = await blob.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      const r = await fetch('/admin/api/conversations/' + phone + '/reply-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: b64, mimeType, durationMs }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert('Erro ao enviar áudio: ' + (data.error || 'falhou'));
        if (sendBtn) sendBtn.disabled = false;
        return;
      }
      // sucesso — limpa estado, recarrega
      if (data && data.autoAssumed) {
        showAutoAssumedToast();
      }
      if (recAudioUrl) { try { URL.revokeObjectURL(recAudioUrl); } catch {} recAudioUrl = null; }
      recState = null;
      const wrap = document.getElementById('chat-input-wrap');
      if (wrap) wrap.dataset.mode = 'fresh';
      chatScrollPinned = true;
      await loadConversations({ force: true });
    } catch (e2) {
      console.error('[audio] sendAudio falhou', e2);
      alert('Falha de conexão. Tenta de novo.');
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  function toggleReviewPopup(e) {
    e.stopPropagation();
    document.getElementById('review-popup')?.classList.toggle('hidden');
  }

  function setFilter(f) {
    currentFilter = f;
    document.querySelectorAll('#filter-bar .filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === f);
    });
    renderInboxList();
  }

  function clearInboxFilters() {
    searchQuery = '';
    currentFilter = 'all';
    const sb = document.getElementById('inbox-search-input');
    if (sb) sb.value = '';
    document.querySelectorAll('#filter-bar .filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === 'all');
    });
    renderInboxList();
  }

  async function rateConv(phone, rating) {
    const conv = allConversations.find(c => c.from === phone);
    const comment = conv && conv.review ? conv.review.comment : '';
    await fetch('/admin/api/reviews/' + phone, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, comment }),
    });
    if (conv) conv.review = { rating, comment, reviewedAt: Date.now() };
    renderInboxList();
    renderChat();
  }

  async function clearReview(phone) {
    await fetch('/admin/api/reviews/' + phone, { method: 'DELETE' });
    const conv = allConversations.find(c => c.from === phone);
    if (conv) conv.review = null;
    renderInboxList();
    renderChat();
  }

  // Cache simples de display_names dos users (id → display_name)
  let userCache = {};
  async function refreshUserCache() {
    try {
      const r = await fetch('/admin/api/users-public');
      if (r.ok) {
        const u = await r.json();
        userCache = Object.fromEntries(u.map(x => [x.id, x.display_name]));
      }
    } catch {}
  }
  function getUserDisplay(id) { return userCache[id]; }

  async function assumeConv(e, phone) {
    e.stopPropagation();
    const r = await fetch('/admin/api/conversations/' + phone + '/assume', { method: 'POST' });
    if (!r.ok) {
      const data = await r.json();
      alert('Não consegui assumir: ' + (data.by ? data.by + ' já assumiu' : data.error));
    } else {
      selectedPhone = phone; // já abre a conversa pro atendimento
    }
    loadConversations();
  }

  async function releaseConv(e, phone) {
    e.stopPropagation();
    if (!confirm('Devolver pra IA? A IA volta a responder essa conversa.')) return;
    await fetch('/admin/api/conversations/' + phone + '/release', { method: 'POST' });
    // Reset estados do composer humano: modo nota / reply / gravação não fazem
    // sentido depois de devolver pra IA. Sem isso, banner amber fica preso.
    if (recState) { try { cancelRecording(); } catch {} }
    replyingTo = null;
    noteModeActive = false;
    loadConversations();
  }

  // Salva comentário com debounce de 600ms (popup do chat header)
  const commentTimers = {};
  function onCommentChange(phone) {
    const ta = document.getElementById('review-cmt');
    if (!ta) return;
    const text = ta.value;
    clearTimeout(commentTimers[phone]);
    commentTimers[phone] = setTimeout(async () => {
      const conv = allConversations.find(c => c.from === phone);
      const rating = conv && conv.review ? conv.review.rating : 'bad';
      await fetch('/admin/api/reviews/' + phone, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment: text }),
      });
      if (conv) conv.review = { rating, comment: text, reviewedAt: Date.now() };
      renderInboxList();
    }, 600);
  }

  async function clearConv(e, from) {
    e.stopPropagation();
    if (!confirm('Limpar conversa de ' + fmtPhone(from) + '? Histórico e atribuição serão apagados.')) return;
    await fetch('/admin/api/conversations/' + from, { method: 'DELETE' });
    if (selectedPhone === from) {
      // Reseta seleção e força rebuild do chat + ficha do lead pra empty state.
      // Sem isso, o chat continua mostrando a conversa deletada (header, bubbles,
      // composer) porque updateChatIncremental retorna early quando selectedPhone === null.
      selectedPhone = null;
      replyingTo = null;
      noteModeActive = false;
      const layout = document.getElementById('inbox-layout');
      if (layout) layout.classList.remove('has-selected');
      renderChat();
      renderLeadDetail();
    }
    loadConversations();
  }

  const CRUMB_LABELS = {
    prompt:        { label: 'Prompt do agente', tag: '' },
    conversas:     { label: 'Conversas',         tag: '' },
    agendamentos:  { label: 'Agendamentos',      tag: '' },
    alunos:        { label: 'Alunos',            tag: '' },
    users:         { label: 'Usuários & permissões', tag: '' },
    metrics:       { label: 'Métricas',          tag: 'últimos 30d' },
    conexoes:      { label: 'Conexões WhatsApp', tag: '' },
    conhecimento:  { label: 'Conhecimento',      tag: '' },
    modulos:       { label: 'Módulos do prompt', tag: '' },
    playground:    { label: 'Testar agente',     tag: '' },
  };

  function updateCrumb(tab) {
    const meta = CRUMB_LABELS[tab];
    if (!meta) return;
    const now = document.getElementById('crumb-now');
    const tagEl = document.getElementById('crumb-tag');
    if (now) {
      now.firstChild.nodeValue = meta.label + ' ';
    }
    if (tagEl) {
      tagEl.textContent = meta.tag;
      tagEl.style.display = meta.tag ? '' : 'none';
    }
  }

  function setActiveNav(tab) {
    document.querySelectorAll('.nav-item[data-nav], .sub-item[data-nav]').forEach(el => {
      el.classList.toggle('active', el.dataset.nav === tab);
    });
    if (tab === 'prompt' || tab === 'users' || tab === 'conexoes' || tab === 'conhecimento' || tab === 'modulos' || tab === 'playground' || tab === 'atalhos' || tab === 'agente') {
      const cfg = document.getElementById('cfg-group');
      if (cfg) cfg.classList.add('open');
    }
  }

  function switchTab(tab, navEl) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const legacyTab = document.querySelector('.tabs .tab[onclick*="\\'' + tab + '\\'"]');
    if (legacyTab) legacyTab.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');

    setActiveNav(tab);
    updateCrumb(tab);

    // Polling só na aba Inbox — outras paradas
    if (tab === 'conversas') {
      loadConversations();
      startPolling();
    } else {
      stopPolling();
    }
    if (tab === 'prompt') loadPrompt();
    if (tab === 'agendamentos') loadAppointments();
    if (tab === 'alunos') loadStudents();
    if (tab === 'leads') loadLeads();
    if (tab === 'users') loadUsers();
    if (tab === 'metrics') loadMetrics();
    if (tab === 'v2-monitor' && window.__v2mLoadOnTab) window.__v2mLoadOnTab();
    else if (window.__v2mUnloadOnTab) window.__v2mUnloadOnTab();
    if (tab === 'conexoes') {
      loadConnections();
      startConexoesPolling();
    } else {
      stopConexoesPolling();
    }
    if (tab === 'conhecimento') loadKnowledge();
    if (tab === 'modulos') loadModulos();
    if (tab === 'playground') initPlayground();
    if (tab === 'atalhos') qrMgmtRender();
    if (tab === 'agente') loadAgentConfig();
  }

  // ─────────────────────────────────────────────────────────────────
  // Aba Conexões (gerencia status do número WhatsApp conectado)
  // ─────────────────────────────────────────────────────────────────
  let conexoesPollTimer = null;
  function startConexoesPolling() {
    stopConexoesPolling();
    conexoesPollTimer = setInterval(loadConnections, 3000);
  }
  function stopConexoesPolling() {
    if (conexoesPollTimer) { clearInterval(conexoesPollTimer); conexoesPollTimer = null; }
  }

  async function loadConnections() {
    const list = document.getElementById('connections-list');
    if (!list) return;
    try {
      const r = await fetch('/admin/api/whatsapp/status');
      const s = await r.json();
      list.innerHTML = renderConnectionCard(s);
    } catch (e) {
      list.innerHTML = '<div class="empty">Erro ao carregar status: ' + escapeHtml(e.message) + '</div>';
    }
  }

  function renderConnectionCard(s) {
    const isMeta = s.provider === 'meta';
    const isBaileys = s.provider === 'baileys';
    const status = s.status;

    let statusBadge, statusText, providerLabel;
    if (isMeta) {
      providerLabel = 'Meta Cloud API (oficial)';
      statusBadge = '<span class="conn-status open">✓ Ativo</span>';
      statusText = 'Conectado via API oficial da Meta. Sujeito à janela de 24h e templates pra reativação.';
    } else if (isBaileys) {
      providerLabel = 'Baileys (WhatsApp Web)';
      if (status === 'open') {
        statusBadge = '<span class="conn-status open">✓ Conectado</span>';
        statusText = 'Sessão Web ativa. Sem janela 24h, liberdade total de envio.';
      } else if (status === 'qr') {
        statusBadge = '<span class="conn-status qr">⏳ Aguardando escanear</span>';
        statusText = 'Escaneie o QR code abaixo com o WhatsApp do número.';
      } else if (status === 'connecting') {
        statusBadge = '<span class="conn-status qr">🔄 Conectando…</span>';
        statusText = 'Estabelecendo conexão com o servidor WhatsApp.';
      } else {
        statusBadge = '<span class="conn-status close">⚠ ' + status + '</span>';
        statusText = 'Conexão caiu. Tentando reconectar automaticamente.';
      }
    } else {
      providerLabel = s.provider || 'Desconhecido';
      statusBadge = '<span class="conn-status close">⚠ ' + (status || 'indisponível') + '</span>';
      statusText = '';
    }

    const phoneLine = s.me ? '<div class="conn-row"><span class="k">Número conectado</span><span class="v conn-phone">' + escapeHtml(fmtPhone(s.me)) + '</span></div>' : '';
    const sinceLine = s.connectedSince ? '<div class="conn-row"><span class="k">Conectado há</span><span class="v">' + fmtRelativeTime(s.connectedSince) + '</span></div>' : '';

    let qrSection = '';
    if (isBaileys && status === 'qr' && s.qr) {
      qrSection = '<div class="conn-qr-wrap">' +
        '<img class="conn-qr" src="' + s.qr + '" alt="QR Code">' +
        '<ol class="conn-instructions">' +
        '<li>Abra o <strong>WhatsApp</strong> no celular do número</li>' +
        '<li>Configurações → <strong>Aparelhos conectados</strong></li>' +
        '<li>Toque em <strong>Conectar um aparelho</strong></li>' +
        '<li>Aponte a câmera para o QR ao lado</li>' +
        '</ol></div>';
    }

    let actions = '';
    if (isBaileys && status === 'open') {
      actions = '<button class="btn-disconnect-conn" onclick="disconnectConnection()">Desconectar e trocar número</button>';
    }
    if (isMeta) {
      actions = '<p class="conn-meta-note">Pra trocar pra Baileys, defina <code>WHATSAPP_PROVIDER=baileys</code> no Railway e redeploye.</p>';
    }

    return '<div class="connection-card">' +
      '<div class="conn-head">' +
        '<div class="conn-title-wrap">' +
          '<div class="conn-icon">📱</div>' +
          '<div>' +
            '<div class="conn-provider">' + escapeHtml(providerLabel) + '</div>' +
            '<div class="conn-status-text">' + escapeHtml(statusText) + '</div>' +
          '</div>' +
        '</div>' +
        statusBadge +
      '</div>' +
      '<div class="conn-body">' +
        phoneLine + sinceLine +
      '</div>' +
      qrSection +
      (actions ? '<div class="conn-actions">' + actions + '</div>' : '') +
    '</div>' +
    '<div class="connection-card disabled">' +
      '<div class="conn-head">' +
        '<div class="conn-title-wrap">' +
          '<div class="conn-icon" style="opacity:.4">➕</div>' +
          '<div>' +
            '<div class="conn-provider">Adicionar segundo número</div>' +
            '<div class="conn-status-text">Em breve — multi-número permitirá rodar academia + marketing em números separados.</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ─────────────────────────────────────────────────────────────────
  // Aba Conhecimento (academia_info — knowledge base editável)
  // ─────────────────────────────────────────────────────────────────
  const CAT_LABELS_KB = {
    promo:         '🔥 Promo atual',
    planos:        '💰 Planos & valores',
    estrutura:     '🏋️ Modalidades & estrutura',
    horarios:      '⏰ Horários',
    contato:       '📍 Localização & contato',
    institucional: '⭐ Diferenciais',
  };
  // ─────────────────────────────────────────────────────────────────
  // Aba Agente — config v2 (timing + buffer). Núcleo do prompt v2 fica
  // gerenciado via "Módulos do prompt" + "Conhecimento" (jeito oficial).
  // Backend ainda aceita override de nucleo_v2 via API direta pra
  // emergência, mas UI não expõe mais.
  // ─────────────────────────────────────────────────────────────────
  const agenteSaveTimers = {};

  async function loadAgentConfig() {
    try {
      const r = await fetch('/admin/api/agent-config');
      if (!r.ok) {
        if (r.status === 403) {
          document.getElementById('tab-agente').innerHTML =
            '<div class="empty-state"><div class="es-icon">🔒</div><div class="es-title">Acesso restrito</div><div class="es-sub">Só admins podem editar configs do agente.</div></div>';
        }
        return;
      }
      const cfg = await r.json();

      // Timing — mostra em segundos
      const minS = Math.round((cfg.typing_delay_min_ms || 0) / 1000);
      const maxS = Math.round((cfg.typing_delay_max_ms || 0) / 1000);
      const bufS = Math.round((cfg.buffer_window_ms || 0) / 1000);
      const elMin = document.getElementById('ac-typing-min');
      const elMax = document.getElementById('ac-typing-max');
      const elBuf = document.getElementById('ac-buffer');
      if (elMin) elMin.value = minS;
      if (elMax) elMax.value = maxS;
      if (elBuf) elBuf.value = bufS;

      // Persona — identidade, tom e perguntas do roteiro
      if (cfg.persona && cfg.persona.current) {
        const p = cfg.persona.current;
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        setVal('ac-persona-nome-agente', p.nomeAgente);
        setVal('ac-persona-nome-negocio', p.nomeNegocio);
        setVal('ac-persona-descricao-jeito', p.descricaoJeito);
        setVal('ac-persona-abertura', p.abertura);
        setVal('ac-persona-binaria-treinando', p.binariaTreinando);
        setVal('ac-persona-binaria-objetivo', p.binariaObjetivo);
        setVal('ac-persona-binaria-objetivo-drill', p.binariaObjetivoDrill);
        setVal('ac-persona-binaria-nome', p.binariaNome);
        setVal('ac-persona-binaria-turno', p.binariaTurno);
        setVal('ac-persona-binaria-dia', p.binariaDia);
        setVal('ac-persona-binaria-hora', p.binariaHora);
        setVal('ac-persona-defletor-1', p.defletorValor1);
        setVal('ac-persona-defletor-2', p.defletorValor2);
        const elGq = document.getElementById('ac-persona-girias-quentes');
        const elGp = document.getElementById('ac-persona-girias-proibidas');
        const elFx = document.getElementById('ac-persona-frases-extra');
        if (elGq) elGq.value = (p.giriasQuentes || []).join('\\n');
        if (elGp) elGp.value = (p.giriasProibidas || []).join('\\n');
        if (elFx) elFx.value = (p.frasesProibidasExtra || []).join('\\n');
        const pill = document.getElementById('persona-status-pill');
        if (pill) {
          pill.textContent = cfg.persona.isCustom ? '(Customizado)' : '(Default)';
          pill.classList.toggle('custom', !!cfg.persona.isCustom);
        }
        const revertBtn = document.getElementById('persona-revert-btn');
        if (revertBtn) revertBtn.style.display = cfg.persona.hasPrevious ? '' : 'none';
      }
    } catch (e) {
      console.error('[agent-config] erro ao carregar:', e.message);
    }
  }

  // Persona — debounce 800ms + auto-save (mais conservador que timing
  // porque manda payload maior + revalida).
  let personaSaveTimer = null;
  function onPersonaChange() {
    const status = document.getElementById('persona-save-status');
    if (status) status.textContent = '✏️ Editando...';
    clearTimeout(personaSaveTimer);
    personaSaveTimer = setTimeout(savePersona, 800);
  }

  function readPersonaInputs() {
    const getVal = (id) => (document.getElementById(id)?.value || '').trim();
    const elGq = document.getElementById('ac-persona-girias-quentes');
    const elGp = document.getElementById('ac-persona-girias-proibidas');
    const elFx = document.getElementById('ac-persona-frases-extra');
    const splitLines = (s) => (s || '').split('\\n').map(x => x.trim()).filter(x => x.length > 0);
    return {
      nomeAgente: getVal('ac-persona-nome-agente'),
      nomeNegocio: getVal('ac-persona-nome-negocio'),
      descricaoJeito: getVal('ac-persona-descricao-jeito'),
      abertura: getVal('ac-persona-abertura'),
      binariaTreinando: getVal('ac-persona-binaria-treinando'),
      binariaObjetivo: getVal('ac-persona-binaria-objetivo'),
      binariaObjetivoDrill: getVal('ac-persona-binaria-objetivo-drill'),
      binariaNome: getVal('ac-persona-binaria-nome'),
      binariaTurno: getVal('ac-persona-binaria-turno'),
      binariaDia: getVal('ac-persona-binaria-dia'),
      binariaHora: getVal('ac-persona-binaria-hora'),
      defletorValor1: getVal('ac-persona-defletor-1'),
      defletorValor2: getVal('ac-persona-defletor-2'),
      giriasQuentes: splitLines(elGq?.value),
      giriasProibidas: splitLines(elGp?.value),
      frasesProibidasExtra: splitLines(elFx?.value),
    };
  }

  async function savePersona() {
    const status = document.getElementById('persona-save-status');
    const persona = readPersonaInputs();
    try {
      const r = await fetch('/admin/api/agent-config/persona', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: persona }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        if (status) status.textContent = '⚠ Erro';
        showToast({ severity: 'warn', title: 'Erro ao salvar persona', message: data.error || 'Tenta de novo' });
        return;
      }
      if (status) status.textContent = '✓ Salvo';
      const pill = document.getElementById('persona-status-pill');
      if (pill) { pill.textContent = '(Customizado)'; pill.classList.add('custom'); }
      // Após salvar, snapshot anterior pode existir → mostra botão revert
      const revertBtn = document.getElementById('persona-revert-btn');
      if (revertBtn) revertBtn.style.display = '';
      setTimeout(() => { if (status) status.textContent = ''; }, 2000);
    } catch (e) {
      if (status) status.textContent = '⚠ Sem conexão';
      showToast({ severity: 'warn', title: 'Sem conexão', message: 'Tenta de novo' });
    }
  }

  async function restorePersona() {
    if (!confirm('Restaurar identidade e tom ao default? Versão atual será guardada como anterior pra dar pra voltar se quiser.')) return;
    try {
      const r = await fetch('/admin/api/agent-config/persona', { method: 'DELETE' });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        showToast({ severity: 'warn', title: 'Erro ao restaurar', message: data.error || 'Tenta de novo' });
        return;
      }
      await loadAgentConfig();
      showToast({ severity: 'info', title: '↺ Restaurado', message: 'Voltou pro default. Use "Voltar para versão anterior" se quiser desfazer.' });
    } catch (e) {
      showToast({ severity: 'warn', title: 'Sem conexão', message: 'Tenta de novo' });
    }
  }

  async function revertPersona() {
    if (!confirm('Voltar pra versão anterior da persona? A versão atual fica como "anterior" — dá pra fazer undo de novo.')) return;
    try {
      const r = await fetch('/admin/api/agent-config/persona/revert', { method: 'POST' });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        showToast({ severity: 'warn', title: 'Erro ao reverter', message: data.error || 'Sem versão anterior' });
        return;
      }
      await loadAgentConfig();
      showToast({ severity: 'info', title: '↶ Revertido', message: 'Voltou pra versão anterior.' });
    } catch (e) {
      showToast({ severity: 'warn', title: 'Sem conexão', message: 'Tenta de novo' });
    }
  }

  // onChange dos inputs numéricos (timing/buffer) — debounce 600ms + auto-save
  function onAgenteConfigChange(key, inputEl, multiplier) {
    const valSec = Number(inputEl.value);
    if (!Number.isFinite(valSec) || valSec < 0) return;
    const valMs = Math.round(valSec * (multiplier || 1));
    clearTimeout(agenteSaveTimers[key]);
    agenteSaveTimers[key] = setTimeout(async () => {
      try {
        const r = await fetch('/admin/api/agent-config/' + key, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: valMs }),
        });
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          showToast({ severity: 'warn', title: 'Erro ao salvar', message: data.error || 'Tenta de novo' });
        }
      } catch (e) {
        showToast({ severity: 'warn', title: 'Sem conexão', message: 'Tenta de novo' });
      }
    }, 600);
  }

  async function restoreAgenteConfig(key) {
    const labels = {
      typing_delay_min_ms: 'delay mínimo',
      typing_delay_max_ms: 'delay máximo',
      buffer_window_ms: 'janela de buffer',
    };
    if (!confirm('Restaurar ' + (labels[key] || key) + ' ao default? A customização atual será perdida.')) return;
    try {
      const r = await fetch('/admin/api/agent-config/' + key, { method: 'DELETE' });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        showToast({ severity: 'warn', title: 'Erro ao restaurar', message: data.error || 'Tenta de novo' });
        return;
      }
      // Recarrega tudo pra refletir defaults
      await loadAgentConfig();
      showToast({ severity: 'info', title: '↺ Restaurado', message: (labels[key] || key) + ' voltou pro default.' });
    } catch (e) {
      showToast({ severity: 'warn', title: 'Sem conexão', message: 'Tenta de novo' });
    }
  }

  async function loadKnowledge() {
    const list = document.getElementById('kb-list');
    if (!list) return;
    try {
      const r = await fetch('/admin/api/academia-info');
      const items = await r.json();
      const byCat = {};
      for (const it of items) {
        const c = it.category || 'outros';
        (byCat[c] = byCat[c] || []).push(it);
      }
      const order = ['promo','planos','estrutura','horarios','contato','institucional'];
      let html = '';
      for (const cat of order) {
        if (!byCat[cat]) continue;
        html += '<div class="kb-category">';
        html += '<div class="kb-category-title">' + (CAT_LABELS_KB[cat] || cat) + '</div>';
        for (const it of byCat[cat]) {
          html += '<div class="kb-item">';
          html += '<div>';
          html += '<div class="kb-label">' + escapeHtml(it.label || it.key) + '</div>';
          if (it.description) html += '<div class="kb-desc">' + escapeHtml(it.description) + '</div>';
          html += '</div>';
          html += '<div>';
          const isMulti = it.key === 'modalidades' || it.key === 'diferenciais' || it.key === 'plano_observacoes' || it.key === 'promo_atual_descricao';
          if (isMulti) {
            html += '<textarea class="kb-input" data-key="' + escapeHtml(it.key) + '" rows="3" onblur="saveKnowledge(this)">' + escapeHtml(it.value || '') + '</textarea>';
          } else {
            html += '<input class="kb-input" type="text" data-key="' + escapeHtml(it.key) + '" value="' + escapeHtml(it.value || '') + '" onblur="saveKnowledge(this)">';
          }
          html += '<div class="kb-saving" id="kb-saving-' + escapeHtml(it.key) + '"></div>';
          html += '</div>';
          html += '</div>';
        }
        html += '</div>';
      }
      list.innerHTML = html || '<div class="empty">Nenhum item de conhecimento.</div>';
    } catch (e) {
      list.innerHTML = '<div class="empty">Erro: ' + escapeHtml(e.message) + '</div>';
    }
  }

  async function saveKnowledge(el) {
    const key = el.dataset.key;
    const value = el.value;
    const status = document.getElementById('kb-saving-' + key);
    if (status) { status.textContent = 'Salvando...'; status.className = 'kb-saving'; }
    try {
      const r = await fetch('/admin/api/academia-info/' + encodeURIComponent(key), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'falha');
      }
      if (status) { status.textContent = '✓ Salvo'; status.className = 'kb-saving ok'; }
      setTimeout(() => { if (status) status.textContent = ''; }, 1500);
    } catch (e) {
      if (status) { status.textContent = 'Erro: ' + e.message; status.className = 'kb-saving err'; }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Aba Módulos do prompt (28 módulos editáveis do Johnny v2)
  // ─────────────────────────────────────────────────────────────────
  const CAT_LABELS_MOD = {
    conhecimento: '📚 Conhecimento factual',
    objecoes:     '🛡️ Objeções',
    situacionais: '🎯 Situacionais',
    sistema:      '⚙️ Sistema',
  };
  let modulosCache = [];
  async function loadModulos() {
    const list = document.getElementById('modulos-list');
    if (!list) return;
    try {
      const r = await fetch('/admin/api/prompt-modules');
      const items = await r.json();
      modulosCache = items;
      const byCat = {};
      for (const it of items) {
        const c = it.category || 'outros';
        (byCat[c] = byCat[c] || []).push(it);
      }
      const order = ['conhecimento','objecoes','situacionais','sistema'];
      let html = '';
      for (const cat of order) {
        if (!byCat[cat]) continue;
        const catItems = byCat[cat];
        html += '<div class="kb-category">';
        html += '<div class="kb-category-title">' + (CAT_LABELS_MOD[cat] || cat) + ' <span style="opacity:.5;font-weight:400">(' + catItems.length + ')</span></div>';
        for (const m of catItems) {
          const safeName = escapeHtml(m.name);
          const safeTitle = escapeHtml(m.title || m.name);
          const charCount = (m.content || '').length;
          const activeCls = m.active ? '' : ' inactive';
          html += '<div class="modulo-item' + activeCls + '">';
          html += '<div class="modulo-head" onclick="toggleModulo(this)">';
          html += '<div>';
          html += '<div class="modulo-title">' + safeTitle + '</div>';
          html += '<div class="modulo-meta">' + safeName + ' · ' + charCount + ' chars · ' + (m.active ? 'ativo' : 'desativado') + '</div>';
          html += '</div>';
          html += '<svg class="modulo-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>';
          html += '</div>';
          html += '<div class="modulo-body" style="display:none">';
          html += '<textarea class="modulo-textarea" data-name="' + safeName + '" oninput="onModuloEdit(this)">' + escapeHtml(m.content) + '</textarea>';
          html += '<div class="modulo-actions">';
          html += '<button class="btn-add" onclick="saveModulo(\\'' + safeName + '\\')">💾 Salvar</button>';
          html += '<button class="btn-clear" onclick="toggleModuloActive(\\'' + safeName + '\\', ' + (m.active ? 'false' : 'true') + ')">' + (m.active ? '🚫 Desativar' : '✓ Ativar') + '</button>';
          html += '<span class="kb-saving" id="mod-saving-' + safeName + '"></span>';
          html += '</div>';
          html += '</div>';
          html += '</div>';
        }
        html += '</div>';
      }
      list.innerHTML = html || '<div class="empty">Nenhum módulo cadastrado.</div>';
    } catch (e) {
      list.innerHTML = '<div class="empty">Erro: ' + escapeHtml(e.message) + '</div>';
    }
  }

  function toggleModulo(headEl) {
    const body = headEl.parentElement.querySelector('.modulo-body');
    if (!body) return;
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }

  function onModuloEdit(el) {
    const status = document.getElementById('mod-saving-' + el.dataset.name);
    if (status) { status.textContent = 'Não salvo'; status.className = 'kb-saving err'; }
  }

  async function saveModulo(name) {
    const ta = document.querySelector('.modulo-textarea[data-name="' + name + '"]');
    const status = document.getElementById('mod-saving-' + name);
    if (!ta) return;
    if (status) { status.textContent = 'Salvando...'; status.className = 'kb-saving'; }
    try {
      const cached = modulosCache.find(m => m.name === name);
      const r = await fetch('/admin/api/prompt-modules/' + encodeURIComponent(name), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: ta.value,
          title: cached?.title || name,
          category: cached?.category || null,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'falha');
      }
      if (status) { status.textContent = '✓ Salvo'; status.className = 'kb-saving ok'; }
      setTimeout(() => { if (status) status.textContent = ''; }, 2000);
    } catch (e) {
      if (status) { status.textContent = 'Erro: ' + e.message; status.className = 'kb-saving err'; }
    }
  }

  async function toggleModuloActive(name, makeActive) {
    try {
      await fetch('/admin/api/prompt-modules/' + encodeURIComponent(name) + '/active', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !!makeActive }),
      });
      loadModulos();
    } catch (e) { alert('Erro: ' + e.message); }
  }

  // ─────────────────────────────────────────────────────────────────
  // Aba Playground (testar agente — v1 e v2 com debug)
  // ─────────────────────────────────────────────────────────────────
  let playgroundHistory = [];
  let playgroundState = null;  // só usado em v2 (state simulado)
  let playgroundVersion = 'v1';

  // Cenários pré-carregados pras Baterias A-E (Anexo 5 do plano de refatoração)
  const PG_CENARIOS = {
    'A.1 — Lead novo padrão': ['oi, queria saber sobre a academia'],
    'A.2 — Lead pula pra valor': ['oi, qual o valor?'],
    'A.3 — Insiste em valor (3x)': ['qual o valor?', 'quanto custa?', 'me passa os valores aí'],
    'A.4 — Qualificação completa': ['oi', 'tô parado faz tempo', 'quero emagrecer', 'Maria', 'manhã', 'terça', '9h'],
    'B.1 — Tá caro': ['oi quanto custa', 'qual o valor', 'me passa os valores', 'tá caro pra mim'],
    'B.2 — Vou pensar': ['oi tudo bem? me conta sobre os planos', 'ah vou pensar e te falo'],
    'B.3 — Mês que vem': ['oi quero treinar', 'vou começar no próximo mês, tô me organizando'],
    'B.4 — Gympass': ['vocês atendem Gympass?'],
    'B.5 — Mensal': ['oi quero treinar', 'tô parado', 'emagrecer', 'João', 'manhã', 'quero só o plano mensal'],
    'C.1 — Gestante': ['oi tô grávida, posso treinar?'],
    'C.2 — Idoso': ['tenho 67 anos, vocês atendem idoso?'],
    'C.3 — Lesão': ['fiz cirurgia no joelho ano passado, posso treinar?'],
    'D.1 — É IA?': ['oi, você é robô?'],
    'D.2 — Lead aluno (financeiro)': ['oi minha mensalidade não foi descontada'],
    'D.3 — Grosseria': ['isso é uma porcaria, vocês são uns ladrões'],
    'D.4 — Errou número': ['oi mãe, tô chegando'],
    'E.1 — Mudança de objeção (reset contador)': ['oi quero saber valores', 'qual o valor', 'qual o valor', 'tá caro', 'mas eu preciso falar com minha esposa'],
    'E.2 — 3 tentativas mesma objeção (handoff)': ['oi', 'tá caro', 'tá muito caro', 'sério mesmo, tá caro pra mim'],
    'E.3 — Conversa longa (>15 msgs)': ['oi', 'tô parado', 'quero saúde', 'João', 'tarde', 'quarta', '14h', 'beleza confirmado', 'aliás, tem estacionamento?', 'e vestiário?', 'qual o horário?', 'aceita Pix?', 'tem aula de zumba?', 'meu joelho dói às vezes', 'preciso adiar pra outra semana'],
    'E.4 — Tag malformada (resiliência)': ['oi qual valor'],
  };

  function initPlayground() {
    // Popula select de cenários
    const sel = document.getElementById('pg-cenario');
    if (sel && sel.options.length === 1) {
      for (const name of Object.keys(PG_CENARIOS)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      }
    }
    onPlaygroundVersionChange();
    setTimeout(() => document.getElementById('playground-input')?.focus(), 100);
  }

  function onPlaygroundVersionChange() {
    const sel = document.getElementById('pg-version');
    playgroundVersion = sel ? sel.value : 'v1';
    const cenarioSel = document.getElementById('pg-cenario');
    const debug = document.getElementById('pg-debug');
    if (playgroundVersion === 'v2') {
      if (cenarioSel) cenarioSel.style.display = '';
      if (debug) debug.classList.remove('hidden');
    } else {
      if (cenarioSel) cenarioSel.style.display = 'none';
      if (debug) debug.classList.add('hidden');
    }
    resetPlayground();
  }

  function resetPlayground() {
    playgroundHistory = [];
    playgroundState = null;
    const t = document.getElementById('playground-thread');
    if (t) t.innerHTML = '<div class="playground-hint">Comece digitando ou carregue um cenário pré-definido.</div>';
    const stats = document.getElementById('playground-stats');
    if (stats) stats.style.display = 'none';
    const sel = document.getElementById('pg-cenario');
    if (sel) sel.value = '';
    renderPlaygroundDebug();
  }

  async function loadCenario() {
    const sel = document.getElementById('pg-cenario');
    const name = sel?.value;
    if (!name || !PG_CENARIOS[name]) return;
    resetPlayground();
    const msgs = PG_CENARIOS[name];
    const inp = document.getElementById('playground-input');
    for (const m of msgs) {
      if (inp) inp.value = m;
      await sendPlayground();
      await new Promise(r => setTimeout(r, 200));
    }
  }

  function onPlaygroundKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPlayground();
    }
  }

  function renderPlaygroundDebug() {
    const el = document.getElementById('pg-state-content');
    if (!el) return;
    if (!playgroundState) { el.textContent = '—'; return; }
    const s = playgroundState;
    let html = '';
    html += '<div class="pg-state-row"><span class="k">Estágio</span><span class="v">' + (s.estagio_atual || '—') + '</span></div>';
    if (s.proxima_acao) html += '<div class="pg-state-row"><span class="k">Próx. ação</span><span class="v">' + escapeHtml(s.proxima_acao) + '</span></div>';
    html += '<div class="pg-state-row"><span class="k">Insistências valor</span><span class="v">' + (s.insistencias_valor || 0) + '/3</span></div>';
    if (s.objetivo) html += '<div class="pg-state-row"><span class="k">Objetivo</span><span class="v">' + s.objetivo + '</span></div>';
    if (s.modalidade_recomendada) html += '<div class="pg-state-row"><span class="k">Modalidade</span><span class="v">' + s.modalidade_recomendada + '</span></div>';
    if (s.disponibilidade) html += '<div class="pg-state-row"><span class="k">Disponibilidade</span><span class="v">' + s.disponibilidade + '</span></div>';
    if (s.objecao_ativa) {
      html += '<div class="pg-state-row"><span class="k">Objeção ativa</span><span class="v">' + s.objecao_ativa + '</span></div>';
      html += '<div class="pg-state-row"><span class="k">Tentativas</span><span class="v">' + (s.tentativas_objecao_atual || 0) + '/3</span></div>';
    }
    if (Array.isArray(s.objecoes_levantadas) && s.objecoes_levantadas.length) {
      html += '<div class="pg-state-row"><span class="k">Histórico objeções</span><span class="v">' + s.objecoes_levantadas.join(', ') + '</span></div>';
    }
    if (s.modulo_pendente) {
      html += '<div class="pg-state-row"><span class="k">Módulo pendente</span><span class="v" style="color:var(--brand-light)">' + s.modulo_pendente + '</span></div>';
    }
    el.innerHTML = html;
  }

  async function sendPlayground() {
    const inp = document.getElementById('playground-input');
    const btn = document.getElementById('playground-send-btn');
    const thread = document.getElementById('playground-thread');
    if (!inp || !thread) return;
    const text = inp.value.trim();
    if (!text) return;
    const hint = thread.querySelector('.playground-hint');
    if (hint) hint.remove();
    const userBubble = document.createElement('div');
    userBubble.className = 'pg-bubble user';
    userBubble.textContent = text;
    thread.appendChild(userBubble);
    inp.value = '';
    inp.disabled = true;
    if (btn) btn.disabled = true;
    const thinking = document.createElement('div');
    thinking.className = 'pg-bubble thinking';
    thinking.textContent = 'pensando…';
    thread.appendChild(thinking);
    thread.scrollTop = thread.scrollHeight;

    try {
      const endpoint = playgroundVersion === 'v2' ? '/admin/api/playground/v2/message' : '/admin/api/playground/message';
      const body = playgroundVersion === 'v2'
        ? { history: playgroundHistory, message: text, state: playgroundState }
        : { history: playgroundHistory, message: text };
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      thinking.remove();
      if (!r.ok) {
        const err = document.createElement('div');
        err.className = 'pg-bubble assistant';
        err.style.color = 'var(--danger)';
        err.textContent = 'Erro: ' + (data.error || 'falhou');
        thread.appendChild(err);
        return;
      }
      const aiBubble = document.createElement('div');
      aiBubble.className = 'pg-bubble assistant';
      aiBubble.textContent = data.text;
      thread.appendChild(aiBubble);
      playgroundHistory.push({ role: 'user', content: text });
      playgroundHistory.push({ role: 'assistant', content: data.text });
      // v2 retorna estado novo
      if (playgroundVersion === 'v2' && data.state) {
        playgroundState = data.state;
        renderPlaygroundDebug();
      }
      const stats = document.getElementById('playground-stats');
      if (stats) {
        stats.style.display = 'flex';
        document.getElementById('pg-tokens').textContent =
          'in: ' + data.tokensInput + ' (cache: ' + (data.cacheReadTokens || 0) + ') · out: ' + data.tokensOutput;
        document.getElementById('pg-latency').textContent = data.latencyMs + ' ms';
        const brl = (data.estimatedCostUSD * 5.5).toFixed(4);
        document.getElementById('pg-cost').textContent = '~R$ ' + brl;
      }
      thread.scrollTop = thread.scrollHeight;
    } catch (e) {
      thinking.remove();
      const err = document.createElement('div');
      err.className = 'pg-bubble assistant';
      err.style.color = 'var(--danger)';
      err.textContent = 'Falha de conexão: ' + e.message;
      thread.appendChild(err);
    } finally {
      inp.disabled = false;
      if (btn) btn.disabled = false;
      inp.focus();
    }
  }

  async function disconnectConnection() {
    if (!confirm('Desconectar o WhatsApp atual? Você precisará escanear novo QR pra reconectar (com este ou outro número).')) return;
    try {
      const r = await fetch('/admin/api/baileys/disconnect', { method: 'POST' });
      const data = await r.json();
      if (!r.ok) {
        alert('Erro: ' + (data.error || 'falhou'));
        return;
      }
      // Recarrega status — depois de ~2s aparece QR novo
      setTimeout(loadConnections, 1500);
    } catch (e) {
      alert('Falha de conexão: ' + e.message);
    }
  }

  // ─── USERS ───
  async function loadUsers() {
    const res = await fetch('/admin/api/users');
    if (!res.ok) {
      document.getElementById('users-list').innerHTML = '<div class="empty">Acesso negado</div>';
      return;
    }
    const users = await res.json();
    const list = document.getElementById('users-list');
    if (!users.length) {
      list.innerHTML = '<div class="empty">Nenhum usuário cadastrado</div>';
      return;
    }
    list.innerHTML = users.map(u => {
      const phone = u.phone ? formatBRPhone(u.phone) : '<span style="color:#555">sem telefone</span>';
      const created = new Date(u.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const roleBadge = u.role === 'admin'
        ? '<span class="review-badge good">👑 admin</span>'
        : '<span class="assign-badge ai">🎯 consultora</span>';
      const activeBadge = u.active
        ? '<span class="assign-badge mine">✓ ativo</span>'
        : '<span class="review-badge bad">✗ inativo</span>';
      const isMe = me && me.id === u.id;
      return \`
        <div class="student-row">
          <span class="phone">\${u.username}\${isMe ? ' <small style=\"color:#666\">(você)</small>' : ''}</span>
          <span class="name">\${u.display_name}</span>
          <span class="notes">\${roleBadge} \${activeBadge}</span>
          <span style="color:#888;font-size:12px">\${phone}</span>
          \${u.active
            ? \`<button class="btn-clear" onclick="setUserActive(\${u.id}, false)">Desativar</button>\`
            : \`<button class="btn-clear" style="border-color:#22c55e44;color:#4ade80" onclick="setUserActive(\${u.id}, true)">Reativar</button>\`}
          <button class="btn-clear" onclick="resetUserPassword(\${u.id})">Reset senha</button>
          \${isMe ? '' : \`<button class="btn-clear" onclick="removeUser(\${u.id})">Excluir</button>\`}
        </div>
      \`;
    }).join('');
  }

  async function addUser() {
    const username    = document.getElementById('u-username').value.trim();
    const displayName = document.getElementById('u-displayname').value.trim();
    const role        = document.getElementById('u-role').value;
    const phone       = document.getElementById('u-phone').value.trim();
    const password    = document.getElementById('u-password').value;
    if (!username || !displayName || !password) { alert('Preencha usuário, nome e senha.'); return; }
    if (password.length < 8) { alert('Senha precisa ter pelo menos 8 caracteres.'); return; }
    const r = await fetch('/admin/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, displayName, role, phone }),
    });
    const data = await r.json();
    if (!r.ok) { alert('Erro: ' + (data.error || 'falha')); return; }
    ['u-username','u-displayname','u-phone','u-password'].forEach(id => document.getElementById(id).value = '');
    refreshUserCache();
    loadUsers();
  }

  async function setUserActive(id, active) {
    const r = await fetch('/admin/api/users/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    if (!r.ok) {
      const data = await r.json();
      alert('Erro: ' + (data.error || 'falha'));
    }
    refreshUserCache();
    loadUsers();
  }

  async function resetUserPassword(id) {
    const newPwd = prompt('Nova senha (mín 8 caracteres):');
    if (!newPwd) return;
    if (newPwd.length < 8) { alert('Senha precisa ter pelo menos 8 caracteres.'); return; }
    const r = await fetch('/admin/api/users/' + id + '/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPwd }),
    });
    if (!r.ok) {
      const data = await r.json();
      alert('Erro: ' + (data.error || 'falha'));
    } else {
      alert('Senha redefinida. Próximo login do usuário usará a nova.');
    }
  }

  async function removeUser(id) {
    if (!confirm('Excluir esse usuário definitivamente? Sessões ativas serão invalidadas.')) return;
    const r = await fetch('/admin/api/users/' + id, { method: 'DELETE' });
    if (!r.ok) {
      const data = await r.json();
      alert('Erro: ' + (data.error || 'falha'));
    }
    refreshUserCache();
    loadUsers();
  }

  // ─── METRICS ───
  async function loadMetrics() {
    const res = await fetch('/admin/api/metrics');
    const grid = document.getElementById('metrics-grid');
    if (!res.ok) {
      grid.innerHTML = '<div class="empty">Acesso negado ou métricas indisponíveis</div>';
      return;
    }
    const m = await res.json();
    const card = (title, value, sub) => \`
      <div class="metric-card">
        <div class="metric-card-label">\${title}</div>
        <div class="metric-card-value">\${value}</div>
        \${sub ? \`<div class="metric-card-sub">\${sub}</div>\` : ''}
      </div>
    \`;
    let html = '';
    html += card('Conversas iniciadas (30d)', m.totalConversations30d, '');
    html += card('Em atendimento humano agora', m.activeHumanHandoff, '');
    html += card('% c/ handoff humano', (m.handoffPct * 100).toFixed(1) + '%', m.handoffCount + ' de ' + m.totalConversations30d);
    html += card('Tempo médio 1ª resposta IA', m.avgFirstReplySec ? Math.round(m.avgFirstReplySec) + 's' : '—', m.firstReplySamples + ' amostras');
    html += card('Pendentes de assumir', m.unassignedActive, 'conversas com msgs nas últ 24h sem dono');
    html += card('Total de alunos cadastrados', m.studentsCount, '');
    if (m.byConsultor && m.byConsultor.length) {
      html += '<div class="metric-card" style="grid-column:1/-1">';
      html += '<div class="metric-card-label">Conversas atendidas por consultora (30d)</div>';
      html += '<div style="display:flex;flex-direction:column;gap:0;margin-top:8px">';
      html += m.byConsultor.map(c => \`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-subtle)"><span style="color:var(--text-primary);font-size:14px">\${escapeHtml(c.display_name)}</span><span style="font-weight:600;font-size:15px;color:var(--brand);font-variant-numeric:tabular-nums">\${c.count}</span></div>\`).join('');
      html += '</div></div>';
    }
    grid.innerHTML = html;
  }

  function formatBRPhone(phone) {
    const n = String(phone || '').replace(/\\D/g, '');
    if (n.startsWith('55') && n.length === 13) {
      return \`(\${n.slice(2, 4)}) \${n.slice(4, 9)}-\${n.slice(9)}\`;
    }
    return phone;
  }

  let allStudents = []; // cache pra usar no modal de nova conversa

  async function loadStudents() {
    const res = await fetch('/admin/api/students');
    const students = await res.json();
    allStudents = students;
    const navBadge = document.getElementById('nav-badge-students');
    if (navBadge) navBadge.textContent = String(students.length);
    const list = document.getElementById('students-list');
    if (!students.length) {
      list.innerHTML = '<div class="empty">Nenhum aluno cadastrado ainda. Adiciona pelo formulário acima.</div>';
      return;
    }
    list.innerHTML = students.map(s => \`
      <div class="student-row">
        <span class="phone">\${formatBRPhone(s.phone)}</span>
        <span class="name">\${s.name || '<span style="color:#555">sem nome</span>'}</span>
        <span class="notes">\${s.notes || ''}</span>
        <button class="btn-msg-student" onclick="messageStudent('\${s.phone}', \${JSON.stringify(s.name || '').replace(/"/g, '&quot;')})" title="Abrir conversa com esse aluno">💬 Mandar msg</button>
        <button class="btn-clear" onclick="removeStudent('\${s.phone}')">Remover</button>
      </div>
    \`).join('');
  }

  // Abre conversa com um aluno (cria contato se não existe), pula pra aba Inbox
  async function messageStudent(phone, name) {
    try {
      const r = await fetch('/admin/api/contacts/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name: name || null }),
      });
      const data = await r.json();
      if (!r.ok) {
        alert('Erro: ' + (data.error || 'falha ao abrir conversa'));
        return;
      }
      // Pula pra aba conversas e seleciona
      switchTab('conversas');
      await loadConversations({ force: true });
      selectConv(data.phone);
    } catch (err) {
      alert('Falha de conexão: ' + err.message);
    }
  }

  async function addStudent() {
    const phoneRaw = document.getElementById('st-phone').value.trim();
    const phone = phoneRaw.replace(/\\D/g, '');
    const name = document.getElementById('st-name').value.trim();
    const notes = document.getElementById('st-notes').value.trim();
    if (!phone || phone.length < 12) { alert('Telefone inválido. Use o formato 5551995304633 (DDI+DDD+número).'); return; }
    const res = await fetch('/admin/api/students/' + phone, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, notes }),
    });
    if (!res.ok) { alert('Erro ao adicionar.'); return; }
    document.getElementById('st-phone').value = '';
    document.getElementById('st-name').value = '';
    document.getElementById('st-notes').value = '';
    loadStudents();
  }

  async function removeStudent(phone) {
    if (!confirm('Remover ' + formatBRPhone(phone) + '? A IA voltará a tratar esse número como lead.')) return;
    await fetch('/admin/api/students/' + phone, { method: 'DELETE' });
    loadStudents();
  }

  // ─────────────────────────────────────────────────────────────────
  // Leads — contatos não-alunos no funil (manual + auto-captura via IA)
  // ─────────────────────────────────────────────────────────────────
  async function loadLeads() {
    try {
      const res = await fetch('/admin/api/leads');
      if (!res.ok) return;
      const leads = await res.json();
      const navBadge = document.getElementById('nav-badge-leads');
      if (navBadge) navBadge.textContent = String(leads.length);
      const list = document.getElementById('leads-list');
      if (!list) return;
      if (!leads.length) {
        list.innerHTML =
          '<div class="empty-state">' +
            '<div class="es-icon">👥</div>' +
            '<div class="es-title">Nenhum lead cadastrado ainda</div>' +
            '<div class="es-sub">Adiciona pelo formulário acima ou aguarda alguém mandar mensagem — a IA cadastra automático quando o lead se apresenta.</div>' +
          '</div>';
        return;
      }
      list.innerHTML = leads.map(l => {
        const name = l.name || '<span style="color:#555">sem nome</span>';
        const lastSeen = l.lastContactAt ? fmtRelativeTime(l.lastContactAt) : '—';
        const msgs = l.messageCount || 0;
        return '<div class="student-row">' +
                 '<span class="phone">' + formatBRPhone(l.phone) + '</span>' +
                 '<span class="name" onclick="editLeadName(\\'' + l.phone + '\\', ' + JSON.stringify(l.name || '').replace(/"/g, '&quot;') + ')" title="Clica pra editar nome" style="cursor:pointer">' + name + '</span>' +
                 '<span class="notes" style="font-size:11.5px;color:var(--text-muted)">' + msgs + ' msgs · há ' + lastSeen + '</span>' +
                 '<button class="btn-msg-student" onclick="messageLead(\\'' + l.phone + '\\', ' + JSON.stringify(l.name || '').replace(/"/g, '&quot;') + ')" title="Abrir conversa">💬 Conversa</button>' +
                 '<button class="btn-clear" onclick="removeLead(\\'' + l.phone + '\\')">Remover</button>' +
               '</div>';
      }).join('');
    } catch (e) {
      console.error('[leads] erro ao carregar:', e.message);
    }
  }

  async function addLead() {
    const phoneRaw = document.getElementById('lead-phone').value.trim();
    const phone = phoneRaw.replace(/\\D/g, '');
    const name = document.getElementById('lead-name').value.trim();
    if (!phone || phone.length < 12) {
      alert('Telefone inválido. Use o formato 5551995304633 (DDI+DDD+número).');
      return;
    }
    try {
      const res = await fetch('/admin/api/leads/' + phone, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert('Erro: ' + (data.error || 'falha ao cadastrar'));
        return;
      }
      document.getElementById('lead-phone').value = '';
      document.getElementById('lead-name').value = '';
      loadLeads();
    } catch (e) {
      alert('Falha de conexão: ' + e.message);
    }
  }

  async function editLeadName(phone, currentName) {
    const newName = prompt('Editar nome do lead ' + formatBRPhone(phone) + ':', currentName || '');
    if (newName === null) return; // cancelou
    try {
      const res = await fetch('/admin/api/leads/' + phone, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert('Erro: ' + (data.error || 'falha ao atualizar'));
        return;
      }
      loadLeads();
      // Se a conversa tá aberta, recarrega tb pra atualizar o header
      if (selectedPhone === phone) loadConversations();
    } catch (e) {
      alert('Falha de conexão: ' + e.message);
    }
  }

  async function removeLead(phone) {
    if (!confirm('Remover lead ' + formatBRPhone(phone) + '? Histórico de conversa será apagado também.')) return;
    try {
      const res = await fetch('/admin/api/leads/' + phone, { method: 'DELETE' });
      if (!res.ok) {
        alert('Erro ao remover.');
        return;
      }
      // Se conversa aberta era essa, limpa seleção
      if (selectedPhone === phone) {
        selectedPhone = null;
        replyingTo = null;
        noteModeActive = false;
        const layout = document.getElementById('inbox-layout');
        if (layout) layout.classList.remove('has-selected');
        renderChat();
        renderLeadDetail();
      }
      loadLeads();
      loadConversations();
    } catch (e) {
      alert('Falha de conexão: ' + e.message);
    }
  }

  async function messageLead(phone, name) {
    try {
      const r = await fetch('/admin/api/contacts/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name: name || null }),
      });
      const data = await r.json();
      if (!r.ok) {
        alert('Erro: ' + (data.error || 'falha ao abrir conversa'));
        return;
      }
      switchTab('conversas');
      await loadConversations({ force: true });
      selectConv(data.phone);
    } catch (err) {
      alert('Falha de conexão: ' + err.message);
    }
  }

  const STATUS_LABEL = {
    pending:   '🟡 Pendente',
    confirmed: '🟢 Confirmado',
    cancelled: '🔴 Cancelado',
    no_show:   '⚫ Não compareceu',
  };

  async function loadAppointments() {
    const res = await fetch('/admin/api/appointments');
    const appts = await res.json();
    const navBadge = document.getElementById('nav-badge-appt');
    if (navBadge) navBadge.textContent = String(appts.filter(a => a.status === 'pending' || a.status === 'confirmed').length);
    const list = document.getElementById('appt-list');

    if (!appts.length) {
      list.innerHTML = '<div class="empty">📅 Nenhum agendamento ainda</div>';
      return;
    }

    list.innerHTML = appts.map(a => {
      const date = new Date(a.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const phone = fmtPhone(a.phone);
      const when = a.scheduled_hour
        ? \`\${a.scheduled_day || '—'} às \${a.scheduled_hour}\`
        : \`\${a.scheduled_day || '—'} — \${a.scheduled_turn || '—'}\`;
      return \`
        <div class="appt-card">
          <div class="appt-icon">📅</div>
          <div class="appt-when">
            <div class="appt-when-text">\${escapeHtml(when)}</div>
            <div class="appt-modality">\${escapeHtml(a.modality || '—')}</div>
          </div>
          <div class="appt-lead">
            <div class="appt-lead-name">\${escapeHtml(a.name || 'Sem nome')}</div>
            <div class="appt-lead-phone">\${phone}</div>
          </div>
          <div class="appt-date">\${date}</div>
          <select class="appt-status-select" onchange="updateStatus(\${a.id}, this.value)" data-status="\${a.status}">
            \${['pending','confirmed','cancelled','no_show'].map(s =>
              \`<option value="\${s}" \${a.status === s ? 'selected' : ''}>\${STATUS_LABEL[s]}</option>\`
            ).join('')}
          </select>
        </div>
      \`;
    }).join('');
  }

  async function updateStatus(id, status) {
    await fetch('/admin/api/appointments/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
  }

  let me = null;
  async function loadMe() {
    try {
      const r = await fetch('/admin/api/me');
      if (!r.ok) { location.href = '/admin/login'; return; }
      const data = await r.json();
      me = data.user;
      // User pill no rail
      const initials = (me.displayName || me.username || '··').trim().split(/\\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase() || '··';
      const avEl = document.getElementById('rail-avatar');
      const nmEl = document.getElementById('rail-username');
      const roleEl = document.getElementById('rail-userrole');
      if (avEl) avEl.textContent = initials;
      if (nmEl) nmEl.textContent = me.displayName || me.username;
      if (roleEl) roleEl.textContent = me.role === 'admin' ? 'Admin' : 'Consultora';
      // Mostra abas só de admin
      if (me.role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
      }
    } catch {
      location.href = '/admin/login';
    }
  }

  async function logout() {
    await fetch('/admin/api/auth/logout', { method: 'POST' });
    location.href = '/admin/login';
  }

  // ─── Pin do rail (Cmd+B / Ctrl+B) ───
  function setupRailPin() {
    const rail = document.getElementById('rail');
    const app = document.getElementById('app');
    const hint = document.getElementById('rail-hint');
    if (!rail || !app) return;
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        rail.classList.toggle('pinned');
        app.classList.toggle('pinned');
        try { localStorage.setItem('railPinned', rail.classList.contains('pinned') ? '1' : '0'); } catch {}
      }
    });
    // Restaura preferência
    try {
      if (localStorage.getItem('railPinned') === '1') {
        rail.classList.add('pinned');
        app.classList.add('pinned');
      }
    } catch {}
    // Hint na primeira visita
    try {
      if (!localStorage.getItem('railHintSeen') && hint) {
        setTimeout(() => hint.classList.add('show'), 1200);
        setTimeout(() => { hint.classList.remove('show'); localStorage.setItem('railHintSeen','1'); }, 6500);
      }
    } catch {}
  }

  // ─────────────────────────────────────────────────────────────────
  // SSE — atualização em tempo real (substitui polling 5s)
  // EventSource reconecta sozinho se cair. Polling existente fica de
  // fallback: rodando em freq mais baixa quando SSE tá saudável.
  // ─────────────────────────────────────────────────────────────────
  let sseSource = null;
  let sseHealthy = false;
  let sseFailures = 0;

  // Throttle do load — se vários eventos vêm em rajada, só recarrega 1x
  let convReloadTimer = null;
  function scheduleConversationsReload() {
    if (convReloadTimer) return;
    convReloadTimer = setTimeout(() => {
      convReloadTimer = null;
      // Só recarrega se a aba conversas tá ativa OU pra atualizar badges
      const onConvTab = document.getElementById('tab-conversas')?.classList.contains('active');
      if (onConvTab) loadConversations();
      else loadConversations(); // sempre atualiza pra badge nav refletir
    }, 200);
  }

  function startSSE() {
    if (sseSource) return;
    try {
      sseSource = new EventSource('/admin/api/events');
      sseSource.addEventListener('hello', () => {
        sseHealthy = true;
        sseFailures = 0;
        console.log('[sse] conectado — atualização em tempo real ativa');
      });
      sseSource.addEventListener('conversation.changed', (e) => {
        scheduleConversationsReload();
      });
      sseSource.addEventListener('connections.changed', () => {
        const onConexoesTab = document.getElementById('tab-conexoes')?.classList.contains('active');
        if (onConexoesTab) loadConnections();
        // Sempre re-checa o banner (status pode ter mudado pra qualquer aba)
        refreshConnectionBanner();
      });
      sseSource.addEventListener('appointments.changed', () => {
        const onApptTab = document.getElementById('tab-agendamentos')?.classList.contains('active');
        if (onApptTab) loadAppointments();
      });
      sseSource.addEventListener('students.changed', () => {
        const onAlunosTab = document.getElementById('tab-alunos')?.classList.contains('active');
        if (onAlunosTab) loadStudents();
      });
      sseSource.addEventListener('leads.changed', () => {
        // Sempre atualiza badge da nav. Recarrega lista só se aba aberta.
        const onLeadsTab = document.getElementById('tab-leads')?.classList.contains('active');
        if (onLeadsTab) loadLeads();
        else {
          // Atualiza pelo menos o badge sem renderizar lista inteira
          fetch('/admin/api/leads').then(r => r.ok ? r.json() : []).then(leads => {
            const navBadge = document.getElementById('nav-badge-leads');
            if (navBadge) navBadge.textContent = String(leads.length);
          }).catch(() => {});
        }
      });
      sseSource.addEventListener('alert', (e) => {
        try {
          const data = JSON.parse(e.data);
          showToast(data);
        } catch (err) { console.error('[sse] alert parse fail:', err); }
      });
      sseSource.addEventListener('v2.metrics.changed', () => {
        // Recarrega só se a aba v2-monitor está ativa (otimização)
        const onV2Tab = document.getElementById('tab-v2-monitor')?.classList.contains('active');
        if (onV2Tab && window.__v2mLoadOnTab) v2mLoadAll();
      });
      sseSource.onerror = () => {
        sseFailures++;
        sseHealthy = false;
        if (sseFailures === 1) console.warn('[sse] conexão caiu — reconectando…');
        if (sseFailures > 5) console.warn('[sse] falhou muitas vezes, polling continua de backup');
      };
    } catch (e) {
      console.error('[sse] falha ao iniciar:', e);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Sistema de notificações: banner persistente + toasts
  // ─────────────────────────────────────────────────────────────────
  async function refreshConnectionBanner() {
    try {
      const r = await fetch('/admin/api/whatsapp/status');
      const s = await r.json();
      const banner = document.getElementById('conn-banner');
      const txt = document.getElementById('conn-banner-text');
      if (!banner || !txt) return;
      // Mostra banner quando WhatsApp NÃO tá 'open' E provider é Baileys
      // (Meta sempre considera 'open' do nosso lado — erros viram toasts)
      if (s.provider === 'baileys' && s.status !== 'open') {
        const map = {
          qr:         'WhatsApp aguardando você escanear o QR.',
          connecting: 'WhatsApp conectando…',
          close:      'WhatsApp desconectado. Mensagens não chegam.',
          unavailable:'Sistema WhatsApp indisponível.',
        };
        txt.textContent = map[s.status] || ('WhatsApp em estado: ' + s.status);
        banner.classList.remove('hidden');
      } else {
        banner.classList.add('hidden');
      }
    } catch {}
  }

  let toastSeq = 0;
  function showToast({ severity = 'warn', title, message, code }) {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const id = 'toast-' + (++toastSeq);
    const icon = severity === 'error' ? '❌' : severity === 'info' ? 'ℹ️' : '⚠️';
    const el = document.createElement('div');
    el.className = 'toast ' + severity;
    el.id = id;
    el.innerHTML =
      '<button class="toast-close" onclick="dismissToast(\\'' + id + '\\')">×</button>' +
      '<div class="toast-title"><span class="toast-icon">' + icon + '</span>' + escapeHtml(title || '') + '</div>' +
      '<div class="toast-msg">' + escapeHtml(message || '') + '</div>';
    el.onclick = (e) => {
      if (e.target.closest('.toast-close')) return;
      // Click no toast → vai pra Conexões se for relacionado a conexão
      if (code === 'whatsapp_disconnected' || code === 'whatsapp_reconnected') {
        switchTab('conexoes');
      }
      dismissToast(id);
    };
    stack.appendChild(el);
    // Auto-dismiss após 6s (info), 8s (warn), 12s (error)
    const ttl = severity === 'error' ? 12000 : severity === 'info' ? 6000 : 8000;
    setTimeout(() => dismissToast(id), ttl);

    // Browser notification (se tiver permissão)
    if (severity !== 'info' && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try {
        const n = new Notification(title || 'STRONIX SDR', { body: message || '', tag: code || id, silent: false });
        n.onclick = () => { window.focus(); n.close(); };
        setTimeout(() => n.close(), 8000);
      } catch {}
    }
  }

  function dismissToast(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('fading');
    setTimeout(() => el.remove(), 250);
  }

  (async () => {
    setupRailPin();
    await loadMe();
    await refreshUserCache();
    // Default: aba Conversas (em vez de Prompt)
    switchTab('conversas');

    // Permissão de notificação (silencioso se já concedida ou negada)
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    // SSE depois do loadMe (precisa cookie de auth setado)
    startSSE();
    // Banner de conexão (visível enquanto WhatsApp tá fora)
    refreshConnectionBanner();
    // Pre-fetch contagem de leads pra badge na nav (sem renderizar a lista)
    fetch('/admin/api/leads').then(r => r.ok ? r.json() : []).then(leads => {
      const navBadge = document.getElementById('nav-badge-leads');
      if (navBadge) navBadge.textContent = String(leads.length);
    }).catch(() => {});
  })();

  // ─────────────────────────────────────────────────────────────────────
  // PR #37 — Monitor v2 (admin tooling)
  // ─────────────────────────────────────────────────────────────────────

  let v2mState = {
    period: '7d',
    statusFilter: '',
    selectedPhone: null,
    conversations: [],
    pollHandle: null,
    commentDebounce: null,
  };

  async function v2mLoadAll() {
    v2mState.period = document.getElementById('v2m-period')?.value || '7d';
    await Promise.all([v2mLoadAlerts(), v2mLoadMetrics(), v2mLoadConversations(), v2mLoadVersion()]);
  }

  async function v2mLoadAlerts() {
    try {
      const r = await fetch('/admin/api/v2/alerts');
      if (!r.ok) return;
      const data = await r.json();
      const c = document.getElementById('v2m-alerts');
      const navBadge = document.getElementById('nav-badge-v2-alerts');
      if (!data.alerts.length) {
        c.innerHTML = '';
        if (navBadge) navBadge.style.display = 'none';
        return;
      }
      if (navBadge) {
        navBadge.style.display = '';
        navBadge.textContent = data.alerts.length;
      }
      c.innerHTML = data.alerts.map(a => \`
        <div class="v2m-alert \${a.level}">
          <span class="ico">\${a.level === 'critical' ? '🚨' : '⚠️'}</span>
          <div class="body">
            <strong>\${escapeHtml(a.message)}</strong>
            <span>code: <code>\${escapeHtml(a.code)}</code></span>
          </div>
        </div>
      \`).join('');
    } catch (e) { console.error('[v2m] alerts:', e.message); }
  }

  async function v2mLoadMetrics() {
    try {
      const r = await fetch('/admin/api/v2/metrics?period=' + encodeURIComponent(v2mState.period));
      if (!r.ok) return;
      const m = await r.json();

      const tempoH = m.tempo_medio_ate_agendou_ms
        ? (m.tempo_medio_ate_agendou_ms / (1000 * 60 * 60)).toFixed(1) + 'h'
        : '—';

      const cards = [
        { lbl: 'Total leads v2', val: m.total_leads, sub: m.period },
        { lbl: '% agendou', val: m.pct_agendou.toFixed(1) + '%', sub: m.funil['agendamento_confirmado'] || 0 + ' conversas' },
        { lbl: '% handoff', val: m.pct_handoff.toFixed(1) + '%', sub: m.funil['handoff_humano'] || 0 + ' conversas' },
        { lbl: '% perdeu (>24h)', val: m.pct_perdeu.toFixed(1) + '%' },
        { lbl: 'Tempo médio até agendar', val: tempoH },
        { lbl: 'Total turnos', val: m.total_turns, sub: 'tag_ok + tag_esquecida' },
        { lbl: '% tag esquecida', val: m.pct_tag_esquecida.toFixed(1) + '%', sub: 'limite alerta: 30%', alert: m.pct_tag_esquecida > 30 },
        { lbl: '% router empty', val: m.pct_router_empty.toFixed(1) + '%', sub: 'cobertura insuficiente' },
        { lbl: 'Crashes', val: m.crashes, alert: m.crashes > 0 },
        { lbl: 'Preço inventado', val: m.preco_inventado, alert: m.preco_inventado > 0 },
        { lbl: 'Valor antecipado', val: m.valor_antecipado, alert: m.valor_antecipado > 0 },
      ];

      document.getElementById('v2m-metrics').innerHTML = cards.map(c => \`
        <div class="v2m-card\${c.alert ? ' alert-bg' : ''}">
          <div class="lbl">\${escapeHtml(c.lbl)}</div>
          <div class="val">\${escapeHtml(String(c.val))}</div>
          \${c.sub ? '<div class="sub">' + escapeHtml(String(c.sub)) + '</div>' : ''}
        </div>
      \`).join('');

      // Funil: distribuição de leads por estágio
      const funilEl = document.getElementById('v2m-funil');
      const funilEntries = Object.entries(m.funil).sort((a,b) => b[1] - a[1]);
      if (funilEntries.length) {
        const max = Math.max(...funilEntries.map(([,v]) => v));
        funilEl.style.display = '';
        funilEl.innerHTML = '<h4>Distribuição por estágio</h4>' + funilEntries.map(([k, v]) => \`
          <div class="v2m-funil-row">
            <span class="name">\${escapeHtml(k)}</span>
            <div class="bar"><div style="width:\${(v/max*100).toFixed(0)}%"></div></div>
            <span class="ct">\${v}</span>
          </div>
        \`).join('');
      } else {
        funilEl.style.display = 'none';
      }
    } catch (e) { console.error('[v2m] metrics:', e.message); }
  }

  async function v2mLoadConversations() {
    try {
      const r = await fetch('/admin/api/v2/conversations?limit=300');
      if (!r.ok) {
        document.getElementById('v2m-list').innerHTML = '<div class="empty" style="padding:30px;text-align:center;color:var(--text-muted)">Erro ao carregar.</div>';
        return;
      }
      const data = await r.json();
      v2mState.conversations = data.conversations || [];
      // Counters por status
      const counts = { '': v2mState.conversations.length, em_andamento: 0, agendou: 0, handoff: 0, perdeu: 0 };
      for (const c of v2mState.conversations) counts[c._status] = (counts[c._status] || 0) + 1;
      for (const k of ['', 'em_andamento', 'agendou', 'handoff', 'perdeu']) {
        const el = document.getElementById('v2m-ct-' + (k || 'all'));
        if (el) el.textContent = counts[k] || 0;
      }
      v2mRenderList();
    } catch (e) { console.error('[v2m] conversations:', e.message); }
  }

  function v2mRenderList() {
    const el = document.getElementById('v2m-list');
    let convs = v2mState.conversations;
    if (v2mState.statusFilter) convs = convs.filter(c => c._status === v2mState.statusFilter);
    const reviewFilter = document.getElementById('v2m-review-filter')?.value;
    if (reviewFilter === 'none') convs = convs.filter(c => !c.review_rating);
    else if (reviewFilter) convs = convs.filter(c => c.review_rating === reviewFilter);

    if (!convs.length) {
      el.innerHTML = '<div class="empty" style="padding:30px;text-align:center;color:var(--text-muted)">Nenhuma conversa neste filtro.</div>';
      return;
    }
    el.innerHTML = convs.map(c => {
      const reviewMark = c.review_rating === 'good' ? '<span class="review-mark">✅</span>' :
                       c.review_rating === 'aceitavel' ? '<span class="review-mark">⚠️</span>' :
                       c.review_rating === 'bad' ? '<span class="review-mark">❌</span>' : '';
      const elapsed = c.last_contact_at ? fmtRelativeTime(c.last_contact_at) : '—';
      const preview = (c.last_message || '').replace(/\\[(?:ESTADO|MODULO_REQUERIDO|AGENDAMENTO):[^\\]]+\\]/g, '').trim().slice(0, 100);
      return \`
        <div class="v2m-conv \${v2mState.selectedPhone === c.phone ? 'selected' : ''}" onclick="v2mSelect('\${c.phone}')">
          <div class="top">
            <span class="ph">\${escapeHtml(c._phone_masked)}</span>
            <span class="badges">
              \${reviewMark}
              <span class="badge b-\${c._status}">\${c._status.replace('_', ' ')}</span>
            </span>
          </div>
          <div class="stage">\${escapeHtml(c.estagio_atual || '—')} · \${escapeHtml(elapsed)} · \${c.total_mensagens_lead || 0} msgs lead / \${c.total_mensagens_johnny || 0} johnny</div>
          <div class="preview">\${escapeHtml(preview)}</div>
          \${c.modulo_pendente ? '<div class="modules">📦 módulo pendente: ' + escapeHtml(c.modulo_pendente) + '</div>' : ''}
        </div>
      \`;
    }).join('');
  }

  function v2mFilterStatus(el, status) {
    document.querySelectorAll('.v2m-filters .v2m-pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    v2mState.statusFilter = status;
    v2mRenderList();
  }

  async function v2mSelect(phone) {
    v2mState.selectedPhone = phone;
    v2mRenderList();
    const el = document.getElementById('v2m-detail');
    el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted)">Carregando…</div>';
    try {
      const r = await fetch('/admin/api/v2/conversation/' + encodeURIComponent(phone));
      if (!r.ok) {
        el.innerHTML = '<div style="padding:20px;color:var(--danger)">Erro ao carregar detalhe.</div>';
        return;
      }
      const d = await r.json();
      const s = d.state || {};
      const r2 = d.review;
      const fields = [
        ['Estágio', s.estagio_atual],
        ['Próx. ação', s.proxima_acao],
        ['Insistências valor', (s.insistencias_valor || 0) + '/3'],
        ['Objetivo', s.objetivo],
        ['Modalidade', s.modalidade_recomendada],
        ['Disponibilidade', s.disponibilidade],
        ['Objeção ativa', s.objecao_ativa],
        ['Tentativas objeção', (s.tentativas_objecao_atual || 0) + '/3'],
        ['Histórico objeções', (s.objecoes_levantadas || []).join(', ')],
        ['Módulo pendente', s.modulo_pendente],
        ['Aula agendada', s.aula_experimental_agendada ? 'sim' : 'não'],
        ['Data agendamento', s.data_agendamento],
        ['Hora agendamento', s.hora_agendamento],
        ['Total msgs', (s.total_mensagens_lead || 0) + ' lead / ' + (s.total_mensagens_johnny || 0) + ' johnny'],
        ['Resumo dinâmico', s.resumo_dinamico_n_msgs ? (s.resumo_dinamico_n_msgs + ' msgs resumidas') : '—'],
      ].filter(f => f[1] !== null && f[1] !== undefined && f[1] !== '');

      const msgsHtml = (d.messages || []).slice(-30).map(m => {
        const cleaned = (m.content || '').replace(/\\[(?:ESTADO|MODULO_REQUERIDO|AGENDAMENTO):[^\\]]+\\]/g, '').trim();
        return \`<div class="msg \${m.role}"><span class="who">\${m.role === 'user' ? 'lead' : 'johnny'}</span> \${escapeHtml(cleaned)}</div>\`;
      }).join('');

      const eventsHtml = (d.events || []).slice(0, 8).map(e =>
        \`<div style="font-size:10px;color:var(--text-muted);font-family:monospace">\${new Date(e.timestamp).toLocaleString('pt-BR')} · \${escapeHtml(e.event_type)}</div>\`
      ).join('');

      const rating = r2?.rating || '';
      const comment = r2?.comment || '';

      el.innerHTML = \`
        <h3>\${escapeHtml(d.contact?.name || d.phone_masked)}</h3>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;font-family:monospace">\${escapeHtml(d.phone_masked)}</div>

        <div class="review-buttons">
          <button class="r-good \${rating === 'good' ? 'active' : ''}" onclick="v2mReview('\${phone}', 'good')">✅ Deu certo</button>
          <button class="r-aceitavel \${rating === 'aceitavel' ? 'active' : ''}" onclick="v2mReview('\${phone}', 'aceitavel')">⚠️ Aceitável</button>
          <button class="r-bad \${rating === 'bad' ? 'active' : ''}" onclick="v2mReview('\${phone}', 'bad')">❌ Deu errado</button>
        </div>
        <textarea id="v2m-comment-\${phone}" placeholder="O que faria diferente? (autosalva)" oninput="v2mDebounceComment('\${phone}', '\${rating || 'aceitavel'}')">\${escapeHtml(comment)}</textarea>

        <div class="actions">
          <button onclick="v2mForceResumo('\${phone}')">⟳ Forçar resumo agora</button>
        </div>

        <div style="margin-top:14px">\${fields.map(f => '<div class="field"><div class="k">' + escapeHtml(f[0]) + '</div><div class="v">' + escapeHtml(String(f[1])) + '</div></div>').join('')}</div>

        \${eventsHtml ? '<div style="margin-top:14px"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Eventos recentes</div>' + eventsHtml + '</div>' : ''}

        \${msgsHtml ? '<div style="margin-top:14px;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Histórico</div><div class="msgs">' + msgsHtml + '</div>' : ''}
      \`;
    } catch (e) { console.error('[v2m] detail:', e.message); }
  }

  async function v2mReview(phone, rating) {
    const comment = document.getElementById('v2m-comment-' + phone)?.value || '';
    try {
      const r = await fetch('/admin/api/v2/review/' + encodeURIComponent(phone), {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ rating, comment }),
      });
      if (!r.ok) throw new Error('falhou');
      // Re-render do detalhe atualizado
      v2mSelect(phone);
      // Atualiza lista (review marker)
      v2mLoadConversations();
    } catch (e) { alert('Erro ao salvar avaliação: ' + e.message); }
  }

  function v2mDebounceComment(phone, currentRating) {
    if (v2mState.commentDebounce) clearTimeout(v2mState.commentDebounce);
    v2mState.commentDebounce = setTimeout(() => {
      // Garante que tem rating (default 'aceitavel' se vazio)
      const conv = v2mState.conversations.find(c => c.phone === phone);
      const rating = conv?.review_rating || currentRating || 'aceitavel';
      v2mReview(phone, rating);
    }, 700);
  }

  async function v2mForceResumo(phone) {
    try {
      const r = await fetch('/admin/api/v2/force-resumo/' + encodeURIComponent(phone), { method: 'POST' });
      const data = await r.json();
      alert('Resumo: ' + (data.result?.reason || 'ok'));
      v2mSelect(phone);
    } catch (e) { alert('Erro: ' + e.message); }
  }

  async function v2mLoadVersion() {
    try {
      const r = await fetch('/admin/api/v2/version');
      if (!r.ok) return;
      const v = await r.json();
      const badge = document.getElementById('v2m-version-badge');
      if (badge) {
        badge.textContent = v.current + (v.override ? ' (override)' : ' (env)');
        badge.style.color = v.current === 'v2' ? 'var(--brand)' : 'var(--text-muted)';
      }
      const pauseBtn = document.getElementById('v2m-pause-btn');
      const resumeBtn = document.getElementById('v2m-resume-btn');
      if (pauseBtn && resumeBtn) {
        pauseBtn.style.display = (v.current === 'v2') ? '' : 'none';
        resumeBtn.style.display = v.override ? '' : 'none';
      }
    } catch (e) { console.error('[v2m] version:', e.message); }
  }

  async function v2mPauseV2() {
    if (!confirm('Pausar v2 imediatamente? Próximas mensagens caem em v1.')) return;
    if (!confirm('Tem CERTEZA? Confirme novamente.')) return;
    try {
      const r = await fetch('/admin/api/v2/pause', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ confirm: 'PAUSAR_V2_AGORA' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'falhou');
      alert('✅ v2 pausado. Próximas mensagens em v1.');
      v2mLoadVersion();
    } catch (e) { alert('Erro: ' + e.message); }
  }

  async function v2mResumeV2() {
    if (!confirm('Remover override e voltar pra env var?')) return;
    try {
      const r = await fetch('/admin/api/v2/resume', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ confirm: 'RESUMIR_V2' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'falhou');
      alert('✅ override removido. Versão atual: ' + data.current);
      v2mLoadVersion();
    } catch (e) { alert('Erro: ' + e.message); }
  }

  function v2mExportCsv(ev) {
    ev.preventDefault();
    window.location = '/admin/api/v2/export?period=' + encodeURIComponent(v2mState.period);
  }

  // ─── Onboarding tour ───
  const V2M_TOUR_STEPS = [
    { title: '🚦 Bem-vindo ao Monitor v2', text: 'Aqui você acompanha em tempo real todas as conversas do agente v2 durante a janela de validação.' },
    { title: '📊 Métricas e funil', text: 'Os cards mostram conversões, % de agendamento, handoff, tag esquecida, valor antecipado, crashes. O funil mostra distribuição por estágio. Filtra por período no canto superior direito.' },
    { title: '✅ Avalie cada conversa', text: 'Clica numa conversa pra abrir o detalhe lateral. Use ✅ / ⚠️ / ❌ pra avaliar e escreva o que faria diferente. Tudo autosalva.' },
    { title: '⏸ Pausa de emergência', text: 'Se algo der errado, o botão vermelho "Pausar v2" volta pra v1 instantâneo (sem restart). Use sem medo.' },
  ];
  let v2mTourIdx = 0;
  function v2mTourStart() {
    if (localStorage.getItem('v2m_tour_seen') === '1') return;
    v2mTourIdx = 0;
    document.getElementById('v2m-tour').style.display = 'flex';
    v2mTourRender();
  }
  function v2mTourRender() {
    const s = V2M_TOUR_STEPS[v2mTourIdx];
    document.getElementById('v2m-tour-step').textContent = 'Passo ' + (v2mTourIdx + 1) + ' de ' + V2M_TOUR_STEPS.length;
    document.getElementById('v2m-tour-title').textContent = s.title;
    document.getElementById('v2m-tour-text').textContent = s.text;
    document.getElementById('v2m-tour-next').textContent = (v2mTourIdx === V2M_TOUR_STEPS.length - 1) ? 'Começar' : 'Próximo';
  }
  function v2mTourNext() {
    if (v2mTourIdx < V2M_TOUR_STEPS.length - 1) { v2mTourIdx++; v2mTourRender(); }
    else { v2mTourSkip(); }
  }
  function v2mTourSkip() {
    document.getElementById('v2m-tour').style.display = 'none';
    localStorage.setItem('v2m_tour_seen', '1');
  }
  // Expor pra HTML inline
  window.v2mLoadAll = v2mLoadAll;
  window.v2mFilterStatus = v2mFilterStatus;
  window.v2mRenderList = v2mRenderList;
  window.v2mSelect = v2mSelect;
  window.v2mReview = v2mReview;
  window.v2mDebounceComment = v2mDebounceComment;
  window.v2mForceResumo = v2mForceResumo;
  window.v2mPauseV2 = v2mPauseV2;
  window.v2mResumeV2 = v2mResumeV2;
  window.v2mExportCsv = v2mExportCsv;
  window.v2mTourNext = v2mTourNext;
  window.v2mTourSkip = v2mTourSkip;
  window.__v2mLoadOnTab = function() {
    v2mLoadAll();
    v2mTourStart();
    if (v2mState.pollHandle) clearInterval(v2mState.pollHandle);
    v2mState.pollHandle = setInterval(v2mLoadAll, 30000);
  };
  window.__v2mUnloadOnTab = function() {
    if (v2mState.pollHandle) { clearInterval(v2mState.pollHandle); v2mState.pollHandle = null; }
  };
</script>
</body>
</html>`);
});

module.exports = router;
