import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface FamilyContext {
  country: string
  currency: string
  restrictions: Array<{ tag: string; type: string }>
  patterns: Array<{ label: string; carb_multiplier: number; portion_multiplier: number; notes: string | null }>
  typical_portions: number
  meal_slot?: string
  available_ingredients: string[]
}

const IngredientItemSchema = z.object({
  name:            z.string(),
  qty_per_portion: z.number().positive(),
  unit:            z.enum(['g', 'ml', 'unit']),
  category:        z.string(),
})

const RecipeSchema = z.object({
  name:                   z.string(),
  description:            z.string().optional().default(''),
  meal_type:              z.enum(['breakfast', 'snack', 'lunch', 'dinner']),
  tags:                   z.array(z.string()).default([]),
  structured_ingredients: z.array(IngredientItemSchema).default([]),
})

// Palabras clave en español por tag de restricción para detección de violaciones
const RESTRICTION_KEYWORDS: Record<string, string[]> = {
  gluten:    ['trigo', 'harina', 'pan', 'avena', 'centeno', 'cebada', 'pasta', 'fideos', 'sémola', 'semola', 'galleta', 'masa'],
  lactose:   ['leche', 'queso', 'mantequilla', 'crema', 'yogur', 'nata', 'caseína', 'manteca'],
  pork:      ['cerdo', 'chancho', 'tocino', 'jamón', 'chorizo', 'morcilla', 'lardo', 'panceta', 'chicharrón', 'costilla'],
  shellfish: ['camarón', 'langostino', 'cangrejo', 'langosta', 'mejillón', 'ostra', 'mariscos', 'pulpo', 'calamar'],
  nuts:      ['nuez', 'almendra', 'cacahuete', 'maní', 'pistacho', 'avellana', 'pecana', 'anacardo'],
  egg:       ['huevo', 'yema', 'clara'],
  fish:      ['pescado', 'atún', 'salmón', 'merluza', 'trucha', 'anchoa', 'sardina', 'bacalao', 'bonito'],
  soy:       ['soya', 'soja', 'tofu', 'tempeh', 'edamame'],
  beef:      ['res', 'vaca', 'ternera', 'bistec', 'asado de res', 'carne molida'],
}

function detectViolations(
  ingredients: Array<{ name: string }>,
  excludeTags: string[],
): string[] {
  return excludeTags.filter(tag => {
    const keywords = RESTRICTION_KEYWORDS[tag.toLowerCase()] ?? [tag.toLowerCase()]
    return ingredients.some(ing =>
      keywords.some(kw => ing.name.toLowerCase().includes(kw))
    )
  })
}

function buildPrompt(ctx: FamilyContext, query: string, extraWarnings: string[] = []): string {
  const excludeList  = ctx.restrictions.filter(r => r.type === 'exclude').map(r => r.tag).join(', ')
  const avoidList    = ctx.restrictions.filter(r => r.type === 'prefer_avoid').map(r => r.tag).join(', ')
  const patternNotes = ctx.patterns.map(p =>
    `  • ${p.label}: carb×${p.carb_multiplier}, porción×${p.portion_multiplier}${p.notes ? ` (${p.notes})` : ''}`
  ).join('\n')
  const ingList      = ctx.available_ingredients.slice(0, 20).join(', ')

  const needsLowCarb  = ctx.patterns.some(p => p.carb_multiplier < 1)
  const needsScalable = ctx.patterns.some(p => p.portion_multiplier > 1)

  const warnBlock = extraWarnings.length
    ? '\n' + extraWarnings.map(w => `⚠️ CRÍTICO: ${w}`).join('\n')
    : ''

  return `Eres un asistente de cocina especializado en cocina de ${ctx.country}.
El usuario quiere: "${query}"

Contexto de la familia:
- País: ${ctx.country} | Moneda: ${ctx.currency}
- Porciones: ${ctx.typical_portions} personas
- Tipo de comida: ${ctx.meal_slot ?? 'no especificado'}
${excludeList  ? `- RESTRICCIONES ABSOLUTAS (nunca uses estos ingredientes, ni sustitutos): ${excludeList}` : ''}
${avoidList    ? `- Preferir evitar: ${avoidList}` : ''}
${patternNotes ? `- Objetivos nutricionales activos:\n${patternNotes}` : ''}
${ingList      ? `- Ingredientes disponibles (prioriza estos en la receta): ${ingList}` : ''}
${needsLowCarb  ? '- El carbohidrato debe ser servible aparte como guarnición separada.' : ''}
${needsScalable ? '- La receta debe escalar fácilmente para porciones adicionales.' : ''}${warnBlock}

Responde SOLO con JSON (sin texto adicional):
{
  "name": "nombre oficial del plato en español",
  "description": "descripción breve (1-2 oraciones)",
  "meal_type": "breakfast|snack|lunch|dinner",
  "tags": ["tag1", "tag2"],
  "structured_ingredients": [
    {"name":"pechuga de pollo","qty_per_portion":125,"unit":"g","category":"protein"},
    {"name":"aceite de oliva","qty_per_portion":10,"unit":"ml","category":"oil"}
  ]
}
Categorías válidas (usa exactamente estas): protein, vegetable, fruit, dairy, egg,
grain, legume, oil, spice, herb, seed, nut, fish, seafood, canned, beverage,
flour, citrus, meat, poultry, condiment.
Las cantidades en qty_per_portion son por porción individual (no para ${ctx.typical_portions} personas).
Las unidades permitidas son solo: g, ml, unit.`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { query, family_context } = req.body as { query: string; family_context?: FamilyContext }
  if (!query?.trim()) return res.status(400).json({ error: 'query requerido' })

  const ctx: FamilyContext = family_context ?? {
    country: 'PE', currency: 'PEN',
    restrictions: [], patterns: [], typical_portions: 4,
    available_ingredients: [],
  }

  const MAX_RETRIES = 2
  const excludeTags = ctx.restrictions.filter(r => r.type === 'exclude').map(r => r.tag)

  let violations: string[]  = []
  let finalData: z.infer<typeof RecipeSchema> | null = null
  let warnings: string[]    = []

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const extraWarnings = violations.map(v =>
        `NO incluyas NINGÚN ingrediente relacionado con "${v}" ni ningún derivado`
      )
      const promptText = buildPrompt(ctx, query, extraWarnings)

      const msg = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages:   [{ role: 'user', content: promptText }],
      })

      const raw       = (msg.content[0] as { type: string; text: string }).text.trim()
      const jsonStart = raw.indexOf('{')
      const jsonEnd   = raw.lastIndexOf('}')
      if (jsonStart === -1 || jsonEnd === -1) return res.status(500).json({ error: 'Respuesta inválida del modelo' })

      const parsed = RecipeSchema.safeParse(JSON.parse(raw.slice(jsonStart, jsonEnd + 1)))
      if (!parsed.success) return res.status(500).json({ error: 'Schema inválido', detail: parsed.error.issues })

      violations = detectViolations(parsed.data.structured_ingredients, excludeTags)
      finalData  = parsed.data

      if (violations.length === 0 || attempt === MAX_RETRIES) {
        if (violations.length > 0)
          warnings = [`Revisar ingredientes: ${violations.join(', ')}`]
        break
      }
    }

    const ingredients_text = finalData!.structured_ingredients
      .map(i => `- ${i.qty_per_portion}${i.unit} ${i.name}`)
      .join('\n')
    return res.status(200).json({ ...finalData, ingredients_text, warnings })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Error generando receta' })
  }
}
