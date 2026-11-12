const PREFERIDOS = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'llama-3.1-8b-instant'
];
const URL_GROQ = 'https://api.groq.com/openai/v1/chat/completions';
let modeloCache = null;

async function elegirModelo(key) {
  if (modeloCache) return modeloCache;

  const r = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${key}` }
  });

  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || 'No se pudo listar modelos');

  const ids = Array.isArray(data?.data) ? data.data.map(m => m.id).filter(Boolean) : [];
  const chat = ids.filter(id => !/whisper|tts|guard|embed|orpheus|playai|compound/i.test(id));

  modeloCache = PREFERIDOS.find(p => ids.includes(p)) || chat[0] || null;
  if (!modeloCache) {
    throw new Error('Modelos disponibles: ' + ids.join(', ') || 'Sin modelos disponibles');
  }
  return modeloCache;
}

async function llamar(key, model, messages, maxTokens) {
  const r = await fetch(URL_GROQ, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages })
  });

  const data = await r.json();
  if (!r.ok) throw new Error(`(${model}) ` + (data?.error?.message || 'Error de la API'));
  return (data.choices?.[0]?.message?.content || '').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { pregunta, contexto, historial } = req.body || {};
  if (!pregunta || !String(pregunta).trim()) {
    return res.status(400).json({ error: 'Falta la pregunta' });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Falta la variable de entorno GROQ_API_KEY' });
  }

  const c = contexto || {};
  const ahora = typeof c.ahora === 'string' ? `Fecha y hora actual en Argentina: ${c.ahora}. ` : '';
  const sensores = Number.isFinite(c.temperatura) || Number.isFinite(c.humedad) || Number.isFinite(c.corriente) || c.rele !== undefined
    ? `Datos del dispositivo (solo mencionalos si te los preguntan): temperatura ${Number.isFinite(c.temperatura) ? c.temperatura : 'desconocida'} °C, ` +
      `humedad ${Number.isFinite(c.humedad) ? c.humedad : 'desconocida'} %, corriente ${Number.isFinite(c.corriente) ? c.corriente : 'desconocida'} A, aparato ${c.rele ? 'encendido' : 'apagado'}.`
    : '';

  const system =
    'Sos Alexa 2.0, un asistente de voz amable y canchero, con un dispositivo que mide temperatura, humedad y corriente. ' +
    'Hablás en español rioplatense natural, como una persona: respuestas de 1 a 3 frases cortas, sin markdown, listas, ' +
    'links, citas ni emojis, porque se leen en voz alta. ' +
    'Para resultados deportivos, noticias, clima y cualquier dato actual, buscá en la web y dá el dato concreto ' +
    '(resultado, fecha, hora) sin decir que lo buscaste. Si no estás seguro, decilo en una frase. ' +
    ahora + sensores;

  const messages = [
    { role: 'system', content: system },
    ...(Array.isArray(historial) ? historial.slice(-8) : []),
    { role: 'user', content: String(pregunta).trim() }
  ];

  try {
    let respuesta = '';

    try {
      respuesta = await llamar(key, 'groq/compound-mini', messages, 500);
    } catch (e) {
      // Si no está disponible, usamos el modelo normal.
    }

    if (!respuesta) {
      const model = await elegirModelo(key);
      respuesta = await llamar(key, model, messages, 600);
    }

    res.status(200).json({ respuesta });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Error interno' });
  }
}
