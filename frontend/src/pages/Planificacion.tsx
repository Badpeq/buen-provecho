import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFamilyStore } from '../store/familyStore'
import { toast } from '../components/ui/Toast'
import type { DishSlot, DishAssignment, Recipe, WeeklyPlan } from '../types/database'

interface SlotRow {
  slot:       DishSlot
  assignment: (DishAssignment & { recipe: Recipe }) | null
}

const DOW_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function nextTuesdayFrom(date: Date): string {
  const d = new Date(date)
  const dow = d.getDay() // 0=Dom, 2=Mar
  const daysUntilTue = (2 - dow + 7) % 7 || 7
  d.setDate(d.getDate() + daysUntilTue)
  return d.toISOString().slice(0, 10)
}

export default function Planificacion() {
  const { currentFamily, activePlan, setActivePlan } = useFamilyStore()
  const [rows,      setRows]      = useState<SlotRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [creating,  setCreating]  = useState(false)
  const [recipes,   setRecipes]   = useState<Recipe[]>([])
  const [picker,    setPicker]    = useState<DishSlot | null>(null)
  const [saving,    setSaving]    = useState(false)

  useEffect(() => {
    if (!currentFamily) { setLoading(false); return }
    loadPlanAndSlots()
    loadRecipes()
  }, [currentFamily])

  async function loadRecipes() {
    const { data } = await supabase
      .from('recipes').select('*')
      .eq('family_id', currentFamily!.id)
      .eq('meal_type', 'lunch')
      .order('name')
    setRecipes((data ?? []) as Recipe[])
  }

  async function loadPlanAndSlots(planToShow?: WeeklyPlan) {
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

    const { data: rawSlots } = await supabase
      .from('dish_slots').select('*')
      .eq('family_id', currentFamily!.id)
      .eq('meal_slot_id', '00000001-0000-0000-0000-000000000022') // Almuerzo
      .order('sort_order')
    const dishSlots = (rawSlots ?? []) as DishSlot[]

    const { data: rawAssign } = await supabase
      .from('dish_assignments').select('*, recipes(*)')
      .eq('weekly_plan_id', plan.id).eq('is_adhoc', false)
    const assignments = (rawAssign ?? []) as Array<DishAssignment & { recipes: Recipe }>

    const bySlot: Record<string, DishAssignment & { recipe: Recipe }> = {}
    assignments.forEach(a => {
      if (a.dish_slot_id) bySlot[a.dish_slot_id] = { ...a, recipe: a.recipes }
    })

    setRows(dishSlots.map(slot => ({
      slot,
      assignment: bySlot[slot.id] ?? null,
    })))
    setLoading(false)
  }

  async function createWeeklyPlan(weekStartDate: string) {
    setCreating(true)

    // Comprobar si ya existe un plan para esa semana
    const { data: existing } = await supabase
      .from('weekly_plans').select('id')
      .eq('family_id', currentFamily!.id)
      .eq('week_start_date', weekStartDate)
      .limit(1)

    if (existing && existing.length > 0) {
      toast.info('Ya existe un plan para esa semana')
      setCreating(false)
      return
    }

    const { data: newPlanData, error: planErr } = await supabase
      .from('weekly_plans').insert({
        family_id:       currentFamily!.id,
        week_start_date: weekStartDate,
        status:          'planned',
        created_by:      (await supabase.auth.getUser()).data.user?.id,
      }).select().single()

    if (planErr || !newPlanData) {
      toast.err('Error al crear el plan')
      setCreating(false)
      return
    }

    const newPlan = newPlanData as WeeklyPlan

    // Copiar asignaciones del plan anterior al nuevo (si existe activePlan)
    if (activePlan) {
      const { data: prevAssign } = await supabase
        .from('dish_assignments').select('*')
        .eq('weekly_plan_id', activePlan.id)
        .eq('is_adhoc', false)

      if (prevAssign && prevAssign.length > 0) {
        const copies = (prevAssign as DishAssignment[]).map(a => ({
          family_id:      currentFamily!.id,
          weekly_plan_id: newPlan.id,
          dish_slot_id:   a.dish_slot_id,
          recipe_id:      a.recipe_id,
          is_adhoc:       false,
        }))
        await supabase.from('dish_assignments').insert(copies)
      }
    }

    toast.ok(`Semana del ${new Date(weekStartDate + 'T12:00:00').toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })} creada ✓`)
    setCreating(false)
    await loadPlanAndSlots(newPlan)
  }

  async function assignRecipe(slot: DishSlot, recipe: Recipe) {
    if (!activePlan || saving) return
    setSaving(true)

    await supabase.from('dish_assignments')
      .delete()
      .eq('weekly_plan_id', activePlan.id)
      .eq('dish_slot_id', slot.id)
      .eq('is_adhoc', false)

    const { error } = await supabase.from('dish_assignments').insert({
      family_id:      currentFamily!.id,
      weekly_plan_id: activePlan.id,
      dish_slot_id:   slot.id,
      recipe_id:      recipe.id,
      is_adhoc:       false,
    })

    setSaving(false)
    setPicker(null)

    if (error) {
      toast.err('Error al asignar plato')
    } else {
      setRows(prev => prev.map(r =>
        r.slot.id === slot.id
          ? { ...r, assignment: { recipe, dish_slot_id: slot.id, recipe_id: recipe.id } as any }
          : r
      ))
      toast.ok(`${recipe.name} asignado ✓`)
    }
  }

  function slotLabel(slot: DishSlot, weekStart: string): string {
    return slot.day_offsets.map(offset => {
      const d = new Date(weekStart + 'T12:00:00')
      d.setDate(d.getDate() + offset)
      return DOW_NAMES[d.getDay()]
    }).join(' · ')
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
    <div className="px-4 pt-4">
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
            className="text-xs px-3 py-1.5 rounded-lg bg-[var(--color-brand)] text-white font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
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
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : !activePlan ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="mb-1">No hay plan activo esta semana.</p>
          <p className="text-xs">Crea uno con el botón de arriba.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(({ slot, assignment }) => (
            <div
              key={slot.id}
              className="p-4 rounded-xl border border-gray-100 bg-white shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                    {slotLabel(slot, activePlan.week_start_date)}
                  </p>
                  {assignment ? (
                    <p className="font-semibold text-gray-800">{assignment.recipe.name}</p>
                  ) : (
                    <p className="text-gray-400 italic text-sm">Sin asignar</p>
                  )}
                </div>
                <button
                  className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-[var(--color-brand)] text-[var(--color-brand)] hover:bg-[var(--color-brand-pale)] transition-colors"
                  onClick={() => setPicker(slot)}
                >
                  {assignment ? 'Cambiar' : 'Asignar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal picker de recetas ── */}
      {picker && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => setPicker(null)}
        >
          <div
            className="w-full bg-white rounded-t-2xl max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white px-4 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">
                  {activePlan && slotLabel(picker, activePlan.week_start_date)}
                </p>
                <h2 className="font-semibold text-gray-800">Elige el plato de almuerzo</h2>
              </div>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500"
                onClick={() => setPicker(null)}
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-2">
              {recipes.length === 0 ? (
                <p className="text-center text-gray-400 py-8">Cargando catálogo…</p>
              ) : (
                recipes.map(recipe => (
                  <button
                    key={recipe.id}
                    disabled={saving}
                    onClick={() => assignRecipe(picker, recipe)}
                    className="w-full text-left p-3 rounded-xl border border-gray-100 bg-gray-50 hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-pale)] transition-colors disabled:opacity-50"
                  >
                    <p className="font-medium text-gray-800 text-sm">{recipe.name}</p>
                    {recipe.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{recipe.description}</p>
                    )}
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
