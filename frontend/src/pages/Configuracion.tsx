import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFamilyStore } from '../store/familyStore'
import { toast } from '../components/ui/Toast'
import type { FamilyMember, DietaryPattern, FoodRestriction, MemberBodyData } from '../types/database'

const ROLES = [
  { value: 'owner',         label: 'Propietario' },
  { value: 'adult',         label: 'Adulto' },
  { value: 'member',        label: 'Miembro' },
  { value: 'support_staff', label: 'Personal de apoyo' },
  { value: 'guest',         label: 'Invitado' },
] as const
type RoleValue = typeof ROLES[number]['value']

const PORTION_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

const HEALTH_GOALS = [
  { value: '',                 label: 'Sin objetivo específico' },
  { value: 'mantenimiento',    label: '⚖️ Mantenimiento' },
  { value: 'perdida_peso',     label: '📉 Perder peso' },
  { value: 'ganancia_muscular',label: '💪 Ganar músculo' },
  { value: 'lactancia',        label: '🤱 Lactancia / Embarazo' },
]

interface MemberDraft {
  id?:            string
  display_name:   string
  role:           RoleValue
  portion_factor: number
  // Health profile
  health_goal:    string
  require_snacks: boolean
  weight_kg:      string
  height_cm:      string
  birth_year:     string
}

interface RestrictionDraft {
  tag:              string
  restriction_type: 'exclude' | 'prefer_avoid'
  family_member_id: string | null
}

interface AiRestriction {
  tag:    string
  type:   'exclude' | 'prefer_avoid'
  reason: string
}

export default function Configuracion() {
  const { currentFamily, members, setMembers, setFamily } = useFamilyStore()
  const [patterns,       setPatterns]       = useState<DietaryPattern[]>([])
  const [restrictions,   setRestrictions]   = useState<FoodRestriction[]>([])
  const [loading,        setLoading]        = useState(true)

  const [editFamily,     setEditFamily]     = useState(false)
  const [familyName,     setFamilyName]     = useState('')
  const [savingFamily,   setSavingFamily]   = useState(false)

  const [memberModal,    setMemberModal]    = useState(false)
  const [memberDraft,    setMemberDraft]    = useState<MemberDraft>({ display_name: '', role: 'member', portion_factor: 1, health_goal: '', require_snacks: false, weight_kg: '', height_cm: '', birth_year: '' })
  const [savingMember,   setSavingMember]   = useState(false)
  const [deletingMember, setDeletingMember] = useState(false)

  const [restrictModal,  setRestrictModal]  = useState(false)
  const [rDraft,         setRDraft]         = useState<RestrictionDraft>({ tag: '', restriction_type: 'exclude', family_member_id: null })
  const [savingR,        setSavingR]        = useState(false)
  // AI restrictions
  const [aiText,         setAiText]         = useState('')
  const [aiLoading,      setAiLoading]      = useState(false)
  const [aiPreview,      setAiPreview]      = useState<AiRestriction[]>([])
  const [showAiInput,    setShowAiInput]    = useState(false)

  useEffect(() => {
    if (!currentFamily) { setLoading(false); return }
    setFamilyName(currentFamily.name)
    loadData()
  }, [currentFamily])

  async function loadData() {
    setLoading(true)
    const [membersRes, patternsRes, restrictionsRes] = await Promise.all([
      supabase.from('family_members').select('*').eq('family_id', currentFamily!.id).order('created_at'),
      supabase.from('dietary_patterns').select('*').eq('family_id', currentFamily!.id).eq('active', true),
      supabase.from('food_restrictions').select('*').eq('family_id', currentFamily!.id),
    ])
    setMembers((membersRes.data ?? []) as FamilyMember[])
    setPatterns((patternsRes.data ?? []) as DietaryPattern[])
    setRestrictions((restrictionsRes.data ?? []) as FoodRestriction[])
    setLoading(false)
  }

  async function saveFamily() {
    if (!familyName.trim() || !currentFamily) return
    setSavingFamily(true)
    const { error } = await supabase.from('families').update({ name: familyName.trim() }).eq('id', currentFamily.id)
    setSavingFamily(false)
    if (error) { toast.err('Error al guardar'); return }
    setFamily({ ...currentFamily, name: familyName.trim() })
    setEditFamily(false)
    toast.ok('Familia actualizada ✓')
  }

  function openAddMember() {
    setMemberDraft({ display_name: '', role: 'member', portion_factor: 1, health_goal: '', require_snacks: false, weight_kg: '', height_cm: '', birth_year: '' })
    setMemberModal(true)
  }

  async function openEditMember(m: FamilyMember) {
    const pattern = patterns.find(p => p.family_member_id === m.id)
    // Load body data
    const { data: bodyData } = await supabase.from('member_body_data')
      .select('*').eq('family_member_id', m.id).single()
    const bd = bodyData as MemberBodyData | null
    setMemberDraft({
      id:             m.id,
      display_name:   m.display_name,
      role:           m.role as RoleValue,
      portion_factor: m.portion_factor,
      health_goal:    pattern?.label ?? '',
      require_snacks: pattern?.require_snacks ?? false,
      weight_kg:      bd?.weight_kg?.toString() ?? '',
      height_cm:      bd?.height_cm?.toString() ?? '',
      birth_year:     bd?.birth_year?.toString() ?? '',
    })
    setMemberModal(true)
  }

  async function saveMember() {
    if (!memberDraft.display_name.trim() || !currentFamily) return
    setSavingMember(true)

    const basePayload = {
      display_name:   memberDraft.display_name.trim(),
      role:           memberDraft.role,
      portion_factor: memberDraft.portion_factor,
    }

    let memberId = memberDraft.id

    if (memberDraft.id) {
      const { error } = await supabase.from('family_members').update(basePayload).eq('id', memberDraft.id)
      if (error) { setSavingMember(false); toast.err('Error al guardar'); return }
      setMembers(members.map(m => m.id === memberDraft.id ? { ...m, ...basePayload } : m))
    } else {
      const { data, error } = await supabase.from('family_members')
        .insert({ family_id: currentFamily.id, ...basePayload }).select().single()
      if (error || !data) { setSavingMember(false); toast.err('Error al agregar'); return }
      setMembers([...members, data as FamilyMember])
      memberId = (data as FamilyMember).id
    }

    if (memberId) {
      // Save health goal (dietary pattern)
      await supabase.from('dietary_patterns').update({ active: false }).eq('family_member_id', memberId).eq('active', true)
      if (memberDraft.health_goal) {
        const { data: np } = await supabase.from('dietary_patterns').insert({
          family_id:          currentFamily.id,
          family_member_id:   memberId,
          label:              memberDraft.health_goal,
          require_snacks:     memberDraft.require_snacks,
          portion_multiplier: memberDraft.health_goal === 'ganancia_muscular' ? 1.25 : memberDraft.health_goal === 'perdida_peso' ? 0.85 : 1.0,
          carb_multiplier:    memberDraft.health_goal === 'perdida_peso' ? 0.8 : memberDraft.health_goal === 'ganancia_muscular' ? 1.2 : 1.0,
          active:             true,
        }).select().single()
        if (np) {
          setPatterns(prev => [...prev.filter(p => p.family_member_id !== memberId), np as DietaryPattern])
        }
      } else {
        setPatterns(prev => prev.filter(p => p.family_member_id !== memberId))
      }

      // Save body data (upsert)
      if (memberDraft.weight_kg || memberDraft.height_cm || memberDraft.birth_year) {
        await supabase.from('member_body_data').upsert({
          family_member_id: memberId,
          family_id:        currentFamily.id,
          weight_kg:        memberDraft.weight_kg ? parseFloat(memberDraft.weight_kg) : null,
          height_cm:        memberDraft.height_cm ? parseFloat(memberDraft.height_cm) : null,
          birth_year:       memberDraft.birth_year ? parseInt(memberDraft.birth_year) : null,
        })
      }
    }

    setSavingMember(false)
    toast.ok(`${memberDraft.display_name} ${memberDraft.id ? 'actualizado' : 'agregado'} ✓`)
    setMemberModal(false)
  }

  async function deleteMember() {
    if (!memberDraft.id) return
    setDeletingMember(true)
    const { error } = await supabase.from('family_members').delete().eq('id', memberDraft.id)
    setDeletingMember(false)
    if (error) { toast.err('Error al eliminar'); return }
    setMembers(members.filter(m => m.id !== memberDraft.id))
    setMemberModal(false)
    toast.ok('Miembro eliminado')
  }

  async function saveRestriction() {
    if (!rDraft.tag.trim() || !currentFamily) return
    setSavingR(true)
    const { data, error } = await supabase.from('food_restrictions')
      .insert({ family_id: currentFamily.id, tag: rDraft.tag.trim().toLowerCase(), restriction_type: rDraft.restriction_type, family_member_id: rDraft.family_member_id })
      .select().single()
    setSavingR(false)
    if (error || !data) { toast.err('Error al agregar'); return }
    setRestrictions([...restrictions, data as FoodRestriction])
    setRestrictModal(false)
    setRDraft({ tag: '', restriction_type: 'exclude', family_member_id: null })
    toast.ok('Restricción agregada ✓')
  }

  async function parseWithAI() {
    if (!aiText.trim()) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/restriction-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: aiText }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json() as { restrictions: AiRestriction[] }
      if (!data.restrictions?.length) { toast.info('No se detectaron restricciones claras'); return }
      setAiPreview(data.restrictions)
    } catch {
      toast.err('Error al procesar. Verifica la configuración de IA.')
    } finally {
      setAiLoading(false)
    }
  }

  async function saveAiRestrictions(memberId: string | null) {
    if (!currentFamily || !aiPreview.length) return
    const inserts = aiPreview.map(r => ({
      family_id:        currentFamily.id,
      tag:              r.tag,
      restriction_type: r.type,
      family_member_id: memberId,
    }))
    const { data, error } = await supabase.from('food_restrictions').insert(inserts).select()
    if (error) { toast.err('Error al guardar'); return }
    setRestrictions(prev => [...prev, ...(data as FoodRestriction[])])
    setAiPreview([])
    setAiText('')
    setShowAiInput(false)
    setRestrictModal(false)
    toast.ok(`${inserts.length} restricciones agregadas ✓`)
  }

  async function deleteRestriction(id: string) {
    await supabase.from('food_restrictions').delete().eq('id', id)
    setRestrictions(restrictions.filter(r => r.id !== id))
  }

  const goalLabel = (label: string) => HEALTH_GOALS.find(g => g.value === label)?.label ?? label

  if (!currentFamily) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <span className="text-4xl">⚙️</span>
        <p className="text-gray-500">No perteneces a ninguna familia aún.</p>
      </div>
    )
  }

  return (
    <div className="px-4 pt-4 space-y-6 pb-8">

      {/* ── Familia ── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Familia</h2>
        <div className="p-4 rounded-xl bg-white border border-gray-100 shadow-sm">
          {editFamily ? (
            <div className="space-y-3">
              <input autoFocus value={familyName} onChange={e => setFamilyName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-brand)]"
                placeholder="Nombre de la familia" />
              <div className="flex gap-2">
                <button disabled={savingFamily} onClick={saveFamily}
                  className="flex-1 py-2 rounded-lg bg-[var(--color-brand)] text-white text-sm font-medium disabled:opacity-50">
                  {savingFamily ? 'Guardando…' : 'Guardar'}
                </button>
                <button onClick={() => { setEditFamily(false); setFamilyName(currentFamily.name) }}
                  className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-500">
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="font-bold text-gray-800">{currentFamily.name}</p>
              <p className="text-sm text-gray-500 mt-1">{currentFamily.country_code} · {currentFamily.currency_code} · {currentFamily.timezone}</p>
              <button className="mt-3 text-xs text-[var(--color-brand)] underline" onClick={() => setEditFamily(true)}>Editar nombre</button>
            </>
          )}
        </div>
      </section>

      {/* ── Miembros ── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Miembros</h2>
          <button className="text-xs px-2 py-1 rounded-lg bg-[var(--color-brand-pale)] text-[var(--color-brand)]" onClick={openAddMember}>+ Agregar</button>
        </div>
        {loading ? (
          <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />)}</div>
        ) : (
          <div className="space-y-2">
            {members.map(m => {
              const pattern = patterns.find(p => p.family_member_id === m.id)
              return (
                <div key={m.id} className="p-3 rounded-xl bg-white border border-gray-100 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-800">{m.display_name}</p>
                      <p className="text-xs text-gray-400">
                        {ROLES.find(r => r.value === m.role)?.label ?? m.role} · Porción ×{m.portion_factor}
                      </p>
                    </div>
                    <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-[var(--color-brand)] transition-colors"
                      onClick={() => openEditMember(m)}>✏️</button>
                  </div>
                  {pattern && (
                    <div className="mt-2 flex gap-2 flex-wrap">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">{goalLabel(pattern.label)}</span>
                      {pattern.require_snacks && <span className="text-xs px-2 py-0.5 rounded-full bg-pink-50 text-pink-600">Snacks obligatorios</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Restricciones alimentarias ── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Restricciones</h2>
          <button className="text-xs px-2 py-1 rounded-lg bg-[var(--color-brand-pale)] text-[var(--color-brand)]"
            onClick={() => { setRDraft({ tag: '', restriction_type: 'exclude', family_member_id: null }); setAiPreview([]); setShowAiInput(false); setRestrictModal(true) }}>
            + Agregar
          </button>
        </div>
        {restrictions.length === 0 ? (
          <p className="text-sm text-gray-400 italic">Sin restricciones registradas.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {restrictions.map(r => (
              <div key={r.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 border border-red-100">
                <span className="text-xs font-medium text-red-700">
                  {r.restriction_type === 'exclude' ? '🚫' : '⚠️'} {r.tag}
                </span>
                {r.family_member_id && (
                  <span className="text-xs text-red-400">· {members.find(m => m.id === r.family_member_id)?.display_name ?? '?'}</span>
                )}
                <button onClick={() => deleteRestriction(r.id)} className="ml-1 text-red-300 hover:text-red-600 text-xs">✕</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Cerrar sesión ── */}
      <section className="pt-4 border-t border-gray-100">
        <button onClick={async () => { await supabase.auth.signOut(); useFamilyStore.getState().reset() }}
          className="w-full py-3 rounded-xl border border-gray-200 text-sm text-gray-500 hover:border-red-200 hover:text-red-500 transition-colors">
          Cerrar sesión
        </button>
      </section>

      {/* ── Modal: agregar / editar miembro ── */}
      {memberModal && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setMemberModal(false)}>
          <div className="w-full bg-white rounded-t-2xl p-5 space-y-4 max-h-[95vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">{memberDraft.id ? 'Editar miembro' : 'Agregar miembro'}</h2>
              <button className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500" onClick={() => setMemberModal(false)}>✕</button>
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">Nombre</label>
              <input autoFocus value={memberDraft.display_name} onChange={e => setMemberDraft(d => ({ ...d, display_name: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-brand)]"
                placeholder="Ej: Mamá, Papá, Ana..." />
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">Rol</label>
              <select value={memberDraft.role} onChange={e => setMemberDraft(d => ({ ...d, role: e.target.value as RoleValue }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[var(--color-brand)]">
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">Factor de porción</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {PORTION_OPTIONS.map(v => (
                  <button key={v} onClick={() => setMemberDraft(d => ({ ...d, portion_factor: v }))}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      memberDraft.portion_factor === v
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand-pale)] text-[var(--color-brand)] font-medium'
                        : 'border-gray-200 text-gray-600'
                    }`}>
                    ×{v}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Perfil de salud ── */}
            <div className="pt-1 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Perfil de salud</p>

              <div className="mb-3">
                <label className="text-xs text-gray-500 font-medium">Objetivo nutricional</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {HEALTH_GOALS.map(g => (
                    <button key={g.value} onClick={() => setMemberDraft(d => ({ ...d, health_goal: g.value }))}
                      className={`py-2 px-2 rounded-lg text-xs border text-left transition-colors ${
                        memberDraft.health_goal === g.value
                          ? 'border-[var(--color-brand)] bg-[var(--color-brand-pale)] text-[var(--color-brand)] font-medium'
                          : 'border-gray-200 text-gray-600'
                      }`}>
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>

              {memberDraft.health_goal && memberDraft.health_goal !== '' && (
                <label className="flex items-center gap-2 text-sm text-gray-600 mb-3">
                  <input type="checkbox" checked={memberDraft.require_snacks}
                    onChange={e => setMemberDraft(d => ({ ...d, require_snacks: e.target.checked }))}
                    className="accent-[var(--color-brand)]" />
                  Incluir snacks obligatorios
                </label>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Peso (kg)</label>
                  <input type="number" value={memberDraft.weight_kg} onChange={e => setMemberDraft(d => ({ ...d, weight_kg: e.target.value }))}
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-brand)]"
                    placeholder="65" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Talla (cm)</label>
                  <input type="number" value={memberDraft.height_cm} onChange={e => setMemberDraft(d => ({ ...d, height_cm: e.target.value }))}
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-brand)]"
                    placeholder="165" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Año nac.</label>
                  <input type="number" value={memberDraft.birth_year} onChange={e => setMemberDraft(d => ({ ...d, birth_year: e.target.value }))}
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-brand)]"
                    placeholder="1990" />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              {memberDraft.id && (
                <button disabled={deletingMember} onClick={deleteMember}
                  className="px-4 py-2.5 rounded-xl border border-red-200 text-red-500 text-sm disabled:opacity-50">
                  {deletingMember ? '…' : 'Eliminar'}
                </button>
              )}
              <button disabled={savingMember || !memberDraft.display_name.trim()} onClick={saveMember}
                className="flex-1 py-2.5 rounded-xl bg-[var(--color-brand)] text-white text-sm font-medium disabled:opacity-50">
                {savingMember ? 'Guardando…' : memberDraft.id ? 'Guardar cambios' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: agregar restricción ── */}
      {restrictModal && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setRestrictModal(false)}>
          <div className="w-full bg-white rounded-t-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">Agregar restricción</h2>
              <button className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500" onClick={() => setRestrictModal(false)}>✕</button>
            </div>

            {/* ── IA: descripción en lenguaje natural ── */}
            <div className="rounded-xl bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-100 p-3">
              <button onClick={() => setShowAiInput(!showAiInput)}
                className="flex items-center gap-2 text-sm font-medium text-purple-700">
                <span>✨</span> {showAiInput ? 'Ocultar' : 'Describir en mi idioma con IA'}
              </button>
              {showAiInput && (
                <div className="mt-3 space-y-2">
                  <textarea
                    autoFocus
                    value={aiText}
                    onChange={e => setAiText(e.target.value)}
                    rows={3}
                    className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-400 resize-none"
                    placeholder="Ej: No puedo comer mariscos porque soy alérgico. Prefiero evitar el cerdo y los lácteos me caen mal..."
                  />
                  <button onClick={parseWithAI} disabled={aiLoading || !aiText.trim()}
                    className="w-full py-2 rounded-lg bg-purple-600 text-white text-sm font-medium disabled:opacity-50">
                    {aiLoading ? 'Procesando con IA…' : '✨ Identificar restricciones'}
                  </button>
                </div>
              )}

              {/* Preview de restricciones detectadas por IA */}
              {aiPreview.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-purple-700 mb-2">Restricciones detectadas:</p>
                  <div className="space-y-1.5">
                    {aiPreview.map((r, i) => (
                      <div key={i} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-purple-100">
                        <div>
                          <span className="text-sm font-medium text-gray-800">{r.type === 'exclude' ? '🚫' : '⚠️'} {r.tag}</span>
                          <span className="ml-2 text-xs text-gray-400">({r.reason})</span>
                        </div>
                        <button onClick={() => setAiPreview(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-gray-300 hover:text-red-400 text-xs">✕</button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3">
                    <label className="text-xs text-gray-500">¿Para quién?</label>
                    <select value={rDraft.family_member_id ?? ''}
                      onChange={e => setRDraft(d => ({ ...d, family_member_id: e.target.value || null }))}
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                      <option value="">Toda la familia</option>
                      {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                    </select>
                  </div>
                  <button onClick={() => saveAiRestrictions(rDraft.family_member_id)}
                    className="mt-2 w-full py-2.5 rounded-xl bg-purple-600 text-white text-sm font-medium">
                    Guardar {aiPreview.length} restricciones
                  </button>
                </div>
              )}
            </div>

            {/* Manual */}
            <div>
              <label className="text-xs text-gray-500 font-medium">O agregar manualmente</label>
              <input autoFocus={!showAiInput} value={rDraft.tag} onChange={e => setRDraft(d => ({ ...d, tag: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-brand)]"
                placeholder="Ej: mariscos, gluten, lactosa..." />
            </div>

            <div>
              <div className="flex gap-2">
                {[{ v: 'exclude', l: '🚫 Excluir (alergia)' }, { v: 'prefer_avoid', l: '⚠️ Preferir evitar' }].map(o => (
                  <button key={o.v} onClick={() => setRDraft(d => ({ ...d, restriction_type: o.v as 'exclude' | 'prefer_avoid' }))}
                    className={`flex-1 py-2 rounded-lg text-xs border transition-colors ${
                      rDraft.restriction_type === o.v
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand-pale)] text-[var(--color-brand)] font-medium'
                        : 'border-gray-200 text-gray-600'
                    }`}>
                    {o.l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">¿Para quién?</label>
              <select value={rDraft.family_member_id ?? ''} onChange={e => setRDraft(d => ({ ...d, family_member_id: e.target.value || null }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
                <option value="">Toda la familia</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
              </select>
            </div>

            <button disabled={savingR || !rDraft.tag.trim()} onClick={saveRestriction}
              className="w-full py-2.5 rounded-xl bg-[var(--color-brand)] text-white text-sm font-medium disabled:opacity-50">
              {savingR ? 'Guardando…' : 'Agregar restricción'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
