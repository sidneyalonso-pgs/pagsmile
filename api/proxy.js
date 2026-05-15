export default async function handler(req, res) {
  // Permite requisições do frontend Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const APPS_SCRIPT_URL = 'https://script.google.com/a/macros/xcloudgame.com/s/AKfycbxnoXq5e0jJS3yy0Y3RPHUyDDZNEgrM_ejGxZ5E7icEspeajYKiZuiV9Rayq-huQwWh6g/exec';

  try {
    let body = req.body;

    // POST — repassa o body JSON direto para o Apps Script
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body),
      redirect: 'follow',
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { ok: false, erro: 'Resposta inválida do servidor: ' + text.substring(0, 200) };
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, erro: 'Proxy error: ' + err.message });
  }
}
