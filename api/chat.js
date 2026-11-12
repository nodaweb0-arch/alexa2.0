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
  const chat = ids.filter(id => !/whisper|tts|guard|embed|orpheus|playai|compound/i.test(id));
  modeloCache = PREFERIDOS.find(p => ids.includes(p)) || chat[0];
  if (!modeloCache) throw new Error('Modelos disponibles: ' + ids.join(', '));
  return modeloCache;
}

// ---------- Búsqueda web (Tavily) ----------
const CLAVES = ['partido', 'resultado', 'salio', 'gano', 'ganaron', 'perdio', 'empato', 'score',
  'noticia', 'clima', 'pronostico', 'hoy', 'ayer', 'anoche', 'ultimo', 'ultima', 'actual',
  'precio', 'cotizacion', 'dolar', 'euro', 'bitcoin', 'campeon', 'tabla', 'posiciones',
  'fixture', 'cuando juega', 'quien es', 'presidente', 'estreno', 'cuanto esta', 'cuanto sale'];

function necesitaBusqueda(p) {
  const t = p.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return CLAVES.some(k => t.includes(k));
}

async function buscar(query, reciente) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return '';
  try {
    const cuerpo = { query, max_results: 6, include_answer: false, search_depth: 'basic' };
    if (reciente) { cuerpo.topic = 'news'; cuerpo.days = 5; }
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(cuerpo)
    });
    const d = await r.json();
    if (!r.ok) return '';
    let lista = d.results || [];
    if (reciente) {
      lista = lista.sort((a, b) => new Date(b.published_date || 0) - new Date(a.published_date || 0));
    }
    let txt = '';
    for (const x of lista.slice(0, 4)) {
      const f = x.published_date ? ` (${x.published_date.slice(0, 16)})` : '';
      txt += `- ${x.title}${f}: ${(x.content || '').slice(0, 300)}\n`;
    }
    return txt;
  } catch (e) {
    return '';
  }
}

export default async function handler(req, res) {
    if (req.method === 'GET') {
    const t = process.env.TAVILY_API_KEY;
    let estado = t ? 'clave cargada' : 'FALTA TAVILY_API_KEY';
    if (t) {
      try {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
          body: JSON.stringify({ query: 'Boca Juniors último partido resultado', max_results: 2 })
        });
        const d = await r.json();
        estado += ' | tavily HTTP ' + r.status + ' | ' + JSON.stringify(d).slice(0, 400);
      } catch (e) {
        estado += ' | error: ' + e.message;
      }
    }
    return res.status(200).json({ estado });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { pregunta, contexto, historial } = req.body || {};
  if (!pregunta) return res.status(400).json({ error: 'Falta la pregunta' });

  const key = process.env.GROQ_API_KEY;
  const c = contexto || {};
  const ahora = c.ahora ? `Fecha y hora actual en Argentina: ${c.ahora}. ` : '';
  const sensores = c.temperatura !== undefined
    ? `Datos del dispositivo (solo mencionalos si te los preguntan): temperatura ${c.temperatura} °C, ` +
      `humedad ${c.humedad} %, corriente ${c.corriente} A, aparato ${c.rele ? 'encendido' : 'apagado'}.`
    : '';

  let web = '';
  let buscado = false;
  if (necesitaBusqueda(pregunta)) {
    buscado = true;
    const t = pregunta.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const deportes = ['partido', 'salio', 'gano', 'ganaron', 'perdio', 'empato', 'finde', 'anoche', 'resultado']
      .some(k => t.includes(k));
    const reciente = deportes || ['ayer', 'hoy', 'noticia', 'anoche'].some(k => t.includes(k));
    web = await buscar(deportes ? pregunta + ' último partido resultado' : pregunta, reciente);
  }

  let internet = '';
  if (web) {
    internet = 'Resultados de una búsqueda en internet hecha recién (usalos para responder con el dato concreto, ' +
      'por ejemplo resultado y fecha, y si no aparece lo que piden, decilo): ' +
      'Si hay varios partidos o fechas, usá el más reciente respecto de la fecha de hoy y decí contra quién fue. ' +
      '\n' + web;
  } else if (buscado) {
    internet = 'No pudiste consultar internet ahora: si te piden un dato actual, decí que no lo podés confirmar. ';
  }

  const system =
    'Sos Alexa 2.0, un asistente de voz amable y canchero, con un dispositivo que mide temperatura, humedad y corriente. ' +
    'Hablás en español rioplatense natural, como una persona: respuestas de 1 a 3 frases cortas, sin markdown, listas, ' +
    'links, citas ni emojis, porque se leen en voz alta. No tenés herramientas ni podés navegar: respondé solo con ' +
    'lo que sabés y con los resultados que te pasen acá. ' + ahora + sensores + '\n' + internet;

  try {
    const model = await elegirModelo(key);
    const cuerpo = {
      model,
      max_tokens: 700,
      messages: [
        { role: 'system', content: system },
        ...(Array.isArray(historial) ? historial.slice(-8) : []),
        { role: 'user', content: pregunta }
      ]
    };
    if (model.includes('gpt-oss')) cuerpo.reasoning_effort = 'low';

    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(cuerpo)
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: `(${model}) ` + (data?.error?.message || 'Error de la API') });
    res.status(200).json({ respuesta: (data.choices?.[0]?.message?.content || '').trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
