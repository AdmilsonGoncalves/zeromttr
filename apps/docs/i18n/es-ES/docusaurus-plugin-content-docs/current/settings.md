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

- **Cooldown tras rechazo (Human Takeover):** periodo en el que se suprimen alertas idénticas tras un rechazo humano.
- **Supresión de repetición:** intervalo mínimo antes de abrir un nuevo incidente para el mismo problema después de un cierre.
- **Validez del enlace de decisión (TTL):** tiempo de expiración de los enlaces firmados enviados por correo.
- **Restaurar objetivo al aprobar:** define si aprobar un incidente debe restaurar el servicio de demostración (se deshabilita automáticamente cuando el modo demo está desactivado).

### 2. Servicio Objetivo

- **Ruta del servicio en el repositorio:** directorio inspeccionado al analizar diffs.
- **Referencias base y degradada:** etiquetas o refs comparadas durante la investigación de regresión.
- **Umbral de tasa de error 5xx (%):** porcentaje sobre el cual un servicio monitorizado vía Prometheus se clasifica como degradado.
- **Información de solo lectura:** repositorio GitHub configurado, rama base de PRs, proveedor de estado activo e intervalo de Grafana.

### 3. IA y Observabilidad

- **Modelos LLM principal y de fallback:** modelos usados por el proveedor activo (`LLM_PROVIDER`: Gemini, OpenAI, `openai-compatible`, OpenRouter, Groq, DeepSeek, Ollama, vLLM o Anthropic) para sintetizar RCA y parches, con soporte para identificadores con namespace (p. ej., `openai/gpt-4o-mini`).
- **Correo del ingeniero de guardia:** se muestra siempre enmascarado (`on***@example.com`) para evitar exposición de PII en pantalla.
- **Nivel de log del orquestador:** ajustable en vivo (`debug`, `info`, `warn`, `error`).

### 4. Auditoría

- Registro cronológico de cambios en la configuración con fecha/hora (UTC), campo modificado, valor anterior y nuevo valor (con correos siempre enmascarados).

## Control de acceso y modo de solo lectura

- **Entornos protegidos por token:** introduce el **Token de Administrador de Configuración** en la parte superior del panel para habilitar el guardado. Se conserva solo en `sessionStorage` de la pestaña actual y se borra al cerrarla.
- **Modo solo lectura:** en instancias públicas de demo sin token administrativo configurado, se pueden consultar todas las políticas y la auditoría mientras la edición permanece bloqueada.
