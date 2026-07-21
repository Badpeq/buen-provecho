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
const MEAL_EMOJI: Record<string, string> = {
  breakfast: '☕', snack_am: '🥑', lunch: '🍽', snack_pm: '🥑', dinner: '🌙',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Agrupa números en runs consecutivos: [0,2,3] → [[0],[2,3]] */
function groupConsecutive(offsets: number[]): number[][] {
  if (!offsets.length) return []
  const sorted = [...offsets].sort((a, b) => a - b)
  const groups: number[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) groups[groups.length - 1].push(sorted[i])
    else groups.push([sorted[i]])
  }
  return groups
}

// ── Interfaces ────────────────────────────────────────────────────────────────

interface BlockCard {
  mealSlot:    MealSlot
  recipe:      Recipe | null
  dayLabel:    string        // "Mar · Mié"
  dayOffsets:  number[]      // offsets reales que cubre este bloque
  startOffset: number        // primer offset (para orden y cálculo de días)
  dishSlot:    DishSlot | null  // referencia al preset (puede ser null para bloques dinámicos)
  assignment:  DishAssignment | null
}

interface MealRow {
  mealSlot:   MealSlot
  dishSlot:   DishSlot | null
  recipe:     Recipe | null
  assignment: DishAssignment | null
  shared:     boolean
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

// ── Componente ────────────────────────────────────────────────────────────────

export default function Planificacion() {
  const { currentFamily, activePlan, setActivePlan } = useFamilyStore()
  const location = useLocation()
  const navigate  = useNavigate()
  const banner   = (location.state as { banner?: string } | null)?.banner

  const [blocks,     setBlocks]     = useState<BlockCard[]>([])
  const [days,       setDays]       = useState<DayPlan[]>([])
  const [showGrid,   setShowGrid]   = useState(false)

  const [loading,     setLoading]     = useState(true)
  const [creating,    setCreating]    = useState(false)

  // Picker paso 1: lista de recetas
  const [picker, setPicker] = useState<{
    block: BlockCard; mealType: string; useF2: boolean
  } | null>(null)
  const [pickerRecipes,     setPickerRecipes]     = useState<Recipe[]>([])
  const [pickerRecommended, setPickerRecommended] = useState<Recipe[]>([])

  // Picker paso 2: selector de días (F2)
  const [dayStep, setDayStep] = useState<{
    recipe: Recipe; block: BlockCard; selectedDays: number; maxDays: number
  } | null>(null)

  const [saving,      setSaving]      = useState(false)
  const [cost,        setCost]        = useState<number | null>(null)
  const [costLoading, setCostLoading] = useState(false)
  const [sharing,     setSharing]     = useState(false)
  const [suggesting,  setSuggesting]  = useState(false)

  useEffect(() => {
    if (!currentFamily) { setLoading(false); return }
    loadAll()
  }, [currentFamily])

  async function loadAll(planToShow?: WeeklyPlan, silent = false) {
    if (!silent) setLoading(true)
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

    if (!plan) { if (!silent) setLoading(false); return }

    const [mealSlotsRes, dishSlotsRes, assignRes] = await Promise.all([
      supabase.from('meal_slots').select('*').eq('family_id', currentFamily!.id).order('sort_order'),
      supabase.from('dish_slots').select('*').eq('family_id', currentFamily!.id).order('sort_order'),
      supabase.from('dish_assignments').select('*, recipes(*)').eq('weekly_plan_id', plan.id).eq('is_adhoc', false),
    ])

    const mealSlots   = (mealSlotsRes.data ?? []) as MealSlot[]
    const dishSlots   = (dishSlotsRes.data ?? []) as DishSlot[]
    const assignments = (assignRes.data ?? []) as unknown as Array<DishAssignment & { recipes: Recipe }>

    const weekStart = new Date(plan.week_start_date + 'T12:00:00')

    // ── Nivel 1: bloques dinámicos ─────────────────────────────────────────

    // Pasada 1: asignaciones existentes → una tarjeta por assignment
    const coveredBySlot: Record<string, Set<number>> = {}
    mealSlots.forEach(ms => { coveredBySlot[ms.id] = new Set() })

    const builtBlocks: BlockCard[] = []

    for (const a of assignments) {
      if (!a.meal_slot_id || !a.day_offsets) continue
      const ms = mealSlots.find(m => m.id === a.meal_slot_id)
      if (!ms) continue
      a.day_offsets.forEach(o => coveredBySlot[ms.id].add(o))
      const dayLabel = a.day_offsets.map(o => {
        const d = new Date(weekStart); d.setDate(d.getDate() + o)
        return DOW_NAMES[d.getDay()]
      }).join(' · ')
      builtBlocks.push({
        mealSlot: ms,
        recipe:   a.recipes,
        dayLabel,
        dayOffsets:  a.day_offsets,
        startOffset: a.day_offsets[0] ?? 0,
        dishSlot:    dishSlots.find(d => d.id === a.dish_slot_id) ?? null,
        assignment:  a as unknown as DishAssignment,
      })
    }

    // Pasada 2: días libres dentro de presets → agrupados en runs consecutivos
    for (const ds of dishSlots) {
      const ms = mealSlots.find(m => m.id === ds.meal_slot_id)
      if (!ms) continue
      const covered    = coveredBySlot[ms.id] ?? new Set()
      const freeOffset = ds.day_offsets.filter(o => !covered.has(o))
      for (const group of groupConsecutive(freeOffset)) {
        const dayLabel = group.map(o => {
          const d = new Date(weekStart); d.setDate(d.getDate() + o)
          return DOW_NAMES[d.getDay()]
        }).join(' · ')
        builtBlocks.push({
          mealSlot: ms,
          recipe:      null,
          dayLabel,
          dayOffsets:  group,
          startOffset: group[0],
          dishSlot:    ds,
          assignment:  null,
        })
      }
    }

    // Ordenar por meal_slot.sort_order, luego por startOffset
    builtBlocks.sort((a, b) => {
      const ia = mealSlots.indexOf(a.mealSlot)
      const ib = mealSlots.indexOf(b.mealSlot)
      return ia !== ib ? ia - ib : a.startOffset - b.startOffset
    })
    setBlocks(builtBlocks)

    // ── Nivel 2: grilla de 7 días ─────────────────────────────────────────
    const byDishSlot: Record<string, { recipe: Recipe; assignment: DishAssignment }> = {}
    assignments.forEach(a => {
      if (a.dish_slot_id) byDishSlot[a.dish_slot_id] = { recipe: a.recipes, assignment: a as unknown as DishAssignment }
    })

    const shownMealSlots = mealSlots.filter(ms => (SLOT_KEYS_SHOWN as readonly string[]).includes(ms.slot_key))
    const builtDays: DayPlan[] = []
    for (let offset = 0; offset < 7; offset++) {
      const d = new Date(weekStart); d.setDate(d.getDate() + offset)
      const meals: MealRow[] = shownMealSlots.map(ms => {
        const dishSlot = dishSlots.find(ds =>
          ds.meal_slot_id === ms.id && ds.day_offsets.includes(offset)
        ) ?? null
        const assigned = dishSlot ? byDishSlot[dishSlot.id] : undefined
        return {
          mealSlot: ms, dishSlot,
          recipe:     assigned?.recipe     ?? null,
          assignment: assigned?.assignment ?? null,
          shared:     (dishSlot?.day_offsets.length ?? 1) > 1,
        }
      })
      builtDays.push({ offset, date: d, meals })
    }
    setDays(builtDays)
    if (!silent) setLoading(false)
    refreshCost(plan.id)
  }

  async function refreshCost(planId: string) {
    setCostLoading(true)
    const { data } = await supabase.rpc('estimate_plan_cost', { p_weekly_plan_id: planId })
    setCost(typeof data === 'number' ? data : null)
    setCostLoading(false)
  }

  // ── F2: días libres consecutivos desde block.startOffset ──────────────────

  function computeFreeDays(block: BlockCard): number {
    const covered = new Set<number>()
    for (const b of blocks) {
      if (
        b.mealSlot.id === block.mealSlot.id &&
        b.assignment !== null &&
        b.assignment.id !== (block.assignment?.id ?? '')
      ) {
        b.dayOffsets.forEach(o => covered.add(o))
      }
    }
    let count = 0
    for (let o = block.startOffset; o < 7; o++) {
      if (covered.has(o)) break
      count++
    }
    return count
  }

  // ── Assign core ───────────────────────────────────────────────────────────

  async function assignWithOffsets(block: BlockCard, recipe: Recipe, dayOffsets: number[]) {
    if (!activePlan) return
    setSaving(true)

    // Borrar asignación actual del bloque (por ID)
    if (block.assignment) {
      await supabase.from('dish_assignments').delete().eq('id', block.assignment.id)
    }

    // Borrar asignaciones que solapen con los nuevos offsets (mismo meal_slot)
    const conflictIds = blocks
      .filter(b =>
        b.mealSlot.id === block.mealSlot.id &&
        b.assignment !== null &&
        b.assignment.id !== (block.assignment?.id ?? '') &&
        b.dayOffsets.some(o => dayOffsets.includes(o))
      )
      .map(b => b.assignment!.id)

    if (conflictIds.length > 0) {
      await supabase.from('dish_assignments').delete().in('id', conflictIds)
    }

    const { error } = await supabase.from('dish_assignments').insert({
      family_id:      currentFamily!.id,
      weekly_plan_id: activePlan.id,
      dish_slot_id:   block.dishSlot?.id ?? null,
      meal_slot_id:   block.mealSlot.id,
      day_offsets:    dayOffsets,
      recipe_id:      recipe.id,
      is_adhoc:       false,
    })

    setSaving(false)
    setDayStep(null)
    setPicker(null)
    if (error) { toast.err('Error al asignar'); return }
    toast.ok(`${recipe.name} asignado ✓`)
    await loadAll(activePlan, true)
  }

  // ── Picker helpers ────────────────────────────────────────────────────────

  async function _loadPickerOptions(mealType: string, suggestedTag: string | null) {
    const [recipesRes, restrictionsRes, historyRes] = await Promise.all([
      supabase.from('recipes').select('*').eq('family_id', currentFamily!.id).eq('meal_type', mealType),
      supabase.from('food_restrictions').select('tag, restriction_type').eq('family_id', currentFamily!.id),
      supabase.from('dish_assignments').select('recipe_id').eq('family_id', currentFamily!.id),
    ])
    const recipes      = (recipesRes.data      ?? []) as Recipe[]
    const restrictions = (restrictionsRes.data ?? []) as Array<{ tag: string; restriction_type: string }>
    const history      = (historyRes.data      ?? []) as Array<{ recipe_id: string }>

    const excludeTags     = new Set(restrictions.filter(r => r.restriction_type === 'exclude').map(r => r.tag))
    const preferAvoidTags = new Set(restrictions.filter(r => r.restriction_type === 'prefer_avoid').map(r => r.tag))
    const freqMap: Record<string, number> = {}
    history.forEach(h => { freqMap[h.recipe_id] = (freqMap[h.recipe_id] ?? 0) + 1 })

    const eligible       = recipes.filter(r => !r.tags.some(t => excludeTags.has(t)))
    const hasPreferAvoid = (r: Recipe) => r.tags.some(t => preferAvoidTags.has(t))
    const maxFreq        = Math.max(1, ...Object.values(freqMap))
    const score          = (r: Recipe) =>
      (suggestedTag && r.tags.includes(suggestedTag) ? 2 : 0) +
      (freqMap[r.id] ?? 0) / maxFreq

    const candidates  = eligible.filter(r => !hasPreferAvoid(r))
    const avoided     = eligible.filter(r => hasPreferAvoid(r))
    const sorted      = [...candidates].sort((a, b) => score(b) - score(a))
    const recommended = sorted.slice(0, 4).filter(r => score(r) > 0)
    const rest        = [...sorted.slice(recommended.length), ...avoided]
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))

    setPickerRecommended(recommended)
    setPickerRecipes(rest)
  }

  /** Abre el picker con F2 (Nivel 1) */
  async function openPickerBlock(block: BlockCard) {
    const mealType = block.mealSlot.slot_key === 'breakfast' ? 'breakfast'
                   : block.mealSlot.slot_key === 'dinner'    ? 'dinner'
                   : 'lunch'
    await _loadPickerOptions(mealType, block.dishSlot?.suggested_tag ?? null)
    setPicker({ block, mealType, useF2: true })
  }

  /** Abre el picker directo (Nivel 2 — sin selector de días) */
  async function openPicker(row: MealRow, dayLabel: string) {
    if (!row.dishSlot) { toast.info('No hay slot configurado para este día'); return }
    const mealType = row.mealSlot.slot_key === 'breakfast' ? 'breakfast'
                   : row.mealSlot.slot_key === 'dinner'    ? 'dinner'
                   : 'lunch'
    await _loadPickerOptions(mealType, row.dishSlot.suggested_tag)
    const syntheticBlock: BlockCard = {
      mealSlot:    row.mealSlot,
      recipe:      row.recipe,
      dayLabel,
      dayOffsets:  row.dishSlot.day_offsets,
      startOffset: row.dishSlot.day_offsets[0] ?? 0,
      dishSlot:    row.dishSlot,
      assignment:  row.assignment,
    }
    setPicker({ block: syntheticBlock, mealType, useF2: false })
  }

  async function handleRecipePick(recipe: Recipe) {
    if (!picker || saving) return
    const { block, useF2 } = picker

    if (!useF2) {
      // Nivel 2: asignar directo con los offsets del bloque preset
      setPicker(null)
      await assignWithOffsets(block, recipe, block.dayOffsets)
      return
    }

    // Nivel 1 — F2: calcular días disponibles
    const freeDays = computeFreeDays(block)
    const maxDays  = recipe.batch_friendly
      ? Math.min(recipe.max_batch_days, freeDays)
      : 1

    if (maxDays <= 1) {
      // Un solo día disponible o receta no batch-friendly → asignar directo
      setPicker(null)
      await assignWithOffsets(block, recipe, [block.startOffset])
      return
    }

    // Mostrar selector de días
    setPicker(null)
    setDayStep({ recipe, block, selectedDays: maxDays, maxDays })
  }

  // ── Other actions ─────────────────────────────────────────────────────────

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

  async function suggestWeek() {
    if (!activePlan || suggesting) return
    setSuggesting(true)

    // Primer bloque libre de cada dish_slot (preset)
    const seen = new Map<string, { block: BlockCard; mealType: string }>()
    blocks.forEach(block => {
      if (!block.recipe && block.dishSlot && !seen.has(block.dishSlot.id)) {
        const mealType = block.mealSlot.slot_key === 'breakfast' ? 'breakfast'
                       : block.mealSlot.slot_key === 'dinner'    ? 'dinner'
                       : 'lunch'
        seen.set(block.dishSlot.id, { block, mealType })
      }
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
            id:            u.block.dishSlot!.id,
            name:          u.block.dishSlot!.name,
            meal_type:     u.mealType,
            suggested_tag: u.block.dishSlot!.suggested_tag,
            day_offsets:   u.block.dayOffsets,
          })),
          recipes:      allRecipes,
          restrictions: (restrictionsRes.data ?? []).map(r => ({ tag: r.tag, type: r.restriction_type })),
        }),
      })

      const aiAssignments = await apiRes.json() as Array<{ dish_slot_id: string; recipe_id: string }>
      if (!Array.isArray(aiAssignments) || aiAssignments.length === 0) {
        toast.info('No hay recetas suficientes para sugerir la semana')
        setSuggesting(false)
        return
      }

      await supabase.from('dish_assignments').delete()
        .eq('weekly_plan_id', activePlan.id)
        .eq('is_adhoc', false)
        .in('dish_slot_id', aiAssignments.map(a => a.dish_slot_id))

      await supabase.from('dish_assignments').insert(
        aiAssignments.map(a => {
          const entry = seen.get(a.dish_slot_id)
          return {
            family_id:      currentFamily!.id,
            weekly_plan_id: activePlan!.id,
            dish_slot_id:   a.dish_slot_id,
            meal_slot_id:   entry?.block.mealSlot.id ?? null,
            day_offsets:    entry?.block.dayOffsets   ?? null,
            recipe_id:      a.recipe_id,
            is_adhoc:       false,
          }
        })
      )

      await loadAll(activePlan, true)
      toast.ok(`${aiAssignments.length} platos sugeridos ✓`)
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
            family_id:      currentFamily!.id,
            weekly_plan_id: newPlan.id,
            dish_slot_id:   a.dish_slot_id,
            meal_slot_id:   a.meal_slot_id,
            day_offsets:    a.day_offsets,
            recipe_id:      a.recipe_id,
            is_adhoc:       false,
          }))
        )
      }
    }

    toast.ok(`Semana del ${new Date(weekStartDate + 'T12:00:00').toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })} creada ✓`)
    setCreating(false)
    await loadAll(newPlan)
  }

  // ── Early returns ─────────────────────────────────────────────────────────

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

  const totalSlots    = blocks.length
  const assignedSlots = blocks.filter(b => b.recipe !== null).length

  function RecipeOption({ recipe, onPick }: { recipe: Recipe; onPick: (r: Recipe) => void }) {
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 pt-4 pb-32">
      {banner && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700">
          {banner}
        </div>
      )}

      {/* Cabecera */}
      <div className="flex items-center justify-between mb-1">
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
        <p className="text-xs text-gray-400 mb-4">
          Semana del {new Date(activePlan.week_start_date + 'T12:00:00')
            .toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}
        </p>
      )}

      {/* ── Estado de carga ── */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-20 rounded-2xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : !activePlan ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="mb-1">No hay plan activo esta semana.</p>
          <p className="text-xs">Crea uno con el botón de arriba.</p>
        </div>
      ) : (
        <>
          {/* ══ Nivel 1: tarjetas de bloque ══════════════════════════════════ */}
          <div className="space-y-3">
            {blocks.map((block, i) => {
              const emoji    = MEAL_EMOJI[block.mealSlot.slot_key] ?? '🍽'
              const assigned = block.recipe !== null
              return (
                <button
                  key={`${block.mealSlot.id}-${block.startOffset}-${i}`}
                  onClick={() => openPickerBlock(block)}
                  className={`w-full text-left rounded-2xl border-2 p-4 transition-colors active:scale-[0.98] ${
                    assigned
                      ? 'border-[var(--color-brand)] bg-white shadow-sm'
                      : 'border-dashed border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      {emoji} {block.mealSlot.name}
                    </span>
                    <span className="text-xs text-gray-400 font-medium">{block.dayLabel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {assigned ? (
                      <p className="font-semibold text-gray-800 truncate">{block.recipe!.name}</p>
                    ) : (
                      <p className="text-gray-300 italic text-sm">Por elegir…</p>
                    )}
                    <span className={`text-base shrink-0 ${assigned ? 'text-[var(--color-brand)]' : 'text-gray-300'}`}>
                      {assigned ? '✎' : '+'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* ══ Toggle Nivel 2 ════════════════════════════════════════════════ */}
          <button
            onClick={() => setShowGrid(g => !g)}
            className="w-full mt-4 py-2.5 text-xs text-gray-400 font-medium hover:text-gray-600 flex items-center justify-center gap-1"
          >
            {showGrid ? '▲ Ocultar semana completa' : '▼ Ver semana completa'}
          </button>

          {/* ══ Nivel 2: grilla de 7 días ════════════════════════════════════ */}
          {showGrid && (
            <div className="space-y-4 mt-2">
              {days.map(day => {
                const dow     = day.date.getDay()
                const isToday = limaDateStr(day.date) === limaToday()
                return (
                  <div key={day.offset} className={`rounded-xl border bg-white shadow-sm overflow-hidden ${isToday ? 'border-[var(--color-brand)]' : 'border-gray-100'}`}>
                    <div className={`px-4 py-2 flex items-center gap-2 ${isToday ? 'bg-[var(--color-brand-pale)]' : 'bg-gray-50'}`}>
                      <span className={`text-sm font-bold ${isToday ? 'text-[var(--color-brand)]' : 'text-gray-700'}`}>
                        {DOW_FULL[dow]}
                      </span>
                      <span className="text-xs text-gray-400">
                        {day.date.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}
                      </span>
                      {isToday && <span className="text-xs font-medium text-[var(--color-brand)] ml-auto">Hoy</span>}
                    </div>
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
        </>
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
                <p className="text-xs text-gray-400">{assignedSlots} de {totalSlots} bloques</p>
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

      {/* ── Picker paso 1: lista de recetas ── */}
      {picker && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setPicker(null)}>
          <div className="w-full bg-white rounded-t-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white px-4 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">{picker.block.dayLabel}</p>
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
                        <RecipeOption key={recipe.id} recipe={recipe} onPick={handleRecipePick} />
                      ))}
                      {pickerRecipes.length > 0 && (
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-3 pb-1">
                          Todo el catálogo
                        </p>
                      )}
                    </>
                  )}
                  {pickerRecipes.map(recipe => (
                    <RecipeOption key={recipe.id} recipe={recipe} onPick={handleRecipePick} />
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Picker paso 2: selector de días (F2) ── */}
      {dayStep && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40">
          <div className="w-full bg-white rounded-t-2xl p-6" onClick={e => e.stopPropagation()}>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">
              {dayStep.block.mealSlot.name}
            </p>
            <h2 className="font-semibold text-gray-800 mb-4">{dayStep.recipe.name}</h2>

            <p className="text-sm font-medium text-gray-600 mb-3">Cocinar para:</p>

            <div className="flex gap-2 mb-4">
              {Array.from({ length: dayStep.maxDays }, (_, i) => i + 1).map(n => (
                <button
                  key={n}
                  onClick={() => setDayStep(d => d ? { ...d, selectedDays: n } : d)}
                  className={`flex-1 py-3 rounded-xl border-2 font-semibold text-sm transition-colors ${
                    dayStep.selectedDays === n
                      ? 'border-[var(--color-brand)] bg-[var(--color-brand-pale)] text-[var(--color-brand)]'
                      : 'border-gray-200 text-gray-500'
                  }`}
                >
                  {n} {n === 1 ? 'día' : 'días'}
                </button>
              ))}
            </div>

            <p className="text-xs text-center text-gray-400 mb-5">
              {Array.from({ length: dayStep.selectedDays }, (_, i) => {
                const d = new Date(activePlan!.week_start_date + 'T12:00:00')
                d.setDate(d.getDate() + dayStep.block.startOffset + i)
                return DOW_NAMES[d.getDay()]
              }).join(' · ')}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => { setDayStep(null); openPickerBlock(dayStep.block) }}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium"
              >
                ← Cambiar receta
              </button>
              <button
                disabled={saving}
                onClick={() => {
                  const offsets = Array.from(
                    { length: dayStep.selectedDays },
                    (_, i) => dayStep.block.startOffset + i
                  )
                  assignWithOffsets(dayStep.block, dayStep.recipe, offsets)
                }}
                className="flex-1 py-3 rounded-xl bg-[var(--color-brand)] text-white font-semibold text-sm disabled:opacity-50"
              >
                {saving ? '…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
