import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { query, restrictions = [] } = req.body as { query: string; restrictions?: string[] }
  if (!query?.trim()) return res.status(400).json({ error: 'query requerido' })

  const restrictionNote = restrictions.length
    ? `\nTen en cuenta estas restricciones alimentarias de la familia: ${restrictions.join(', ')}.`
    : ''

  const prompt = `Eres un asistente de cocina especializado en recetas peruanas y latinoamericanas.
El usuario quiere crear la receta: "${query}".${restrictionNote}

Responde SOLO con un JSON válido con esta estructura exacta:
{
  "name": "nombre oficial de la receta",
  "description": "descripción breve del plato (1-2 oraciones)",
  "meal_type": "breakfast|snack|lunch|dinner",
  "tags": ["tag1", "tag2"],
  "ingredients_text": "lista de ingredientes con cantidades, una por línea, ej:\n- 500g pechuga de pollo\n- 2 cdas aceite de oliva"
}

Reglas:
- name: en español, nombre real del plato
- meal_type: elige el más apropiado según el plato
- tags: máximo 5 etiquetas relevantes (peruano, sin_gluten, fit, rapido, etc.)
- ingredients_text: ingredientes para 4 porciones, cantidades en unidades locales peruanas
- Si hay restricciones, excluye esos ingredientes o sugiere sustitutos`

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = (msg.content[0] as { type: string; text: string }).text.trim()
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return res.status(500).json({ error: 'Respuesta inválida del modelo' })

    const parsed = JSON.parse(jsonMatch[0])
    return res.status(200).json(parsed)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error generando receta' })
  }
}
