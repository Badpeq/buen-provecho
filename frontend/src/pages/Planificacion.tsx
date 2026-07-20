import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFamilyStore } from '../store/familyStore'
import { toast } from '../components/ui/Toast'
import type { DishSlot, DishAssignment, Recipe, WeeklyPlan, MealSlot } from '../types/database'

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
  const [days,      setDays]      = useState<DayPlan[]>([])
  const [loading,   setLoading]   = useState(true)
  const [creating,  setCreating]  = useState(false)
  const [picker,    setPicker]    = useState<{ dishSlot: DishSlot; mealType: string; dayLabel: string } | null>(null)
  const [pickerRecipes, setPickerRecipes] = useState<Recipe[]>([])
  const [saving,    setSaving]    = useState(false)

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
    const assignments = (assignRes.data ?? []) as Array<DishAssignment & { recipes: Recipe }>

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
  }

  async function openPicker(row: MealRow, dayLabel: string) {
    if (!row.dishSlot) { toast.info('No hay slot configurado para este día'); return }
    const mealType = row.mealSlot.slot_key === 'breakfast' ? 'breakfast'
                   : row.mealSlot.slot_key === 'dinner'    ? 'dinner'
                   : 'lunch'
    const { data } = await supabase.from('recipes').select('*')
      .eq('family_id', currentFamily!.id).eq('meal_type', mealType).order('name')
    setPickerRecipes((data ?? []) as Recipe[])
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
    ? (() => { const d = new Date(activePlan.week_start_date + 'T12:00:00'); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10) })()
    : nextTuesdayFrom(new Date())

  return (
    <div className="px-4 pt-4 pb-6">
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
            const isToday = day.date.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
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
              {pickerRecipes.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">No hay recetas de este tipo aún.</p>
              ) : (
                pickerRecipes.map(recipe => (
                  <button
                    key={recipe.id}
                    disabled={saving}
                    onClick={() => assignRecipe(recipe)}
                    className="w-full text-left p-3 rounded-xl border border-gray-100 bg-gray-50 hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-pale)] transition-colors disabled:opacity-50"
                  >
                    <p className="font-medium text-gray-800 text-sm">{recipe.name}</p>
                    {recipe.description && <p className="text-xs text-gray-500 mt-0.5">{recipe.description}</p>}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
