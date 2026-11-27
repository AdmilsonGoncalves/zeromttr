---
id: connect-service
title: Conectando tu Servicio
slug: /connect-service
sidebar_position: 6
---

# Conectando tu Servicio

El núcleo de ZeroMTTR es **agnóstico al dominio**. Puedes monitorizar cualquier aplicación HTTP que emita telemetría OpenTelemetry y tenga su código en GitHub, sin modificar una línea de ZeroMTTR.

## Requisitos mínimos de tu aplicación

1. **Telemetría OpenTelemetry (OTLP):** exportar métricas HTTP, trazas distribuidas y logs hacia el OTel Collector de la pila.
2. **Repositorio en GitHub:** accesible con un token con permisos para leer diffs y crear ramas/Pull Requests.
3. **Regla de alerta en Grafana:** configurada para enviar su webhook al orquestador cuando la tasa de error o la latencia superen tu SLO.

## Elige el modo de monitorización de estado

### Modo 1 — Pasivo vía Prometheus (cero cambios en tu servicio)

Ideal para servicios existentes o de terceros donde no deseas añadir endpoints personalizados.

Configura en el entorno del **orquestador**:

```dotenv
TARGET_STATUS_PROVIDER=prometheus
TARGET_SERVICE_NAME=mi-api-pedidos
TARGET_REPO_URL=https://github.com/mi-org/mi-api-pedidos
TARGET_BASE_BRANCH=main
```

En este modo:

- ZeroMTTR sintetiza caudal (req/s), tasa de error 5xx y latencia p95 directamente desde las métricas en Prometheus (consultadas vía servidor MCP).
- Si no se observan métricas del servicio, el War Room muestra el estado **Inalcanzable**.
- Los controles de simulación de caos se deshabilitan automáticamente.

### Modo 2 — Cooperativo vía Manifiesto de Salud (`GET /ops/status`)

Ideal cuando deseas mostrar en el War Room metadatos enriquecidos como versión actual, versión saludable previa y saturación de un recurso concreto (cola de workers, pool de base de datos o hilos).

Configura en el entorno del **orquestador**:

```dotenv
TARGET_STATUS_PROVIDER=manifest
TARGET_APP_URL=http://mi-api-pedidos:8080
TARGET_STATUS_PATH=/ops/status
```

Ejemplo de respuesta JSON esperada en `GET /ops/status`:

```json
{
  "status": "healthy",
  "service": "mi-api-pedidos",
  "version": "v3.2.0",
  "previousHealthyVersion": "v3.1.9",
  "targetRepo": "https://github.com/mi-org/mi-api-pedidos",
  "suspectFilePath": "src/workers/dispatch.ts",
  "capabilities": {
    "chaosSimulation": false,
    "healthyTrafficToggle": false
  },
  "metrics": {
    "requestsPerSecond": 42.5,
    "errorRate5xxPercent": 0.2,
    "p95LatencyMs": 85,
    "healthyTrafficActive": false,
    "saturation": {
      "resourceLabel": "Worker Queue",
      "active": 4,
      "waiting": 0,
      "max": 20
    }
  }
}
```

:::tip Desactivar el modo demo en producción
En entornos reales define `ENABLE_DEMO_MODE=false`. Esto oculta el panel **Demostración** en el War Room y desactiva las rutas de simulación en el servidor, manteniendo activos **Configuración** y todo el flujo de remediación.
:::
