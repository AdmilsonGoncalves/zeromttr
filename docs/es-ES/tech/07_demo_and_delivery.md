# TECH 07 — Demostración en vivo, medición de TTD/TTPR y entrega final (Fases 5–6)

**Depende de:** [05](./05_orchestrator.md), [08](./08_dashboard_frontend.md)
**Objetivo:** Consolidar el sistema en una demostración en vivo de 3 minutos (modo `Live` real + cliente MCP externo), documentar el baseline cronometrado de **TTD** y **TTPR**, y congelar el entorno de producción para su evaluación.

## 1. Guion del vídeo de demostración (3 minutos — Modo `Live` real)
Dado que los visitantes anónimos en la URL pública ven por defecto el modo `Replay` (para protección de cuota), **el vídeo de demostración debe grabar el modo `Live` real de extremo a extremo**, además de demostrar el contrato MCP abierto en un cliente externo:

| Tiempo | Paso | Evidencia demostrada en vivo |
| :--- | :--- | :--- |
| **0:00 – 0:25** | Problema operativo y arquitectura abierta | Contextualización en la línea **Logística y Automatización** (automatización de flujos de trabajo e integración entre sistemas): diferencial de enmascaramiento de PII en el borde + FinOps de tokens + contrato MCP abierto y agnóstico al servicio monitorizado. |
| **0:25 – 0:45** | Contrato MCP abierto (Cliente externo) | **MCP Inspector** (o Cursor/Claude Desktop vía `.mcp.json`) conectado directamente a `zeromttr-mcp-server`, listando las 8 herramientas (`tools/list`) e invocando `execute_promql_range`. |
| **0:45 – 1:10** | Disparo de incidente real (`⚡ Live API Mode`) | Clic en "Simular Incidente" en el War Room; `api-pagamentos-core` entra en `degraded` (`v2.14.8`); Grafana dispara una alerta hacia el Orchestrator. |
| **1:10 – 1:40** | Enmascaramiento OTTL en el borde y recolección OTel (`TTD ≤ 15s`) | La pestaña 1 (`Live Metrics`) muestra los gráficos SVG temporales de latencia, 5xx, throughput y pool; la pestaña 2 (`Trace Tree`) muestra `Evidence Coverage: 4/4 Signals (100%)` + `reasoningSource: 'llm'` + `Blast Radius` + span `pg.pool.acquire` en error; la pestaña 3 (`Loki Logs & PII`) muestra el log reportado en la aplicación (pre-Collector) frente al log enmascarado por `transform` OTTL (`[REDACTED_CPF]`, `[REDACTED_CNPJ]`, `Bearer [REDACTED_TOKEN]`) y la auditoría fail-closed de `PiiPromptGuard` (`leakedPatternsDetected: 0`). |
| **1:40 – 2:10** | Diff real `v2.14.7...v2.14.8` y PR autónomo (`TTPR ≤ 30s`) | La pestaña 4 (`Git Diff & FinOps`) muestra el diff extraído de `apps/target-app-demo/src/repositories/payment.repository.ts` y la reducción FinOps calculada dinámicamente (`bytes reduced / estimated tokens saved`). Al hacer clic en el enlace se abre en GitHub el **Pull Request real recién creado** (contra `release/target-v2.14.8`) con `reasoningSource: llm` y el comentario `✅ ZeroMTTR Autonomous CI Gate: PASSED` publicado por `hotfix-verify.yml`. |
| **2:10 – 2:40** | Post-Mortem en Resend y aprobación humana vía HMAC (`#fragment`) | Visualización del correo real recibido vía **Resend** (`sre@zeromttr.agjworks.com`); al hacer clic en el botón **Aprovar Hotfix** del correo se abre `/decision/:id#action=approve&sig=...`, se confirma vía `POST` con firma HMAC y transiciona el estado a `RESOLVED` + anotación en el gráfico de Grafana. |
| **2:40 – 3:00** | Cierre con métricas cronometradas | Comparación entre el baseline manual cronometrado (7 pasos) y el TTD/TTPR medido por `scripts/measure-mttr.sh`. |

## 2. Medición honesta de TTD y TTPR frente al baseline manual cronometrado
El script `scripts/measure-mttr.sh` lee los timestamps de transición desde `GET /api/incidents/:id` y calcula:
1. **TTD (*Time to Deterministic Diagnosis*):** `timestamp(REMEDIATING) - timestamp(RECEIVED)` (objetivo: ≤ 15 s).
2. **TTPR (*Time to Reviewable Pull Request*):** `timestamp(AWAITING_PR) - timestamp(RECEIVED)` — donde `AWAITING_PR` se transiciona estrictamente **después** de que `createRemediationPr` tenga éxito con un `pullRequestUrl` no vacío y exista un PR revisable en GitHub (objetivo: ≤ 30 s).
3. **Tiempo hasta Post-Mortem entregado:** `timestamp(NOTIFIED) - timestamp(RECEIVED)` (objetivo: ≤ 45 s).

Para una comparación justa en el README, cronometra y registra una ejecución manual real de los mismos 7 pasos realizados por un ingeniero (1. leer alerta; 2. ejecutar PromQL; 3. abrir exemplar en Tempo; 4. filtrar Loki por `trace_id`; 5. ejecutar `git diff v2.14.7...v2.14.8 -- apps/target-app-demo`; 6. editar `payment.repository.ts` y ejecutar pruebas; 7. crear rama y abrir PR).

### Scripts de Verificación, Carga LGTM y Replay

Los siguientes scripts automatizan la validación de PII en el borde, la estabilidad de memoria de la pila LGTM (`GOMEMLIMIT=200MiB` en `otel-collector`, límite agregado `<= 2200 MiB` sin `OOMKill`), la medición de TTD/TTPR y la grabación de la instantánea de replay:

```bash
./scripts/smoke-phase1.sh
./scripts/load-test-lgtm.sh
INCIDENT_ID="inc-001" # defina el ID real del incidente
./scripts/measure-mttr.sh "$INCIDENT_ID"
./scripts/record-replay.sh "$INCIDENT_ID"
```

## 3. Documentación obligatoria en el repositorio público
- `README.md` (en-US) y `README.pt-BR.md`:
  - Declaración explícita de la línea **Logística y Automatización** (automatización de flujos de trabajo operativos e integraciones entre sistemas) y de la arquitectura agnóstica de dominio.
  - Tabla comparativa cualificada (HolmesGPT / OpenSRE / Bits AI frente a ZeroMTTR, referenciada a nov/2026).
  - Sección **"Transparencia técnica y límites del MVP"**:
    1. Explicación del **Modo `Live` frente al Modo `Replay`** en la demo pública (`https://zeromttr.agjworks.com`) y cómo probar en modo `Live` (localmente mediante Docker Compose o con la `LIVE_DEMO_KEY`, que debe rotarse tras la evaluación).
    2. Aclaración de que el ciclo autónomo finaliza en el **Pull Request verificado por CI + decisión humana firmada** (sin merge/redespliegue automático en el contenedor en ejecución).
    3. Aclaración de que la métrica FinOps mide la **reducción de payload mediante sumarización y truncamiento por política** (usando estimación `bytes / 4`), y que el enmascaramiento de PII cubre los **5 tipos oficiales de clave PIX del Banco Central** (CPF y CNPJ vía Módulo-11 de la Receita Federal, Teléfono móvil/fijo vía reglas de ANATEL, Correo RFC 5322 y Clave aleatoria EVP / UUID v4 RFC 4122 en contexto PIX) además de tokens JWT/Bearer (mientras que los UUID técnicos como `request_id` y los nombres propios en texto libre no se bloquean).
  - Cómo conectar un cliente MCP externo usando el archivo `.mcp.json` de la raíz.
  - Explicación de los tags `v2.14.7` (saludable en `master`) y `v2.14.8` (regresión en `release/target-v2.14.8`) para la reproducción determinista del Pull Request.
- `docs/es-ES/adr/` con los ADR 001–011.
- `CONTRIBUTING.md` y `SECURITY.md`.

## 4. Lista de verificación de ensayo previo a la grabación, entrega y estabilidad en producción
- [ ] `docker compose up` funciona en una máquina limpia (desarrollo local).
- [ ] Tags `v2.14.7` y `v2.14.8` y rama `release/target-v2.14.8` creados **después** de que existan `.github/workflows/hotfix-verify.yml` y las pruebas de `apps/target-app-demo`, con **Branch Protection en `master`** y **Tag Protection en `v2.14.*`** activos en GitHub **incluidos administradores (*"Do not allow bypassing"* / *Bypass list* vacía)** y probados intentando un `git push` directo a `master` con el PAT del VPS (confirmando rechazo).
- [ ] **Ensayo previo a la grabación (Live Rehearsal):**
  - Confirmar en el evento SSE y en el PR que `PiiPromptGuard` devolvió `passed: true, leakedPatternsDetected: 0` y que `reasoningSource === 'llm'` (`gemini-3.5-flash`).
  - Confirmar en el Pull Request abierto contra `release/target-v2.14.8` que el workflow `hotfix-verify.yml` se disparó y publicó `✅ ZeroMTTR Autonomous CI Gate: PASSED`.
  - Confirmar en el correo real recibido vía Resend (con *Click Tracking* deshabilitado en el dominio) que el enlace `/decision/:id#action=approve&sig=...&exp=...` preserva el fragmento `#` y completa la transición a `RESOLVED`.
  - Volver a grabar la instantánea `data/last-recorded-incident.json` a partir de esta ejecución `live` final (ya conteniendo `reasoningSource: 'llm'` y `Evidence Coverage: 100%`).
- [ ] Vídeo de hasta 3 minutos grabado en modo `Live` con narración o subtítulos en inglés (`en-US`).
- [ ] En el VPS, secretos almacenados exclusivamente en un archivo fuera del repositorio Git (p. ej., `/path/to/secrets/.env` con permisos `600`) conteniendo los 3 tokens segregados (`MCP_AUTH_TOKEN`, `GRAFANA_WEBHOOK_TOKEN`, `DASHBOARD_API_TOKEN`) y la `LIVE_DEMO_KEY` dedicada (para rotar tras la evaluación).
- [ ] Stack sometido a prueba de carga en el VPS consumiendo ≤ 2.2 GB de RAM, con cero OOMKill en Prometheus/Loki/Tempo y cero puertos de telemetría expuestos en el host (`ss -tulpn`).
- [ ] Release `v1.0.0` publicada y **despliegue en VPS congelado** (sin despliegues automáticos en pushes ad-hoc) para garantizar el 100 % de disponibilidad durante todo el periodo de evaluación.
- [ ] Vídeo de 3 minutos grabado en modo `Live` real y publicado en el README.
