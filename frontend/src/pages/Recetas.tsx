import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFamilyStore } from '../store/familyStore'
import { toast } from '../components/ui/Toast'
import type { Recipe } from '../types/database'

const MEAL_TYPES = [
  { value: 'breakfast', label: 'Desayuno' },
  { value: 'snack',     label: 'Snack' },
  { value: 'lunch',     label: 'Almuerzo' },
  { value: 'dinner',    label: 'Cena' },
] as const

type MealTypeVal = typeof MEAL_TYPES[number]['value']

const FILTER_ALL = 'all'

interface RecipeDraft {
  id?:              string
  name:             string
  description:      string
  meal_type:        MealTypeVal
  tags:             string
  ingredients_text: string
}

export default function Recetas() {
  const { currentFamily } = useFamilyStore()
  const [recipes,   setRecipes]   = useState<Recipe[]>([])
  const [filter,    setFilter]    = useState<string>(FILTER_ALL)
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(false)
  const [draft,     setDraft]     = useState<RecipeDraft>({ name: '', description: '', meal_type: 'lunch', tags: '', ingredients_text: '' })
  const [saving,    setSaving]    = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  // AI search
  const [aiQuery,   setAiQuery]   = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [showAi,    setShowAi]    = useState(false)
  // Detail view
  const [detail,    setDetail]    = useState<Recipe | null>(null)

  useEffect(() => {
    if (!currentFamily) { setLoading(false); return }
    load()
  }, [currentFamily])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('recipes').select('*')
      .eq('family_id', currentFamily!.id).order('meal_type').order('name')
    setRecipes((data ?? []) as Recipe[])
    setLoading(false)
  }

  function openNew() {
    setDraft({ name: '', description: '', meal_type: 'lunch', tags: '', ingredients_text: '' })
    setShowAi(false)
    setAiQuery('')
    setModal(true)
  }

  function openEdit(r: Recipe) {
    setDraft({
      id:               r.id,
      name:             r.name,
      description:      r.description ?? '',
      meal_type:        (r.meal_type as MealTypeVal) ?? 'lunch',
      tags:             (r.tags ?? []).join(', '),
      ingredients_text: r.ingredients_text ?? '',
    })
    setShowAi(false)
    setModal(true)
  }

  async function searchWithAI() {
    if (!aiQuery.trim()) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/recipe-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: aiQuery }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json() as { name: string; description: string; meal_type: string; tags: string[]; ingredients_text: string }
      setDraft({
        name:             data.name ?? aiQuery,
        description:      data.description ?? '',
        meal_type:        (MEAL_TYPES.find(m => m.value === data.meal_type)?.value ?? 'lunch') as MealTypeVal,
        tags:             (data.tags ?? []).join(', '),
        ingredients_text: data.ingredients_text ?? '',
      })
      setShowAi(false)
      toast.ok('Receta generada por IA ✓')
    } catch {
      toast.err('Error al buscar con IA. Verifica la configuración.')
    } finally {
      setAiLoading(false)
    }
  }

  async function save() {
    if (!draft.name.trim() || !currentFamily) return
    setSaving(true)
    const payload = {
      name:             draft.name.trim(),
      description:      draft.description.trim() || null,
      meal_type:        draft.meal_type,
      tags:             draft.tags.split(',').map(t => t.trim()).filter(Boolean),
      ingredients_text: draft.ingredients_text.trim() || null,
    }

    if (draft.id) {
      const { error } = await supabase.from('recipes').update(payload).eq('id', draft.id)
      setSaving(false)
      if (error) { toast.err('Error al guardar'); return }
      setRecipes(prev => prev.map(r => r.id === draft.id ? { ...r, ...payload } : r))
      toast.ok('Receta actualizada ✓')
    } else {
      const { data, error } = await supabase.from('recipes')
        .insert({ family_id: currentFamily.id, ...payload }).select().single()
      setSaving(false)
      if (error || !data) { toast.err('Error al crear'); return }
      setRecipes(prev => [...prev, data as Recipe].sort((a, b) => a.name.localeCompare(b.name)))
      toast.ok(`${payload.name} creada ✓`)
    }
    setModal(false)
  }

  async function deleteRecipe() {
    if (!draft.id) return
    setDeleting(true)
    const { error } = await supabase.from('recipes').delete().eq('id', draft.id)
    setDeleting(false)
    if (error) { toast.err('Error al eliminar'); return }
    setRecipes(prev => prev.filter(r => r.id !== draft.id))
    setModal(false)
    setDetail(null)
    toast.ok('Receta eliminada')
  }

  const filtered = filter === FILTER_ALL ? recipes : recipes.filter(r => r.meal_type === filter)
  const mealLabel = (type: string) => MEAL_TYPES.find(m => m.value === type)?.label ?? type

  if (!currentFamily) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Configura tu familia primero.</div>
  }

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-gray-800">Recetas</h1>
        <button onClick={openNew}
          className="text-xs px-3 py-1.5 rounded-lg bg-[var(--color-brand)] text-white font-medium">
          + Nueva
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-4 no-scrollbar">
        {[{ value: FILTER_ALL, label: 'Todas' }, ...MEAL_TYPES].map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filter === f.value
                ? 'border-[var(--color-brand)] bg-[var(--color-brand-pale)] text-[var(--color-brand)] font-medium'
                : 'border-gray-200 text-gray-500'
            }`}>
            {f.label} {f.value !== FILTER_ALL && `(${recipes.filter(r => r.meal_type === f.value).length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">🍽️</p>
          <p className="text-sm">No hay recetas aún.</p>
          <button onClick={openNew} className="mt-4 text-sm text-[var(--color-brand)] underline">Crear la primera</button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => (
            <button key={r.id} onClick={() => setDetail(r)}
              className="w-full text-left p-4 rounded-xl bg-white border border-gray-100 shadow-sm hover:border-[var(--color-brand)] transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 text-sm">{r.name}</p>
                  {r.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{r.description}</p>}
                </div>
                <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  {mealLabel(r.meal_type ?? '')}
                </span>
              </div>
              {r.tags && r.tags.length > 0 && (
                <div className="mt-2 flex gap-1 flex-wrap">
                  {r.tags.map(t => (
                    <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-brand-pale)] text-[var(--color-brand)]">#{t}</span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Detail view ── */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setDetail(null)}>
          <div className="w-full bg-white rounded-t-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="font-bold text-gray-800 text-base">{detail.name}</h2>
                <span className="text-xs text-gray-400">{mealLabel(detail.meal_type ?? '')}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setDetail(null); openEdit(detail) }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600">
                  Editar
                </button>
                <button onClick={() => setDetail(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500">✕</button>
              </div>
            </div>
            {detail.description && <p className="text-sm text-gray-600 mb-4">{detail.description}</p>}
            {detail.ingredients_text && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Ingredientes</p>
                <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 whitespace-pre-line">{detail.ingredients_text}</div>
              </div>
            )}
            {detail.tags && detail.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {detail.tags.map(t => (
                  <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-brand-pale)] text-[var(--color-brand)]">#{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: crear / editar receta ── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setModal(false)}>
          <div className="w-full bg-white rounded-t-2xl p-5 space-y-4 max-h-[95vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">{draft.id ? 'Editar receta' : 'Nueva receta'}</h2>
              <button className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500" onClick={() => setModal(false)}>✕</button>
            </div>

            {/* ── Buscar con IA ── */}
            {!draft.id && (
              <div className="rounded-xl bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-100 p-3">
                <button onClick={() => setShowAi(!showAi)}
                  className="flex items-center gap-2 text-sm font-medium text-purple-700">
                  <span>✨</span> {showAi ? 'Ocultar búsqueda IA' : 'Buscar con IA'}
                </button>
                {showAi && (
                  <div className="mt-3 flex gap-2">
                    <input
                      autoFocus={showAi}
                      value={aiQuery}
                      onChange={e => setAiQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && searchWithAI()}
                      placeholder="Ej: Lomo saltado, Quinua con verduras..."
                      className="flex-1 border border-purple-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-400"
                    />
                    <button onClick={searchWithAI} disabled={aiLoading || !aiQuery.trim()}
                      className="px-3 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium disabled:opacity-50">
                      {aiLoading ? '…' : 'Buscar'}
                    </button>
                  </div>
                )}
                {aiLoading && <p className="mt-2 text-xs text-purple-500">Consultando IA...</p>}
              </div>
            )}

            <div>
              <label className="text-xs text-gray-500 font-medium">Nombre *</label>
              <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                autoFocus={!showAi}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-brand)]"
                placeholder="Ej: Arroz con leche" />
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">Descripción</label>
              <textarea value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                rows={2} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-brand)] resize-none"
                placeholder="Breve descripción del plato..." />
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">Tipo de comida</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {MEAL_TYPES.map(m => (
                  <button key={m.value} onClick={() => setDraft(d => ({ ...d, meal_type: m.value }))}
                    className={`py-2 rounded-lg text-sm border transition-colors ${
                      draft.meal_type === m.value
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand-pale)] text-[var(--color-brand)] font-medium'
                        : 'border-gray-200 text-gray-600'
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">Ingredientes (por porción)</label>
              <textarea value={draft.ingredients_text} onChange={e => setDraft(d => ({ ...d, ingredients_text: e.target.value }))}
                rows={5} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-brand)] resize-none font-mono"
                placeholder={"- 500g pechuga de pollo\n- 2 cdas aceite de oliva\n- 1 cebolla grande\n..."} />
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">Etiquetas (separadas por coma)</label>
              <input value={draft.tags} onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-brand)]"
                placeholder="Ej: fit, sin gluten, rápido" />
            </div>

            <div className="flex gap-2 pt-1">
              {draft.id && (
                <button disabled={deleting} onClick={deleteRecipe}
                  className="px-4 py-2.5 rounded-xl border border-red-200 text-red-500 text-sm disabled:opacity-50">
                  {deleting ? '…' : 'Eliminar'}
                </button>
              )}
              <button disabled={saving || !draft.name.trim()} onClick={save}
                className="flex-1 py-2.5 rounded-xl bg-[var(--color-brand)] text-white text-sm font-medium disabled:opacity-50">
                {saving ? 'Guardando…' : draft.id ? 'Guardar cambios' : 'Crear receta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
