import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface SlotInput {
  id: string; name: string; meal_type: string
  suggested_tag: string | null; day_offsets: number[]
}
interface RecipeInput {
  id: string; name: string; meal_type: string | null; tags: string[]
}

const AssignmentSchema = z.array(z.object({
  dish_slot_id: z.string().uuid(),
  recipe_id:    z.string().uuid(),
}))

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { country, dish_slots, recipes, restrictions } = req.body as {
    country:      string
    dish_slots:   SlotInput[]
    recipes:      RecipeInput[]
    restrictions: Array<{ tag: string; type: string }>
  }

  if (!dish_slots?.length || !recipes?.length)
    return res.status(200).json([])

  const excludeList = (restrictions ?? []).filter(r => r.type === 'exclude').map(r => r.tag).join(', ')
  const avoidList   = (restrictions ?? []).filter(r => r.type === 'prefer_avoid').map(r => r.tag).join(', ')

  const slotsText   = dish_slots.map(s =>
    `{"dish_slot_id":"${s.id}","meal_type":"${s.meal_type}","suggested_tag":${JSON.stringify(s.suggested_tag)},"days":[${s.day_offsets.join(',')}]}`
  ).join('\n')

  const recipesText = recipes.map(r =>
    `{"recipe_id":"${r.id}","name":${JSON.stringify(r.name)},"meal_type":${JSON.stringify(r.meal_type)},"tags":${JSON.stringify(r.tags)}}`
  ).join('\n')

  const prompt = `Eres un planificador de menú semanal para una familia en ${country}.

Slots sin asignar (necesitan una receta):
${slotsText}

Recetas disponibles:
${recipesText}

${excludeList ? `RESTRICCIONES ABSOLUTAS — no asignes recetas cuyos tags incluyan: ${excludeList}` : ''}
${avoidList   ? `Preferir evitar tags: ${avoidList}` : ''}

Reglas:
1. Asigna solo recetas cuyo meal_type coincida con el del slot (breakfast→breakfast, lunch→lunch, dinner→dinner, snack→snack).
2. Prefiere recetas cuyo tag incluya el suggested_tag del slot.
3. No repitas la misma recipe_id más de una vez si hay alternativas.
4. Si no existe receta adecuada para un slot, omite ese slot.

Responde SOLO con un array JSON, sin texto adicional:
[{"dish_slot_id":"<uuid>","recipe_id":"<uuid>"},...]`

  try {
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages:   [{ role: 'user', content: prompt }],
    })

    const raw      = (msg.content[0] as { type: string; text: string }).text.trim()
    const arrStart = raw.indexOf('[')
    const arrEnd   = raw.lastIndexOf(']')
    if (arrStart === -1 || arrEnd === -1) return res.status(200).json([])

    const parsed = AssignmentSchema.safeParse(JSON.parse(raw.slice(arrStart, arrEnd + 1)))
    if (!parsed.success) return res.status(200).json([])

    // Filtrar IDs inválidos — defensa contra alucinaciones
    const validSlotIds   = new Set(dish_slots.map(s => s.id))
    const validRecipeIds = new Set(recipes.map(r => r.id))
    const safe = parsed.data.filter(
      a => validSlotIds.has(a.dish_slot_id) && validRecipeIds.has(a.recipe_id)
    )

    return res.status(200).json(safe)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error generando sugerencia' })
  }
}
