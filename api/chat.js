const PREFERIDOS = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'llama-3.1-8b-instant'
];

let modeloCache = null;

async function elegirModelo(key) {
  if (modeloCache) return modeloCache;
  const r = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${key}` }
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || 'No se pudo listar modelos');
  const ids = data.data.map(m => m.id);
  const chat = ids.filter(id => !/whisper|tts|guard|embed|orpheus|playai/i.test(id));
  modeloCache = PREFERIDOS.find(p => ids.includes(p)) || chat[0];
  if (!modeloCache) throw new Error('Modelos disponibles: ' + ids.join(', '));
  return modeloCache;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { pregunta, contexto, historial } = req.body || {};
  if (!pregunta) return res.status(400).json({ error: 'Falta la pregunta' });

  const key = process.env.GROQ_API_KEY;
  const sensores = contexto
    ? `Datos actuales: temperatura ${contexto.temperatura} °C, humedad ${contexto.humedad} %, ` +
      `corriente ${contexto.corriente} A, aparato ${contexto.rele ? 'encendido' : 'apagado'}.`
    : '';

  try {
    const model = await elegirModelo(key);
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        messages: [
          {
            role: 'system',
            content:
              'Sos un asistente de voz de un dispositivo que mide temperatura, humedad y corriente. ' +
              'Respondé cualquier pregunta con normalidad, en español rioplatense, en 1 o 2 frases cortas, ' +
              'sin markdown, listas ni emojis, porque tu respuesta se lee en voz alta. ' +
              'Mencioná los datos del dispositivo solo si te los preguntan. ' + sensores
          },
          ...(Array.isArray(historial) ? historial.slice(-8) : []),
          { role: 'user', content: pregunta }
        ]
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: `(${model}) ` + (data?.error?.message || 'Error de la API') });
    res.status(200).json({ respuesta: data.choices[0].message.content.trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
