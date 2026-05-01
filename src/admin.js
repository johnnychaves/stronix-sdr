const { Router } = require('express');
const { getSystemPrompt, updateSystemPrompt, getConversations, clearConversation } = require('./agent');
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

    /* Filtros */
    .filter-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    .filter-btn { background: #1a1a1a; border: 1px solid #2a2a2a; color: #888; padding: 6px 12px; border-radius: 20px; font-size: 12px; cursor: pointer; transition: all .15s; }
    .filter-btn:hover { color: #ccc; border-color: #444; }
    .filter-btn.active { background: #22c55e22; border-color: #22c55e44; color: #4ade80; }

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
  <div class="conv-header">
    <h2>Conversas em memória</h2>
    <button class="refresh-btn" onclick="loadConversations()">↻ Atualizar</button>
  </div>
  <div class="filter-bar" id="filter-bar">
    <span class="review-label">Filtrar:</span>
    <button class="filter-btn active" data-filter="all" onclick="setFilter('all')">Todas</button>
    <button class="filter-btn" data-filter="unrated" onclick="setFilter('unrated')">Não avaliadas</button>
    <button class="filter-btn" data-filter="bad" onclick="setFilter('bad')">👎 Não gostei</button>
    <button class="filter-btn" data-filter="good" onclick="setFilter('good')">👍 Gostei</button>
    <span class="review-meta" id="filter-count" style="margin-left:auto"></span>
  </div>
  <div class="conv-list" id="conv-list">
    <div class="empty">Carregando...</div>
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
  const openCards = new Set();

  const RATE_LABEL = { good: '👍 Gostei', bad: '👎 Não gostei' };

  async function loadConversations() {
    const res = await fetch('/admin/api/conversations');
    allConversations = await res.json();
    renderConversations();
  }

  function renderConversations() {
    const list = document.getElementById('conv-list');
    const convs = allConversations.filter(c => {
      if (currentFilter === 'all') return true;
      if (currentFilter === 'unrated') return !c.review;
      return c.review && c.review.rating === currentFilter;
    });

    document.getElementById('filter-count').textContent =
      \`\${convs.length} de \${allConversations.length}\`;

    if (convs.length === 0) {
      list.innerHTML = '<div class="empty">Nenhuma conversa nesse filtro</div>';
      return;
    }

    list.innerHTML = convs.map((c, i) => {
      const r = c.review;
      const badge = r ? \`<span class="review-badge \${r.rating}">\${RATE_LABEL[r.rating]}</span>\` : '';
      const commentVal = r && r.comment ? r.comment.replace(/"/g, '&quot;') : '';
      const reviewedAt = r ? new Date(r.reviewedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
      return \`
        <div class="conv-card">
          <div class="conv-card-header" onclick="toggleMessages(\${i})">
            <div class="conv-info">
              <span class="conv-phone">\${c.fromDisplay}</span>
              <div class="conv-stats">
                <span class="stat">\${c.messageCount} msgs</span>
                \${c.audioPermission ? '<span class="stat audio">🔊 áudio</span>' : ''}
                \${badge}
              </div>
              \${c.lastMessage ? \`<span class="conv-last">\${c.lastMessage.role === 'assistant' ? '🤖' : '👤'} \${c.lastMessage.content.slice(0, 60)}...\</span>\` : ''}
            </div>
            <button class="btn-clear" onclick="clearConv(event, '\${c.from}')">Limpar</button>
          </div>
          <div class="conv-messages \${openCards.has(c.from) ? 'open' : ''}" id="msgs-\${i}" data-phone="\${c.from}">
            \${c.history.map(m => \`
              <div class="msg">
                <div class="msg-role \${m.role}">\${m.role === 'user' ? '👤 Lead' : '🤖 SDR'}</div>
                <div class="msg-content">\${m.content}</div>
              </div>
            \`).join('')}
          </div>
          <div class="review-bar">
            <div class="review-row">
              <span class="review-label">Avaliação:</span>
              <button class="rate-btn good \${r && r.rating === 'good' ? 'active' : ''}" onclick="rateConv('\${c.from}', 'good')">👍 Gostei</button>
              <button class="rate-btn bad \${r && r.rating === 'bad' ? 'active' : ''}" onclick="rateConv('\${c.from}', 'bad')">👎 Não gostei</button>
              \${r ? \`<button class="rate-btn clear" onclick="clearReview('\${c.from}')">remover</button>\` : ''}
              \${reviewedAt ? \`<span class="review-meta">avaliada em \${reviewedAt}</span>\` : ''}
            </div>
            <textarea class="review-comment" id="cmt-\${i}" placeholder="Comentário (o que foi bom/ruim, o que mudar no prompt...)" oninput="onCommentChange('\${c.from}', \${i})">\${commentVal}</textarea>
          </div>
        </div>
      \`;
    }).join('');
  }

  function setFilter(f) {
    currentFilter = f;
    document.querySelectorAll('#filter-bar .filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === f);
    });
    renderConversations();
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
    renderConversations();
  }

  async function clearReview(phone) {
    await fetch('/admin/api/reviews/' + phone, { method: 'DELETE' });
    const conv = allConversations.find(c => c.from === phone);
    if (conv) conv.review = null;
    renderConversations();
  }

  // Salva comentário com debounce de 600ms
  const commentTimers = {};
  function onCommentChange(phone, idx) {
    const text = document.getElementById('cmt-' + idx).value;
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
    }, 600);
  }

  function toggleMessages(i) {
    const el = document.getElementById('msgs-' + i);
    el.classList.toggle('open');
    const phone = el.dataset.phone;
    if (el.classList.contains('open')) openCards.add(phone);
    else openCards.delete(phone);
  }

  async function clearConv(e, from) {
    e.stopPropagation();
    if (!confirm('Limpar conversa de ' + from + '?')) return;
    await fetch('/admin/api/conversations/' + from, { method: 'DELETE' });
    loadConversations();
  }

  function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
    if (tab === 'conversas') loadConversations();
    if (tab === 'agendamentos') loadAppointments();
    if (tab === 'alunos') loadStudents();
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
    } catch {
      location.href = '/admin/login';
    }
  }

  async function logout() {
    await fetch('/admin/api/auth/logout', { method: 'POST' });
    location.href = '/admin/login';
  }

  loadMe();
  loadPrompt();
</script>
</body>
</html>`);
});

module.exports = router;
