import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { text } = req.body as { text: string }
  if (!text?.trim()) return res.status(400).json({ error: 'text requerido' })

  const prompt = `Eres un asistente de nutrición. El usuario describió sus restricciones o preferencias alimentarias en lenguaje natural:
"${text}"

Extrae las restricciones alimentarias y devuelve SOLO un JSON con esta estructura:
{
  "restrictions": [
    { "tag": "mariscos", "type": "exclude", "reason": "alérgico" },
    { "tag": "gluten", "type": "prefer_avoid", "reason": "sensibilidad" }
  ]
}

Reglas:
- tag: en español, en minúsculas, una sola palabra o compuesta con guion (mariscos, gluten, lactosa, frutos_secos, cerdo, carne_roja, etc.)
- type: "exclude" si es alergia o no lo come definitivamente, "prefer_avoid" si prefiere evitarlo
- reason: motivo breve del usuario (alergia, no le gusta, intolerancia, etc.)
- Devuelve máximo 10 restricciones
- Si el texto no contiene restricciones claras, devuelve array vacío`

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = (msg.content[0] as { type: string; text: string }).text.trim()
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return res.status(200).json({ restrictions: [] })

    const parsed = JSON.parse(jsonMatch[0])
    return res.status(200).json(parsed)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error procesando restricciones' })
  }
}
