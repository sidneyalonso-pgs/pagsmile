// Pagsmile Faturamento — Proxy Microsoft Graph API
// Lê e salva dados direto no Excel do OneDrive via Microsoft Graph

const TENANT_ID  = '2cdf9b61-ba13-4086-a05d-1dd634a38669';
const CLIENT_ID  = '35251d24-52c6-4bf3-a656-307d9afcb1a6';
const CLIENT_SECRET = 'eqS8Q~HFrH2BdKEBgDVvE1MKS_IPjUx5WCptUbBM';
const FILE_ID    = '6FB4BB02-160A-4392-A339-1B73CB10DDCA';
const USER_ID    = 'sidney.alonso@xcloudgame.com';

// Colunas de cada aba
const COLS = {
  Usuarios:    ['id','nome','email','cargo','perfil','senha_hash','foto_url','status','ultimo_acesso','criado_em','criado_por'],
  Clientes:    ['id','razao','cnpj','agencia','conta','num_conta','repasse','in_tipo','in_val','out_tipo','out_val','criado_por','criado_em'],
  Faturas:     ['id','clienteId','cliente','cnpj','agencia','conta','num_conta','competencia','inicio','fim','qtdIn','valIn','qtdOut','valOut','total','repasse','obs','status','emissao','criado_por','criado_em'],
  NotasDebito: ['id','debitado','cnpj','tipo','ref','competencia','vencimento','itens','total','obs','status','emissao','criado_por','criado_em'],
  Sessoes:     ['token','usuario_id','email','perfil','criado_em','expira_em'],
  Logs:        ['data','email','nome','acao','detalhe','ip'],
};

// Salt para hash de senha
const SALT = 'pagsmile_salt_2026';

// ── Token Microsoft Graph ──────────────────────────────────
async function getToken() {
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope:         'https://graph.microsoft.com/.default',
  });
  const res  = await fetch(url, { method: 'POST', body });
  const data = await res.json();
  if (!data.access_token) throw new Error('Falha ao obter token: ' + JSON.stringify(data));
  return data.access_token;
}

// ── Graph helper ───────────────────────────────────────────
async function graph(path, method = 'GET', body = null, token) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(`https://graph.microsoft.com/v1.0${path}`, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph ${method} ${path} → ${res.status}: ${err}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Excel helpers ──────────────────────────────────────────
const excelBase = `/users/${USER_ID}/drive/items/${FILE_ID}/workbook`;

async function lerAba(sheet, token) {
  try {
    const data = await graph(`${excelBase}/worksheets('${sheet}')/usedRange`, 'GET', null, token);
    const rows = data.values || [];
    if (rows.length <= 1) return [];
    const header = rows[0];
    return rows.slice(1).map(row =>
      Object.fromEntries(header.map((col, i) => [col, row[i] ?? '']))
    );
  } catch(e) {
    return [];
  }
}

async function adicionarLinha(sheet, valores, token) {
  // Descobrir próxima linha vazia
  const data = await graph(`${excelBase}/worksheets('${sheet}')/usedRange`, 'GET', null, token);
  const nextRow = (data.rowCount || 1) + 1;
  const cols = COLS[sheet];
  const endCol = String.fromCharCode(64 + cols.length);
  const range = `A${nextRow}:${endCol}${nextRow}`;
  const row = cols.map(c => valores[c] ?? '');
  await graph(`${excelBase}/worksheets('${sheet}')/range(address='${range}')`, 'PATCH', { values: [row] }, token);
}

async function atualizarCelula(sheet, campo, valor, idBusca, colId = 'id', token) {
  const data = await graph(`${excelBase}/worksheets('${sheet}')/usedRange`, 'GET', null, token);
  const rows = data.values || [];
  const header = rows[0] || [];
  const colIdx = header.indexOf(campo);
  const idIdx  = header.indexOf(colId);
  if (colIdx === -1 || idIdx === -1) return;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idIdx]) === String(idBusca)) {
      const col = String.fromCharCode(65 + colIdx);
      await graph(`${excelBase}/worksheets('${sheet}')/range(address='${col}${i+1}')`, 'PATCH', { values: [[valor]] }, token);
      return;
    }
  }
}

async function deletarLinha(sheet, id, token) {
  const data = await graph(`${excelBase}/worksheets('${sheet}')/usedRange`, 'GET', null, token);
  const rows = data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      const cols = COLS[sheet];
      const endCol = String.fromCharCode(64 + cols.length);
      const range = `A${i+1}:${endCol}${i+1}`;
      await graph(`${excelBase}/worksheets('${sheet}')/range(address='${range}')`, 'PATCH',
        { values: [new Array(cols.length).fill('')] }, token);
      return;
    }
  }
}

// ── Hash senha ─────────────────────────────────────────────
async function hashSenha(senha) {
  const encoder = new TextEncoder();
  const data    = encoder.encode(senha + SALT);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Sessões (em memória + Excel) ───────────────────────────
const SESSION_HOURS = 8;

async function criarSessao(user, token) {
  const sessToken = crypto.randomUUID();
  const agora     = new Date();
  const expira    = new Date(agora.getTime() + SESSION_HOURS * 3600000);
  await adicionarLinha('Sessoes', {
    token:      sessToken,
    usuario_id: user.id,
    email:      user.email,
    perfil:     user.perfil,
    criado_em:  agora.toISOString(),
    expira_em:  expira.toISOString(),
  }, token);
  // Atualiza ultimo_acesso
  await atualizarCelula('Usuarios', 'ultimo_acesso', agora.toISOString(), user.id, 'id', token);
  return {
    ok: true,
    token: sessToken,
    expira: expira.toISOString(),
    usuario: {
      id:       user.id,
      nome:     user.nome,
      email:    user.email,
      cargo:    user.cargo,
      perfil:   user.perfil,
      foto_url: user.foto_url || '',
    }
  };
}

async function validarToken(sessToken, graphToken) {
  const sessoes = await lerAba('Sessoes', graphToken);
  const sessao  = sessoes.find(s => s.token === sessToken);
  if (!sessao) return null;
  if (new Date() > new Date(sessao.expira_em)) return null;
  const usuarios = await lerAba('Usuarios', graphToken);
  const user     = usuarios.find(u => String(u.id) === String(sessao.usuario_id));
  if (!user || user.status === 'bloqueado') return null;
  return { ...sessao, nome: user.nome, cargo: user.cargo, foto_url: user.foto_url || '' };
}

// ── Rotas ──────────────────────────────────────────────────
async function login(dados, graphToken) {
  const { email, senha } = dados;
  if (!email || !senha) return { ok: false, erro: 'Email e senha obrigatórios.' };
  const hash     = await hashSenha(senha);
  const usuarios = await lerAba('Usuarios', graphToken);
  const user     = usuarios.find(u => u.email.toLowerCase() === email.toLowerCase() && u.senha_hash === hash);
  if (!user) return { ok: false, erro: 'Email ou senha incorretos.' };
  if (user.status === 'bloqueado') return { ok: false, erro: 'Usuário bloqueado.' };
  return criarSessao(user, graphToken);
}

async function carregarTudo(graphToken) {
  const [clientes, faturas, notasRaw] = await Promise.all([
    lerAba('Clientes', graphToken),
    lerAba('Faturas',  graphToken),
    lerAba('NotasDebito', graphToken),
  ]);
  const notas = notasRaw.map(n => {
    try { n.itens = JSON.parse(n.itens); } catch(e) { n.itens = []; }
    return n;
  });
  return { ok: true, clientes, faturas, notas };
}

async function inicializar(graphToken) {
  // Verificar se já tem usuário admin
  const usuarios = await lerAba('Usuarios', graphToken);
  if (usuarios.filter(u => u.id).length === 0) {
    const hash = await hashSenha('admin123');
    await adicionarLinha('Usuarios', {
      id: Date.now(), nome: 'Administrador', email: 'admin@pagsmile.com',
      cargo: 'Administrador do Sistema', perfil: 'admin',
      senha_hash: hash, foto_url: '', status: 'ativo',
      ultimo_acesso: '', criado_em: new Date().toISOString(), criado_por: 'sistema'
    }, graphToken);
  }
  return { ok: true, mensagem: 'Sistema inicializado.' };
}

// ── Handler principal ──────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { acao, dados = {}, token: sessToken } = req.body;
    const graphToken = await getToken();
    let resultado;

    // Rotas públicas
    if (acao === 'login')       return res.json(await login(dados, graphToken));
    if (acao === 'inicializar') return res.json(await inicializar(graphToken));
    if (acao === 'logout') {
      await atualizarCelula('Sessoes', 'expira_em', new Date(0).toISOString(), sessToken, 'token', graphToken);
      return res.json({ ok: true });
    }

    // Rotas protegidas
    const sessao = await validarToken(sessToken, graphToken);
    if (!sessao) return res.json({ ok: false, erro: 'Sessão inválida ou expirada.' });

    const perfil = sessao.perfil;
    const isAdmin = perfil === 'admin';
    const isFat   = perfil === 'faturamento';
    const isND    = perfil === 'nd';

    switch(acao) {
      case 'carregarTudo':
        resultado = await carregarTudo(graphToken); break;

      case 'listarUsuarios':
        if (!isAdmin) return res.json({ ok: false, erro: 'Acesso negado.' });
        resultado = { ok: true, dados: (await lerAba('Usuarios', graphToken)).map(u => { delete u.senha_hash; return u; }) }; break;

      case 'salvarUsuario':
        if (!isAdmin) return res.json({ ok: false, erro: 'Acesso negado.' });
        if (dados.senha) dados.senha_hash = await hashSenha(dados.senha);
        delete dados.senha;
        dados.id = dados.id || Date.now();
        dados.criado_em = new Date().toISOString();
        dados.criado_por = sessao.email;
        dados.status = dados.status || 'ativo';
        await adicionarLinha('Usuarios', dados, graphToken);
        resultado = { ok: true }; break;

      case 'bloquearUsuario':
        if (!isAdmin) return res.json({ ok: false, erro: 'Acesso negado.' });
        await atualizarCelula('Usuarios', 'status', dados.status, dados.id, 'id', graphToken);
        resultado = { ok: true }; break;

      case 'resetarSenha':
        if (!isAdmin) return res.json({ ok: false, erro: 'Acesso negado.' });
        await atualizarCelula('Usuarios', 'senha_hash', await hashSenha(dados.nova_senha), dados.id, 'id', graphToken);
        resultado = { ok: true }; break;

      case 'deletarUsuario':
        if (!isAdmin) return res.json({ ok: false, erro: 'Acesso negado.' });
        await deletarLinha('Usuarios', dados.id, graphToken);
        resultado = { ok: true }; break;

      case 'salvarCliente':
        if (isND) return res.json({ ok: false, erro: 'Sem permissão.' });
        dados.criado_por = sessao.email; dados.criado_em = new Date().toISOString();
        await adicionarLinha('Clientes', dados, graphToken);
        resultado = { ok: true }; break;

      case 'deletarCliente':
        if (!isAdmin) return res.json({ ok: false, erro: 'Sem permissão.' });
        await deletarLinha('Clientes', dados.id, graphToken);
        resultado = { ok: true }; break;

      case 'salvarFatura':
        if (isND) return res.json({ ok: false, erro: 'Sem permissão.' });
        dados.criado_por = sessao.email; dados.criado_em = new Date().toISOString();
        await adicionarLinha('Faturas', dados, graphToken);
        resultado = { ok: true }; break;

      case 'atualizarFatura':
        if (isND) return res.json({ ok: false, erro: 'Sem permissão.' });
        await atualizarCelula('Faturas', 'status', dados.status, dados.id, 'id', graphToken);
        resultado = { ok: true }; break;

      case 'deletarFatura':
        if (!isAdmin) return res.json({ ok: false, erro: 'Sem permissão.' });
        await deletarLinha('Faturas', dados.id, graphToken);
        resultado = { ok: true }; break;

      case 'salvarNota':
        if (isFat) return res.json({ ok: false, erro: 'Sem permissão.' });
        if (dados.itens) dados.itens = JSON.stringify(dados.itens);
        dados.criado_por = sessao.email; dados.criado_em = new Date().toISOString();
        await adicionarLinha('NotasDebito', dados, graphToken);
        resultado = { ok: true }; break;

      case 'atualizarNota':
        if (isFat) return res.json({ ok: false, erro: 'Sem permissão.' });
        await atualizarCelula('NotasDebito', 'status', dados.status, dados.id, 'id', graphToken);
        resultado = { ok: true }; break;

      case 'deletarNota':
        if (!isAdmin) return res.json({ ok: false, erro: 'Sem permissão.' });
        await deletarLinha('NotasDebito', dados.id, graphToken);
        resultado = { ok: true }; break;

      default:
        resultado = { ok: false, erro: 'Ação desconhecida: ' + acao };
    }

    return res.json(resultado);
  } catch(err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ ok: false, erro: err.message });
  }
}
