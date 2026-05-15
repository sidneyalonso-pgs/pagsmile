export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const APPS_SCRIPT_URL = 'https://script.google.com/a/macros/xcloudgame.com/s/AKfycbxnoXq5e0jJS3yy0Y3RPHUyDDZNEgrM_ejGxZ5E7icEspeajYKiZuiV9Rayq-huQwWh6g/exec';
  const API_KEY = 'pgs2026xcloud';

  try {
    const body = { ...req.body, apiKey: API_KEY };

    // Tenta POST primeiro
    let response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
    });

    let text = await response.text();

    // Se recebeu HTML (página de login do Google), tenta via GET com payload
    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      const payload = encodeURIComponent(JSON.stringify(body));
      response = await fetch(`${APPS_SCRIPT_URL}?payload=${payload}`, {
        method: 'GET',
        redirect: 'follow',
      });
      text = await response.text();
    }

    // Remove JSONP wrapper se existir
    if (text.includes('(') && text.endsWith(')')) {
      text = text.substring(text.indexOf('(') + 1, text.lastIndexOf(')'));
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { ok: false, erro: 'Resposta inválida: ' + text.substring(0, 300) };
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, erro: 'Proxy error: ' + err.message });
  }
}
