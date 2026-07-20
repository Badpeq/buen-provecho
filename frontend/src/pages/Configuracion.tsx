import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFamilyStore } from '../store/familyStore'
import { toast } from '../components/ui/Toast'
import type { FamilyMember, DietaryPattern, FoodRestriction } from '../types/database'

const ROLES = [
  { value: 'owner',         label: 'Propietario' },
  { value: 'adult',         label: 'Adulto' },
  { value: 'member',        label: 'Miembro' },
  { value: 'support_staff', label: 'Personal de apoyo' },
  { value: 'guest',         label: 'Invitado' },
] as const
type RoleValue = typeof ROLES[number]['value']

const PORTION_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

interface MemberDraft {
  id?:            string
  display_name:   string
  role:           RoleValue
  portion_factor: number
}

interface RestrictionDraft {
  tag:              string
  restriction_type: 'exclude' | 'prefer_avoid'
  family_member_id: string | null
}

export default function Configuracion() {
  const { currentFamily, members, setMembers, setFamily } = useFamilyStore()
  const [patterns,       setPatterns]       = useState<DietaryPattern[]>([])
  const [restrictions,   setRestrictions]   = useState<FoodRestriction[]>([])
  const [loading,        setLoading]        = useState(true)

  // Editar familia
  const [editFamily,     setEditFamily]     = useState(false)
  const [familyName,     setFamilyName]     = useState('')
  const [savingFamily,   setSavingFamily]   = useState(false)

  // Agregar / editar miembro
  const [memberModal,    setMemberModal]    = useState(false)
  const [memberDraft,    setMemberDraft]    = useState<MemberDraft>({ display_name: '', role: 'member', portion_factor: 1 })
  const [savingMember,   setSavingMember]   = useState(false)
  const [deletingMember, setDeletingMember] = useState(false)

  // Agregar restricción
  const [restrictModal,  setRestrictModal]  = useState(false)
  const [rDraft,         setRDraft]         = useState<RestrictionDraft>({ tag: '', restriction_type: 'exclude', family_member_id: null })
  const [savingR,        setSavingR]        = useState(false)

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

  // ── Familia ──
  async function saveFamily() {
    if (!familyName.trim() || !currentFamily) return
    setSavingFamily(true)
    const { error } = await supabase.from('families')
      .update({ name: familyName.trim() }).eq('id', currentFamily.id)
    setSavingFamily(false)
    if (error) { toast.err('Error al guardar'); return }
    setFamily({ ...currentFamily, name: familyName.trim() })
    setEditFamily(false)
    toast.ok('Familia actualizada ✓')
  }

  // ── Miembro ──
  function openAddMember() {
    setMemberDraft({ display_name: '', role: 'member', portion_factor: 1 })
    setMemberModal(true)
  }
  function openEditMember(m: FamilyMember) {
    setMemberDraft({ id: m.id, display_name: m.display_name, role: m.role as RoleValue, portion_factor: m.portion_factor })
    setMemberModal(true)
  }

  async function saveMember() {
    if (!memberDraft.display_name.trim() || !currentFamily) return
    setSavingMember(true)

    if (memberDraft.id) {
      const { error } = await supabase.from('family_members')
        .update({ display_name: memberDraft.display_name.trim(), role: memberDraft.role, portion_factor: memberDraft.portion_factor })
        .eq('id', memberDraft.id)
      setSavingMember(false)
      if (error) { toast.err('Error al guardar'); return }
      setMembers(members.map(m => m.id === memberDraft.id
        ? { ...m, display_name: memberDraft.display_name.trim(), role: memberDraft.role, portion_factor: memberDraft.portion_factor }
        : m
      ))
      toast.ok(`${memberDraft.display_name} actualizado ✓`)
    } else {
      const { data, error } = await supabase.from('family_members')
        .insert({ family_id: currentFamily.id, display_name: memberDraft.display_name.trim(), role: memberDraft.role, portion_factor: memberDraft.portion_factor })
        .select().single()
      setSavingMember(false)
      if (error || !data) { toast.err('Error al agregar'); return }
      setMembers([...members, data as FamilyMember])
      toast.ok(`${memberDraft.display_name} agregado ✓`)
    }
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

  // ── Restricciones ──
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

  async function deleteRestriction(id: string) {
    await supabase.from('food_restrictions').delete().eq('id', id)
    setRestrictions(restrictions.filter(r => r.id !== id))
    toast.info('Restricción eliminada')
  }

  if (!currentFamily) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <span className="text-4xl">⚙️</span>
        <p className="text-gray-500">No perteneces a ninguna familia aún.</p>
        <button
          className="px-4 py-2 rounded-xl bg-[var(--color-brand)] text-white text-sm font-medium"
          onClick={() => toast.info('Crear familia — próximamente')}
        >
          Crear familia
        </button>
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
              <input
                autoFocus
                value={familyName}
                onChange={e => setFamilyName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-brand)]"
                placeholder="Nombre de la familia"
              />
              <div className="flex gap-2">
                <button
                  disabled={savingFamily}
                  onClick={saveFamily}
                  className="flex-1 py-2 rounded-lg bg-[var(--color-brand)] text-white text-sm font-medium disabled:opacity-50"
                >
                  {savingFamily ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  onClick={() => { setEditFamily(false); setFamilyName(currentFamily.name) }}
                  className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-500"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="font-bold text-gray-800">{currentFamily.name}</p>
              <p className="text-sm text-gray-500 mt-1">
                {currentFamily.country_code} · {currentFamily.currency_code} · {currentFamily.timezone}
              </p>
              <button
                className="mt-3 text-xs text-[var(--color-brand)] underline"
                onClick={() => setEditFamily(true)}
              >
                Editar nombre
              </button>
            </>
          )}
        </div>
      </section>

      {/* ── Miembros ── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Miembros</h2>
          <button
            className="text-xs px-2 py-1 rounded-lg bg-[var(--color-brand-pale)] text-[var(--color-brand)]"
            onClick={openAddMember}
          >
            + Agregar
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />)}
          </div>
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
                        {ROLES.find(r => r.value === m.role)?.label ?? m.role}
                        {' · '}Porción ×{m.portion_factor}
                      </p>
                    </div>
                    <button
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-[var(--color-brand)] transition-colors"
                      onClick={() => openEditMember(m)}
                    >
                      ✏️
                    </button>
                  </div>
                  {pattern && (
                    <div className="mt-2 flex gap-2 flex-wrap">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">{pattern.label}</span>
                      {pattern.carb_multiplier !== 1 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">
                          Carbohidratos ×{pattern.carb_multiplier}
                        </span>
                      )}
                      {pattern.portion_multiplier !== 1 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">
                          Porción ×{pattern.portion_multiplier}
                        </span>
                      )}
                      {pattern.require_snacks && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-pink-50 text-pink-600">Snacks obligatorios</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Restricciones ── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Restricciones</h2>
          <button
            className="text-xs px-2 py-1 rounded-lg bg-[var(--color-brand-pale)] text-[var(--color-brand)]"
            onClick={() => { setRDraft({ tag: '', restriction_type: 'exclude', family_member_id: null }); setRestrictModal(true) }}
          >
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
                <button
                  onClick={() => deleteRestriction(r.id)}
                  className="ml-1 text-red-300 hover:text-red-600 text-xs leading-none"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Cerrar sesión ── */}
      <section className="pt-4 border-t border-gray-100">
        <button
          onClick={async () => { await supabase.auth.signOut(); useFamilyStore.getState().reset() }}
          className="w-full py-3 rounded-xl border border-gray-200 text-sm text-gray-500 hover:border-red-200 hover:text-red-500 transition-colors"
        >
          Cerrar sesión
        </button>
      </section>

      {/* ── Modal: agregar / editar miembro ── */}
      {memberModal && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setMemberModal(false)}>
          <div className="w-full bg-white rounded-t-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">{memberDraft.id ? 'Editar miembro' : 'Agregar miembro'}</h2>
              <button className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500" onClick={() => setMemberModal(false)}>✕</button>
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">Nombre</label>
              <input
                autoFocus
                value={memberDraft.display_name}
                onChange={e => setMemberDraft(d => ({ ...d, display_name: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-brand)]"
                placeholder="Ej: Mamá, Papá, Ana..."
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">Rol</label>
              <select
                value={memberDraft.role}
                onChange={e => setMemberDraft(d => ({ ...d, role: e.target.value as RoleValue }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[var(--color-brand)]"
              >
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">Factor de porción</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {PORTION_OPTIONS.map(v => (
                  <button
                    key={v}
                    onClick={() => setMemberDraft(d => ({ ...d, portion_factor: v }))}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      memberDraft.portion_factor === v
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand-pale)] text-[var(--color-brand)] font-medium'
                        : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    ×{v}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              {memberDraft.id && (
                <button
                  disabled={deletingMember}
                  onClick={deleteMember}
                  className="px-4 py-2.5 rounded-xl border border-red-200 text-red-500 text-sm disabled:opacity-50"
                >
                  {deletingMember ? '…' : 'Eliminar'}
                </button>
              )}
              <button
                disabled={savingMember || !memberDraft.display_name.trim()}
                onClick={saveMember}
                className="flex-1 py-2.5 rounded-xl bg-[var(--color-brand)] text-white text-sm font-medium disabled:opacity-50"
              >
                {savingMember ? 'Guardando…' : memberDraft.id ? 'Guardar cambios' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: agregar restricción ── */}
      {restrictModal && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setRestrictModal(false)}>
          <div className="w-full bg-white rounded-t-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">Agregar restricción</h2>
              <button className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500" onClick={() => setRestrictModal(false)}>✕</button>
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">Alimento o ingrediente</label>
              <input
                autoFocus
                value={rDraft.tag}
                onChange={e => setRDraft(d => ({ ...d, tag: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-brand)]"
                placeholder="Ej: mariscos, gluten, lactosa..."
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">Tipo</label>
              <div className="mt-1 flex gap-2">
                {[{ v: 'exclude', l: '🚫 Excluir (alergia)' }, { v: 'prefer_avoid', l: '⚠️ Preferir evitar' }].map(o => (
                  <button
                    key={o.v}
                    onClick={() => setRDraft(d => ({ ...d, restriction_type: o.v as 'exclude' | 'prefer_avoid' }))}
                    className={`flex-1 py-2 rounded-lg text-xs border transition-colors ${
                      rDraft.restriction_type === o.v
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand-pale)] text-[var(--color-brand)] font-medium'
                        : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium">¿Para quién?</label>
              <select
                value={rDraft.family_member_id ?? ''}
                onChange={e => setRDraft(d => ({ ...d, family_member_id: e.target.value || null }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[var(--color-brand)]"
              >
                <option value="">Toda la familia</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
              </select>
            </div>

            <button
              disabled={savingR || !rDraft.tag.trim()}
              onClick={saveRestriction}
              className="w-full py-2.5 rounded-xl bg-[var(--color-brand)] text-white text-sm font-medium disabled:opacity-50"
            >
              {savingR ? 'Guardando…' : 'Agregar restricción'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
