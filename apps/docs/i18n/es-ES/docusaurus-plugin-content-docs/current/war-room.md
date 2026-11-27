---
id: war-room
title: Usando el War Room
slug: /war-room
sidebar_position: 2
---

# Usando el War Room

El **War Room** es el panel único de operación de ZeroMTTR. Combina estado en tiempo real, línea temporal de remediación, telemetría del servicio objetivo, evidencias técnicas y controles de remediación.

## 1. Encabezado Superior

De izquierda a derecha, el encabezado muestra:

- **Marca y estado de conexión:** indica si el stream de eventos en tiempo real (**SSE**) está conectado (`Online` en verde u `Offline` en rojo).
- **Estado del servicio monitorizado:** muestra el nombre del servicio objetivo, la versión actual y su estado de salud:
  - **Saludable (verde):** operando dentro de los límites normales.
  - **Degradado (amarillo):** fallo o saturación activa detectada.
  - **Inalcanzable (rojo):** sin respuesta o sin telemetría reciente.
- **Controles a la derecha:**
  - **Demostración:** abre el panel lateral de simulación (visible solo cuando el modo demo está habilitado).
  - **Configuración (icono de engranaje):** abre las políticas operativas en tiempo real y el historial de auditoría (disponible en demo y producción).
  - **Manual (`?`):** abre esta guía en el idioma activo.
  - **Idioma (bandera):** cambia al instante entre **Português**, **English** y **Español**.

## 2. Flujo de Remediación

Justo debajo del encabezado, la línea temporal horizontal sigue las 8 etapas del incidente en tiempo real:

1. **Colecta LGTM** — esperando el disparo de la alerta de observabilidad.
2. **Recibido** — alerta validada e incidente inicializado.
3. **Investigando** — consulta automática de métricas, trazas y logs.
4. **Enriqueciendo** — inspección del diff entre la versión saludable y la degradada.
5. **Remediando** — auditoría de privacidad y síntesis de la causa raíz y del parche.
6. **Abriendo PR** — creación de la rama hotfix y apertura del Pull Request en GitHub.
7. **Notificado** — post-mortem enviado al ingeniero de guardia esperando decisión humana.
8. **Resuelto / Rechazado** — decisión registrada e incidente cerrado.

:::info Consejo visual
Pasa el cursor sobre cualquier etapa de la línea temporal para ver el resumen de la acción realizada en ese paso.
:::

## 3. Telemetría del Servicio Objetivo

Muestra la salud instantánea del servicio monitorizado en tarjetas compactas:

- **Caudal (req/s)** e indicador de tráfico sintético activo.
- **Tasa de error 5xx (%)** con color dinámico (verde, amarillo o rojo según severidad).
- **Latencia p95 (ms)** señalando degradación en el tiempo de respuesta.
- **Saturación de recurso** (cuando el servicio la reporta, como pool de base de datos o cola de workers) con conteo activo y en espera.

## 4. Franja de KPIs

Resume los indicadores clave del incidente activo:

- **TTD (Time to Diagnose):** tiempo desde la recepción de la alerta hasta completar el diagnóstico.
- **TTPR (Time to Pull Request):** tiempo hasta la apertura del Pull Request de corrección.
- **Cobertura de Evidencias:** porcentaje de señales independientes recopiladas (métricas, ejemplar, traza de error y log/diff — hasta `4/4` = `100%`).
- **Fuente del Diagnóstico:** indica si el análisis provino de **Proveedor LLM** o **Fallback Determinista** (si el LLM no está disponible o fue bloqueado por privacidad).
- **Reducción FinOps:** porcentaje de compactación aplicada a los datos brutos antes del envío a la IA y tokens ahorrados estimados.

## 5. Panel de Evidencias (4 Pestañas)

- **Telemetría en Vivo:** series temporales recientes de latencia p95, errores 5xx, caudal y saturación.
- **Trace Tree y Evidencias:** árbol distribuido de spans destacando el span crítico con error, radio de impacto (_blast radius_) y resumen de la causa raíz.
- **Logs Loki y Enmascaramiento PII:** comparación lado a lado entre el log bruto en el borde (con PII sintética) y el log enmascarado en Loki, junto al estado de la auditoría _fail-closed_.
- **Git Deploy Diff y FinOps:** diff de código entre releases y comparativa visual de bytes brutos vs. compactados.

## 6. Panel de Remediación

Muestra el estado del **Pull Request en GitHub** (con enlace directo para revisión), una vista previa sanitizada del **correo Post-Mortem** enviado al ingeniero y, en modo demo, el botón para simular la aprobación en pantalla.
