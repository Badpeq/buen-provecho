import { create } from 'zustand'

interface ToastMsg { id: number; text: string; type: 'info' | 'ok' | 'err' }

interface ToastStore {
  msgs: ToastMsg[]
  add: (text: string, type?: ToastMsg['type']) => void
  remove: (id: number) => void
}

let _id = 0

export const useToastStore = create<ToastStore>((set) => ({
  msgs: [],
  add: (text, type = 'info') => {
    const id = ++_id
    set(s => ({ msgs: [...s.msgs, { id, text, type }] }))
    setTimeout(() => set(s => ({ msgs: s.msgs.filter(m => m.id !== id) })), 3000)
  },
  remove: (id) => set(s => ({ msgs: s.msgs.filter(m => m.id !== id) })),
}))

export const toast = {
  info: (t: string) => useToastStore.getState().add(t, 'info'),
  ok:   (t: string) => useToastStore.getState().add(t, 'ok'),
  err:  (t: string) => useToastStore.getState().add(t, 'err'),
}

const BG = { info: 'bg-gray-800', ok: 'bg-[var(--color-brand)]', err: 'bg-red-500' }

export function ToastContainer() {
  const { msgs, remove } = useToastStore()
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-72 pointer-events-none">
      {msgs.map(m => (
        <div
          key={m.id}
          className={`${BG[m.type]} text-white text-sm px-4 py-3 rounded-xl shadow-lg
                      pointer-events-auto flex items-center justify-between gap-2
                      animate-[fadeIn_0.15s_ease]`}
        >
          <span>{m.text}</span>
          <button onClick={() => remove(m.id)} className="opacity-60 hover:opacity-100">✕</button>
        </div>
      ))}
    </div>
  )
}
