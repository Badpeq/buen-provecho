import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFamilyStore } from '../store/familyStore'
import { toast } from '../components/ui/Toast'
import type { DishAssignment, MealSlot, Recipe } from '../types/database'

interface SlotWithDish {
  slot:       MealSlot
  recipe:     Recipe | null
  assignment: DishAssignment | null
  consumed:   boolean
  dishSlotId: string | null
}

const HOY_LABEL = new Intl.DateTimeFormat('es-PE', {
  weekday: 'long', day: 'numeric', month: 'long',
})

const MEAL_TYPE_FOR_SLOT: Record<string, string> = {
  Desayuno:  'breakfast',
  'Snack AM': 'snack',
  Almuerzo:  'lunch',
  'Snack PM': 'snack',
  Cena:      'dinner',
}

export default function Hoy() {
  const { currentFamily } = useFamilyStore()
  const [slots,     setSlots]     = useState<SlotWithDish[]>([])
  const [loading,   setLoading]   = useState(true)
  const [picker,    setPicker]    = useState<SlotWithDish | null>(null)
  const [pickerRecipes, setPickerRecipes] = useState<Recipe[]>([])
  const [saving,    setSaving]    = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    if (!currentFamily) { setLoading(false); return }
    load()
  }, [currentFamily])

  async function load() {
    setLoading(true)

    const { data: rawSlots } = await supabase
      .from('meal_slots').select('*')
      .eq('family_id', currentFamily!.id).order('sort_order')
    const mealSlots = (rawSlots ?? []) as MealSlot[]

    const { data: rawPlans } = await supabase
      .from('weekly_plans').select('id, week_start_date')
      .eq('family_id', currentFamily!.id)
      .in('status', ['planned', 'active'])
    const plans = (rawPlans ?? []) as { id: string; week_start_date: string }[]
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
        const weekStart  = new Date(((a.weekly_plans as Record<string,string>)?.week_start_date ?? '') + 'T12:00:00')
        const ds         = a.dish_slots as Record<string, unknown>
        const offsets    = (ds?.day_offsets ?? []) as number[]
        const mealSlotId = ds?.meal_slot_id as string
        const dishSlotId = ds?.id as string
        const recipe     = a.recipes as Recipe
        for (const offset of offsets) {
          const d = new Date(weekStart)
          d.setDate(d.getDate() + offset)
          if (d.toISOString().slice(0, 10) === today && mealSlotId) {
            assignBySlot[mealSlotId] = { recipe, assignment: a as unknown as DishAssignment, dishSlotId }
          }
        }
      })
    }

    const { data: rawAdhoc } = await supabase
      .from('dish_assignments').select('*, recipes(*)')
      .eq('family_id', currentFamily!.id)
      .eq('is_adhoc', true).eq('adhoc_date', today)
    ;(rawAdhoc ?? []).forEach((a: any) => {
      if (a.adhoc_meal_slot_id && a.recipes) {
        assignBySlot[a.adhoc_meal_slot_id] = { recipe: a.recipes, assignment: a, dishSlotId: null }
      }
    })

    setSlots(mealSlots.map(slot => ({
      slot,
      recipe:     assignBySlot[slot.id]?.recipe     ?? null,
      assignment: assignBySlot[slot.id]?.assignment ?? null,
      dishSlotId: assignBySlot[slot.id]?.dishSlotId ?? null,
      consumed:   false,
    })))
    setLoading(false)
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
    setSaving(true)

    // Borrar adhoc previo del mismo slot/día
    await supabase.from('dish_assignments').delete()
      .eq('family_id', currentFamily.id)
      .eq('adhoc_meal_slot_id', picker.slot.id)
      .eq('adhoc_date', today)
      .eq('is_adhoc', true)

    const { error } = await supabase.from('dish_assignments').insert({
      family_id:          currentFamily.id,
      recipe_id:          recipe.id,
      is_adhoc:           true,
      adhoc_meal_slot_id: picker.slot.id,
      adhoc_date:         today,
    })

    setSaving(false)
    if (error) { toast.err('Error al asignar'); setPicker(null); return }

    setSlots(prev => prev.map(s =>
      s.slot.id === picker.slot.id ? { ...s, recipe, assignment: null, dishSlotId: null } : s
    ))
    toast.ok(`${recipe.name} asignado ✓`)
    setPicker(null)
  }

  function markConsumed(slotWithDish: SlotWithDish) {
    const { slot, recipe, consumed } = slotWithDish
    setSlots(prev => prev.map(s =>
      s.slot.id === slot.id ? { ...s, consumed: !consumed } : s
    ))
    if (!consumed) toast.ok(`${recipe?.name ?? slot.name} ✓`)
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
      <h1 className="text-lg font-semibold text-gray-800 capitalize mb-4">
        {HOY_LABEL.format(new Date())}
      </h1>

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
                  <p className={`font-semibold truncate ${item.consumed ? 'text-green-700 line-through' : 'text-gray-800'}`}>
                    {item.recipe.name}
                  </p>
                ) : (
                  <p className="text-gray-400 italic text-sm">Sin plato asignado</p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Botón cambiar/asignar receta */}
                <button
                  onClick={() => openPicker(item)}
                  className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-500 hover:bg-[var(--color-brand-pale)] hover:text-[var(--color-brand)] transition-colors"
                  title="Cambiar plato"
                >
                  {item.recipe ? '↺' : '+'}
                </button>

                {/* Botón consumir */}
                {item.recipe && (
                  <button
                    onClick={() => markConsumed(item)}
                    className={`w-9 h-9 rounded-full border-2 flex items-center justify-center transition-colors ${
                      item.consumed
                        ? 'border-green-500 bg-green-500 text-white'
                        : 'border-[var(--color-brand)] text-[var(--color-brand)] hover:bg-[var(--color-brand-pale)]'
                    }`}
                    title={item.consumed ? 'Desmarcar' : 'Marcar como consumido'}
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
                <p className="text-xs text-gray-400 uppercase tracking-wide">{picker.slot.name}</p>
                <h2 className="font-semibold text-gray-800">Elige el plato</h2>
              </div>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500"
                onClick={() => setPicker(null)}
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-2">
              {pickerRecipes.map(recipe => (
                <button
                  key={recipe.id}
                  disabled={saving}
                  onClick={() => assignAdhoc(recipe)}
                  className="w-full text-left p-3 rounded-xl border border-gray-100 bg-gray-50 hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-pale)] transition-colors disabled:opacity-50"
                >
                  <p className="font-medium text-gray-800 text-sm">{recipe.name}</p>
                  {recipe.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{recipe.description}</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
