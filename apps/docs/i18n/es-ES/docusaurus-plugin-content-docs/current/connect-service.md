---
id: connect-service
title: Conectando tu Servicio
slug: /connect-service
---

# Conectando tu Servicio

El núcleo de ZeroMTTR es **agnóstico al dominio**. Puedes monitorizar cualquier aplicación HTTP que emita telemetría OpenTelemetry y tenga su código en GitHub, sin modificar una línea de ZeroMTTR.

## Requisitos mínimos de tu aplicación

1. **Telemetría OpenTelemetry (OTLP):** exportar métricas HTTP, trazas distribuidas y logs hacia el OTel Collector de la pila.
2. **Repositorio en GitHub:** accesible con un token (`GITHUB_TOKEN`) con permisos para leer diffs y crear ramas/Pull Requests. Si deseas validación automática de los parches propuestos, configura un workflow de CI en el repositorio objetivo para PRs `hotfix/zeromttr-*`.
3. **Regla de alerta en Grafana:** configurada para enviar su webhook al orquestador cuando la tasa de error o la latencia superen tu SLO.

## Configuración del repositorio (Orquestador + Servidor MCP)

Independientemente del modo elegido abajo, configura en el `.env` compartido entre **orquestador** y **servidor MCP** las variables que identifican el repositorio objetivo de diffs y Pull Requests:

```dotenv
TARGET_GITHUB_REPO=mi-org/mi-api-pedidos
TARGET_BASE_BRANCH=main
TARGET_SERVICE_PATH=apps/mi-api-pedidos
```

> El `mcp-server` lee `TARGET_GITHUB_REPO`, `TARGET_BASE_BRANCH` y `TARGET_SERVICE_PATH` para consultar diffs y abrir PRs; el orquestador también acepta `TARGET_REPO_URL` para el enlace completo mostrado en el War Room.

## Elige el modo de monitorización de estado

### Modo 1 — Pasivo vía Prometheus (cero cambios en tu servicio)

Ideal para servicios existentes o de terceros donde no deseas añadir endpoints personalizados.

Configura en el entorno del **orquestador** (además de las variables de repositorio arriba):

```dotenv
TARGET_STATUS_PROVIDER=prometheus
TARGET_SERVICE_NAME=mi-api-pedidos
TARGET_REPO_URL=https://github.com/mi-org/mi-api-pedidos
```

En este modo:

- ZeroMTTR sintetiza caudal (req/s), tasa de error 5xx y latencia p95 directamente desde las métricas en Prometheus (consultadas vía servidor MCP), soportando dos formatos de histograma HTTP:
  - `http_server_duration_milliseconds_{count,bucket}` con etiquetas `service_name` y `http_status_code`, **o**
  - `http_request_duration_seconds_{count,bucket}` con etiquetas `service` y `status`.
- Si no se observa ninguna de estas series para `TARGET_SERVICE_NAME`, el War Room muestra el estado **Inalcanzable**.
- Los controles de simulación de caos se deshabilitan automáticamente.

### Modo 2 — Cooperativo vía Manifiesto de Salud (`GET /ops/status`)

Ideal cuando deseas mostrar en el War Room metadatos enriquecidos como versión actual, versión saludable previa y saturación de un recurso concreto (cola de workers, pool de base de datos o hilos).

Configura en el entorno del **orquestador** (además de las variables de repositorio en el `.env` compartido con el servidor MCP):

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

Los campos `version`, `previousHealthyVersion`, `suspectFilePath` y `metrics` enriquecen el War Room y guían la investigación del orquestador, mientras que `TARGET_GITHUB_REPO`, `TARGET_BASE_BRANCH` y `TARGET_SERVICE_PATH` definen dónde el servidor MCP abre los Pull Requests.

:::tip Desactivar el modo demo en producción
En entornos reales define `ENABLE_DEMO_MODE=false`. Esto oculta el panel **Demostración** en el War Room y desactiva las rutas de simulación en el servidor, manteniendo activos **Configuración** y todo el flujo de remediación.
:::
