---
id: demo-modes
title: Modo Replay vs. Modo Live
slug: /demo-modes
sidebar_position: 3
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
4. _(Opcional)_ Activa **Tráfico Saludable Continuo** para ver métricas normales en vivo antes de inyectar un fallo.
5. Haz clic en **Simular Incidente**: ZeroMTTR degrada el servicio de ejemplo, genera tráfico sintético controlado, espera la alerta real de Grafana, diagnostica, abre un PR en GitHub y envía el correo Post-Mortem.
6. Para devolver el servicio al estado saludable en cualquier momento, abre **Demostración** y haz clic en **Restaurar Servicio**.

:::warning Cooldown entre simulaciones
Para evitar ejecuciones simultáneas o abuso de cuotas, el servidor aplica un tiempo de espera global (por defecto **2 minutos**) entre disparos consecutivos. Si está activo, la notificación mostrará cuántos segundos faltan.
:::

:::info Objetivos sin soporte de simulación de caos
Cuando ZeroMTTR está conectado a un servicio real de producción (o monitorizado pasivamente vía Prometheus), el objetivo reporta que no soporta simulación de caos. Los botones de inyección de fallo y tráfico sintético se ocultan automáticamente para proteger el entorno.
:::
