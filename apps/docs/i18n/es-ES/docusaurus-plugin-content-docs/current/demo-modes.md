---
id: demo-modes
title: Modo Replay vs. Modo Live
slug: /demo-modes
---

# Modo Replay vs. Modo Live

Cuando el modo de demostración está habilitado, el botón **Demostración** en el encabezado del War Room abre un panel lateral con dos modos de operación.

## Comparación rápida

| Característica                    | Modo Replay (predeterminado público)              | Modo Live (ejecución real)                                              |
| :-------------------------------- | :------------------------------------------------ | :---------------------------------------------------------------------- |
| **Duración típica**               | ~25 segundos                                      | ~30–60 segundos                                                         |
| **Uso de APIs externas**          | Ninguno (preserva cuotas de LLM, GitHub y correo) | Sí (LLM real, PR real y correo real)                                    |
| **Modifica el servicio objetivo** | No                                                | Sí (inyecta degradación controlada y tráfico)                           |
| **Requiere clave de acceso**      | No                                                | Depende de la configuración del servidor (local con Docker no requiere) |

## Paso a paso en Modo Replay

1. Haz clic en **Demostración** en el encabezado del War Room.
2. Mantén desactivado el interruptor **Modo Live** (`REPLAY` por defecto).
3. Haz clic en **Simular Incidente**.
4. El panel se cierra automáticamente para que sigas el flujo completo de un incidente real grabado previamente.
5. Al llegar a **Notificado**, haz clic en **Simular Aprobación** en el Panel de Remediación para cerrar el ciclo.

## Paso a paso en Modo Live

1. Abre el panel **Demostración** y activa **Modo Live**.
2. Si el servidor exige autorización para ejecuciones reales, introduce la **Clave de Demo Live** en el campo correspondiente.
3. Si el entorno público utiliza **Cloudflare Turnstile**, espera o completa la verificación mostrada bajo el encabezado.
4. _(Opcional)_ Activa **Tráfico Saludable Continuo** para ver métricas normales en vivo antes de inyectar un fallo. Este interruptor queda bloqueado mientras el objetivo está degradado (restaure antes de reactivarlo) y se apaga automáticamente al volver al Modo Replay.
5. Haz clic en **Simular Incidente**: ZeroMTTR degrada el servicio de ejemplo, genera tráfico sintético controlado, espera la alerta real de Grafana, diagnostica, abre un PR en GitHub y envía el correo Post-Mortem.
6. Para devolver el servicio al estado saludable en cualquier momento, abre **Demostración** y haz clic en **Restaurar Servicio**.

:::warning Cooldown entre simulaciones y ejecuciones Live consecutivas

- **Cooldown global de disparo (`DEMO_COOLDOWN_MS`, por defecto `120000` ms = 2 min):** evita ejecuciones simultáneas y abuso de cuotas. Si está activo, el toast muestra los segundos restantes.
- **Supresión de repetición (`REPEAT_SUPPRESSION_SECONDS`) e intervalo de Grafana (`GRAFANA_ALERT_REPEAT_INTERVAL`):** en despliegues de producción/VPS el valor por defecto es `900s` (15 min) con `AUTO_RESTORE_ON_APPROVE=false`. Restaurar el servicio (y esperar ~30s a que la alerta de Grafana vuelva a `OK`) solo limpia el fallo del objetivo y permite que Grafana vuelva a disparar; **no** finaliza la ventana de supresión del incidente anterior. Para ejecutar simulaciones Live consecutivas sin esperar 15 minutos, reduce la **Supresión de repetición** en **Configuración ⚙️** **y** restaura el servicio (o activa **Restaurar objetivo al aprobar**); de lo contrario, espera el resto de la ventana. Cuando ocurra una supresión o una espera prolongada de Grafana, el War Room mostrará un toast de advertencia explicando el motivo.
  :::

## Variables de entorno del modo demo

| Variable                                      | Función                                                                                   | Valor por defecto                          |
| :-------------------------------------------- | :---------------------------------------------------------------------------------------- | :----------------------------------------- |
| `ENABLE_DEMO_MODE`                            | Habilita/oculta el panel **Demostración** y endpoints `/api/demo/*`                       | `true` (Compose) / `false` (prod estricta) |
| `REQUIRE_DEMO_KEY`                            | Exige la cabecera `X-Live-Demo-Key` en acciones de Modo Live                              | `false` local / `true` prod                |
| `LIVE_DEMO_KEY`                               | Clave secreta aceptada en el campo **Clave de Demo Live**                                 | —                                          |
| `PUBLIC_LIVE_DEMO`                            | Permite Modo Live público sin clave cuando `REQUIRE_DEMO_KEY=false`                       | `false`                                    |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Activa verificación anti-bot Cloudflare Turnstile en demos públicas                       | vacío (desactivado)                        |
| `DEMO_COOLDOWN_MS`                            | Cooldown mínimo entre disparos de `/api/demo/chaos`                                       | `120000` (2 min)                           |
| `CHAOS_ENDPOINTS_ENABLED`                     | Habilita endpoints `/chaos/*` en `target-app-demo`                                        | sigue `ENABLE_DEMO_MODE`                   |
| `CHAOS_AUTO_TRAFFIC_BURST`                    | Genera ráfaga sintética automática al activar caos en `target-app-demo`                   | `true`                                     |
| `HEALTHY_TRAFFIC_AUTO_START`                  | Inicia el tráfico saludable continuo automáticamente al arrancar el objetivo              | `false`                                    |
| `HEALTHY_TRAFFIC_INTERVAL_MS`                 | Intervalo (ms) entre oleadas de tráfico saludable (usa `3000`–`5000` para aliviar el VPS) | `1500`                                     |

:::info Objetivos sin soporte de simulación de caos
Cuando ZeroMTTR está conectado a un servicio real de producción (o monitorizado pasivamente vía Prometheus), el objetivo reporta que no soporta simulación de caos. Los botones de inyección de fallo y tráfico sintético se ocultan automáticamente para proteger el entorno.
:::

:::note Ventana privada o navegador nuevo
El tráfico saludable es estado del servidor, mientras que el modo (Live/Replay) se guarda en el navegador. Al abrir el War Room en un navegador nuevo (p. ej., ventana privada) con el tráfico aún activo, el panel alinea el modo a **Live** automáticamente, siempre que el Modo Live esté permitido (sin clave exigida o con clave informada). Si `REQUIRE_DEMO_KEY=true` y no hay clave guardada, el modo permanece **Replay** y detener el tráfico sigue exigiendo autorización: cambia a **Live** e introduce la **Clave de Demo Live** antes de apagar el tráfico.
:::
