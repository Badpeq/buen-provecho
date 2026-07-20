export const CATEGORY_ORDER = [
  'verduras', 'frutas', 'carnes', 'pescados',
  'lacteos', 'huevos', 'granos', 'legumbres',
  'semillas', 'harinas', 'aceites', 'condimentos',
  'conservas', 'bebidas', 'otros',
]

export const CATEGORY_ICON: Record<string, string> = {
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

export const CAT_MAP: Record<string, string> = {
  // inglés exacto de la DB
  vegetable: 'verduras',
  grain:     'granos',
  dairy:     'lacteos',
  protein:   'carnes',
  fruit:     'frutas',
  spice:     'condimentos',
  oil:       'aceites',
  seed:      'semillas',
  legume:    'legumbres',
  condiment: 'condimentos',
  egg:       'huevos',
  herb:      'condimentos',
  citrus:    'frutas',
  nut:       'semillas',
  fish:      'pescados',
  seafood:   'pescados',
  meat:      'carnes',
  poultry:   'carnes',
  beverage:  'bebidas',
  flour:     'harinas',
  canned:    'conservas',
  // español
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

export function normalizeCategory(cat: string | null | undefined): string {
  if (!cat) return 'otros'
  return CAT_MAP[cat.toLowerCase().trim()] ?? 'otros'
}

export interface WhatsAppItem {
  display_name: string
  quantity_to_buy: number
  unit: string
  category: string
  status: string
}

export function shareWhatsApp(items: WhatsAppItem[]): void {
  const pending = items.filter(i => i.status === 'pending')
  const grouped: Record<string, WhatsAppItem[]> = {}
  pending.forEach(i => { (grouped[i.category] ??= []).push(i) })
  const lines = CATEGORY_ORDER
    .filter(cat => grouped[cat])
    .flatMap(cat => [
      `*${CATEGORY_ICON[cat] ?? '•'} ${cat.charAt(0).toUpperCase() + cat.slice(1)}*`,
      ...grouped[cat].map(i => `  • ${i.display_name}: ${i.quantity_to_buy} ${i.unit}`),
    ])
  window.open(
    `https://wa.me/?text=${encodeURIComponent(`🛒 Lista de compras\n\n${lines.join('\n')}`)}`,
    '_blank',
  )
}
