---
id: settings
title: Configuración en Tiempo Real
slug: /settings
---

# Configuración en Tiempo Real

El icono de **engranaje** en la esquina superior derecha del War Room abre el panel **Configuración**, disponible tanto en modo demo como en producción.

Los cambios se guardan en almacenamiento SQLite local y se aplican **de inmediato**, sin necesidad de reiniciar contenedores.

## Pestañas disponibles

### 1. Alertas y Decisiones

- **Cooldown tras rechazo (Human Takeover)** (`REJECTION_COOLDOWN_SECONDS`, `0`–`86400s`, por defecto `900s`): periodo en el que se suprimen alertas idénticas tras un rechazo humano. Cuando se suprime una alerta, el War Room muestra un aviso (toast) con el tiempo restante.
- **Supresión de repetición** (`REPEAT_SUPPRESSION_SECONDS`, `0`–`86400s`, por defecto `60s` local / `900s` producción): intervalo mínimo antes de abrir un nuevo incidente para el mismo problema después de un cierre (`RESOLVED` o `REJECTED`). Cuando se suprime, el War Room muestra un aviso (toast) con el tiempo restante y el acceso a esta pestaña.
- **Validez del enlace de decisión (TTL)** (`DECISION_TTL_SECONDS`, `60`–`86400s`, por defecto `900s`): tiempo de expiración de los enlaces firmados enviados por correo.
- **Restaurar objetivo al aprobar** (`AUTO_RESTORE_ON_APPROVE`, por defecto `true` en demo local / `false` en `.env.prod.template`): define si aprobar un incidente debe restaurar el servicio de demostración (se deshabilita automáticamente cuando `ENABLE_DEMO_MODE=false`).

### 2. Servicio Objetivo

- **Ruta del servicio en el repositorio** (`TARGET_SERVICE_PATH`): directorio inspeccionado al analizar diffs.
- **Referencias base y degradada** (`TARGET_BASE_REF` / `TARGET_HEAD_REF`): etiquetas o refs comparadas durante la investigación de regresión.
- **Umbral de tasa de error 5xx (%)** (`TARGET_ERROR_RATE_THRESHOLD_PERCENT`, `0.1`–`100`): porcentaje sobre el cual un servicio monitorizado vía Prometheus se clasifica como degradado.
- **Información de solo lectura:** repositorio GitHub configurado (`TARGET_GITHUB_REPO`), rama base de PRs (`TARGET_BASE_BRANCH`), proveedor de estado activo (`TARGET_STATUS_PROVIDER`) e intervalo de reenvío de Grafana (`GRAFANA_ALERT_REPEAT_INTERVAL`, por defecto `1m` local / `15m` producción — de solo lectura porque cambiarlo requiere editar `.env` y recrear el contenedor `grafana`).

### 3. IA y Observabilidad

- **Modelos LLM principal y de fallback** (`LLM_MODEL` / `LLM_FALLBACK_MODEL`): modelos usados por el proveedor activo (`LLM_PROVIDER`: Gemini, OpenAI, `openai-compatible`, OpenRouter, Groq, DeepSeek, Ollama, vLLM o Anthropic) para sintetizar RCA y parches, con soporte para identificadores con namespace (p. ej., `openai/gpt-4o-mini`).
- **Correo del ingeniero de guardia** (`ON_CALL_ENGINEER_EMAIL`): se muestra siempre enmascarado (`on***@example.com`) para evitar exposición de PII en pantalla.
- **Nivel de log del orquestador** (`LOG_LEVEL`): ajustable en vivo (`debug`, `info`, `warn`, `error`).

### 4. Auditoría

- Registro cronológico de cambios en la configuración con fecha/hora (UTC), campo modificado, valor anterior y nuevo valor (con correos siempre enmascarados).

## Precedencia entre SQLite y `.env`

- Los valores guardados desde el panel **Configuración** persisten en el volumen SQLite (`SETTINGS_DB_PATH`) y tienen **precedencia sobre `.env`** incluso tras recrear el contenedor `orchestrator`.
- **Excepción al cambiar proveedor LLM:** `LLM_PROVIDER` siempre se lee desde `.env` al arrancar; al cambiar `LLM_PROVIDER`, los overrides anteriores de `llmModel` y `llmFallbackModel` en SQLite se limpian automáticamente para usar los valores por defecto del nuevo proveedor.

## Control de acceso y modo de solo lectura

- **Entornos protegidos por token:** introduce el **Token de Administrador de Configuración** en la parte superior del panel para habilitar el guardado. Se conserva solo en `sessionStorage` de la pestaña actual y se borra al cerrarla.
- **Modo solo lectura:** en instancias públicas de demo sin token administrativo configurado, se pueden consultar todas las políticas y la auditoría mientras la edición permanece bloqueada.
