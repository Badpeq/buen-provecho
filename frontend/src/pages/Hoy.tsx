import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFamilyStore } from '../store/familyStore'
import { toast } from '../components/ui/Toast'
import { limaToday, limaDateStr, limaDateFmt, capitalizeFirst } from '../lib/date'
import type { DishAssignment, MealSlot, Recipe, DietaryPattern } from '../types/database'

interface SlotWithDish {
  slot:       MealSlot
  recipe:     Recipe | null
  assignment: DishAssignment | null
  consumed:   boolean
  dishSlotId: string | null
}

const MEAL_TYPE_FOR_SLOT: Record<string, string> = {
  Desayuno:   'breakfast',
  'Snack AM': 'snack',
  Almuerzo:   'lunch',
  'Snack PM': 'snack',
  Cena:       'dinner',
}

export default function Hoy() {
  const { currentFamily, members } = useFamilyStore()
  const [slots,          setSlots]          = useState<SlotWithDish[]>([])
  const [planIdForToday, setPlanIdForToday] = useState<string | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [picker,         setPicker]         = useState<SlotWithDish | null>(null)
  const [pickerRecipes,  setPickerRecipes]  = useState<Recipe[]>([])
  const [saving,         setSaving]         = useState(false)
  const [memberPatterns,  setMemberPatterns]  = useState<DietaryPattern[]>([])
  const [attendingBySlot, setAttendingBySlot] = useState<Record<string, string[]>>({})

  const today = limaToday()

  useEffect(() => {
    if (!currentFamily) { setLoading(false); return }
    load()
  }, [currentFamily])

  async function load() {
    setLoading(true)

    // Phase 1: parallel fetches
    const [{ data: rawSlots }, { data: rawPlans }, { data: rawDP }] = await Promise.all([
      supabase.from('meal_slots').select('*').eq('family_id', currentFamily!.id).order('sort_order'),
      supabase.from('weekly_plans').select('id, week_start_date')
        .eq('family_id', currentFamily!.id).in('status', ['planned', 'active']),
      supabase.from('dietary_patterns').select('*')
        .eq('family_id', currentFamily!.id).eq('active', true),
    ])
    const mealSlots = rawSlots ?? []
    const plans     = rawPlans ?? []
    setMemberPatterns((rawDP ?? []) as DietaryPattern[])

    // Find plan whose week contains today
    const todayDate = new Date(today + 'T12:00:00')
    const planForToday = plans.find(p => {
      const start = new Date(p.week_start_date + 'T12:00:00')
      const end   = new Date(start)
      end.setDate(end.getDate() + 6)
      return todayDate >= start && todayDate <= end
    }) ?? plans[0] ?? null

    setPlanIdForToday(planForToday?.id ?? null)
    const planIds = plans.map(p => p.id)

    const assignBySlot: Record<string, { recipe: Recipe; assignment: DishAssignment; dishSlotId: string }> = {}

    if (planIds.length > 0) {
      const { data: rawBlock } = await supabase
        .from('dish_assignments')
        .select('*, recipes(*), dish_slots(id, meal_slot_id, day_offsets), weekly_plans(week_start_date)')
        .eq('family_id', currentFamily!.id)
        .eq('is_adhoc', false)
        .in('weekly_plan_id', planIds)
      const blockAssignments = (rawBlock ?? []) as Array<Record<string, unknown>>

      blockAssignments.forEach(a => {
        const weekStart  = new Date(((a.weekly_plans as Record<string, string>)?.week_start_date ?? '') + 'T12:00:00')
        const ds         = a.dish_slots as Record<string, unknown>
        const offsets    = (ds?.day_offsets ?? []) as number[]
        const mealSlotId = ds?.meal_slot_id as string
        const dishSlotId = ds?.id as string
        const recipe     = a.recipes as Recipe
        for (const offset of offsets) {
          const d = new Date(weekStart)
          d.setDate(d.getDate() + offset)
          if (limaDateStr(d) === today && mealSlotId) {
            assignBySlot[mealSlotId] = { recipe, assignment: a as unknown as DishAssignment, dishSlotId }
          }
        }
      })
    }

    // Adhoc overrides for today
    if (planForToday) {
      const { data: rawAdhoc } = await supabase
        .from('dish_assignments').select('*, recipes(*)')
        .eq('family_id', currentFamily!.id)
        .eq('weekly_plan_id', planForToday.id)
        .eq('is_adhoc', true).eq('adhoc_date', today)
      ;(rawAdhoc ?? []).forEach((a: Record<string, unknown>) => {
        const adhocSlotId = a.adhoc_meal_slot_id as string | null
        const recipes = a.recipes as Recipe | null
        if (adhocSlotId && recipes) {
          assignBySlot[adhocSlotId] = { recipe: recipes, assignment: a as unknown as DishAssignment, dishSlotId: '' }
        }
      })
    }

    // Load consumed state for today from DB
    const { data: rawConsumed } = await supabase
      .from('consumption_log')
      .select('meal_slot_id')
      .eq('family_id', currentFamily!.id)
      .eq('date', today)
    const consumedSlotIds = new Set((rawConsumed ?? []).map(r => r.meal_slot_id))

    const builtSlots = mealSlots.map(slot => ({
      slot,
      recipe:     assignBySlot[slot.id]?.recipe     ?? null,
      assignment: assignBySlot[slot.id]?.assignment ?? null,
      dishSlotId: assignBySlot[slot.id]?.dishSlotId ?? null,
      consumed:   consumedSlotIds.has(slot.id),
    }))

    // Phase 3: fetch attending members for slots with recipes (parallel)
    const attendingMap: Record<string, string[]> = {}
    await Promise.all(
      builtSlots
        .filter(s => s.recipe !== null)
        .map(async s => {
          const { data } = await supabase.rpc('get_attending_members', {
            p_family_id:    currentFamily!.id,
            p_meal_slot_id: s.slot.id,
            p_date:         today,
          })
          attendingMap[s.slot.id] = (data ?? []).map(
            (r: { family_member_id: string }) => r.family_member_id
          )
        })
    )
    setAttendingBySlot(attendingMap)
    setSlots(builtSlots)
    setLoading(false)
  }

  function buildPortionLabel(memberId: string, patterns: DietaryPattern[]): string {
    const pattern = patterns.find(p => p.family_member_id === memberId)
    const member  = members.find(m => m.id === memberId)
    const parts: string[] = []
    if (pattern) {
      if (pattern.carb_multiplier < 0.99)       parts.push(`${Math.round(pattern.carb_multiplier * 100)}% carb`)
      else if (pattern.carb_multiplier > 1.01)   parts.push(`×${pattern.carb_multiplier} carb`)
      if (Math.abs(pattern.portion_multiplier - 1) > 0.01) parts.push(`×${pattern.portion_multiplier} porción`)
      if (pattern.require_snacks)                parts.push('snack')
      if (pattern.notes)                         parts.push(pattern.notes)
    } else if (member && Math.abs(member.portion_factor - 1) > 0.01) {
      parts.push(`×${member.portion_factor}`)
    }
    return parts.length > 0 ? parts.join(' · ') : 'estándar'
  }

  async function openPicker(item: SlotWithDish) {
    const mealType = MEAL_TYPE_FOR_SLOT[item.slot.name] ?? 'lunch'
    const { data } = await supabase.from('recipes').select('*')
      .eq('family_id', currentFamily!.id)
      .eq('meal_type', mealType)
      .order('name')
    setPickerRecipes((data ?? []) as Recipe[])
    setPicker(item)
  }

  async function assignAdhoc(recipe: Recipe) {
    if (!picker || !currentFamily || saving) return

    if (!planIdForToday) {
      toast.err('No hay plan activo para esta semana')
      setPicker(null)
      return
    }

    setSaving(true)

    // Borrar adhoc previo del mismo slot/día
    await supabase.from('dish_assignments').delete()
      .eq('family_id', currentFamily.id)
      .eq('weekly_plan_id', planIdForToday)
      .eq('adhoc_meal_slot_id', picker.slot.id)
      .eq('adhoc_date', today)
      .eq('is_adhoc', true)

    const { error } = await supabase.from('dish_assignments').insert({
      family_id:          currentFamily.id,
      weekly_plan_id:     planIdForToday,
      recipe_id:          recipe.id,
      is_adhoc:           true,
      adhoc_meal_slot_id: picker.slot.id,
      adhoc_date:         today,
    })

    setSaving(false)
    if (error) {
      console.error('adhoc insert error:', error)
      toast.err(`Error: ${error.message}`)
      setPicker(null)
      return
    }

    setSlots(prev => prev.map(s =>
      s.slot.id === picker.slot.id ? { ...s, recipe, assignment: null, dishSlotId: null } : s
    ))
    // Fetch attending members for newly assigned slot
    const { data: attending } = await supabase.rpc('get_attending_members', {
      p_family_id:    currentFamily.id,
      p_meal_slot_id: picker.slot.id,
      p_date:         today,
    })
    setAttendingBySlot(prev => ({
      ...prev,
      [picker.slot.id]: (attending ?? []).map((r: { family_member_id: string }) => r.family_member_id),
    }))
    toast.ok(`${recipe.name} asignado ✓`)
    setPicker(null)
  }

  async function toggleConsumed(item: SlotWithDish) {
    if (!currentFamily || !item.recipe) return

    const next = !item.consumed

    // Optimistic update
    setSlots(prev => prev.map(s =>
      s.slot.id === item.slot.id ? { ...s, consumed: next } : s
    ))

    if (next) {
      const { error } = await supabase.from('consumption_log').insert({
        family_id:   currentFamily.id,
        date:        today,
        meal_slot_id: item.slot.id,
      })
      if (error) {
        // Rollback
        setSlots(prev => prev.map(s =>
          s.slot.id === item.slot.id ? { ...s, consumed: false } : s
        ))
        toast.err('Error al registrar consumo')
        return
      }
      toast.ok(`${item.recipe.name} ✓`)
    } else {
      const { error } = await supabase.from('consumption_log').delete()
        .eq('family_id', currentFamily.id)
        .eq('date', today)
        .eq('meal_slot_id', item.slot.id)
      if (error) {
        // Rollback
        setSlots(prev => prev.map(s =>
          s.slot.id === item.slot.id ? { ...s, consumed: true } : s
        ))
        toast.err('Error al desmarcar consumo')
      }
    }
  }

  if (!currentFamily) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-500">
        <span className="text-4xl">🏠</span>
        <p>Crea o únete a una familia primero.</p>
      </div>
    )
  }

  return (
    <div className="px-4 pt-4">
      <h1 className="text-lg font-semibold text-gray-800 mb-4">
        {capitalizeFirst(limaDateFmt.format(new Date()))}
      </h1>

      {!planIdForToday && !loading && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
          No hay plan activo para esta semana. Crea uno en Planificación para asignar platos.
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {slots.map((item) => (
            <div
              key={item.slot.id}
              className={`flex items-center gap-3 p-4 rounded-xl border bg-white shadow-sm transition-colors ${
                item.consumed ? 'border-green-200 bg-green-50' : 'border-gray-100'
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium uppercase tracking-wide ${
                  item.consumed ? 'text-green-500' : 'text-gray-400'
                }`}>
                  {item.slot.name}
                  {item.slot.default_time && (
                    <span className="ml-1 normal-case">· {item.slot.default_time.slice(0, 5)}</span>
                  )}
                </p>
                {item.recipe ? (
                  <>
                    <p className={`font-semibold truncate ${item.consumed ? 'text-green-700 line-through' : 'text-gray-800'}`}>
                      {item.recipe.name}
                    </p>
                    {(attendingBySlot[item.slot.id] ?? []).length > 0 && (
                      <p className="mt-0.5 text-xs text-gray-400 leading-relaxed">
                        {(attendingBySlot[item.slot.id] ?? [])
                          .map(id => {
                            const m = members.find(m => m.id === id)
                            return m ? `${m.display_name}: ${buildPortionLabel(id, memberPatterns)}` : null
                          })
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-gray-400 italic text-sm">Sin plato asignado</p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openPicker(item)}
                  disabled={!planIdForToday}
                  className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-[var(--color-brand-pale)] hover:text-[var(--color-brand)] transition-colors disabled:opacity-30"
                  title={planIdForToday ? 'Cambiar plato' : 'No hay plan activo'}
                >
                  {item.recipe ? '↺' : '+'}
                </button>

                {item.recipe && (
                  <button
                    onClick={() => toggleConsumed(item)}
                    className={`w-9 h-9 rounded-full border-2 flex items-center justify-center transition-colors ${
                      item.consumed
                        ? 'border-green-500 bg-green-500 text-white'
                        : 'border-[var(--color-brand)] text-[var(--color-brand)] hover:bg-[var(--color-brand-pale)]'
                    }`}
                  >
                    ✓
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal picker adhoc ── */}
      {picker && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setPicker(null)}>
          <div className="w-full bg-white rounded-t-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white px-4 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">{picker.slot.name}</p>
                <h2 className="font-semibold text-gray-800">Elige el plato</h2>
              </div>
              <button className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500" onClick={() => setPicker(null)}>✕</button>
            </div>
            <div className="p-4 space-y-2">
              {pickerRecipes.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">No hay recetas de este tipo. Crea una en la sección Recetas.</p>
              ) : pickerRecipes.map(recipe => (
                <button
                  key={recipe.id}
                  disabled={saving}
                  onClick={() => assignAdhoc(recipe)}
                  className="w-full text-left p-3 rounded-xl border border-gray-100 bg-gray-50 hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-pale)] transition-colors disabled:opacity-50"
                >
                  <p className="font-medium text-gray-800 text-sm">{recipe.name}</p>
                  {recipe.description && <p className="text-xs text-gray-500 mt-0.5">{recipe.description}</p>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
