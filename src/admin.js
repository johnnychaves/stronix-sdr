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
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>STRONIX SDR — Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 32px; width: 380px; max-width: calc(100vw - 32px); }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
    h1 .accent { color: #22c55e; }
    .subtitle { font-size: 13px; color: #666; margin-bottom: 24px; }
    .bootstrap-banner { background: #1e2a1e; color: #4ade80; border: 1px solid #22c55e44; padding: 12px 14px; border-radius: 8px; font-size: 12px; line-height: 1.5; margin-bottom: 18px; }
    label { display: block; font-size: 12px; color: #888; margin-bottom: 4px; margin-top: 14px; }
    input { width: 100%; background: #0f0f0f; color: #d4d4d4; border: 1px solid #2a2a2a; border-radius: 6px; padding: 10px 12px; font-size: 14px; outline: none; font-family: inherit; }
    input:focus { border-color: #22c55e44; }
    button { width: 100%; margin-top: 20px; padding: 11px; background: #22c55e; color: #000; border: none; border-radius: 7px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background .15s; }
    button:hover { background: #16a34a; }
    button:disabled { background: #1a4a2a; color: #555; cursor: not-allowed; }
    .error { color: #f87171; font-size: 13px; margin-top: 12px; min-height: 18px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ STRONIX <span class="accent">SDR</span></h1>
    <p class="subtitle" id="subtitle">Acesse o painel</p>
    <div class="bootstrap-banner" id="banner" style="display:none">
      Nenhum admin cadastrado ainda. Cadastre o <strong>primeiro admin</strong> abaixo — ele terá acesso total ao painel.
    </div>
    <form id="form">
      <label>Usuário</label>
      <input id="username" autocomplete="username" required>
      <label>Senha <span id="pw-hint" style="color:#444;font-weight:400" hidden> (mín 8 caracteres)</span></label>
      <input id="password" type="password" autocomplete="current-password" required>
      <div id="extra-fields" style="display:none">
        <label>Nome completo</label>
        <input id="displayName" autocomplete="name">
        <label>Telefone (opcional, formato 5551XXXXXXXX)</label>
        <input id="phone" inputmode="numeric">
      </div>
      <button type="submit" id="submit">Entrar</button>
      <div class="error" id="err"></div>
    </form>
  </div>
  <script>
    let bootstrap = false;
    fetch('/admin/api/auth/status').then(r => r.json()).then(s => {
      bootstrap = !!s.bootstrap;
      if (bootstrap) {
        document.getElementById('subtitle').textContent = 'Configuração inicial';
        document.getElementById('banner').style.display = 'block';
        document.getElementById('extra-fields').style.display = 'block';
        document.getElementById('submit').textContent = 'Criar admin e entrar';
        document.getElementById('pw-hint').hidden = false;
        document.getElementById('password').autocomplete = 'new-password';
      }
    });

    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submit');
      const err = document.getElementById('err');
      err.textContent = '';
      btn.disabled = true;

      const body = {
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value,
      };
      if (bootstrap) {
        body.displayName = document.getElementById('displayName').value.trim();
        body.phone = document.getElementById('phone').value.trim();
      }

      const url = bootstrap ? '/admin/api/auth/bootstrap' : '/admin/api/auth/login';
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await r.json();
        if (!r.ok) {
          err.textContent = data.error || 'Erro';
          btn.disabled = false;
          return;
        }
        location.href = '/admin';
      } catch (e2) {
        err.textContent = 'Falha de conexão';
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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; min-height: 100vh; }

    header { background: #1a1a1a; border-bottom: 1px solid #2a2a2a; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
    header h1 { font-size: 18px; font-weight: 700; color: #fff; }
    header span { font-size: 13px; color: #666; }
    .badge { background: #22c55e22; color: #22c55e; border: 1px solid #22c55e44; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }

    .tabs { display: flex; gap: 0; background: #1a1a1a; border-bottom: 1px solid #2a2a2a; padding: 0 24px; }
    .tab { padding: 14px 20px; font-size: 14px; font-weight: 500; color: #666; cursor: pointer; border-bottom: 2px solid transparent; transition: all .2s; }
    .tab.active { color: #fff; border-bottom-color: #22c55e; }
    .tab:hover:not(.active) { color: #aaa; }

    .panel { display: none; padding: 24px; max-width: 1100px; margin: 0 auto; }
    .panel.active { display: block; }

    /* Prompt */
    .prompt-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .prompt-header h2 { font-size: 15px; color: #aaa; font-weight: 500; }
    .prompt-meta { font-size: 12px; color: #555; }
    textarea { width: 100%; height: calc(100vh - 220px); background: #1a1a1a; color: #d4d4d4; border: 1px solid #2a2a2a; border-radius: 8px; padding: 20px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; line-height: 1.6; resize: none; outline: none; transition: border-color .2s; }
    textarea:focus { border-color: #22c55e44; }

    .actions { display: flex; gap: 10px; margin-top: 14px; align-items: center; }
    .btn { padding: 9px 20px; border-radius: 7px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; transition: all .15s; }
    .btn-save { background: #22c55e; color: #000; }
    .btn-save:hover { background: #16a34a; }
    .btn-save:disabled { background: #1a4a2a; color: #555; cursor: not-allowed; }
    .btn-reset { background: #2a2a2a; color: #aaa; }
    .btn-reset:hover { background: #333; color: #fff; }
    .save-status { font-size: 13px; color: #22c55e; opacity: 0; transition: opacity .3s; }
    .save-status.visible { opacity: 1; }

    /* Seções do prompt */
    .sections { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .section-pill { background: #1e2a1e; color: #4ade80; border: 1px solid #22c55e33; padding: 4px 12px; border-radius: 20px; font-size: 12px; cursor: pointer; transition: all .15s; }
    .section-pill:hover { background: #22c55e22; }

    /* Conversas */
    .conv-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .conv-header h2 { font-size: 15px; color: #aaa; font-weight: 500; }
    .refresh-btn { background: #1a1a1a; border: 1px solid #2a2a2a; color: #aaa; padding: 7px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; }
    .refresh-btn:hover { border-color: #444; color: #fff; }

    .conv-list { display: flex; flex-direction: column; gap: 12px; }
    .conv-card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px; overflow: hidden; }
    .conv-card-header { padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
    .conv-card-header:hover { background: #222; }
    .conv-info { display: flex; align-items: center; gap: 12px; }
    .conv-phone { font-weight: 600; font-size: 14px; }
    .conv-stats { display: flex; gap: 8px; }
    .stat { background: #2a2a2a; padding: 3px 10px; border-radius: 20px; font-size: 12px; color: #888; }
    .stat.audio { background: #1e2a1e; color: #4ade80; }
    .conv-last { font-size: 12px; color: #555; max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .btn-clear { background: transparent; border: 1px solid #3a1a1a; color: #ef4444; padding: 5px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
    .btn-clear:hover { background: #3a1a1a; }

    .conv-messages { border-top: 1px solid #2a2a2a; padding: 16px 18px; display: none; max-height: 400px; overflow-y: auto; }
    .conv-messages.open { display: block; }

    /* Review */
    .review-bar { border-top: 1px solid #2a2a2a; padding: 12px 18px; display: flex; flex-direction: column; gap: 10px; background: #141414; }
    .review-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .review-label { font-size: 12px; color: #666; margin-right: 4px; }
    .rate-btn { background: #1a1a1a; border: 1px solid #2a2a2a; color: #aaa; padding: 5px 12px; border-radius: 6px; font-size: 14px; cursor: pointer; transition: all .15s; }
    .rate-btn:hover { border-color: #444; }
    .rate-btn.active.good { background: #1e2a1e; border-color: #22c55e; color: #4ade80; }
    .rate-btn.active.bad { background: #2a1e1e; border-color: #ef4444; color: #f87171; }
    .rate-btn.clear { color: #555; font-size: 12px; }
    .review-comment { width: 100%; background: #1a1a1a; color: #d4d4d4; border: 1px solid #2a2a2a; border-radius: 6px; padding: 8px 10px; font-size: 13px; font-family: inherit; resize: vertical; min-height: 36px; outline: none; }
    .review-comment:focus { border-color: #444; }
    .review-meta { font-size: 11px; color: #555; }

    /* Badge no header da conversa */
    .review-badge { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .review-badge.good { background: #1e2a1e; color: #4ade80; }
    .review-badge.bad { background: #2a1e1e; color: #f87171; }

    /* Assignment badge + botões */
    .assign-badge { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
    .assign-badge.ai    { background: #1a1a2e; color: #818cf8; }
    .assign-badge.mine  { background: #1e2a1e; color: #4ade80; }
    .assign-badge.other { background: #2a261a; color: #fbbf24; }
    .btn-assume  { background: #22c55e; color: #000; border: none; padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .btn-assume:hover { background: #16a34a; }
    .btn-release { background: #1a2a1e; color: #4ade80; border: 1px solid #22c55e44; padding: 5px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
    .btn-release:hover { background: #1e3a2a; }

    /* Mensagem enviada por humano */
    .msg-role.human { color: #fbbf24; }

    /* Caixa de envio de resposta humana */
    .reply-bar { display: flex; gap: 8px; align-items: flex-start; padding: 12px; background: #1a1a1a; border-top: 1px solid #2a2a2a; border-radius: 0 0 8px 8px; }
    .reply-input { flex: 1; background: #0f0f0f; color: #d4d4d4; border: 1px solid #2a2a2a; border-radius: 6px; padding: 8px 10px; font-size: 13px; font-family: inherit; resize: vertical; outline: none; min-height: 40px; max-height: 200px; }
    .reply-input:focus { border-color: #22c55e44; }
    .btn-send { background: #22c55e; color: #000; border: none; padding: 0 18px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; align-self: stretch; }
    .btn-send:hover { background: #16a34a; }
    .btn-send:disabled { background: #1a4a2a; color: #555; cursor: not-allowed; }

    /* Filtros */
    .filter-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    .filter-btn { background: #1a1a1a; border: 1px solid #2a2a2a; color: #888; padding: 6px 12px; border-radius: 20px; font-size: 12px; cursor: pointer; transition: all .15s; }
    .filter-btn:hover { color: #ccc; border-color: #444; }
    .filter-btn.active { background: #22c55e22; border-color: #22c55e44; color: #4ade80; }

    /* ─────────────── INBOX ESTILO WHATSAPP WEB ─────────────── */
    #tab-conversas { padding: 0; max-width: 100%; }
    #tab-conversas.active { display: flex; }
    .inbox-layout { display: flex; height: calc(100vh - 113px); width: 100%; background: #0b141a; }
    .inbox-col { display: flex; flex-direction: column; overflow: hidden; }
    .inbox-col-left  { width: 360px; min-width: 320px; border-right: 1px solid #222d34; background: #111b21; }
    .inbox-col-mid   { flex: 1; min-width: 0; background: #0b141a; }
    .inbox-col-right { width: 280px; min-width: 240px; border-left: 1px solid #222d34; background: #111b21; }

    /* Header das colunas */
    .inbox-col-header { padding: 12px 16px; background: #202c33; border-bottom: 1px solid #222d34; display: flex; align-items: center; gap: 10px; min-height: 54px; }
    .inbox-col-header h3 { font-size: 14px; font-weight: 600; color: #e9edef; flex: 1; }
    .inbox-col-header .refresh-mini { background: transparent; border: none; color: #aebac1; font-size: 16px; cursor: pointer; padding: 4px 8px; border-radius: 4px; }
    .inbox-col-header .refresh-mini:hover { background: #2a3942; color: #e9edef; }

    /* Search da sidebar esquerda */
    .inbox-search { padding: 8px 12px; background: #111b21; }
    .inbox-search input { width: 100%; background: #202c33; color: #e9edef; border: none; border-radius: 8px; padding: 9px 14px 9px 38px; font-size: 13px; outline: none; font-family: inherit; }
    .inbox-search input::placeholder { color: #8696a0; }
    .inbox-search { position: relative; }
    .inbox-search::before { content: "🔍"; position: absolute; left: 24px; top: 50%; transform: translateY(-50%); font-size: 12px; opacity: .6; }

    /* Filtros como pills compactos */
    .inbox-filters { display: flex; gap: 4px; padding: 4px 12px 8px; background: #111b21; overflow-x: auto; }
    .inbox-filters .filter-btn { font-size: 11px; padding: 4px 10px; white-space: nowrap; flex-shrink: 0; }

    /* Lista de conversas */
    .inbox-list { flex: 1; overflow-y: auto; }
    .inbox-list::-webkit-scrollbar { width: 6px; }
    .inbox-list::-webkit-scrollbar-thumb { background: #2a3942; border-radius: 3px; }

    .inbox-item { display: flex; align-items: center; gap: 12px; padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #1f2a30; transition: background .15s; }
    .inbox-item:hover { background: #202c33; }
    .inbox-item.active { background: #2a3942; }
    .inbox-avatar { width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #00a884, #128c7e); display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 600; color: #fff; flex-shrink: 0; position: relative; }
    .inbox-avatar.human { background: linear-gradient(135deg, #f59e0b, #d97706); }
    .inbox-avatar.mine  { background: linear-gradient(135deg, #22c55e, #16a34a); }
    .inbox-avatar .ai-dot { position: absolute; bottom: -2px; right: -2px; width: 14px; height: 14px; border-radius: 50%; background: #818cf8; border: 2px solid #111b21; font-size: 8px; display: flex; align-items: center; justify-content: center; }
    .inbox-item-body { flex: 1; min-width: 0; }
    .inbox-item-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .inbox-item-name { font-size: 14px; font-weight: 500; color: #e9edef; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .inbox-item-time { font-size: 11px; color: #8696a0; flex-shrink: 0; }
    .inbox-item-bot  { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 3px; }
    .inbox-item-preview { font-size: 13px; color: #8696a0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
    .inbox-item-tags { display: flex; gap: 4px; align-items: center; }
    .inbox-mini-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600; }
    .inbox-mini-badge.ai    { background: #1a2730; color: #8e9aaf; }
    .inbox-mini-badge.human { background: #2a261a; color: #fbbf24; }
    .inbox-mini-badge.mine  { background: #1e2a1e; color: #4ade80; }
    .inbox-mini-badge.review.good { background: #1e2a1e; color: #4ade80; }
    .inbox-mini-badge.review.bad  { background: #2a1e1e; color: #f87171; }

    /* Área central — chat */
    .chat-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: #8696a0; font-size: 14px; flex-direction: column; gap: 8px; padding: 40px; text-align: center; }
    .chat-empty-icon { font-size: 64px; opacity: .3; }
    .chat-header { padding: 12px 20px; background: #202c33; border-bottom: 1px solid #222d34; display: flex; align-items: center; gap: 14px; min-height: 54px; }
    .chat-header-avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #00a884, #128c7e); display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600; color: #fff; flex-shrink: 0; }
    .chat-header-info { flex: 1; min-width: 0; }
    .chat-header-name { font-size: 15px; font-weight: 500; color: #e9edef; }
    .chat-header-status { font-size: 12px; color: #8696a0; margin-top: 2px; }
    .chat-header-actions { display: flex; gap: 8px; align-items: center; }
    .chat-action-btn { background: transparent; color: #aebac1; border: 1px solid #2a3942; padding: 6px 14px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 500; }
    .chat-action-btn:hover { background: #2a3942; color: #fff; }
    .chat-action-btn.primary { background: #00a884; border-color: #00a884; color: #000; font-weight: 600; }
    .chat-action-btn.primary:hover { background: #06cf9c; }
    .chat-action-btn.danger { color: #f87171; border-color: #3a1a1a; }
    .chat-action-btn.danger:hover { background: #3a1a1a; }

    /* Mensagens — bubbles estilo WhatsApp */
    .chat-messages { flex: 1; overflow-y: auto; padding: 18px 8% 12px; background-color: #0b141a; background-image: linear-gradient(0deg, rgba(11,20,26,.92), rgba(11,20,26,.92)), repeating-linear-gradient(45deg, transparent 0 60px, rgba(255,255,255,.012) 60px 61px); display: flex; flex-direction: column; gap: 4px; }
    .chat-messages::-webkit-scrollbar { width: 6px; }
    .chat-messages::-webkit-scrollbar-thumb { background: #2a3942; border-radius: 3px; }
    .bubble { max-width: 65%; padding: 6px 9px 8px; border-radius: 8px; font-size: 14.2px; line-height: 1.45; color: #e9edef; word-wrap: break-word; white-space: pre-wrap; position: relative; }
    .bubble-row { display: flex; }
    .bubble-row.in  { justify-content: flex-start; }
    .bubble-row.out { justify-content: flex-end; }
    .bubble.in  { background: #202c33; border-top-left-radius: 0; }
    .bubble.out { background: #005c4b; border-top-right-radius: 0; }
    .bubble.out.human { background: #00785e; }
    .bubble-meta { font-size: 10.5px; color: #8696a0; margin-top: 4px; display: flex; align-items: center; gap: 4px; justify-content: flex-end; }
    .bubble.in .bubble-meta { color: #67797f; }
    .bubble-sender { font-size: 11px; color: #00a884; font-weight: 600; margin-bottom: 2px; }
    .bubble.in .bubble-sender { color: #f59e0b; }
    .day-divider { display: flex; justify-content: center; margin: 12px 0; }
    .day-divider span { background: #1d282f; color: #8696a0; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 500; }

    /* Input do chat */
    .chat-input-bar { padding: 10px 16px; background: #202c33; border-top: 1px solid #222d34; display: flex; gap: 10px; align-items: flex-end; }
    .chat-input { flex: 1; background: #2a3942; color: #e9edef; border: none; border-radius: 8px; padding: 10px 14px; font-size: 14px; resize: none; outline: none; font-family: inherit; min-height: 42px; max-height: 200px; }
    .chat-input::placeholder { color: #8696a0; }
    .chat-input:focus { background: #34434c; }
    .chat-send { background: #00a884; color: #000; border: none; width: 42px; height: 42px; border-radius: 50%; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .chat-send:hover { background: #06cf9c; }
    .chat-send:disabled { background: #1a4a40; color: #555; cursor: not-allowed; }
    .chat-input-disabled { padding: 12px; text-align: center; color: #8696a0; font-size: 13px; background: #1d282f; border-top: 1px solid #222d34; }
    .chat-input-disabled .btn-primary-small { background: #00a884; color: #000; border: none; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; margin-left: 8px; }
    .chat-input-disabled .btn-primary-small:hover { background: #06cf9c; }

    /* Sidebar direita — atendimentos ativos */
    .actives-empty { padding: 30px 20px; text-align: center; color: #8696a0; font-size: 13px; line-height: 1.6; }
    .active-item { padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #1f2a30; transition: background .15s; }
    .active-item:hover { background: #202c33; }
    .active-item.selected { background: #2a3942; border-left: 3px solid #00a884; padding-left: 13px; }
    .active-item-name { font-size: 14px; font-weight: 500; color: #e9edef; }
    .active-item-meta { font-size: 11px; color: #8696a0; margin-top: 3px; }
    .active-item-consult { font-size: 12px; color: #fbbf24; margin-top: 4px; }

    /* Painel de avaliação compacto, dentro do chat header dropdown */
    .review-popup { position: absolute; top: 60px; right: 16px; background: #233138; border: 1px solid #2a3942; border-radius: 8px; padding: 12px; width: 320px; box-shadow: 0 8px 24px rgba(0,0,0,.5); z-index: 10; }
    .review-popup.hidden { display: none; }

    /* Esconde painel direita em telas estreitas */
    @media (max-width: 1100px) {
      .inbox-col-right { display: none; }
    }
    @media (max-width: 800px) {
      .inbox-col-left { width: 100%; }
      .inbox-col-mid { display: none; }
      .inbox-layout.has-selected .inbox-col-left { display: none; }
      .inbox-layout.has-selected .inbox-col-mid  { display: flex; }
    }

    /* Students */
    .student-form { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px; padding: 16px; margin-bottom: 18px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .student-form input { background: #0f0f0f; color: #d4d4d4; border: 1px solid #2a2a2a; border-radius: 6px; padding: 8px 10px; font-size: 13px; outline: none; font-family: inherit; }
    .student-form input:focus { border-color: #444; }
    .student-form input.phone { width: 180px; }
    .student-form input.name { width: 220px; }
    .student-form input.notes { flex: 1; min-width: 200px; }
    .btn-add { background: #22c55e; color: #000; border: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn-add:hover { background: #16a34a; }
    .student-help { font-size: 12px; color: #555; margin-bottom: 14px; line-height: 1.5; }
    .student-row { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 12px 16px; display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
    .student-row .phone { font-family: 'SF Mono', monospace; font-size: 13px; color: #ccc; min-width: 150px; }
    .student-row .name { font-size: 14px; color: #fff; min-width: 180px; }
    .student-row .notes { font-size: 12px; color: #888; flex: 1; }
    .student-row .btn-clear { font-size: 12px; }
    .msg { margin-bottom: 12px; }
    .msg-role { font-size: 11px; font-weight: 600; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .5px; }
    .msg-role.user { color: #60a5fa; }
    .msg-role.assistant { color: #4ade80; }
    .msg-content { font-size: 13px; line-height: 1.5; color: #ccc; background: #141414; padding: 10px 14px; border-radius: 8px; white-space: pre-wrap; }

    .empty { text-align: center; padding: 60px; color: #444; font-size: 14px; }

    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #1a1a1a; }
    ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
  </style>
</head>
<body>

<header>
  <div>
    <h1>⚡ STRONIX SDR</h1>
  </div>
  <span>Painel de treinamento</span>
  <div class="badge">● Online</div>
  <div class="user-area" style="margin-left:auto;display:flex;align-items:center;gap:12px">
    <span id="user-info" style="font-size:13px;color:#aaa"></span>
    <button class="btn-logout" onclick="logout()" style="background:transparent;border:1px solid #2a2a2a;color:#888;padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer">Sair</button>
  </div>
</header>

<div class="tabs">
  <div class="tab active" onclick="switchTab('prompt')">Prompt do SDR</div>
  <div class="tab" onclick="switchTab('conversas')">Conversas ativas</div>
  <div class="tab" onclick="switchTab('agendamentos')">📅 Agendamentos</div>
  <div class="tab" onclick="switchTab('alunos')">🎓 Alunos</div>
  <div class="tab admin-only" onclick="switchTab('users')" style="display:none">👥 Usuários</div>
  <div class="tab admin-only" onclick="switchTab('metrics')" style="display:none">📊 Métricas</div>
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
        <h3>Conversas</h3>
        <span class="review-meta" id="filter-count" style="font-size:11px;color:#8696a0"></span>
        <button class="refresh-mini" onclick="loadConversations()" title="Atualizar">↻</button>
      </div>
      <div class="inbox-search">
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
        <div class="empty" style="padding:30px;color:#8696a0">Carregando...</div>
      </div>
    </div>

    <!-- ─── Centro: chat da conversa selecionada ─── -->
    <div class="inbox-col inbox-col-mid" id="chat-area">
      <div class="chat-empty">
        <div class="chat-empty-icon">💬</div>
        <div>Selecione uma conversa pra ver as mensagens</div>
      </div>
    </div>

    <!-- ─── Sidebar direita: atendimentos ativos ─── -->
    <div class="inbox-col inbox-col-right">
      <div class="inbox-col-header">
        <h3>🟢 Em atendimento</h3>
        <span class="review-meta" id="actives-count" style="font-size:11px;color:#8696a0"></span>
      </div>
      <div class="inbox-list" id="actives-list">
        <div class="actives-empty">Conversas que algum consultor assumiu vão aparecer aqui.</div>
      </div>
    </div>
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

  async function loadConversations() {
    try {
      const res = await fetch('/admin/api/conversations');
      if (!res.ok) return;
      const fresh = await res.json();
      detectNewMessages(fresh);
      allConversations = fresh;
      renderInboxList();
      renderActives();
      renderChat();
    } catch (e) { /* polling silencioso */ }
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

  function renderActives() {
    const list = document.getElementById('actives-list');
    const actives = allConversations.filter(c => c.assignedUserId).sort((a, b) => (b.humanAssumedAt || 0) - (a.humanAssumedAt || 0));
    document.getElementById('actives-count').textContent = actives.length;
    if (!actives.length) {
      list.innerHTML = '<div class="actives-empty">Conversas que algum consultor assumiu vão aparecer aqui.</div>';
      return;
    }
    list.innerHTML = actives.map(c => {
      const isMine = me && c.assignedUserId === me.id;
      const isSelected = selectedPhone === c.from;
      return \`
        <div class="active-item \${isSelected ? 'selected' : ''}" onclick="selectConv('\${c.from}')">
          <div class="active-item-name">\${escapeHtml(c.name || fmtPhone(c.from))}</div>
          <div class="active-item-meta">\${c.messageCount} msgs · há \${fmtRelativeTime(c.humanAssumedAt)}</div>
          <div class="active-item-consult">👤 \${isMine ? 'Você' : escapeHtml(c.assignedUserName || '—')}</div>
        </div>
      \`;
    }).join('');
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
    const isHuman = !!c.assignedUserId;
    const isMine  = isHuman && me && c.assignedUserId === me.id;
    const canReply = isMine || (me && me.role === 'admin');
    const status = isHuman
      ? (isMine ? '🟢 Em atendimento (você)' : '🟡 Em atendimento (' + escapeHtml(c.assignedUserName) + ')')
      : '🤖 IA atendendo';

    // Botões do header
    let actionBtns = '';
    if (!isHuman) {
      actionBtns = '<button class="chat-action-btn primary" onclick="assumeConv(event, \\'' + c.from + '\\')">Assumir</button>';
    } else if (isMine || (me && me.role === 'admin')) {
      actionBtns = '<button class="chat-action-btn" onclick="releaseConv(event, \\'' + c.from + '\\')">Devolver pra IA</button>';
    }
    const reviewBtn = '<button class="chat-action-btn" onclick="toggleReviewPopup(event)" title="Avaliar conversa">📝</button>';
    const clearBtn = '<button class="chat-action-btn danger" onclick="clearConv(event, \\'' + c.from + '\\')">Limpar</button>';

    // Mensagens com day divider
    let lastDay = '';
    const msgsHtml = c.history.map(m => {
      const day = fmtDayDivider(m.createdAt || c.firstContactAt);
      let dayHtml = '';
      if (day !== lastDay) {
        dayHtml = '<div class="day-divider"><span>' + day + '</span></div>';
        lastDay = day;
      }
      const isOut = m.role === 'assistant';
      const fromHuman = m.sentByUserId;
      const senderName = fromHuman ? (getUserDisplay(fromHuman) || 'Atendente') : (isOut ? 'STRONIX SDR' : '');
      const senderHtml = (isOut && fromHuman) ? '<div class="bubble-sender">' + escapeHtml(senderName) + '</div>' : '';
      const inOrOut = isOut ? 'out' : 'in';
      const humanCls = fromHuman ? ' human' : '';
      return dayHtml + \`
        <div class="bubble-row \${inOrOut}">
          <div class="bubble \${inOrOut}\${humanCls}">
            \${senderHtml}\${escapeHtml(m.content)}
            <div class="bubble-meta">\${fmtMessageTime(m.createdAt)}</div>
          </div>
        </div>
      \`;
    }).join('');

    // Input ou aviso
    const inputBar = canReply
      ? \`<div class="chat-input-bar">
          <textarea class="chat-input" id="chat-input" placeholder="Digite uma mensagem como \${escapeHtml(me.displayName)}..." rows="1" onkeydown="handleChatKey(event, '\${c.from}')" oninput="autoGrowChat(this)"></textarea>
          <button class="chat-send" onclick="sendChatReply('\${c.from}')" title="Enviar">➤</button>
        </div>\`
      : isHuman
        ? \`<div class="chat-input-disabled">Conversa em atendimento por <strong>\${escapeHtml(c.assignedUserName)}</strong>. Pra responder, devolva pra IA primeiro ou peça pra ela liberar.</div>\`
        : \`<div class="chat-input-disabled">A IA está atendendo essa conversa. <button class="btn-primary-small" onclick="assumeConv(event, '\${c.from}')">Assumir agora</button></div>\`;

    // Review popup (escondido por default)
    const r = c.review;
    const reviewPopup = \`
      <div class="review-popup hidden" id="review-popup">
        <div style="font-size:12px;color:#8696a0;margin-bottom:8px">Avaliar essa conversa</div>
        <div style="display:flex;gap:6px;margin-bottom:10px">
          <button class="rate-btn good \${r && r.rating === 'good' ? 'active' : ''}" onclick="rateConv('\${c.from}', 'good')">👍 Gostei</button>
          <button class="rate-btn bad \${r && r.rating === 'bad' ? 'active' : ''}" onclick="rateConv('\${c.from}', 'bad')">👎 Não gostei</button>
          \${r ? \`<button class="rate-btn clear" onclick="clearReview('\${c.from}')">remover</button>\` : ''}
        </div>
        <textarea class="review-comment" id="review-cmt" placeholder="Comentário..." oninput="onCommentChange('\${c.from}')">\${escapeHtml(r?.comment || '')}</textarea>
      </div>
    \`;

    area.innerHTML = \`
      <div class="chat-header" style="position:relative">
        <div class="chat-header-avatar">\${getInitials(c)}</div>
        <div class="chat-header-info">
          <div class="chat-header-name">\${escapeHtml(c.name || fmtPhone(c.from))}</div>
          <div class="chat-header-status">\${status} · \${fmtPhone(c.from)}</div>
        </div>
        <div class="chat-header-actions">
          \${actionBtns}
          \${reviewBtn}
          \${clearBtn}
        </div>
        \${reviewPopup}
      </div>
      <div class="chat-messages" id="chat-messages" onscroll="onChatScroll()">
        \${msgsHtml || '<div class="chat-empty"><div>Sem mensagens ainda</div></div>'}
      </div>
      \${inputBar}
    \`;

    // Auto-scroll pro fim se estava pinned
    if (chatScrollPinned) {
      const cm = document.getElementById('chat-messages');
      if (cm) cm.scrollTop = cm.scrollHeight;
    }
  }

  function selectConv(phone) {
    selectedPhone = phone;
    chatScrollPinned = true;
    renderInboxList();
    renderActives();
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
    el.style.height = 'auto';
    el.style.height = Math.min(200, el.scrollHeight) + 'px';
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

  function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
    // Polling só na aba Inbox — outras paradas
    if (tab === 'conversas') {
      loadConversations();
      startPolling();
    } else {
      stopPolling();
    }
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
      <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:18px">
        <div style="font-size:12px;color:#666;margin-bottom:6px">\${title}</div>
        <div style="font-size:28px;font-weight:700;color:#fff">\${value}</div>
        \${sub ? \`<div style="font-size:11px;color:#555;margin-top:4px">\${sub}</div>\` : ''}
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
      html += '<div style="grid-column:1/-1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:18px">';
      html += '<div style="font-size:12px;color:#666;margin-bottom:10px">Conversas atendidas por consultora (30d)</div>';
      html += m.byConsultor.map(c => \`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #2a2a2a"><span>\${c.display_name}</span><span style="font-weight:600">\${c.count}</span></div>\`).join('');
      html += '</div>';
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
    const list = document.getElementById('appt-list');

    if (!appts.length) {
      list.innerHTML = '<div class="empty">Nenhum agendamento ainda</div>';
      return;
    }

    list.innerHTML = appts.map(a => {
      const date = new Date(a.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const phone = a.phone.replace(/^55(\\d{2})(\\d{5})(\\d{4})$/, '($1) $2-$3');
      // Mostra "terça às 9h" se tem hora, senão "terça — manhã"
      const when = a.scheduled_hour
        ? \`\${a.scheduled_day || '—'} às \${a.scheduled_hour}\`
        : \`\${a.scheduled_day || '—'} — \${a.scheduled_turn || '—'}\`;
      return \`
        <div class="conv-card" style="margin-bottom:12px">
          <div class="conv-card-header" style="cursor:default">
            <div class="conv-info" style="flex-wrap:wrap;gap:8px">
              <span class="conv-phone">📅 \${when}</span>
              <div class="conv-stats">
                <span class="stat">\${a.name || 'Sem nome'}</span>
                <span class="stat">\${phone}</span>
                <span class="stat \${a.modality}">\${a.modality || '—'}</span>
              </div>
              <span style="font-size:12px;color:#555">\${date}</span>
            </div>
            <select onchange="updateStatus(\${a.id}, this.value)" style="background:#2a2a2a;color:#ccc;border:1px solid #444;border-radius:6px;padding:4px 8px;font-size:12px">
              \${['pending','confirmed','cancelled','no_show'].map(s =>
                \`<option value="\${s}" \${a.status === s ? 'selected' : ''}>\${STATUS_LABEL[s]}</option>\`
              ).join('')}
            </select>
          </div>
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
      document.getElementById('user-info').textContent = \`\${me.displayName} · \${me.role === 'admin' ? '👑 admin' : '🎯 consultora'}\`;
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

  (async () => {
    await loadMe();
    await refreshUserCache();
    loadPrompt();

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
