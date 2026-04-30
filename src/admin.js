const { Router } = require('express');
const { getSystemPrompt, updateSystemPrompt, getConversations, clearConversation } = require('./agent');

const router = Router();

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
</header>

<div class="tabs">
  <div class="tab active" onclick="switchTab('prompt')">Prompt do SDR</div>
  <div class="tab" onclick="switchTab('conversas')">Conversas ativas</div>
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
  <div class="conv-list" id="conv-list">
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

  async function loadConversations() {
    const res = await fetch('/admin/api/conversations');
    const convs = await res.json();
    const list = document.getElementById('conv-list');

    if (convs.length === 0) {
      list.innerHTML = '<div class="empty">Nenhuma conversa ativa no momento</div>';
      return;
    }

    list.innerHTML = convs.map((c, i) => \`
      <div class="conv-card">
        <div class="conv-card-header" onclick="toggleMessages(\${i})">
          <div class="conv-info">
            <span class="conv-phone">\${c.fromDisplay}</span>
            <div class="conv-stats">
              <span class="stat">\${c.messageCount} msgs</span>
              \${c.audioPermission ? '<span class="stat audio">🔊 áudio</span>' : ''}
            </div>
            \${c.lastMessage ? \`<span class="conv-last">\${c.lastMessage.role === 'assistant' ? '🤖' : '👤'} \${c.lastMessage.content.slice(0, 60)}...\</span>\` : ''}
          </div>
          <button class="btn-clear" onclick="clearConv(event, '\${c.from}')">Limpar</button>
        </div>
        <div class="conv-messages" id="msgs-\${i}">
          \${c.history.map(m => \`
            <div class="msg">
              <div class="msg-role \${m.role}">\${m.role === 'user' ? '👤 Lead' : '🤖 SDR'}</div>
              <div class="msg-content">\${m.content}</div>
            </div>
          \`).join('')}
        </div>
      </div>
    \`).join('');
  }

  function toggleMessages(i) {
    const el = document.getElementById('msgs-' + i);
    el.classList.toggle('open');
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
  }

  loadPrompt();
</script>
</body>
</html>`);
});

module.exports = router;
