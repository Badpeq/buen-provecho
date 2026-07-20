import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useFamilyStore } from '../store/familyStore'
import { toast } from '../components/ui/Toast'
import { limaToday, limaDateStr } from '../lib/date'
import { shareWhatsApp, normalizeCategory } from '../lib/whatsapp'
import type { DishSlot, DishAssignment, Recipe, WeeklyPlan, MealSlot, ShoppingListItem } from '../types/database'

const DOW_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const DOW_FULL  = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const SLOT_KEYS_SHOWN = ['breakfast', 'lunch', 'dinner'] as const

interface MealRow {
  mealSlot:   MealSlot
  dishSlot:   DishSlot | null
  recipe:     Recipe | null
  assignment: DishAssignment | null
  shared:     boolean   // true if this almuerzo slot covers >1 day
}

interface DayPlan {
  offset: number
  date:   Date
  meals:  MealRow[]
}

function nextTuesdayFrom(date: Date): string {
  const d = new Date(date)
  const daysUntilTue = (2 - d.getDay() + 7) % 7 || 7
  d.setDate(d.getDate() + daysUntilTue)
  return d.toISOString().slice(0, 10)
}

export default function Planificacion() {
  const { currentFamily, activePlan, setActivePlan } = useFamilyStore()
  const location = useLocation()
  const navigate  = useNavigate()
  const banner   = (location.state as { banner?: string } | null)?.banner
  const [days,        setDays]        = useState<DayPlan[]>([])
  const [loading,     setLoading]     = useState(true)
  const [creating,    setCreating]    = useState(false)
  const [picker,      setPicker]      = useState<{ dishSlot: DishSlot; mealType: string; dayLabel: string } | null>(null)
  const [pickerRecipes,      setPickerRecipes]      = useState<Recipe[]>([])
  const [pickerRecommended, setPickerRecommended]  = useState<Recipe[]>([])
  const [saving,      setSaving]      = useState(false)
  const [cost,        setCost]        = useState<number | null>(null)
  const [costLoading, setCostLoading] = useState(false)
  const [sharing,     setSharing]     = useState(false)
  const [suggesting,  setSuggesting]  = useState(false)

  useEffect(() => {
    if (!currentFamily) { setLoading(false); return }
    loadAll()
  }, [currentFamily])

  async function loadAll(planToShow?: WeeklyPlan) {
    setLoading(true)
    let plan = planToShow ?? null

    if (!plan) {
      const { data: rawPlans } = await supabase
        .from('weekly_plans').select('*')
        .eq('family_id', currentFamily!.id)
        .in('status', ['active', 'planned', 'voting', 'draft'])
        .order('week_start_date', { ascending: false }).limit(1)
      plan = ((rawPlans ?? []) as WeeklyPlan[])[0] ?? null
    }
    setActivePlan(plan)

    if (!plan) { setLoading(false); return }

    const [mealSlotsRes, dishSlotsRes, assignRes] = await Promise.all([
      supabase.from('meal_slots').select('*').eq('family_id', currentFamily!.id).order('sort_order'),
      supabase.from('dish_slots').select('*').eq('family_id', currentFamily!.id).order('sort_order'),
      supabase.from('dish_assignments').select('*, recipes(*)').eq('weekly_plan_id', plan.id).eq('is_adhoc', false),
    ])

    const mealSlots  = (mealSlotsRes.data ?? []) as MealSlot[]
    const dishSlots  = (dishSlotsRes.data ?? []) as DishSlot[]
    const assignments = (assignRes.data ?? []) as unknown as Array<DishAssignment & { recipes: Recipe }>

    // Index assignments by dish_slot_id
    const byDishSlot: Record<string, { recipe: Recipe; assignment: DishAssignment }> = {}
    assignments.forEach(a => {
      if (a.dish_slot_id) byDishSlot[a.dish_slot_id] = { recipe: a.recipes, assignment: a }
    })

    // Only show breakfast / lunch / dinner slots
    const shownMealSlots = mealSlots.filter(ms => (SLOT_KEYS_SHOWN as readonly string[]).includes(ms.slot_key))

    // Build 7 day plans (offset 0..6)
    const weekStart = new Date(plan.week_start_date + 'T12:00:00')
    const built: DayPlan[] = []

    for (let offset = 0; offset < 7; offset++) {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + offset)

      const meals: MealRow[] = shownMealSlots.map(ms => {
        const dishSlot = dishSlots.find(ds =>
          ds.meal_slot_id === ms.id && ds.day_offsets.includes(offset)
        ) ?? null
        const assigned = dishSlot ? byDishSlot[dishSlot.id] : undefined
        return {
          mealSlot:   ms,
          dishSlot,
          recipe:     assigned?.recipe     ?? null,
          assignment: assigned?.assignment ?? null,
          shared:     (dishSlot?.day_offsets.length ?? 1) > 1,
        }
      })

      built.push({ offset, date: d, meals })
    }

    setDays(built)
    setLoading(false)
    refreshCost(plan.id)
  }

  async function refreshCost(planId: string) {
    setCostLoading(true)
    const { data } = await supabase.rpc('estimate_plan_cost', { p_weekly_plan_id: planId })
    setCost(typeof data === 'number' ? data : null)
    setCostLoading(false)
  }

  async function generateAndShare() {
    if (!activePlan || sharing) return
    setSharing(true)
    await supabase.rpc('generate_shopping_list_snapshot', {
      p_weekly_plan_id: activePlan.id,
      p_deduction_mode: 'net',
    })
    await supabase.from('weekly_plans')
      .update({ status: 'planned' } as Partial<WeeklyPlan>)
      .eq('id', activePlan.id)
    setActivePlan({ ...activePlan, status: 'planned' })
    const { data: rawList } = await supabase
      .from('shopping_lists').select('id')
      .eq('weekly_plan_id', activePlan.id)
      .order('created_at', { ascending: false }).limit(1)
    const listId = ((rawList ?? []) as Array<{ id: string }>)[0]?.id
    if (listId) {
      const { data: rawItems } = await supabase
        .from('shopping_list_items')
        .select('*, ingredient:ingredients!shopping_list_items_display_ingredient_id_fkey(category)')
        .eq('shopping_list_id', listId).order('display_name')
      const waItems = ((rawItems ?? []) as unknown as Array<ShoppingListItem & { ingredient?: { category: string } | null }>)
        .map(i => ({ ...i, category: normalizeCategory(i.ingredient?.category) }))
      shareWhatsApp(waItems)
    }
    setSharing(false)
    navigate('/compras')
  }

  async function openPicker(row: MealRow, dayLabel: string) {
    if (!row.dishSlot) { toast.info('No hay slot configurado para este día'); return }
    const mealType = row.mealSlot.slot_key === 'breakfast' ? 'breakfast'
                   : row.mealSlot.slot_key === 'dinner'    ? 'dinner'
                   : 'lunch'

    const [recipesRes, restrictionsRes, historyRes] = await Promise.all([
      supabase.from('recipes').select('*')
        .eq('family_id', currentFamily!.id).eq('meal_type', mealType),
      supabase.from('food_restrictions').select('tag, restriction_type')
        .eq('family_id', currentFamily!.id),
      supabase.from('dish_assignments').select('recipe_id')
        .eq('family_id', currentFamily!.id),
    ])

    const recipes      = (recipesRes.data      ?? []) as Recipe[]
    const restrictions = (restrictionsRes.data ?? []) as Array<{ tag: string; restriction_type: string }>
    const history      = (historyRes.data      ?? []) as Array<{ recipe_id: string }>

    const excludeTags     = new Set(restrictions.filter(r => r.restriction_type === 'exclude').map(r => r.tag))
    const preferAvoidTags = new Set(restrictions.filter(r => r.restriction_type === 'prefer_avoid').map(r => r.tag))
    const freqMap: Record<string, number> = {}
    history.forEach(h => { freqMap[h.recipe_id] = (freqMap[h.recipe_id] ?? 0) + 1 })

    const suggestedTag = row.dishSlot.suggested_tag

    const eligible       = recipes.filter(r => !r.tags.some(t => excludeTags.has(t)))
    const hasPreferAvoid = (r: Recipe) => r.tags.some(t => preferAvoidTags.has(t))

    const maxFreq = Math.max(1, ...Object.values(freqMap))
    const score   = (r: Recipe) =>
      (suggestedTag && r.tags.includes(suggestedTag) ? 2 : 0) +
      (freqMap[r.id] ?? 0) / maxFreq

    const candidates = eligible.filter(r => !hasPreferAvoid(r))
    const avoided    = eligible.filter(r => hasPreferAvoid(r))

    const sorted      = [...candidates].sort((a, b) => score(b) - score(a))
    const recommended = sorted.slice(0, 4).filter(r => score(r) > 0)
    const rest        = [
      ...sorted.slice(recommended.length),
      ...avoided,
    ].sort((a, b) => a.name.localeCompare(b.name, 'es'))

    setPickerRecommended(recommended)
    setPickerRecipes(rest)
    setPicker({ dishSlot: row.dishSlot, mealType, dayLabel })
  }

  async function assignRecipe(recipe: Recipe) {
    if (!picker || !activePlan || saving) return
    setSaving(true)
    const { dishSlot } = picker

    await supabase.from('dish_assignments').delete()
      .eq('weekly_plan_id', activePlan.id).eq('dish_slot_id', dishSlot.id).eq('is_adhoc', false)

    const { error } = await supabase.from('dish_assignments').insert({
      family_id:      currentFamily!.id,
      weekly_plan_id: activePlan.id,
      dish_slot_id:   dishSlot.id,
      recipe_id:      recipe.id,
      is_adhoc:       false,
    })

    setSaving(false)
    if (error) { toast.err('Error al asignar'); setPicker(null); return }

    // Update local state for all days that share this dish_slot
    setDays(prev => prev.map(day => ({
      ...day,
      meals: day.meals.map(m =>
        m.dishSlot?.id === dishSlot.id ? { ...m, recipe, assignment: null } : m
      ),
    })))
    toast.ok(`${recipe.name} asignado ✓`)
    setPicker(null)
    if (activePlan) refreshCost(activePlan.id)
  }

  async function suggestWeek() {
    if (!activePlan || suggesting) return
    setSuggesting(true)

    // Recopilar dish_slots únicos sin asignar con su meal_type
    const seen = new Map<string, { dishSlot: DishSlot; mealType: string }>()
    days.forEach(day => {
      day.meals.forEach(row => {
        if (row.dishSlot && !row.recipe && !seen.has(row.dishSlot.id)) {
          seen.set(row.dishSlot.id, {
            dishSlot: row.dishSlot,
            mealType: row.mealSlot.slot_key === 'breakfast' ? 'breakfast'
                    : row.mealSlot.slot_key === 'dinner'    ? 'dinner'
                    : 'lunch',
          })
        }
      })
    })

    const unassigned = [...seen.values()]
    if (unassigned.length === 0) { setSuggesting(false); return }

    const [restrictionsRes, recipesRes] = await Promise.all([
      supabase.from('food_restrictions').select('tag, restriction_type').eq('family_id', currentFamily!.id),
      supabase.from('recipes').select('id, name, meal_type, tags').eq('family_id', currentFamily!.id),
    ])

    const allRecipes = (recipesRes.data ?? []) as Array<{ id: string; name: string; meal_type: string | null; tags: string[] }>
    if (allRecipes.length === 0) {
      toast.info('Crea algunas recetas primero')
      setSuggesting(false)
      return
    }

    try {
      const apiRes = await fetch('/api/week-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country:      currentFamily!.country_code,
          dish_slots:   unassigned.map(u => ({
            id:            u.dishSlot.id,
            name:          u.dishSlot.name,
            meal_type:     u.mealType,
            suggested_tag: u.dishSlot.suggested_tag,
            day_offsets:   u.dishSlot.day_offsets,
          })),
          recipes:      allRecipes,
          restrictions: (restrictionsRes.data ?? []).map(r => ({ tag: r.tag, type: r.restriction_type })),
        }),
      })

      const assignments = await apiRes.json() as Array<{ dish_slot_id: string; recipe_id: string }>
      if (!Array.isArray(assignments) || assignments.length === 0) {
        toast.info('No hay recetas suficientes para sugerir la semana')
        setSuggesting(false)
        return
      }

      await supabase.from('dish_assignments').delete()
        .eq('weekly_plan_id', activePlan.id)
        .eq('is_adhoc', false)
        .in('dish_slot_id', assignments.map(a => a.dish_slot_id))

      await supabase.from('dish_assignments').insert(
        assignments.map(a => ({
          family_id:      currentFamily!.id,
          weekly_plan_id: activePlan.id,
          dish_slot_id:   a.dish_slot_id,
          recipe_id:      a.recipe_id,
          is_adhoc:       false,
        }))
      )

      await loadAll(activePlan)
      toast.ok(`${assignments.length} platos sugeridos ✓`)
    } catch {
      toast.err('Error al sugerir la semana')
    }
    setSuggesting(false)
  }

  async function createWeeklyPlan(weekStartDate: string) {
    setCreating(true)
    const { data: existing } = await supabase.from('weekly_plans').select('id')
      .eq('family_id', currentFamily!.id).eq('week_start_date', weekStartDate).limit(1)
    if (existing && existing.length > 0) { toast.info('Ya existe un plan para esa semana'); setCreating(false); return }

    const { data: newPlanData, error: planErr } = await supabase.from('weekly_plans').insert({
      family_id:       currentFamily!.id,
      week_start_date: weekStartDate,
      status:          'planned',
      created_by:      (await supabase.auth.getUser()).data.user?.id,
    }).select().single()

    if (planErr || !newPlanData) { toast.err('Error al crear el plan'); setCreating(false); return }
    const newPlan = newPlanData as WeeklyPlan

    if (activePlan) {
      const { data: prevAssign } = await supabase.from('dish_assignments').select('*')
        .eq('weekly_plan_id', activePlan.id).eq('is_adhoc', false)
      if (prevAssign?.length) {
        await supabase.from('dish_assignments').insert(
          (prevAssign as DishAssignment[]).map(a => ({
            family_id: currentFamily!.id, weekly_plan_id: newPlan.id,
            dish_slot_id: a.dish_slot_id, recipe_id: a.recipe_id, is_adhoc: false,
          }))
        )
      }
    }

    toast.ok(`Semana del ${new Date(weekStartDate + 'T12:00:00').toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })} creada ✓`)
    setCreating(false)
    await loadAll(newPlan)
  }

  if (!currentFamily) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-500">
        <span className="text-4xl">📅</span>
        <p>Configura tu familia primero.</p>
      </div>
    )
  }

  const nextWeekStart = activePlan
    ? (() => { const d = new Date(activePlan.week_start_date + 'T12:00:00'); d.setDate(d.getDate() + 7); return limaDateStr(d) })()
    : nextTuesdayFrom(new Date())

  function RecipeOption({ recipe, saving, onPick }: { recipe: Recipe; saving: boolean; onPick: (r: Recipe) => void }) {
    return (
      <button
        disabled={saving}
        onClick={() => onPick(recipe)}
        className="w-full text-left p-3 rounded-xl border border-gray-100 bg-gray-50 hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-pale)] transition-colors disabled:opacity-50"
      >
        <p className="font-medium text-gray-800 text-sm">{recipe.name}</p>
        {recipe.description && <p className="text-xs text-gray-500 mt-0.5">{recipe.description}</p>}
      </button>
    )
  }

  const totalSlots    = new Set(days.flatMap(d => d.meals.map(m => m.dishSlot?.id).filter(Boolean))).size
  const assignedSlots = new Set(days.flatMap(d => d.meals.filter(m => m.recipe && m.dishSlot).map(m => m.dishSlot!.id))).size

  return (
    <div className="px-4 pt-4 pb-32">
      {banner && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700">
          {banner}
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-gray-800">Menú semanal</h1>
        <div className="flex items-center gap-2">
          {activePlan && (
            <span className="text-xs px-2 py-1 rounded-full bg-[var(--color-brand-pale)] text-[var(--color-brand)] font-medium capitalize">
              {activePlan.status}
            </span>
          )}
          <button
            disabled={creating}
            onClick={() => createWeeklyPlan(nextWeekStart)}
            className="text-xs px-3 py-1.5 rounded-lg bg-[var(--color-brand)] text-white font-medium hover:opacity-90 disabled:opacity-50"
          >
            {creating ? '…' : activePlan ? '+ Próx. semana' : '+ Crear plan'}
          </button>
        </div>
      </div>

      {activePlan && (
        <p className="text-sm text-gray-400 mb-4">
          Semana del {new Date(activePlan.week_start_date + 'T12:00:00')
            .toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}
        </p>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-28 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : !activePlan ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="mb-1">No hay plan activo esta semana.</p>
          <p className="text-xs">Crea uno con el botón de arriba.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {days.map(day => {
            const dow  = day.date.getDay()
            const isToday = limaDateStr(day.date) === limaToday()
            return (
              <div key={day.offset} className={`rounded-xl border bg-white shadow-sm overflow-hidden ${isToday ? 'border-[var(--color-brand)]' : 'border-gray-100'}`}>
                {/* Cabecera del día */}
                <div className={`px-4 py-2 flex items-center gap-2 ${isToday ? 'bg-[var(--color-brand-pale)]' : 'bg-gray-50'}`}>
                  <span className={`text-sm font-bold ${isToday ? 'text-[var(--color-brand)]' : 'text-gray-700'}`}>
                    {DOW_FULL[dow]}
                  </span>
                  <span className="text-xs text-gray-400">
                    {day.date.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}
                  </span>
                  {isToday && <span className="text-xs font-medium text-[var(--color-brand)] ml-auto">Hoy</span>}
                </div>

                {/* Filas de comidas */}
                <div className="divide-y divide-gray-50">
                  {day.meals.map(row => (
                    <div key={row.mealSlot.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-16 shrink-0">
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{row.mealSlot.name}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        {row.recipe ? (
                          <p className="text-sm font-medium text-gray-800 truncate">{row.recipe.name}</p>
                        ) : (
                          <p className="text-sm text-gray-300 italic">Sin asignar</p>
                        )}
                        {row.shared && row.recipe && (
                          <p className="text-xs text-gray-300">
                            {row.dishSlot!.day_offsets.map(o => {
                              const d = new Date(activePlan!.week_start_date + 'T12:00:00')
                              d.setDate(d.getDate() + o)
                              return DOW_NAMES[d.getDay()]
                            }).join('·')}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => openPicker(row, DOW_FULL[dow])}
                        className="shrink-0 text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:border-[var(--color-brand)] hover:text-[var(--color-brand)] transition-colors"
                      >
                        {row.recipe ? '↺' : '+'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Footer presupuesto ── */}
      {activePlan && (
        <div className="fixed bottom-16 left-0 right-0 px-4 pb-2 pointer-events-none">
          <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-4 py-3 flex items-center justify-between pointer-events-auto">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Presupuesto estimado</p>
              <p className="font-semibold text-gray-800 text-sm">
                {costLoading
                  ? '…'
                  : cost === 0 && assignedSlots > 0
                    ? 'sin costo estimado'
                    : cost !== null
                      ? new Intl.NumberFormat('es-PE', {
                          style: 'currency',
                          currency: currentFamily!.currency_code,
                        }).format(cost)
                      : '—'
                }
              </p>
            </div>
            {assignedSlots === totalSlots && totalSlots > 0 ? (
              <button
                disabled={sharing}
                onClick={generateAndShare}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-500 text-white text-xs font-semibold hover:bg-green-600 disabled:opacity-50 shrink-0"
              >
                {sharing ? '…' : '📲 Lista y WhatsApp'}
              </button>
            ) : (
              <div className="flex flex-col items-end gap-1 shrink-0">
                <p className="text-xs text-gray-400">{assignedSlots} de {totalSlots} slots</p>
                {totalSlots > 0 && (
                  <button
                    onClick={suggestWeek}
                    disabled={suggesting}
                    className="text-xs px-2.5 py-1 rounded-lg bg-purple-100 text-purple-700 font-medium disabled:opacity-50"
                  >
                    {suggesting ? '…' : '✨ Sugerir semana'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal picker ── */}
      {picker && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setPicker(null)}>
          <div className="w-full bg-white rounded-t-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white px-4 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">{picker.dayLabel}</p>
                <h2 className="font-semibold text-gray-800">
                  Elige el {picker.mealType === 'breakfast' ? 'desayuno' : picker.mealType === 'dinner' ? 'plato de cena' : 'plato de almuerzo'}
                </h2>
              </div>
              <button className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500" onClick={() => setPicker(null)}>✕</button>
            </div>
            <div className="p-4 space-y-2">
              {pickerRecommended.length === 0 && pickerRecipes.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">No hay recetas de este tipo aún.</p>
              ) : (
                <>
                  {pickerRecommended.length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-[var(--color-brand)] uppercase tracking-wide pb-1">
                        Recomendados
                      </p>
                      {pickerRecommended.map(recipe => (
                        <RecipeOption key={recipe.id} recipe={recipe} saving={saving} onPick={assignRecipe} />
                      ))}
                      {pickerRecipes.length > 0 && (
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-3 pb-1">
                          Todo el catálogo
                        </p>
                      )}
                    </>
                  )}
                  {pickerRecipes.map(recipe => (
                    <RecipeOption key={recipe.id} recipe={recipe} saving={saving} onPick={assignRecipe} />
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
