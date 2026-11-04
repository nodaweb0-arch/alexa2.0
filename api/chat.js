// Vercel Serverless Function: /api/chat
// Configurá la variable de entorno ANTHROPIC_API_KEY en Vercel (Settings > Environment Variables).

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { pregunta, contexto, historial } = req.body || {};
  if (!pregunta) return res.status(400).json({ error: 'Falta la pregunta' });

  const sensores = contexto
    ? `Datos actuales del ambiente: temperatura ${contexto.temperatura} °C, humedad ${contexto.humedad} %, ` +
      `corriente ${contexto.corriente} A, aparato ${contexto.rele ? 'encendido' : 'apagado'}.`
    : '';

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-5-5',
        max_tokens: 200,
        system:
          'Sos un asistente de voz de un dispositivo que mide temperatura, humedad y corriente. ' +
          'Respondé en español rioplatense, en 1 o 2 frases cortas, sin markdown, listas ni emojis, ' +
          'porque tu respuesta se lee en voz alta. ' + sensores,
        messages: [...(Array.isArray(historial) ? historial.slice(-8) : []), { role: 'user', content: pregunta }]
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data?.error?.message || 'Error de la API' });
    const respuesta = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
    res.status(200).json({ respuesta });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
