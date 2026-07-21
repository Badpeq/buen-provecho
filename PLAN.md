# PLAN.md — Buen Provecho · plan canónico (v3)

> **Este es el ÚNICO plan válido del proyecto.** Reemplaza y anula "PLAN v2.md", "PLAN V3.md" y cualquier versión anterior — si esos archivos existen en el repo, elimínalos. Referencia técnica del sistema: ARCHITECTURE.md. Estado verificado contra el repo real (Badpeq/buen-provecho) al 20-jul-2026.

**Cómo usar este documento con Claude Code:** una tarea por sesión, siempre en modo plan primero, commit por tarea con el código de la tarea en el mensaje (`feat(F1): ...`), y la tarea termina cuando cumple su **CA** (criterio de aceptación), no antes. Las migraciones SQL se muestran completas y se aprueban antes de aplicarse.

---

## 1 · FLUJO DE VALOR Y MÉTRICAS (la brújula de todo el plan)

**Flujo principal:** Domingo → elegir los platos de la semana (personalizados a la familia) → presupuesto visible en vivo → lista de compras → WhatsApp → semana resuelta.
**Promesa (guía de toda decisión de UI):** *"Elige tus platos el domingo. Tu semana y tu lista de compras con presupuesto, listas."* (Con el preset de la familia semilla: 4 platos.)
**Métricas:** semanas consecutivas con ciclo completo (norte) · minutos de app-abierta a lista-en-WhatsApp (fricción, objetivo < 10) · % de usuarios nuevos que llegan a su primera lista (activación).
**Regla de oro entre sprints:** si el ciclo domingo→lista se rompe una semana, la prioridad es arreglar esa fricción, no avanzar de fase.

---

## 2 · ESTADO REAL VERIFICADO (20-jul-2026)

**Implementado y en producción (sprints 1-2):**
índice contextual (App.tsx) · presupuesto en vivo (`rpc estimate_plan_cost` + footer) · CTA lista + WhatsApp (`lib/whatsapp.ts`) · recomendados por slot · `family_context` en `/api/recipe-ai` · matcher de ingredientes (`lib/ingredientMatcher.ts`) → `recipe_ingredients` + `needs_price` · porciones por persona en Hoy · guardrail de restricciones · sugerir semana (`/api/week-ai`) · timezone y horarios personalizados · catálogo 32 platos.

**Problemas de estado detectados (bloquean el avance):**
- **Drift SQL:** el frontend llama `estimate_plan_cost` y usa `needs_price`, pero NINGUNA migración del repo los define — se aplicaron a mano en el editor de Supabase. El repo ya no describe la base real. Además existe `supabase/migrations/APPLY_FIRST_schema_rls_functions.sql` sin timestamp (no es una migración válida).
- **Bug del índice contextual:** `hasNoPlan = !activePlan` usa el plan más reciente; con un plan viejo presente pero la semana entrante vacía, no redirige.
- **Sin tests:** ni unitarios ni E2E; el guardrail de restricciones no tiene test automatizado.
- **Verificaciones de CA pendientes de sprints 1-2:** consumo persistente con 2 usuarios simultáneos · edición de perfil con cuenta no-owner · 20 generaciones IA sin ingrediente excluido · receta IA dentro del presupuesto · cronometrar el ciclo completo.

**No iniciado:** todo lo que sigue (R0 en adelante).

---

## 3 · R0 — RECONCILIACIÓN (obligatoria antes de cualquier otra tarea)

**Objetivo:** que `supabase/migrations/` vuelva a ser la verdad de la base de datos. Sin esto, la migración F1 (que altera `dish_assignments` con backfill) se ejecutaría sobre un estado desconocido.
**Pasos:**
1. `supabase db dump -f estado_real.sql` (foto de la base en producción) y backup completo del proyecto.
2. Claude Code compara `estado_real.sql` contra las 4 migraciones del repo y genera **una** migración nueva con timestamp que capture todo lo aplicado a mano: `estimate_plan_cost`, `needs_price`, el rework de `consumption_log`, las políticas RLS corregidas y cualquier otra diferencia encontrada.
3. Eliminar `APPLY_FIRST_schema_rls_functions.sql` de `migrations/` (archivarlo fuera si se quiere conservar).
4. Verificación: aplicar las migraciones del repo sobre una base vacía local (`supabase db reset`) debe producir un schema idéntico al dump (diff limpio).
**CA:** `supabase db reset` local ≡ producción; cero archivos sin timestamp en `migrations/`.
**Nueva regla permanente (añadir a CLAUDE.md):** *ningún cambio SQL se aplica en el editor de Supabase; todo cambio de base entra como migración con timestamp en el repo, sin excepciones.*

---

## 4 · SPRINT 3 — TARGETING + BLOQUES FLEXIBLES

> Diagnóstico que motiva este sprint: la regla de negocio es "eliges los platos de la semana, no uno por día obligatorio", pero la UI muestra una grilla de 21 celdas y 5 tabs de igual peso. El patrón de los referentes (Jow, Mealime): la app entera es un embudo hacia una sola acción, la promesa se declara antes del login y la personalización se captura en 3 preguntas. Además, el nuevo requisito de flexibilidad: **un plato por día, con opción de cocinar un mismo plato para más días.**

**Orden dentro del sprint: F1 → T3 → F2 → T5 → T4 → T1 → T2 → F3 → F4 → T6 → T7.** (F1 antes que T3 para no construir la pantalla dos veces.)

### F1 · Schema de bloques flexibles
**Objetivo:** la unidad de planificación pasa de "slot fijo" a "bloque dinámico de días"; el patrón de 4 platos de 2 días queda como preset de la familia semilla.
**Cambios (migración):** (a) `recipes` + `batch_friendly boolean default true` y `max_batch_days smallint default 2` ("este plato rinde/aguanta N días": estofado sí; ensalada fresca → `false`/1). (b) `dish_assignments` + `day_offsets smallint[]` propio; `dish_slot_id` pasa a nullable (queda como plantilla del preset). (c) Constraint/trigger: dentro de un mismo plan + meal_slot, los `day_offsets` no se solapan. (d) Backfill: asignaciones existentes copian los `day_offsets` de su slot. (e) `dish_slots` se reinterpreta como preset de bloques sugeridos (lo usan Sugerir semana y el onboarding), no estructura obligatoria.
**CA:** una semana admite 7 platos de 1 día, el preset 2-2-2-1, o mezcla sin solaparse; los planes históricos renderizan igual tras el backfill; migración probada primero en base local (R0 lo hace posible).

### T3 · Planificación = tarjetas de bloque, no grilla
**Objetivo:** que la pantalla principal encarne el concepto del producto.
**Cambios:** `Planificacion.tsx` en dos niveles. **Nivel 1 (default):** una tarjeta grande por bloque de la semana (con el preset semilla: exactamente 4 tarjetas — mar-mié, jue-vie, sáb-dom, lun con tag menestra), cada una con emoji/nombre + días que cubre o "Por elegir"; tocar abre el picker con Recomendados arriba; footer permanente: presupuesto en vivo + CTA "📲 Lista y WhatsApp" + "✨ Sugerir semana". **Nivel 2 ("Ver semana completa", colapsado):** la grilla actual con desayunos/cenas y adhoc. **Incluye el fix del bug del índice contextual:** la condición pasa a ser "no existe plan que cubra la próxima semana o tiene bloques sin asignar".
**CA:** en viewport de 390 px el nivel 1 completo se ve con máximo un scroll; el flujo del domingo se completa sin abrir la grilla; el redirect dispara con plan viejo presente y semana entrante vacía.

### F2 · Asignación con extensión de días
**Objetivo:** el gesto central: elijo un plato para un día y decido cuántos días cubre.
**Cambios:** en el picker, tras elegir receta: selector "Cocinar para: 1 · 2 · 3 días", pre-seleccionado con `min(max_batch_days, días libres consecutivos)`; si `batch_friendly=false`, fijo en 1 con nota "mejor recién hecho". Extender fusiona tarjetas; reducir divide y deja "Por elegir" en los días liberados. En Configuración: editor del preset de bloques ("¿cómo suelen cocinar?": por día / bloques de 2 / mixto).
**CA:** asignar "Estofado" al martes y extender a 2 días → una tarjeta mar-mié; reducir a 1 → miércoles "Por elegir"; una ensalada no ofrece extensión.

### T5 · Estados vacíos que empujan al embudo
**Cambios:** `Hoy.tsx` sin plan → "Tu semana no está planificada" + botón grande "✨ Sugerir mi semana"; `Compras.tsx` sin lista → "Primero elige tus platos" + botón a Semana; picker sin recetas → "Genera una con IA" con el query del bloque pre-cargado.
**CA:** desde cualquier pantalla vacía se llega al flujo principal en un tap; cero mensajes terminales sin acción.

### T4 · Navegación: 3 tabs
**Cambios:** `AppShell.tsx`: tabs visibles = **Semana · Hoy · Compras**; Recetas y Configuración a un menú "⋯". Rutas intactas (deep links siguen funcionando).
**CA:** las 3 acciones del flujo a un tap; Recetas accesible en dos.

### T1 · La promesa en el Login
**Cambios:** `Login.tsx`: reemplazar "Planificación familiar de comidas" por la promesa + 3 micro-bullets de outcome (5 minutos el domingo · presupuesto antes de comprar · lista directa a WhatsApp). Una pantalla, una promesa, un input.
**CA:** alguien que no conoce la app lee el login y explica el producto mencionando la mecánica de elegir platos para la semana.

### T2 · Onboarding de 3 preguntas → primera semana sugerida
**Cambios:** ruta `/onboarding` (post-primer-login sin familia): (1) ¿cuántos comen y qué días? → crea `families`/`family_members`/asistencia con preset PE; (2) ¿restricciones o alergias? → texto libre a `/api/restriction-ai` → `food_restrictions`; (3) ¿objetivo especial de alguien? → chips (bajar de peso / lactancia / ninguno / otro) → `dietary_patterns`; final: "✨ Sugerir mi primera semana" → aterriza en T3 con bloques pre-llenados y presupuesto visible. Datos corporales NO se piden aquí (opcionales en Configuración).
**CA:** un correo nuevo pasa de login a semana sugerida con presupuesto en < 3 minutos sin tocar Configuración.

### F3 · IA y recomendados conscientes del rendimiento
**Cambios:** `/api/week-ai` y los recomendados reciben el preset de bloques y `max_batch_days`: bloques largos solo con recetas `batch_friendly`; `/api/recipe-ai` clasifica `batch_friendly`/`max_batch_days` en cada receta generada, con el guardrail validando coherencia.
**CA:** Sugerir semana nunca coloca un plato de 1 día en un bloque de 2; las recetas IA llegan con rendimiento clasificado.

### F4 · Motor de cálculo sobre bloques
**Cambios:** `compute_shopping_list` y `estimate_plan_cost` iteran los `day_offsets` de cada asignación (porciones = Σ asistentes de **cada día** cubierto); `Hoy.tsx` resuelve el plato del día por pertenencia del offset al bloque; `consumption_log` y la futura deducción de despensa descuentan por día consumido, no por bloque.
**CA:** un bloque de 2 días con cocinera solo el primer día compra porciones distintas por día; presupuesto en vivo ≡ lista generada al centavo.

### T6 · Instrumentación mínima del embudo
**Cambios:** tabla `events` (family_id, user_id, name, props jsonb, created_at) + helper `track()`: `onboarding_done`, `week_suggested`, `week_completed`, `list_generated`, `list_shared`. Sin herramientas externas; un query SQL responde las métricas.
**CA:** query que responde: ¿cuántas semanas completaron el ciclo este mes y en cuántos minutos promedio?

### T7 · Tests del embudo (deuda incluida)
**Cambios:** Playwright E2E: login semilla → onboarding (cuenta nueva) → sugerir → lista → texto WhatsApp; Vitest: guardrail (receta con `seafood` inyectada nunca se guarda en familia que lo excluye) y matcher de ingredientes. Correr en CI como smoke test permanente. Aprovechar para cerrar las verificaciones de CA pendientes de sprints 1-2 (§2).
**CA:** ambos suites en verde en CI; las 5 verificaciones pendientes documentadas como pasadas o convertidas en issues.

---

## 5 · CHECKPOINT DE VALIDACIÓN (1-2 semanas de uso real)

Mostrar la app a 2-3 familias ajenas y medir con T6: ¿completan onboarding→lista? ¿en cuántos minutos? ¿qué pantalla los frena? **Criterio de salida:** el revisor externo, sin explicación previa, describe el producto con la mecánica de elegir platos para la semana — ese día el targeting dejó de estar en los documentos y pasó a estar en la pantalla. Registrar las respuestas antes de decidir el siguiente sprint.

---

## 6 · SPRINT 4 — DESPENSA (solo si el checkpoint muestra ciclo semanal sostenido)

**D1 · UI de `pantry_inventory`:** sección Despensa en Compras: listar/ajustar cantidades en `base_unit`, alta rápida por búsqueda. CA: ajustar "arroz 1 kg" y regenerar reduce lo pedido.
**D2 · Ciclo de reposición:** comprado → suma a despensa; consumo confirmado → descuenta según `recipe_ingredients` × porciones del día; selector `deduction_mode` (`net` default / `none`) al generar. La despensa es estimación con ajuste en un toque, no inventario contable. CA: semana 1 compra 1 kg y usa 600 g → semana 2 pide el faltante.

## 7 · SPRINT 5 — HÁBITO Y COLABORACIÓN (por demanda real)

**H1 · SMTP Resend + eliminar `/session` (SEGURIDAD, primera del sprint — adelantar si se comparte la URL con terceros):** la ruta `/session?at=&rt=` acepta tokens por querystring que quedan en historiales y logs. CA: 10 logins sin rate limit; `/session` fuera del router.
**H2 · Notificaciones:** Web Push + cron según `families.timezone` y `meal_slots.default_time` (cierre 9 PM con cena de mañana e ingrediente a alistar, buenos días 6 AM, día de planificación). Preferencias por usuario. CA: las 3 llegan a hora local con contenido del plan real.
**H3 · Votación (cuando haya ≥ 2 votantes activos):** UI sobre `vote_polls/vote_options/votes`; opciones = recomendados + propuestas de miembros; Realtime; cierre antes del CTA de lista; empate decide owner; voto secreto hasta el cierre (lectura agregada `SECURITY DEFINER`). CA: dos dispositivos votan y el ganador queda asignado al bloque.
**H4 · Multi-familia (cuando alguien lo pida):** `loadFamilies()` + selector de familia activa persistido + invitaciones por código. CA: usuario en dos familias alterna y cada una ve solo lo suyo (RLS ya lo garantiza).

---

## 8 · REGLAS PERMANENTES (copiar a CLAUDE.md)

1. Ningún cambio SQL en el editor de Supabase: todo entra como migración con timestamp en el repo, sin excepciones; mostrar el SQL antes de aplicar.
2. Nada de la familia semilla hardcodeado: leer siempre de `families`, `dish_slots`, `meal_slots`, `dietary_patterns`; moneda con `Intl.NumberFormat` + `families.currency_code`.
3. Cálculos de porciones/costos solo en SQL o serverless (fuente única: `compute_shopping_list` y derivados); el frontend presenta.
4. `member_body_data` jamás viaja a los endpoints AI; solo factores numéricos anónimos.
5. Salida de IA validada con Zod; timeout y fallback manual si la IA falla.
6. Un solo plan (este archivo). Si una decisión cambia el plan, se edita PLAN.md en el mismo commit — nunca se crea "PLAN v4.md".
7. Una tarea por sesión, un commit por tarea, cada tarea con su test y cerrada solo por su CA.
