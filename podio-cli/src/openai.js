import OpenAI from 'openai';

export async function classifyInputs({ imageUrls = [], texts = [] }, apiKey) {
  const openai = new OpenAI({ apiKey });

  const content = [];
  // Instruction
  content.push({
    type: 'text',
    text: 'Analiza el material adjunto (imágenes y/o texto de PDF) y devuelve SOLO JSON válido con: nombre_corto, descripcion, requ_id, fecha (YYYY-MM-DD), fraccion, justificacion, arbol (array de strings), alternativas (array de {fraccion,motivo}), dudas_cliente, regulacion, notas_clasificador.',
  });

  // Add PDFs as text blocks
  texts.forEach((t, i) => {
    if (t && t.trim()) content.push({ type: 'text', text: `PDF_${i + 1} (texto extraído):\n${t}` });
  });

  // Add images (URLs or data URLs)
  imageUrls.forEach((url) => content.push({ type: 'image_url', image_url: { url } }));

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'clasificacion_tigie',
        schema: {
          type: 'object',
          required: ['fraccion', 'justificacion'],
          properties: {
            nombre_corto: { type: 'string' },
            descripcion: { type: 'string' },
            requ_id: { type: 'string' },
            fecha: { type: 'string' },
            fraccion: { type: 'string' },
            justificacion: { type: 'string' },
            arbol: { type: 'array', items: { type: 'string' } },
            alternativas: {
              type: 'array',
              items: { type: 'object', properties: { fraccion: { type: 'string' }, motivo: { type: 'string' } } },
            },
            dudas_cliente: { type: 'string' },
            regulacion: { type: 'string' },
            notas_clasificador: { type: 'string' },
          },
        },
      },
    },
    messages: [
      { role: 'system', content: 'Eres un clasificador aduanal experto en TIGIE. Responde SOLO en JSON válido.' },
      { role: 'user', content },
    ],
  });

  const txt = resp?.choices?.[0]?.message?.content ?? '{}';
  return JSON.parse(txt);
}
