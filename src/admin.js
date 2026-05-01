const { Router } = require('express');
const { getSystemPrompt, updateSystemPrompt, getConversations, clearConversation } = require('./agent');
const { sendMessage } = require('./whatsapp');
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

// Lista enxuta dos users ativos pra renderizar nomes em mensagens enviadas por humanos
router.get('/api/users-public', (req, res) => {
  res.json(db.getAllUsers().filter(u => u.active).map(u => ({
    id: u.id,
    display_name: u.display_name,
    role: u.role,
  })));
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

// API — limpa conversa de um número
router.delete('/api/conversations/:from', (req, res) => {
  clearConversation(req.params.from);
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
  // Pool aberto: o primeiro a mandar pega.
  const assignment = db.getContactAssignment(phone);
  if (!assignment.assignedUserId) {
    db.assumeConversation(phone, req.user.id);
  } else if (assignment.assignedUserId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Conversa já assumida por outra consultora' });
  }

  try {
    await sendMessage(phone, text);
    db.addMessageWithSender(phone, 'assistant', text, false, req.user.id);
    db.updateLastContact(phone);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin] erro ao enviar reply humano:', err.message);
    res.status(500).json({ error: 'Falha ao enviar mensagem' });
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
  res.json({ ok: true });
});

// API — remove aluno
router.delete('/api/students/:phone', (req, res) => {
  db.deleteStudent(req.params.phone);
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
    .content { display: grid; grid-template-rows: 56px 1fr; height: 100vh; overflow: hidden; min-width: 0; }

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

    .panel { display: none; height: calc(100vh - 56px); overflow-y: auto; padding: var(--sp-6); }
    .panel.active { display: block; }

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
    #tab-conversas { padding: 0; height: calc(100vh - var(--header-h) - var(--tabs-h)); overflow: hidden; }
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
      padding: var(--sp-4) 8% var(--sp-3);
      background-color: var(--bg-0);
      background-image:
        linear-gradient(0deg, rgba(10,16,20,.94), rgba(10,16,20,.94)),
        radial-gradient(1200px 800px at 50% -100px, rgba(0,168,132,.04), transparent 60%);
      display: flex; flex-direction: column; gap: 2px;
    }

    .bubble-row { display: flex; padding: 1px 0; }
    .bubble-row.in  { justify-content: flex-start; }
    .bubble-row.out { justify-content: flex-end; }

    .bubble {
      max-width: 65%;
      padding: 7px 10px 8px;
      border-radius: 8px;
      font-size: 14.2px; line-height: 1.45;
      color: var(--text-primary);
      word-wrap: break-word; white-space: pre-wrap;
      position: relative;
      box-shadow: 0 1px 1px rgba(0,0,0,.13);
      animation: bubbleIn .18s ease-out;
    }
    @keyframes bubbleIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .bubble.in  { background: var(--bubble-in);  border-top-left-radius: 0; }
    .bubble.out { background: var(--bubble-out); border-top-right-radius: 0; }
    .bubble.out.human { background: var(--bubble-out-human); }
    .bubble-meta {
      font-size: 10.5px; color: rgba(255,255,255,.5);
      margin-top: 4px; display: flex;
      align-items: center; gap: 4px; justify-content: flex-end;
      font-variant-numeric: tabular-nums;
    }
    .bubble.in .bubble-meta { color: var(--text-faint); }
    .bubble-sender {
      font-size: 12px; color: #58e8c9; font-weight: 600;
      margin-bottom: 2px; letter-spacing: -.005em;
    }

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

    /* Handoff banner — acima do composer quando você assumiu */
    .handoff-banner {
      background: rgba(0,168,132,.10); border-top: 1px solid rgba(0,168,132,.25);
      color: var(--brand-light); font: 500 12px var(--font-sans);
      padding: 8px 18px;
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      flex-shrink: 0;
    }
    .handoff-banner button {
      background: none; border: none; color: var(--brand-light);
      font: 600 11.5px var(--font-sans); cursor: pointer; text-decoration: underline;
    }
    .handoff-banner button:hover { color: var(--brand); }

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

    /* Input */
    .chat-input-wrap { flex-shrink: 0; }
    .chat-input-bar {
      padding: var(--sp-3) var(--sp-4);
      background: var(--bg-3); border-top: 1px solid var(--border);
      display: flex; gap: var(--sp-3); align-items: flex-end;
    }
    .chat-input {
      flex: 1; background: var(--bg-2); color: var(--text-primary);
      border: 1px solid transparent;
      border-radius: var(--r-md);
      padding: 11px 14px;
      font-size: 14px; resize: none; outline: none;
      font-family: inherit; line-height: 1.45;
      min-height: 44px; max-height: 200px;
      transition: background var(--t-fast), border-color var(--t-fast);
    }
    .chat-input::placeholder { color: var(--text-muted); }
    .chat-input:focus { background: var(--bg-1); border-color: var(--brand); }

    .chat-send {
      background: var(--brand); color: #001f17;
      border: none; width: 44px; height: 44px;
      border-radius: 50%; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: all var(--t-fast);
      box-shadow: 0 4px 10px rgba(0,168,132,.25);
    }
    .chat-send:hover { background: var(--brand-light); transform: scale(1.05); box-shadow: 0 6px 14px rgba(0,168,132,.4); }
    .chat-send:active { transform: scale(.96); }
    .chat-send:disabled { background: var(--bg-4); color: var(--text-muted); cursor: not-allowed; transform: none; box-shadow: none; }

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

      <div class="nav-item" data-nav="alunos" onclick="switchTab('alunos', this)" title="Alunos">
        <span class="ic"><svg viewBox="0 0 24 24"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg></span>
        <span class="lbl">Alunos</span>
        <span class="nav-badge" id="nav-badge-students">0</span>
      </div>

      <div class="nav-item admin-only" data-nav="metrics" onclick="switchTab('metrics', this)" title="Métricas" style="display:none">
        <span class="ic"><svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-6"/></svg></span>
        <span class="lbl">Métricas</span>
      </div>

      <div style="height:14px"></div>

      <div class="nav-group" id="cfg-group">
        <div class="nav-item" onclick="document.getElementById('cfg-group').classList.toggle('open')" title="Configurações">
          <span class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
          <span class="lbl">Configurações</span>
          <svg class="chev" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
        </div>
        <div class="submenu">
          <div class="sub-item" data-nav="prompt" onclick="event.stopPropagation();switchTab('prompt', this)">
            <span class="si"><svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 16h.01M16 16h.01"/></svg></span>
            <span>Prompt do agente</span>
          </div>
          <div class="sub-item admin-only" data-nav="users" onclick="event.stopPropagation();switchTab('users', this)" style="display:none">
            <span class="si"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
            <span>Usuários &amp; permissões</span>
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

    <div class="topbar">
      <div class="crumb">
        <span class="root">STRONIX SDR</span>
        <span class="sep">›</span>
        <span class="now" id="crumb-now">Conversas <span class="crumb-tag" id="crumb-tag"></span></span>
      </div>
      <div class="topbar-acts">
        <div class="status-pill"><div class="st-dot"></div>Agente online · WhatsApp conectado</div>
      </div>
    </div>

    <!-- Tabs legacy (escondidas, só mantidas pra compat com JS antigo) -->
    <div class="tabs" aria-hidden="true">
      <div class="tab active" onclick="switchTab('prompt')">Prompt</div>
      <div class="tab" onclick="switchTab('conversas')">Conversas</div>
      <div class="tab" onclick="switchTab('agendamentos')">Agendamentos</div>
      <div class="tab" onclick="switchTab('alunos')">Alunos</div>
      <div class="tab admin-only" onclick="switchTab('users')">Usuários</div>
      <div class="tab admin-only" onclick="switchTab('metrics')">Métricas</div>
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
        <div class="empty">Carregando...</div>
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
    <div class="empty">Carregando...</div>
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
    <div class="empty">Carregando...</div>
  </div>
</div>

<div id="tab-metrics" class="panel">
  <div class="conv-header">
    <h2>Métricas (últimos 30 dias)</h2>
    <button class="refresh-btn" onclick="loadMetrics()">↻ Atualizar</button>
  </div>
  <div id="metrics-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:14px"></div>
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
    <div class="empty">Carregando...</div>
  </div>
</div>

  </div><!-- /.content -->
</div><!-- /.app -->

<div class="rail-hint" id="rail-hint">Passe o mouse no rail para expandir · <kbd>⌘</kbd> <kbd>B</kbd> para fixar</div>

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

  // Polling + notificações: estado pra detectar mensagens novas
  let pollTimer = null;
  let lastSeenLastContact = {}; // phone → lastContactAt do último load
  let unreadCount = 0;
  let baseTitle = document.title;

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(loadConversations, 5000);
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
    // Re-renderiza mensagens só se a contagem mudou
    const currentCount = msgsEl.dataset.msgCount ? parseInt(msgsEl.dataset.msgCount, 10) : 0;
    if (c.history.length !== currentCount) {
      msgsEl.innerHTML = renderChatMessages(c);
      msgsEl.dataset.msgCount = c.history.length;
      if (chatScrollPinned) msgsEl.scrollTop = msgsEl.scrollHeight;
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
    const desiredKey = isHuman ? (isMine ? 'release' : 'view') : 'assume';
    if (actionsEl.dataset.key === desiredKey) return;
    actionsEl.dataset.key = desiredKey;
    let actionBtns = '';
    if (!isHuman) {
      actionBtns = '<button class="chat-action-btn primary" onclick="assumeConv(event, \\'' + c.from + '\\')">Assumir</button>';
    } else if (isMine || (me && me.role === 'admin')) {
      actionBtns = '<button class="chat-action-btn" onclick="releaseConv(event, \\'' + c.from + '\\')">Devolver pra IA</button>';
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
      list.innerHTML = '<div class="actives-empty">Nenhuma conversa nesse filtro</div>';
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
    if (!c.history.length) {
      return '<div class="chat-empty"><div style="opacity:.5;font-size:13px">Sem mensagens ainda</div></div>';
    }
    let lastDay = '';
    return c.history.map(m => {
      const day = fmtDayDivider(m.createdAt || c.firstContactAt);
      let dayHtml = '';
      if (day !== lastDay) {
        dayHtml = '<div class="day-divider"><span>' + day + '</span></div>';
        lastDay = day;
      }
      const isOut = m.role === 'assistant';
      const fromHuman = m.sentByUserId;
      const senderName = fromHuman ? (getUserDisplay(fromHuman) || 'Atendente') : '';
      const senderHtml = (isOut && fromHuman) ? '<div class="bubble-sender">' + escapeHtml(senderName) + '</div>' : '';
      const inOrOut = isOut ? 'out' : 'in';
      const humanCls = fromHuman ? ' human' : '';
      return dayHtml +
        '<div class="bubble-row ' + inOrOut + '">' +
          '<div class="bubble ' + inOrOut + humanCls + '">' +
            senderHtml + escapeHtml(m.content) +
            '<div class="bubble-meta">' + fmtMessageTime(m.createdAt) + '</div>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function buildInputBar(c) {
    const isHuman = !!c.assignedUserId;
    const isMine  = isHuman && me && c.assignedUserId === me.id;
    const canReply = isMine || (me && me.role === 'admin');
    if (canReply) {
      const banner = isMine
        ? \`<div class="handoff-banner">
             <div>⚡ Você assumiu este atendimento. A IA não responde até você devolver.</div>
             <button onclick="releaseConv(event, '\${c.from}')">Devolver pra IA</button>
           </div>\`
        : '';
      return \`
        \${banner}
        <div class="chat-input-bar">
          <textarea class="chat-input" id="chat-input" placeholder="Digite uma mensagem como \${escapeHtml(me.displayName)}..." rows="1" onkeydown="handleChatKey(event, '\${c.from}')" oninput="autoGrowChat(this)"></textarea>
          <button class="chat-send" onclick="sendChatReply('\${c.from}')" title="Enviar (Enter)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21l20.99-9L2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      \`;
    }
    if (isHuman) {
      return \`<div class="chat-input-disabled">
        <span class="chat-input-disabled-text">Conversa em atendimento por <strong>\${escapeHtml(c.assignedUserName)}</strong></span>
      </div>\`;
    }
    return \`<div class="chat-input-disabled">
      <span class="chat-input-disabled-text">🤖 A IA está atendendo essa conversa</span>
      <button class="btn-primary-small" onclick="assumeConv(event, '\${c.from}')">Assumir agora</button>
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
    selectedPhone = phone;
    chatScrollPinned = true;
    renderInboxList();
    renderLeadDetail();
    renderChat();
    document.getElementById('inbox-layout').classList.add('has-selected');
    setTimeout(() => document.getElementById('chat-input')?.focus(), 50);
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
    const min = 44, max = 200;
    el.style.height = min + 'px';
    const sh = el.scrollHeight;
    if (sh > min) el.style.height = Math.min(max, sh) + 'px';
  }

  function handleChatKey(e, phone) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatReply(phone);
    }
  }

  async function sendChatReply(phone) {
    const ta = document.getElementById('chat-input');
    if (!ta) return;
    const text = ta.value.trim();
    if (!text) return;
    ta.disabled = true;
    try {
      const r = await fetch('/admin/api/conversations/' + phone + '/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) {
        const data = await r.json();
        alert('Erro: ' + (data.error || 'falha ao enviar'));
        ta.disabled = false;
        return;
      }
      ta.value = '';
      autoGrowChat(ta);
      chatScrollPinned = true;
      await loadConversations();
      ta.disabled = false;
      ta.focus();
    } catch (e2) {
      alert('Falha de conexão');
      ta.disabled = false;
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
    if (selectedPhone === from) selectedPhone = null;
    loadConversations();
  }

  const CRUMB_LABELS = {
    prompt:        { label: 'Prompt do agente', tag: '' },
    conversas:     { label: 'Conversas',         tag: '' },
    agendamentos:  { label: 'Agendamentos',      tag: '' },
    alunos:        { label: 'Alunos',            tag: '' },
    users:         { label: 'Usuários & permissões', tag: '' },
    metrics:       { label: 'Métricas',          tag: 'últimos 30d' },
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
    if (tab === 'prompt' || tab === 'users') {
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
    if (tab === 'users') loadUsers();
    if (tab === 'metrics') loadMetrics();
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

  async function loadStudents() {
    const res = await fetch('/admin/api/students');
    const students = await res.json();
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
        <button class="btn-clear" onclick="removeStudent('\${s.phone}')">Remover</button>
      </div>
    \`).join('');
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
  })();
</script>
</body>
</html>`);
});

module.exports = router;
