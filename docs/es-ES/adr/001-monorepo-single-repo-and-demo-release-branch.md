# ADR-001: Monorepo único con pnpm + Nx y rama de regresión aislada para demostración

- **Estado:** Aceptado
- **Fecha:** 2026-11-01

## Contexto

ZeroMTTR combina cuatro aplicaciones (`orchestrator`, `mcp-server`, `dashboard` y `target-app-demo`), dos bibliotecas compartidas (`libs/contracts` y `libs/utils`) y la pila local de observabilidad (`infra/`). Además, la demostración en vivo requiere un escenario de regresión reproducible en `target-app-demo` para generar Pull Requests de hotfix reales en GitHub sin comprometer la integridad de la rama principal.

## Decisión

1. Adoptar un **monorepo único** gestionado con **pnpm workspaces** y **Nx**, centralizando los contratos compartidos (`@zeromttr/contracts`), las utilidades puras (`@zeromttr/utils`), lint, typecheck, pruebas y compilación en una única tubería (`pnpm run check:workspace`).
2. Mantener la **rama `master` siempre verde y saludable** (etiquetada como **`v2.14.7`**).
3. Aislar la regresión controlada de agotamiento del pool de conexiones (`KnexTimeoutError`) en la rama **`release/target-v2.14.8`** (etiquetada como **`v2.14.8`**), utilizada como base para el diff real `v2.14.7...v2.14.8` y como destino para las Pull Requests autónomas de hotfix validadas por `.github/workflows/hotfix-verify.yml`.

## Consecuencias

### Positivas

- Los contratos tipados (`@zeromttr/contracts`) evitan desviaciones entre `orchestrator`, `mcp-server` y `dashboard`.
- Cualquier evaluador puede ejecutar todo el ecosistema con un único `git clone` y `docker compose up -d`.
- Las Pull Requests de demostración nunca contaminan ni rompen la rama `master`.

### Compromisos

- Requiere disciplina de protección de rama (`master`) y protección de etiquetas (`v2.14.*`) en GitHub.
- El flujo de despliegue en VPS debe restringir los disparadores exclusivamente a etiquetas `v1.*.*` o `workflow_dispatch`, ignorando las etiquetas `v2.14.*`.

## Alternativas descartadas

- **Múltiples repositorios (polyrepo):** aumentaría la fricción de versionado de contratos y complicaría la reproducción local en un entorno limpio.
- **Inyectar el error directamente en `master`:** rompería la CI de la rama principal y vulneraría las buenas prácticas de ingeniería.

## Referencias de código

- `nx.json`, `pnpm-workspace.yaml`, `package.json`
- `.github/workflows/ci.yml`, `.github/workflows/hotfix-verify.yml`
- `apps/target-app-demo/src/repositories/payment.repository.ts`
