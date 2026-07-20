import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFamilyStore } from '../store/familyStore'
import { toast } from '../components/ui/Toast'
import type { ShoppingList, ShoppingListItem, ItemStatus } from '../types/database'

// Orden de categorías y sus etiquetas visuales
const CATEGORY_ORDER = [
  'verduras',
  'frutas',
  'carnes',
  'pescados',
  'lacteos',
  'huevos',
  'granos',
  'legumbres',
  'semillas',
  'harinas',
  'aceites',
  'condimentos',
  'conservas',
  'bebidas',
  'otros',
]

const CATEGORY_ICON: Record<string, string> = {
  verduras:    '🥬',
  frutas:      '🍎',
  carnes:      '🥩',
  pescados:    '🐟',
  lacteos:     '🥛',
  huevos:      '🥚',
  granos:      '🌾',
  legumbres:   '🫘',
  semillas:    '🌰',
  harinas:     '🍞',
  aceites:     '🫒',
  condimentos: '🧂',
  conservas:   '🥫',
  bebidas:     '🧃',
  otros:       '🛒',
}

type ShoppingListItemWithCat = ShoppingListItem & { category: string }

// Mapea el valor real de ingredients.category (inglés) → categoría visual
const CAT_MAP: Record<string, string> = {
  // inglés exacto de la DB
  vegetable:  'verduras',
  grain:      'granos',
  dairy:      'lacteos',
  protein:    'carnes',
  fruit:      'frutas',
  spice:      'condimentos',
  oil:        'aceites',
  seed:       'semillas',
  legume:     'legumbres',
  condiment:  'condimentos',
  egg:        'huevos',
  herb:       'condimentos',
  citrus:     'frutas',
  nut:        'semillas',
  fish:       'pescados',
  seafood:    'pescados',
  meat:       'carnes',
  poultry:    'carnes',
  beverage:   'bebidas',
  flour:      'harinas',
  canned:     'conservas',
  // español (por si acaso)
  verdura: 'verduras', vegetal: 'verduras',
  fruta: 'frutas',
  carne: 'carnes', ave: 'carnes',
  lacteo: 'lacteos', lácteo: 'lacteos',
  huevo: 'huevos',
  grano: 'granos', cereal: 'granos',
  legumbre: 'legumbres', menestra: 'legumbres',
  harina: 'harinas',
  aceite: 'aceites',
  condimento: 'condimentos', especia: 'condimentos', hierba: 'condimentos',
  conserva: 'conservas',
  bebida: 'bebidas',
  semilla: 'semillas', fruto_seco: 'semillas',
}

function normalizeCategory(cat: string | null | undefined): string {
  if (!cat) return 'otros'
  const c = cat.toLowerCase().trim()
  return CAT_MAP[c] ?? 'otros'
}

export default function Compras() {
  const { currentFamily, activePlan } = useFamilyStore()
  const [list,        setList]        = useState<ShoppingList | null>(null)
  const [items,       setItems]       = useState<ShoppingListItemWithCat[]>([])
  const [loading,     setLoading]     = useState(true)
  const [generating,  setGenerating]  = useState(false)
  const [collapsed,   setCollapsed]   = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!currentFamily || !activePlan) { setLoading(false); return }
    loadList()
  }, [currentFamily, activePlan])

  async function loadList() {
    setLoading(true)
    const { data: rawLists } = await supabase
      .from('shopping_lists').select('*')
      .eq('weekly_plan_id', activePlan!.id)
      .order('created_at', { ascending: false }).limit(1)
    const shoppingList = ((rawLists ?? []) as ShoppingList[])[0] ?? null
    setList(shoppingList)

    if (shoppingList) {
      // Traer ítems + categoría del ingrediente en un solo query
      const { data: rawItems } = await supabase
        .from('shopping_list_items')
        .select('*, ingredient:ingredients!shopping_list_items_display_ingredient_id_fkey(category)')
        .eq('shopping_list_id', shoppingList.id)
        .order('display_name')

      const enriched: ShoppingListItemWithCat[] = ((rawItems ?? []) as Array<ShoppingListItem & { ingredient?: { category: string } | null }>).map(i => ({
        ...i,
        category: normalizeCategory(i.ingredient?.category ?? null),
      }))
      setItems(enriched)
    }
    setLoading(false)
  }

  async function generateList() {
    if (!activePlan) return
    setGenerating(true)
    await supabase.rpc('generate_shopping_list_snapshot', {
      p_weekly_plan_id: activePlan.id,
      p_deduction_mode: 'net',
    })
    await loadList()
    setGenerating(false)
  }

  async function toggleItem(item: ShoppingListItemWithCat) {
    const nextStatus: ItemStatus = item.status === 'pending' ? 'bought' : 'pending'
    await supabase.from('shopping_list_items')
      .update({ status: nextStatus } as Partial<ShoppingListItem>)
      .eq('id', item.id)
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: nextStatus } : i))
  }

  function toggleCollapse(cat: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }

  function toWhatsApp() {
    const pending = items.filter(i => i.status === 'pending')
    const grouped: Record<string, ShoppingListItemWithCat[]> = {}
    pending.forEach(i => { (grouped[i.category] ??= []).push(i) })
    const lines = CATEGORY_ORDER
      .filter(cat => grouped[cat])
      .flatMap(cat => [`*${CATEGORY_ICON[cat] ?? '•'} ${cat.charAt(0).toUpperCase() + cat.slice(1)}*`,
        ...grouped[cat].map(i => `  • ${i.display_name}: ${i.quantity_to_buy} ${i.unit}`)])
    window.open(`https://wa.me/?text=${encodeURIComponent(`🛒 Lista de compras\n\n${lines.join('\n')}`)  }`, '_blank')
  }

  // Agrupar por categoría (orden predefinido)
  const grouped: Record<string, ShoppingListItemWithCat[]> = {}
  items.forEach(i => { (grouped[i.category] ??= []).push(i) })
  const presentCats = CATEGORY_ORDER.filter(c => grouped[c]?.length)

  const totalPen    = items.reduce((s, i) => s + (i.estimated_cost ?? 0), 0)
  const pendingAmt  = items.filter(i => i.status === 'pending').reduce((s, i) => s + (i.estimated_cost ?? 0), 0)
  const boughtCount = items.filter(i => i.status === 'bought').length

  if (!currentFamily) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-500">
        <span className="text-4xl">🛒</span>
        <p>Configura tu familia primero.</p>
      </div>
    )
  }

  return (
    <div className="px-4 pt-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-gray-800">Lista de compras</h1>
        <button
          onClick={generateList}
          disabled={!activePlan || generating}
          className="text-xs px-3 py-1.5 rounded-lg bg-[var(--color-brand)] text-white font-medium disabled:opacity-40"
        >
          {generating ? 'Calculando…' : 'Recalcular'}
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : !list || items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">🧺</p>
          <p className="mb-4">{!activePlan ? 'No hay plan activo.' : 'La lista está vacía.'}</p>
          {activePlan && (
            <button onClick={generateList} disabled={generating}
              className="px-4 py-2 rounded-xl bg-[var(--color-brand)] text-white text-sm font-medium disabled:opacity-40">
              {generating ? 'Calculando…' : 'Generar lista'}
            </button>
          )}
        </div>
      ) : (
        <>
          {/* ── Resumen ── */}
          <div className="flex gap-3 mb-4">
            <div className="flex-1 p-3 rounded-xl bg-[var(--color-brand-pale)] text-center">
              <p className="text-xs text-gray-500">Total estimado</p>
              <p className="font-bold text-[var(--color-brand)]">S/ {totalPen.toFixed(2)}</p>
            </div>
            <div className="flex-1 p-3 rounded-xl bg-amber-50 text-center">
              <p className="text-xs text-gray-500">Por comprar</p>
              <p className="font-bold text-amber-600">S/ {pendingAmt.toFixed(2)}</p>
            </div>
            <div className="flex-1 p-3 rounded-xl bg-green-50 text-center">
              <p className="text-xs text-gray-500">Comprado</p>
              <p className="font-bold text-green-600">{boughtCount}/{items.length}</p>
            </div>
          </div>

          {/* ── Ítems agrupados por categoría ── */}
          <div className="space-y-3 mb-4">
            {presentCats.map(cat => {
              const catItems = grouped[cat]
              const allBought = catItems.every(i => i.status === 'bought')
              const isCollapsed = collapsed.has(cat)
              const catPending = catItems.filter(i => i.status === 'pending').length
              return (
                <div key={cat} className={`rounded-xl border overflow-hidden ${allBought ? 'border-green-200' : 'border-gray-100'}`}>
                  {/* Cabecera de categoría */}
                  <button
                    onClick={() => toggleCollapse(cat)}
                    className={`w-full flex items-center gap-2 px-4 py-2.5 text-left ${allBought ? 'bg-green-50' : 'bg-gray-50'}`}
                  >
                    <span className="text-base">{CATEGORY_ICON[cat] ?? '•'}</span>
                    <span className={`flex-1 text-sm font-semibold capitalize ${allBought ? 'text-green-600' : 'text-gray-700'}`}>
                      {cat}
                    </span>
                    <span className="text-xs text-gray-400">{catPending > 0 ? `${catPending} pendiente${catPending > 1 ? 's' : ''}` : 'todo comprado'}</span>
                    <span className="text-xs text-gray-300 ml-1">{isCollapsed ? '▲' : '▼'}</span>
                  </button>

                  {/* Ítems de la categoría */}
                  {!isCollapsed && (
                    <div className="divide-y divide-gray-50">
                      {catItems.map(item => (
                        <button
                          key={item.id}
                          onClick={() => toggleItem(item)}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                            item.status === 'bought' ? 'bg-green-50' : 'bg-white'
                          }`}
                        >
                          <span className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center text-xs ${
                            item.status === 'bought'
                              ? 'border-green-500 bg-green-500 text-white'
                              : 'border-gray-300'
                          }`}>
                            {item.status === 'bought' ? '✓' : ''}
                          </span>
                          <span className={`flex-1 text-sm ${item.status === 'bought' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                            {item.display_name}
                          </span>
                          <span className="text-xs text-gray-500 shrink-0">
                            {item.quantity_to_buy} {item.unit}
                          </span>
                          {item.estimated_cost != null && (
                            <span className="text-xs text-gray-400 shrink-0 w-14 text-right">
                              S/ {item.estimated_cost.toFixed(2)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Exportar ── */}
          <div className="flex gap-2 pb-4">
            <button onClick={toWhatsApp}
              className="flex-1 py-3 rounded-xl bg-green-500 text-white text-sm font-medium flex items-center justify-center gap-2">
              <span>📲</span> WhatsApp
            </button>
            <button onClick={() => window.print()}
              className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 flex items-center justify-center gap-2">
              <span>🖨️</span> Imprimir
            </button>
          </div>
        </>
      )}

      <div className="mt-2 p-3 rounded-xl border border-dashed border-gray-200 text-center">
        <button className="text-sm text-gray-400 hover:text-[var(--color-brand)]"
          onClick={() => toast.info('Gestión de despensa — próximamente')}>
          📦 Gestionar despensa
        </button>
      </div>
    </div>
  )
}
