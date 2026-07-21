# Buen Provecho

## Contexto obligatorio
- Lee ARCHITECTURE.md (sistema actual) y PLAN.md (tareas) antes de cualquier cambio.
- Trabajamos tarea por tarea del PLAN.md. Cada tarea termina cuando cumple
  su Criterio de Aceptación (CA), no antes.

## Comandos
- Frontend: `cd frontend && npm run dev` / `npm run build` / `npx oxlint`
- Migraciones: archivos nuevos en `supabase/migrations/` con timestamp `YYYYMMDDNNNNNN_nombre.sql`;
  NUNCA editar migraciones ya aplicadas.

## Reglas de base de datos (PERMANENTES — no negociables)
- **Cero SQL en el editor de Supabase.** Todo cambio de schema entra como migración
  con timestamp en el repo, sin excepciones. Mostrar el SQL completo y esperar
  aprobación antes de aplicar.
- Migraciones idempotentes siempre que sea posible (IF NOT EXISTS, OR REPLACE, DO blocks).
- `supabase/archive/` guarda archivos históricos que no forman parte de la cadena activa.

## Reglas transversales
- Nada de la familia semilla hardcodeado: leer siempre de `families`,
  `dish_slots`, `meal_slots`, `dietary_patterns`.
- Cálculos de porciones/costos solo en SQL o serverless, nunca en el cliente.
- `member_body_data` jamás viaja a los endpoints AI; solo factores numéricos anónimos.
- Salida de IA validada con Zod, no regex. Timeout y fallback manual si la IA falla.
- No toques `.env` ni expongas la service role key.
- Un solo plan canónico: PLAN.md. Si cambia una decisión, se edita ahí en el mismo commit.