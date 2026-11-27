---
id: installation-troubleshooting
title: Instalación Local y Solución de Problemas
slug: /installation-troubleshooting
---

# Instalación Local y Solución de Problemas

## Requisitos

- **Node.js 24 LTS**
- **pnpm 12+**
- **Docker y Docker Compose v2.40+**

## Arrancar el entorno local

```bash
# 1. Copiar la plantilla de variables de entorno
cp .env.prod.template .env

# 2. (Opcional para Modo Replay; obligatorio para Modo Live)
# Edita .env para elegir el proveedor de IA (LLM_PROVIDER: gemini, openai,
# openai-compatible, openrouter, groq, deepseek, ollama, vllm o anthropic),
# define tus credenciales reales (LLM_API_KEY, GITHUB_TOKEN, RESEND_API_KEY,
# ON_CALL_ENGINEER_EMAIL) y reemplaza los tokens de seguridad de ejemplo
# (MCP_AUTH_TOKEN, GRAFANA_WEBHOOK_TOKEN, DASHBOARD_API_TOKEN,
# SETTINGS_ADMIN_TOKEN y DECISION_HMAC_SECRET). Deja LLM_MODEL y
# LLM_FALLBACK_MODEL en blanco para usar los valores predeterminados del
# proveedor elegido (o indica modelos compatibles; al cambiar LLM_PROVIDER, los
# modelos guardados anteriormente en SQLite se restablecen automáticamente para
# el nuevo proveedor). Para gateways personalizados u Ollama/vLLM con Docker,
# define una LLM_BASE_URL accesible desde el contenedor (p. ej.,
# http://ollama:11434/v1 como servicio Compose o una IP/host accesible; en
# Linux Docker Engine, host.docker.internal solo funciona si añades
# extra_hosts mapeando host.docker.internal a host-gateway en orchestrator).

# 3. Instalar dependencias del workspace
pnpm install --frozen-lockfile

# 4. Ejecutar la puerta de calidad completa (formato, lint, tipos, pruebas y build)
pnpm run check:workspace

# 5. Levantar toda la pila (Observabilidad LGTM + ZeroMTTR + Manual)
docker compose up -d --build
```

## Direcciones locales

| Servicio                                 | URL                         |
| :--------------------------------------- | :-------------------------- |
| **War Room Dashboard**                   | `http://localhost:4200`     |
| **Manual de Instrucciones (Docusaurus)** | `http://localhost:4300`     |
| **Grafana**                              | `http://localhost:3000`     |
| **Prometheus**                           | `http://localhost:9090`     |
| **Servidor MCP**                         | `http://localhost:8000/mcp` |

## Ejecución de scripts CLI en el host

El repositorio incluye scripts auxiliares en `scripts/` para tareas puntuales desde terminal:

- `./scripts/reset.sh` — restaura el servicio de ejemplo y cierra PRs temporales de hotfix en GitHub.
- `./scripts/chaos.sh` — inyecta saturación de pool y carga sintética desde CLI.
- `./scripts/record-replay.sh` — graba un nuevo snapshot sanitizado para Modo Replay.
- `./scripts/load-test-lgtm.sh` — ejecuta prueba de carga y audita consumo de RAM de los contenedores.

:::warning Atención al ejecutar scripts en el host con `.env`
`.env.prod.template` define `TARGET_APP_URL=http://target-app-demo:3001` para la red interna de Docker. Al ejecutar los scripts directamente en tu máquina host, sobrescribe la URL **en línea por comando**:

```bash
TARGET_APP_URL=http://127.0.0.1:3001 ./scripts/reset.sh
```

**No** añadas `export TARGET_APP_URL=http://127.0.0.1:3001` en `~/.zshrc` o `~/.bashrc`, porque Docker Compose prioriza variables del shell sobre `.env` y rompería la comunicación interna entre contenedores.
:::

## Solución de problemas frecuentes

| Síntoma                              | Causa probable                                                   | Cómo resolverlo                                                                                                                                        |
| :----------------------------------- | :--------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SSE Offline** en el War Room       | El orquestador aún arranca o está detenido.                      | Revisa `docker compose ps` y `docker compose logs orchestrator`.                                                                                       |
| **HTTP 403** al activar Modo Live    | Falta/invalidez de `LIVE_DEMO_KEY` o desafío Turnstile caducado. | Introduce la clave en **Demostración** o completa Turnstile de nuevo.                                                                                  |
| **HTTP 429** al simular incidente    | Cooldown global (2 min) o límite de tasa activo.                 | Espera los segundos indicados en el aviso antes de reintentar.                                                                                         |
| **Configuración en solo lectura**    | `SETTINGS_ADMIN_TOKEN` no definido en entorno demo.              | Define `SETTINGS_ADMIN_TOKEN` en `.env`, recrea el servicio (`docker compose up -d --force-recreate orchestrator`) e introdúcelo en **Configuración**. |
| **Servicio objetivo `Inalcanzable`** | Servicio caído o sin métricas recientes en Prometheus.           | Verifica que el servicio responda `GET /health` y envíe telemetría OTLP.                                                                               |
| **Enlace caducado o `409 Conflict`** | TTL expirado o incidente ya aprobado/rechazado.                  | Cada incidente acepta una sola decisión final dentro del TTL (por defecto 15 min).                                                                     |
