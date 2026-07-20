import { supabase } from './supabase'

export interface StructuredIngredient {
  name: string
  qty_per_portion: number
  unit: string
  category: string
}

function mapBaseUnit(unit: string): string {
  if (unit === 'g' || unit === 'kg') return 'g'
  if (unit === 'ml' || unit === 'l') return 'ml'
  return 'unit'
}

export async function matchIngredient(
  ing: StructuredIngredient,
  familyId: string,
  countryCode: string,
): Promise<string> {
  // 1. Buscar en ingredients por nombre exacto (case-insensitive), global o de la familia
  const { data: found } = await supabase
    .from('ingredients').select('id')
    .or(`family_id.is.null,family_id.eq.${familyId}`)
    .ilike('name', ing.name)
    .limit(1)
  if (found?.[0]) return (found[0] as { id: string }).id

  // 2. Buscar por alias local en ingredient_country_map
  const { data: alias } = await supabase
    .from('ingredient_country_map').select('ingredient_id')
    .ilike('local_name', ing.name)
    .eq('country_code', countryCode)
    .limit(1)
  if (alias?.[0]) return (alias[0] as { ingredient_id: string }).ingredient_id

  // 3. Insertar ingrediente nuevo marcado needs_price
  const { data: inserted, error } = await supabase
    .from('ingredients').insert({
      family_id:              familyId,
      name:                   ing.name,
      category:               ing.category,
      base_unit:              mapBaseUnit(ing.unit),
      min_purchase_increment: 1,
      needs_price:            true,
      tags:                   [],
    }).select('id').single()
  if (error || !inserted) throw new Error(`No se pudo insertar ingrediente: ${ing.name}`)
  return (inserted as { id: string }).id
}

export async function saveRecipeIngredients(
  structured: StructuredIngredient[],
  recipeId: string,
  familyId: string,
  countryCode: string,
): Promise<void> {
  for (const ing of structured) {
    try {
      const ingredientId = await matchIngredient(ing, familyId, countryCode)
      await supabase.from('recipe_ingredients').insert({
        recipe_id:            recipeId,
        ingredient_id:        ingredientId,
        quantity_per_portion: ing.qty_per_portion,
        unit:                 ing.unit,
        is_optional:          false,
      })
    } catch (e) {
      console.warn('ingredient match failed for', ing.name, e)
    }
  }
}
