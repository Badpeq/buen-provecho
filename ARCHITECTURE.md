# Buen Provecho — Arquitectura del Sistema

**Versión evaluada:** julio 2026  
**URL producción:** https://frontend-woad-one-17.vercel.app  
**Repositorio:** https://github.com/Badpeq/buen-provecho

---

## 1. Visión General

Buen Provecho es un planificador de comidas familiar con lista de compras automatizada. Permite planificar el menú semanal por familia, asignar recetas a cada comida del día, y generar automáticamente la lista de supermercado con costos estimados en soles (PEN).

```
┌─────────────────────────────────────────────────────────────┐
│                    NAVEGADOR / MÓVIL                        │
│           React 19 + Vite 8 + Tailwind v4                   │
│           PWA-ready (mobile-first, 390px)                   │
└────────────────────────┬────────────────────────────────────┘
                         │  HTTPS
          ┌──────────────┴──────────────┐
          │                             │
          ▼                             ▼
┌─────────────────┐          ┌──────────────────────┐
│  Vercel (CDN)   │          │  Vercel Serverless   │
│  Static assets  │          │  /api/recipe-ai      │
│  SPA rewrite    │          │  /api/restriction-ai │
└─────────────────┘          └──────────┬───────────┘
                                        │ HTTPS
                                        ▼
                             ┌──────────────────────┐
                             │   Anthropic Claude   │
                             │   (Haiku 4.5)        │
                             └──────────────────────┘

          ┌──────────────────────────────────────────┐
          │            Supabase (cloud)              │
          │  ┌──────────┐  ┌──────────┐  ┌────────┐ │
          │  │ Auth     │  │ PostgREST│  │  PG    │ │
          │  │ Magic    │  │ REST API │  │  RLS   │ │
          │  │ Link     │  │ + RPC    │  │  SQL   │ │
          │  └──────────┘  └──────────┘  └────────┘ │
          └──────────────────────────────────────────┘
```

---

## 2. Stack Tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Frontend framework | React | 19.2 |
| Build tool | Vite | 8.1 |
| CSS | Tailwind CSS | v4 (CSS-first) |
| Routing | React Router DOM | 7.18 |
| Estado global | Zustand + persist | 5.0 |
| Auth & DB | Supabase JS | 2.109 |
| Base de datos | PostgreSQL (Supabase) | 15 |
| AI | Anthropic Claude Haiku | 4.5 |
| Serverless | Vercel Functions (Node.js) | — |
| Deploy | Vercel | — |
| Lenguaje | TypeScript | 6.0 |
| Timezone | America/Lima (UTC-5) | — |

---

## 3. Estructura de Archivos

```
BuenProvecho/
├── frontend/
│   ├── api/                         # Vercel Serverless Functions
│   │   ├── recipe-ai.ts             # POST: genera receta con Claude
│   │   └── restriction-ai.ts        # POST: parsea restricciones con Claude
│   ├── src/
│   │   ├── main.tsx                 # Entry point
│   │   ├── App.tsx                  # Auth gate + routing
│   │   ├── index.css                # Tokens CSS (--color-brand, etc.)
│   │   ├── lib/
│   │   │   ├── supabase.ts          # Cliente Supabase (anon key)
│   │   │   └── date.ts              # Helpers timezone Lima
│   │   ├── hooks/
│   │   │   └── useAuth.ts           # Session listener + loadFamily()
│   │   ├── store/
│   │   │   └── familyStore.ts       # Zustand: family, members, activePlan
│   │   ├── types/
│   │   │   └── database.ts          # Interfaces TypeScript ↔ DB
│   │   ├── components/
│   │   │   ├── layout/AppShell.tsx  # Nav bar inferior + outlet
│   │   │   └── ui/Toast.tsx         # Notificaciones toast
│   │   └── pages/
│   │       ├── Login.tsx            # Magic link email
│   │       ├── Session.tsx          # Ruta /session?at=&rt= (bypass rate limit)
│   │       ├── Hoy.tsx              # Vista diaria con 5 meal slots
│   │       ├── Planificacion.tsx    # Vista semanal 7 días
│   │       ├── Recetas.tsx          # Catálogo CRUD + AI search
│   │       ├── Compras.tsx          # Lista de compras por categoría
│   │       └── Configuracion.tsx    # Familia, horarios, miembros, restricciones
│   ├── vercel.json                  # SPA rewrite (excluye /api/)
│   ├── vite.config.ts
│   └── package.json
└── supabase/
    └── migrations/
        ├── 20260719000001_schema.sql    # 25 tablas
        ├── 20260719000002_rls.sql       # Row Level Security
        ├── 20260719000003_functions.sql # PL/pgSQL: shopping list, porciones
        └── 20260719000004_seed.sql      # Datos de familia demo
```

---

## 4. Modelo de Datos

### 4.1 Diagrama de entidades principales

```
families ──< family_members >── auth.users
    │              │
    │              ├──< member_body_data   (peso, talla, año)
    │              └──< dietary_patterns   (objetivo nutricional)
    │
    ├──< food_restrictions    (exclude / prefer_avoid)
    ├──< meal_slots           (Desayuno, Snack AM, Almuerzo, Snack PM, Cena)
    │         └──< dish_slots (slots por día de semana, day_offsets[])
    │
    ├──< ingredients ──< recipe_ingredients ──< recipes
    │         └──< family_ingredient_prices
    │
    ├──< weekly_plans
    │         ├──< dish_assignments   (block + adhoc)
    │         └──< shopping_lists ──< shopping_list_items
    │
    └──< pantry_inventory
```

### 4.2 Tablas clave

| Tabla | Propósito |
|-------|-----------|
| `families` | Unidad familiar (country, currency, timezone) |
| `family_members` | Personas del hogar (rol, factor de porción) |
| `member_body_data` | Datos corporales privados (peso, talla) |
| `dietary_patterns` | Objetivo nutricional activo por miembro |
| `food_restrictions` | Tags de exclusión/preferencia (familia o miembro) |
| `meal_slots` | 5 comidas del día con `default_time` y `slot_key` |
| `dish_slots` | Slot de receta para N días de la semana (`day_offsets int[]`) |
| `recipes` | Catálogo de platos (con `ingredients_text` para vista rápida) |
| `recipe_ingredients` | Relación receta ↔ ingrediente con cantidad por porción |
| `ingredients` | Ingredientes globales con `category` y `base_unit` |
| `weekly_plans` | Plan semanal (status: draft/planned/active/voting) |
| `dish_assignments` | Asignación receta→slot (block `is_adhoc=false` o adhoc diario) |
| `shopping_lists` | Snapshot de lista de compras por plan |
| `shopping_list_items` | Ítem consolidado con cantidad y costo estimado |
| `pantry_inventory` | Inventario de despensa (usado para deducir de la lista) |

### 4.3 Restricción importante: dish_assignments

```sql
-- weekly_plan_id es NOT NULL en todos los casos
weekly_plan_id UUID NOT NULL REFERENCES weekly_plans(id)

-- CHECK constraint diferencia block vs adhoc:
CHECK (
  (NOT is_adhoc AND dish_slot_id IS NOT NULL
   AND adhoc_date IS NULL AND adhoc_meal_slot_id IS NULL)
  OR
  (is_adhoc AND adhoc_date IS NOT NULL
   AND adhoc_meal_slot_id IS NOT NULL AND dish_slot_id IS NULL)
)
```

Los adhoc también necesitan `weekly_plan_id`. La app detecta el plan que contiene la fecha de hoy buscando `week_start_date ≤ today ≤ week_start_date + 6 días`.

---

## 5. Flujo de Autenticación

```
Usuario → Login.tsx
    │  ingresa email
    ▼
Supabase Auth → envía Magic Link al email
    │
    ▼ (clic en email)
Supabase verifica token → redirect a /
    │
    ▼
useAuth.ts (onAuthStateChange)
    └── SIGNED_IN → loadFamily()
            ├── family_members → familia del usuario
            ├── families → datos de familia
            └── weekly_plans → plan activo
                    → Zustand store (persiste en localStorage 'bp-family')

⚠️ Workaround rate limit (free tier: 4 emails/hora):
    /session?at=ACCESS_TOKEN&rt=REFRESH_TOKEN
    → supabase.auth.setSession({ access_token, refresh_token })
    → redirect a /
```

---

## 6. Flujo de Planificación Semanal

```
weekly_plans (week_start_date = Martes)
    │
    ├── dish_slots [meal_slot_id, day_offsets[0..6]]
    │       offset 0 = Martes ... offset 6 = Lunes
    │
    └── dish_assignments
            ├── is_adhoc = false → vinculado a dish_slot (bloque semanal)
            └── is_adhoc = true  → adhoc_date + adhoc_meal_slot_id (override diario)

Prioridad en Hoy.tsx:
  1. Adhoc del día (si existe) → sobreescribe el bloque semanal
  2. Asignación de bloque del día (del plan activo)
  3. Sin plato asignado
```

---

## 7. Generación de Lista de Compras

```sql
-- Función PL/pgSQL en Supabase:
generate_shopping_list_snapshot(p_weekly_plan_id, p_deduction_mode)
    │
    ├── compute_shopping_list(plan_id, 'net')
    │       ├── Para cada receta asignada en el plan:
    │       │     quantity = recipe_ingredient.quantity_per_portion
    │       │              × SUM(portion_factor de asistentes)
    │       │              × dietary_pattern.portion_multiplier
    │       ├── Agrupa por display_ingredient_id (alias regional)
    │       └── Deduce pantry_inventory si deduction_mode = 'net'
    │
    └── INSERT INTO shopping_lists (ON CONFLICT DO NOTHING)
        INSERT INTO shopping_list_items

-- Constraints:
-- shopping_lists tiene UNIQUE(weekly_plan_id) → 1 lista por plan
```

**Categorías de compra** (mapeadas desde `ingredients.category` en inglés):

| DB value | Visual |
|----------|--------|
| `vegetable` | 🥬 Verduras |
| `fruit` / `citrus` | 🍎 Frutas |
| `protein` / `meat` / `poultry` | 🥩 Carnes |
| `fish` / `seafood` | 🐟 Pescados |
| `dairy` | 🥛 Lácteos |
| `egg` | 🥚 Huevos |
| `grain` | 🌾 Granos |
| `legume` | 🫘 Legumbres |
| `seed` / `nut` | 🌰 Semillas |
| `oil` | 🫒 Aceites |
| `spice` / `herb` / `condiment` | 🧂 Condimentos |

---

## 8. Seguridad (Row Level Security)

Todas las tablas tienen RLS activado. El patrón base:

```sql
-- Funciones helper SECURITY DEFINER (evitan recursión RLS):
get_user_family_ids() → UUID[]   -- familias del usuario actual
get_family_role(family_id) → TEXT -- rol en esa familia

-- Políticas genéricas:
SELECT: family_id = ANY(get_user_family_ids())
INSERT: get_family_role(family_id) = 'owner'  [tablas de config]
        family_id = ANY(get_user_family_ids()) [tablas de datos]

-- member_body_data: política estricta
-- Solo el propio usuario (user_id = auth.uid()) o el owner pueden leer
```

**Roles de familia:** `owner`, `adult`, `member`, `support_staff`, `guest`

---

## 9. Funciones AI (Vercel Serverless)

### `/api/recipe-ai` — Generación de recetas

```
POST /api/recipe-ai
{ query: "Lomo saltado", restrictions?: ["mariscos", "gluten"] }

→ Claude Haiku 4.5 (512 tokens)
→ { name, description, meal_type, tags[], ingredients_text }

Variables de entorno Vercel: ANTHROPIC_API_KEY
```

### `/api/restriction-ai` — Parseo de restricciones

```
POST /api/restriction-ai
{ text: "Soy alérgico a los mariscos, no me gusta el brócoli" }

→ Claude Haiku 4.5 (512 tokens)
→ { restrictions: [{ tag, type: 'exclude'|'prefer_avoid', reason }] }
```

Ambas funciones retornan JSON estructurado extraído con regex del output del modelo.

---

## 10. Estado Global (Zustand)

```typescript
FamilyState {
  currentFamily:  Family | null       // datos de la familia
  members:        FamilyMember[]      // miembros del hogar
  activePlan:     WeeklyPlan | null   // plan semanal más reciente

  loadFamily()   // carga los 3 recursos en paralelo al login
  reset()        // limpia todo al hacer logout
}

// Persistido en localStorage con key 'bp-family'
// Permite que la app cargue sin re-fetch en visitas subsiguientes
```

---

## 11. Navegación (5 tabs)

| Ruta | Página | Función principal |
|------|--------|-------------------|
| `/` | Hoy | Ver y asignar platos del día actual |
| `/planificacion` | Planificación | Menú semanal 7 días, crear próxima semana |
| `/compras` | Compras | Lista de supermercado por categoría |
| `/recetas` | Recetas | Catálogo CRUD + búsqueda con AI |
| `/configuracion` | Configuración | Familia, horarios, miembros, restricciones |

Ruta especial: `/session?at=&rt=` → login sin email (bypass rate limit).

---

## 12. Variables de Entorno

| Variable | Dónde | Propósito |
|----------|-------|-----------|
| `VITE_SUPABASE_URL` | Vercel (frontend) | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Vercel (frontend) | Clave pública RLS |
| `ANTHROPIC_API_KEY` | Vercel (serverless) | Claude API para AI features |

La service role key de Supabase **nunca** se expone al frontend. Solo se usa en scripts de migración locales (gitignoreados).

---

## 13. Características Implementadas

| # | Feature | Estado |
|---|---------|--------|
| 1 | Auth por magic link (Supabase) | ✅ |
| 2 | Vista diaria con 5 meal slots | ✅ |
| 3 | Asignación adhoc de recetas por día | ✅ |
| 4 | Planificación semanal (Martes–Lunes) | ✅ |
| 5 | Bloque compartido (mismo almuerzo varios días) | ✅ |
| 6 | Catálogo de recetas CRUD | ✅ |
| 7 | Generación de receta con IA (Claude Haiku) | ✅ |
| 8 | Lista de compras automática (PL/pgSQL) | ✅ |
| 9 | Compras agrupadas por categoría con acordeón | ✅ |
| 10 | Exportar lista por WhatsApp | ✅ |
| 11 | Perfil de salud por miembro (objetivo, medidas) | ✅ |
| 12 | Restricciones alimentarias con IA (lenguaje natural) | ✅ |
| 13 | Horarios de comida personalizables | ✅ |
| 14 | Timezone correcto (America/Lima) | ✅ |
| 15 | Deploy en Vercel (SPA + serverless) | ✅ |

---

## 14. Limitaciones y Deuda Técnica

| Área | Situación | Impacto |
|------|-----------|---------|
| **Consumo de platos** | `consumption_log` requiere `dish_assignment_id NOT NULL` — incompatible con el flujo actual de mark-as-consumed. El toggle es solo estado local (no persiste). | Medio |
| **Categorías de compra** | Dependen de `ingredients.category` en inglés en la DB. Nuevos ingredientes deben seguir el mismo vocabulario. | Bajo |
| **Snacks en planificación** | La vista semanal solo muestra Desayuno/Almuerzo/Cena (SLOT_KEYS_SHOWN). Snacks están en DB pero se ocultan por espacio. | Bajo |
| **Email rate limit** | Free tier Supabase: 4 magic links/hora. Workaround `/session` con tokens manuales implementado. Solución definitiva: SMTP propio (Resend). | Alto en producción |
| **Sin multi-familia** | `loadFamily()` toma solo la primera membresía. Si un usuario pertenece a varias familias, solo ve una. | Medio |
| **RLS para dietary_patterns** | Solo el `owner` puede escribir. Si un adulto quiere editar su propio perfil, falla silenciosamente. | Medio |
| **Tipos DB sin codegen** | El cliente Supabase no tiene el generic `Database<>`. Los tipos se anotan manualmente en cada query. | Bajo |
| **pg y @vercel/node en dependencies** | Deben estar en `devDependencies` o en un workspace separado. Actualmente bultan el bundle de la app. | Bajo |
| **Despensa no implementada** | `pantry_inventory` existe en DB y se usa en `compute_shopping_list`, pero la UI de gestión de despensa está pendiente. | Medio |

---

## 15. Roadmap Sugerido

```
Próximas iteraciones (por impacto):

[ALTA]  SMTP Resend → eliminar rate limit de auth
[ALTA]  Gestión de despensa → deducción automática en lista de compras
[ALTA]  consumption_log rework → simplificar schema para permitir mark-as-consumed
[MEDIA] Votación semanal (vote_polls, vote_options, votes están en DB)
[MEDIA] Notificaciones push (horario de comidas)
[MEDIA] Multi-familia por usuario
[MEDIA] Ingredientes con precio → actualización desde compras reales
[BAJA]  supabase gen types → tipado fuerte del cliente
[BAJA]  Separar pg/@vercel/node a workspace/devDependencies
[BAJA]  Mostrar snacks en vista semanal (acordeón colapsable)
```
