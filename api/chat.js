
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { pregunta, contexto, historial } = req.body || {};

  if (!pregunta) {
    return res.status(400).json({ error: 'Falta la pregunta' });
  }

  const sensores = contexto
    ? `Datos actuales: temperatura ${contexto.temperatura} °C, humedad ${contexto.humedad} %, ` +
      `corriente ${contexto.corriente} A, aparato ${contexto.rele ? 'encendido' : 'apagado'}.`
    : '';

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 200,
        messages: [
          {
            role: 'system',
            content:
              'Sos un asistente de voz de un dispositivo que mide temperatura, humedad y corriente. ' +
              'Respondé en español rioplatense, en 1 o 2 frases cortas, sin markdown, listas ni emojis, ' +
              'porque tu respuesta se lee en voz alta. ' + sensores
          },
          ...(Array.isArray(historial) ? historial.slice(-8) : []),
          { role: 'user', content: pregunta }
        ]
      })
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(500).json({
        error: data?.error?.message || 'Error de la API'
      });
    }

    res.status(200).json({
      respuesta: data.choices[0].message.content.trim()
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
