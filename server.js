require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const Datastore = require('@seald-io/nedb');

const app      = express();
const PORT     = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SECRET   = process.env.JWT_SECRET || 'dsa-fallback-' + crypto.randomBytes(8).toString('hex');
/*
  DSA — Desafio dos Servidores do Altar
  ─────────────────────────────────────
  Iniciar:
    npm install && npm start
    → http://localhost:3000

  Conta de suporte (admin):
    E-mail : dsa.servidoresdoaltar@gmail.com
    Senha  : DSAZelusDomus
*/

// ─── CORS ─────────────────────────────────────────────────────
// Em produção: FRONTEND_URL=https://dsa.servidoresdoaltar.site
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(o => o.trim())
  : true;

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));
app.options('*', cors());

// ─── DATASTORES ───────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = {
  users: new Datastore({ filename: path.join(DATA_DIR, 'users.db'), autoload: true }),
  progress: new Datastore({ filename: path.join(DATA_DIR, 'progress.db'), autoload: true }),
  temas: new Datastore({ filename: path.join(DATA_DIR, 'trails.db'), autoload: true }),
  trilhas: new Datastore({ filename: path.join(DATA_DIR, 'trilhas.db'), autoload: true }),
  questions: new Datastore({ filename: path.join(DATA_DIR, 'questions.db'), autoload: true }),
};

db.users.ensureIndex({ fieldName: 'email', unique: true });
db.users.ensureIndex({ fieldName: 'resetToken' });
db.progress.ensureIndex({ fieldName: 'userId' });
db.questions.ensureIndex({ fieldName: 'trailId' });

app.use(express.json());

// ─── SEED: TEMAS DA TRILHA 1 ─────────────────────────────────
const TEMA_SEED = [
  { _id: 'trail_1', code: 1, name: 'Liturgia e Objetos Sagrados', desc: 'Celebração da Missa, vasos sagrados, vestes e ritos litúrgicos.', icon: '✝' },
  { _id: 'trail_2', code: 2, name: 'Tempos e Calendário Litúrgico', desc: 'Advento, Natal, Quaresma, Páscoa, Tempo Comum e o Ano Litúrgico.', icon: '📅' },
  { _id: 'trail_3', code: 3, name: 'Sacramentos e Sacramentais', desc: 'Os sete sacramentos e os sacramentais da Igreja Católica.', icon: '💧' },
  { _id: 'trail_4', code: 4, name: 'Doutrina e Dogmas', desc: 'Fundamentos da fé: Credo, Trindade, Mariologia e ensinamentos da Igreja.', icon: '📜' },
  { _id: 'trail_5', code: 5, name: 'Vida dos Santos', desc: 'Hagiografia, padroeiros, mártires e a comunhão dos santos.', icon: '⭐' },
  { _id: 'trail_6', code: 6, name: 'Sagradas Escrituras', desc: 'Livros bíblicos, personagens, passagens e a Palavra de Deus.', icon: '📖' },
  { _id: 'trail_7', code: 7, name: 'História da Igreja', desc: 'Concílios, papas, mártires e a história da Igreja ao longo dos séculos.', icon: '⛪' },
  { _id: 'trail_8', code: 8, name: 'Arte e Simbolismo Sacro', desc: 'Iconografia, arquitetura sacra e o rico simbolismo cristão.', icon: '🎨' },
  { _id: 'trail_9', code: 9, name: 'Oração e Espiritualidade', desc: 'Formas de oração, contemplação, Rosário e a vida espiritual cristã.', icon: '🕊' },
  { _id: 'trail_10', code: 10, name: 'Moral e Ética Cristã', desc: 'Mandamentos, virtudes, Doutrina Social da Igreja e ética cristã.', icon: '🏆' },
];

// ─── SEED: TRILHA 1 ───────────────────────────────────────────
const TRILHA_SEED = [
  {
    _id: 'trilha_1', code: 1,
    name: 'Fundamentos da Fé', icon: '✝',
    desc: 'A primeira trilha cobre os fundamentos da vida litúrgica e doutrinal do servidor do altar.',
    temaIds: ['trail_1', 'trail_2', 'trail_3', 'trail_4', 'trail_5',
      'trail_6', 'trail_7', 'trail_8', 'trail_9', 'trail_10'],
  },
];

// ─── E-MAIL ───────────────────────────────────────────────────
const mailer = {
  sendMail: async (opts) => {
    if (!process.env.SMTP_PASS) {
      const link = opts.text?.match(/http\S+/)?.[0] || '';
      console.log('\n╔══════════════════════════════════════════════════════════');
      console.log('║  📧  RECUPERAÇÃO DE SENHA  (sem SMTP_PASS — modo dev)');
      console.log('║  Para  : ' + opts.to);
      console.log('║  Link  : ' + link);
      console.log('╚══════════════════════════════════════════════════════════\n');
      return;
    }
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.SMTP_PASS,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'Servidores do Altar', email: process.env.SMTP_FROM || 'dsa.servidoresdoaltar@gmail.com' },
        to: [{ email: opts.to }],
        subject: opts.subject,
        htmlContent: opts.html || opts.text
      })
    });
    if (!response.ok) throw new Error(`Erro Brevo API: ${await response.text()}`);
    return response.json();
  }
};

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// Serve arquivos estáticos apenas em desenvolvimento local
// Em produção o frontend roda na Hostinger
if (!process.env.FRONTEND_URL) {
  app.use(express.static(path.join(__dirname, 'public')));
}

function authGuard(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autenticado.' });
  try {
    const p = jwt.verify(h.slice(7), SECRET);
    req.uid = p.id;
    req.role = p.role;
    next();
  } catch {
    res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }
}

function adminGuard(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autenticado.' });
  try {
    const p = jwt.verify(h.slice(7), SECRET);
    if (p.role !== 'support') return res.status(403).json({ error: 'Acesso restrito ao perfil de suporte.' });
    req.uid = p.id;
    req.role = p.role;
    next();
  } catch {
    res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }
}

// ─── HELPERS ──────────────────────────────────────────────────
function signToken(id, role) {
  return jwt.sign({ id, role }, SECRET, { expiresIn: '7d' });
}

function publicUser(u) {
  return {
    id: u._id, name: u.name, email: u.email,
    role: u.role, roleCustom: u.roleCustom,
    city: u.city, parish: u.parish, movement: u.movement
  };
}

async function ensureProgress(userId) {
  const trilhas = await db.trilhas.findAsync({});
  trilhas.sort((a, b) => a.code - b.code);

  const existing = await db.progress.findAsync({ userId });
  // Migrate old progress records (had trailId, no trilhaId)
  const oldRecs = existing.filter(p => p.trailId && !p.trilhaId);
  if (oldRecs.length) {
    await db.progress.removeAsync({ userId, trailId: { $exists: true }, trilhaId: { $exists: false } }, { multi: true });
  }

  const fresh = await db.progress.findAsync({ userId });
  const present = new Set(fresh.map(p => `${p.trilhaId}-${p.temaIndex}`));
  const inserts = [];

  for (const trilha of trilhas) {
    const temaIds = trilha.temaIds || [];
    temaIds.forEach((temaId, idx) => {
      const key = `${trilha._id}-${idx}`;
      if (!present.has(key)) {
        inserts.push(db.progress.insertAsync({
          userId, trilhaId: trilha._id, temaId, temaIndex: idx,
          score: 0, firstAttemptRate: 0, timeSeconds: 0,
          completed: false, completedAt: null
        }));
      }
    });
  }
  if (inserts.length) await Promise.all(inserts);
}

function emailHtml(name, link) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#0B0810;font-family:sans-serif">
<div style="max-width:480px;margin:0 auto;background:#160D1E;border:1px solid #2D1840;border-radius:12px;padding:32px">
  <h1 style="color:#C8A84B;font-size:26px;margin:0 0 4px;font-family:Georgia,serif">✝ DSA</h1>
  <p style="color:#8A7C6E;font-size:11px;margin:0 0 28px;letter-spacing:3px;text-transform:uppercase">Desafio dos Servidores do Altar</p>
  <p style="color:#F0EDE6">Olá, <strong>${name}</strong>!</p>
  <p style="color:#A89880;line-height:1.7">Você solicitou a redefinição de senha. Clique abaixo para criar uma nova senha — <strong style="color:#F0EDE6">válido por 1 hora.</strong></p>
  <a href="${link}" style="display:inline-block;margin:24px 0;padding:14px 32px;background:#C8A84B;color:#1A0A00;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Redefinir Minha Senha</a>
  <p style="color:#5A4E48;font-size:13px">Se não foi você, ignore com segurança. Que Deus te abençoe! ✝</p>
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #2D1840">
    <p style="color:#5A4E48;font-size:11px;word-break:break-all">Link: <span style="color:#8A7C6E">${link}</span></p>
  </div>
</div></body></html>`;
}

// ─── SEEDING ──────────────────────────────────────────────────
async function seedAll() {
  // 1. Conta de suporte
  const SUPPORT_EMAIL = 'dsa.servidoresdoaltar@gmail.com';
  const supportExists = await db.users.findOneAsync({ email: SUPPORT_EMAIL });
  if (!supportExists) {
    const hash = await bcrypt.hash('DSAZelusDomus', 10);
    await db.users.insertAsync({
      name: 'Suporte DSA', email: SUPPORT_EMAIL, passwordHash: hash,
      role: 'support', roleCustom: null, city: 'Brasil',
      parish: 'DSA — Desafio dos Servidores do Altar', movement: null,
      resetToken: null, resetExpires: null, createdAt: Date.now()
    });
    console.log('  ✓ Conta de suporte criada');
  }

  // 2. Temas (ex-trilhas)
  for (const t of TEMA_SEED) {
    const exists = await db.temas.findOneAsync({ _id: t._id });
    if (!exists) await db.temas.insertAsync({ ...t, createdAt: Date.now() });
  }
  console.log('  ✓ 10 temas verificados/criados');

  // 3. Trilha 1
  for (const t of TRILHA_SEED) {
    const exists = await db.trilhas.findOneAsync({ _id: t._id });
    if (!exists) await db.trilhas.insertAsync({ ...t, createdAt: Date.now() });
  }
  console.log('  ✓ Trilha 1 verificada/criada');
}

// ─── ROTAS: AUTH ──────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, roleCustom, city, parish, movement } = req.body;
    if (!name?.trim() || !email?.trim() || !password || !role || !city?.trim() || !parish?.trim())
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'A senha precisa ter no mínimo 6 caracteres.' });
    if (role === 'outro' && !roleCustom?.trim())
      return res.status(400).json({ error: 'Descreva sua função na Igreja.' });

    const hash = await bcrypt.hash(password, 10);
    let u;
    try {
      u = await db.users.insertAsync({
        name: name.trim(), email: email.toLowerCase().trim(), passwordHash: hash,
        role, roleCustom: roleCustom?.trim() || null, city: city.trim(),
        parish: parish.trim(), movement: movement?.trim() || null,
        resetToken: null, resetExpires: null, createdAt: Date.now()
      });
    } catch (e) {
      if (e.errorType === 'uniqueViolated') return res.status(409).json({ error: 'Este e-mail já possui um cadastro.' });
      throw e;
    }
    await ensureProgress(u._id);
    res.status(201).json({ token: signToken(u._id, u.role), user: publicUser(u) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro interno.' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    const u = await db.users.findOneAsync({ email: email.toLowerCase().trim() });
    if (!u || !await bcrypt.compare(password, u.passwordHash))
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    if (u.role !== 'support') await ensureProgress(u._id);
    res.json({ token: signToken(u._id, u.role), user: publicUser(u) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro interno.' }); }
});

app.get('/api/auth/me', authGuard, async (req, res) => {
  const u = await db.users.findOneAsync({ _id: req.uid });
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json(publicUser(u));
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const u = await db.users.findOneAsync({ email: req.body?.email?.toLowerCase().trim() });
    if (u) {
      const token = crypto.randomBytes(32).toString('hex');
      await db.users.updateAsync({ _id: u._id }, { $set: { resetToken: token, resetExpires: Date.now() + 3_600_000 } });
      const link = `${BASE_URL}/?action=reset&token=${token}`;
      await mailer.sendMail({
        from: process.env.SMTP_FROM || '"DSA" <noreply@dsa.app>', to: u.email,
        subject: '✝ DSA — Redefinição de Senha',
        text: `Olá, ${u.name}!\n\nLink para redefinir senha (válido 1 hora):\n\n${link}\n\nQue Deus te abençoe!`,
        html: emailHtml(u.name, link)
      });
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao enviar e-mail.' }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Dados inválidos.' });
    if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter no mínimo 6 caracteres.' });
    const u = await db.users.findOneAsync({ resetToken: token });
    if (!u || u.resetExpires < Date.now()) return res.status(400).json({ error: 'Link inválido ou expirado.' });
    const hash = await bcrypt.hash(password, 10);
    await db.users.updateAsync({ _id: u._id }, { $set: { passwordHash: hash, resetToken: null, resetExpires: null } });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao redefinir senha.' }); }
});

// ─── ROTAS: TRILHAS (público) ─────────────────────────────────

app.get('/api/trilhas', async (_, res) => {
  try {
    const trilhas = await db.trilhas.findAsync({});
    trilhas.sort((a, b) => a.code - b.code);
    const result = await Promise.all(trilhas.map(async trilha => {
      const temas = await Promise.all(
        (trilha.temaIds || []).map(id => db.temas.findOneAsync({ _id: id }))
      );
      return { ...trilha, temas: temas.filter(Boolean) };
    }));
    res.json(result);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao listar trilhas.' }); }
});

// ─── ROTAS: PROGRESSO ─────────────────────────────────────────

app.get('/api/progress', authGuard, async (req, res) => {
  try {
    await ensureProgress(req.uid);
    const rows = await db.progress.findAsync({ userId: req.uid, trilhaId: { $exists: true } });
    res.json(rows.map(p => ({
      trilha_id: p.trilhaId,
      tema_id: p.temaId,
      tema_index: p.temaIndex,
      score: p.score,
      first_attempt_rate: p.firstAttemptRate,
      time_seconds: p.timeSeconds,
      completed: p.completed ? 1 : 0
    })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao carregar progresso.' }); }
});

app.post('/api/progress/:trilhaId/:temaIndex', authGuard, async (req, res) => {
  try {
    const { trilhaId, temaIndex } = req.params;
    const idx = +temaIndex;
    if (!trilhaId || isNaN(idx) || idx < 0 || idx > 99) return res.status(400).json({ error: 'Parâmetros inválidos.' });
    const { score = 0, firstAttemptRate = 0, timeSec = 0, completed = false } = req.body;
    const cur = await db.progress.findOneAsync({ userId: req.uid, trilhaId, temaIndex: idx });
    if (!cur?.completed || score > (cur?.score || 0)) {
      await db.progress.updateAsync(
        { userId: req.uid, trilhaId, temaIndex: idx },
        { $set: { score, firstAttemptRate, timeSeconds: timeSec, completed: !!completed, completedAt: completed ? Date.now() : null } },
        { upsert: true }
      );
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao salvar progresso.' }); }
});

// ─── ROTAS: RANKING ───────────────────────────────────────────

app.get('/api/ranking', authGuard, async (req, res) => {
  try {
    const allUsers = await db.users.findAsync({ role: { $ne: 'support' } });
    const allDone = await db.progress.findAsync({ completed: true });
    const byUser = {};
    allDone.forEach(p => { if (!byUser[p.userId]) byUser[p.userId] = []; byUser[p.userId].push(p); });
    const result = allUsers.map(u => {
      const ps = byUser[u._id] || [];
      return {
        id: u._id, name: u.name, role: u.role, role_custom: u.roleCustom, city: u.city, parish: u.parish, movement: u.movement,
        total_score: ps.reduce((s, p) => s + p.score, 0), total_time: ps.reduce((s, p) => s + p.timeSeconds, 0), stages_done: ps.length
      };
    });
    result.sort((a, b) => b.total_score !== a.total_score ? b.total_score - a.total_score : a.total_time - b.total_time);
    res.json(result.slice(0, 100));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao carregar ranking.' }); }
});

// ─── ROTAS: QUIZ ──────────────────────────────────────────────

// Busca 10 questões aleatórias do pool do tema
app.get('/api/quiz/:temaId', async (req, res) => {
  try {
    const { temaId } = req.params;
    const pool = await db.questions.findAsync({ trailId: temaId });
    const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, 10);
    res.json(shuffled.map(q => ({
      id: q._id, theme: q.theme, question: q.question,
      options: q.options, answer: q.answer, explanation: q.explanation,
      image: q.image || null
    })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao buscar questões.' }); }
});

// ─── ROTAS: ADMIN — TRILHAS ───────────────────────────────────

app.get('/api/admin/trilhas', adminGuard, async (req, res) => {
  try {
    const trilhas = await db.trilhas.findAsync({});
    trilhas.sort((a, b) => a.code - b.code);
    const allQ = await db.questions.findAsync({});
    const countByTema = {};
    allQ.forEach(q => { countByTema[q.trailId] = (countByTema[q.trailId] || 0) + 1; });

    const result = await Promise.all(trilhas.map(async trilha => {
      const temas = await Promise.all(
        (trilha.temaIds || []).map(async id => {
          const t = await db.temas.findOneAsync({ _id: id });
          return t ? { ...t, questionCount: countByTema[id] || 0 } : null;
        })
      );
      return { ...trilha, temas: temas.filter(Boolean) };
    }));
    res.json(result);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao listar trilhas.' }); }
});

app.post('/api/admin/trilhas', adminGuard, async (req, res) => {
  try {
    const { name, icon, desc, temas } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nome da trilha é obrigatório.' });
    if (!Array.isArray(temas) || temas.length === 0)
      return res.status(400).json({ error: 'A trilha precisa ter ao menos 1 tema.' });

    // Criar temas novos e coletar seus IDs
    const allExisting = await db.trilhas.findAsync({});
    const nextCode = allExisting.length + 1;
    const temaIds = [];

    for (const t of temas) {
      if (!t.name?.trim()) continue;
      const allTemas = await db.temas.findAsync({});
      const tCode = allTemas.length + 1;
      const temaId = `tema_${Date.now()}_${tCode}`;
      await db.temas.insertAsync({
        _id: temaId, code: tCode,
        name: t.name.trim(), icon: t.icon?.trim() || '✝', desc: t.desc?.trim() || '',
        createdAt: Date.now()
      });
      temaIds.push(temaId);
    }

    const trilha = await db.trilhas.insertAsync({
      code: nextCode, name: name.trim(),
      icon: icon?.trim() || '🎯', desc: desc?.trim() || '',
      temaIds, createdAt: Date.now()
    });

    // Criar registros de progresso para todos os usuários
    const users = await db.users.findAsync({ role: { $ne: 'support' } });
    for (const u of users) {
      await ensureProgress(u._id);
    }

    res.status(201).json(trilha);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao criar trilha.' }); }
});

app.put('/api/admin/trilhas/:id', adminGuard, async (req, res) => {
  try {
    const { name, icon, desc, temaIds } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const n = await db.trilhas.updateAsync(
      { _id: req.params.id },
      { $set: { name: name.trim(), icon: icon || '🎯', desc: desc || '', ...(temaIds ? { temaIds } : {}) } }
    );
    if (!n.numReplaced) return res.status(404).json({ error: 'Trilha não encontrada.' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao atualizar trilha.' }); }
});

// ─── ROTAS: ADMIN — TEMAS ─────────────────────────────────────

app.get('/api/admin/temas', adminGuard, async (req, res) => {
  try {
    const temas = await db.temas.findAsync({});
    temas.sort((a, b) => a.code - b.code);
    const allQ = await db.questions.findAsync({});
    const countByTema = {};
    allQ.forEach(q => { countByTema[q.trailId] = (countByTema[q.trailId] || 0) + 1; });
    res.json(temas.map(t => ({ ...t, questionCount: countByTema[t._id] || 0 })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao listar temas.' }); }
});

app.put('/api/admin/temas/:id', adminGuard, async (req, res) => {
  try {
    const { name, icon, desc } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const n = await db.temas.updateAsync(
      { _id: req.params.id },
      { $set: { name: name.trim(), icon: icon || '✝', desc: desc || '' } }
    );
    if (!n.numReplaced) return res.status(404).json({ error: 'Tema não encontrado.' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao atualizar tema.' }); }
});

// ─── ROTAS: ADMIN — QUESTÕES ──────────────────────────────────

app.get('/api/admin/questions', adminGuard, async (req, res) => {
  try {
    const { temaId, page = 1, limit = 25 } = req.query;
    const query = {};
    if (temaId) query.trailId = temaId;
    const all = await db.questions.findAsync(query);
    all.sort((a, b) => a.createdAt - b.createdAt);
    const total = all.length;
    const rows = all.slice((+page - 1) * +limit, +page * +limit);
    res.json({ total, page: +page, limit: +limit, pages: Math.ceil(total / +limit) || 1, rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao listar questões.' }); }
});

app.get('/api/admin/stats', adminGuard, async (req, res) => {
  try {
    const allQ = await db.questions.findAsync({});
    const byTema = {};
    allQ.forEach(q => { byTema[q.trailId] = (byTema[q.trailId] || 0) + 1; });
    const trilhas = await db.trilhas.findAsync({});
    const byTrilha = {};
    for (const trilha of trilhas) {
      byTrilha[trilha._id] = (trilha.temaIds || []).reduce((s, id) => s + (byTema[id] || 0), 0);
    }
    res.json({ total: allQ.length, byTema, byTrilha });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao gerar estatísticas.' }); }
});

app.post('/api/admin/questions', adminGuard, async (req, res) => {
  try {
    const { temaId, theme, question, options, answer, explanation, image } = req.body;
    if (!temaId || !question?.trim())
      return res.status(400).json({ error: 'Tema e enunciado são obrigatórios.' });
    if (!Array.isArray(options) || options.length !== 4 || options.some(o => !o?.trim()))
      return res.status(400).json({ error: 'Preencha as 4 alternativas.' });
    if (answer < 0 || answer > 3 || isNaN(answer))
      return res.status(400).json({ error: 'Selecione a alternativa correta (A, B, C ou D).' });

    const dup = await db.questions.findOneAsync({ trailId: temaId, question: question.trim() });
    if (dup) return res.status(409).json({ error: 'Esta questão já existe neste tema.' });

    const q = await db.questions.insertAsync({
      trailId: temaId, level: 1, stage: 1,
      theme: theme?.trim() || 'Geral', question: question.trim(),
      options: options.map(o => o.trim()), answer: +answer,
      explanation: explanation?.trim() || '',
      image: image?.trim() || null,
      createdAt: Date.now()
    });
    res.status(201).json(q);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao criar questão.' }); }
});

app.put('/api/admin/questions/:id', adminGuard, async (req, res) => {
  try {
    const { temaId, theme, question, options, answer, explanation, image } = req.body;
    if (!temaId || !question?.trim())
      return res.status(400).json({ error: 'Tema e enunciado são obrigatórios.' });
    if (!Array.isArray(options) || options.length !== 4 || options.some(o => !o?.trim()))
      return res.status(400).json({ error: 'Preencha as 4 alternativas.' });
    if (answer < 0 || answer > 3 || isNaN(answer))
      return res.status(400).json({ error: 'Selecione a alternativa correta.' });

    const dup = await db.questions.findOneAsync({ trailId: temaId, question: question.trim(), _id: { $ne: req.params.id } });
    if (dup) return res.status(409).json({ error: 'Esta questão já existe neste tema.' });

    const n = await db.questions.updateAsync(
      { _id: req.params.id },
      {
        $set: {
          trailId: temaId, theme: theme?.trim() || 'Geral',
          question: question.trim(), options: options.map(o => o.trim()),
          answer: +answer, explanation: explanation?.trim() || '',
          image: image?.trim() || null, updatedAt: Date.now()
        }
      }
    );
    if (!n.numReplaced) return res.status(404).json({ error: 'Questão não encontrada.' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao atualizar questão.' }); }
});

app.delete('/api/admin/questions/:id', adminGuard, async (req, res) => {
  try {
    const n = await db.questions.removeAsync({ _id: req.params.id });
    if (!n.numRemoved) return res.status(404).json({ error: 'Questão não encontrada.' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao excluir questão.' }); }
});

// ─── SPA CATCH-ALL (apenas em dev local) ──────────────────────
if (!process.env.FRONTEND_URL) {
  app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
}

// ─── START ────────────────────────────────────────────────────
seedAll().then(() => {
  app.listen(PORT, () => {
    console.log('\n  ✝  DSA — Desafio dos Servidores do Altar');
    console.log(`     Servidor  : http://localhost:${PORT}`);
    console.log(`     Dados     : ./data/  (5 bancos NeDB)`);
    console.log(`     E-mail    : ${process.env.SMTP_PASS ? 'Brevo API configurado ✓' : 'modo dev — links no console'}`);
    console.log(`     Suporte   : dsa.servidoresdoaltar@gmail.com`);
    console.log('');
  });
}).catch(e => { console.error('Erro na inicialização:', e); process.exit(1); });
