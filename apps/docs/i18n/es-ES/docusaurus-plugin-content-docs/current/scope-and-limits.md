---
id: scope-and-limits
title: Alcance, Limitaciones y Gobernanza
slug: /scope-and-limits
sidebar_position: 6
---

# Alcance, Limitaciones y Gobernanza

Esta página documenta con transparencia **qué automatiza ZeroMTTR**, **qué no realiza de forma intencional** y cuáles son los **límites operativos de la arquitectura actual**.

## 1. Sin auto-merge ni redespliegue automático en producción

Por decisión deliberada de gobernanza (**Human-in-the-Loop**), ZeroMTTR **nunca realiza merge automático de Pull Requests ni dispara despliegues a producción**.

| Acción                                                                      | ¿Automatizada por ZeroMTTR? | Quién la ejecuta                                                |
| :-------------------------------------------------------------------------- | :-------------------------- | :-------------------------------------------------------------- |
| Correlacionar métricas, trazas, logs enmascarados y diff de despliegue      | Sí                          | Automático (Orchestrator + MCP Server)                          |
| Generar diagnóstico (RCA) y abrir rama `hotfix/zeromttr-*` con Pull Request | Sí                          | Automático (validado por CI en el repositorio objetivo)         |
| Enviar correo Post-Mortem con enlaces firmados (HMAC)                       | Sí                          | Automático                                                      |
| Validar HMAC, cerrar incidente (`RESOLVED`) y anotar en Grafana             | Sí (tras clic humano)       | El ingeniero de guardia confirma en la pantalla de decisión     |
| **Hacer merge del Pull Request en la rama objetivo / producción**           | **No**                      | **Siempre manual por un ingeniero directamente en GitHub**      |
| **Disparar build/redespliegue en producción tras el merge**                 | **No**                      | **Pipeline de despliegue controlado por el equipo responsable** |

:::important Sobre "Restauración Automática al Aprobar"
La configuración `autoRestoreOnApprove` aplica **únicamente a entornos de demostración** con servicios de ejemplo que soportan simulación de caos en memoria. En producción (o en servicios monitorizados pasivamente), hacer clic en **Aprobar** solo registra la decisión auditable, cierra el incidente y anota el evento en Grafana.
:::

## 2. Alcance y límites de la protección de privacidad (PII)

ZeroMTTR aplica una **doble barrera independiente** — enmascaramiento OTTL en el borde (OTel Collector) y auditoría _fail-closed_ pre-LLM (`PiiPromptGuard`) — sobre los siguientes patrones estructurados:

- **Cubierto de forma determinista:**
  - **CPF y CNPJ** (con validación de dígitos verificadores Módulo-11, con o sin puntuación);
  - **Teléfonos móviles y fijos** (reglas brasileñas ANATEL);
  - **Direcciones de correo electrónico**;
  - **Claves aleatorias EVP / UUID v4** acompañadas de un marcador contextual de clave PIX (`pix`, `pixKey`, `chave_pix`, `evp`);
  - **Credenciales y tokens `Bearer` / JWT** (incluyendo estructura `eyJ...` incluso sin el prefijo `Bearer`).
- **Fuera del alcance determinista actual:**
  - **Nombres propios, direcciones físicas o datos sensibles en texto libre** sin formato estructural fijo;
  - **Teléfonos sin formato o UUIDs v4 sin marcador contextual** (excluidos intencionalmente para evitar falsos positivos con IDs de correlación, trace IDs y timestamps Unix);
  - **Datos fuera de texto/logs** (las series numéricas brutas de Prometheus no pasan por inspección textual).

## 3. Comportamiento ante fallos de IA (`fail-closed` y fallback)

- Si `PiiPromptGuard` detecta **cualquier** patrón residual sin enmascarar, el envío al proveedor LLM externo se **aborta inmediatamente** (_fail-closed_).
- Tanto ante un bloqueo por privacidad como ante una caída o timeout del LLM, el orquestador finaliza el flujo con un **fallback determinista local** e indica explícitamente `reasoningSource: 'fallback'` en el War Room, el stream SSE y el cuerpo del Pull Request.
- La calidad del parche propuesto por la IA depende de la claridad del diff de despliegue y de la cobertura de telemetría recopilada; por ello la revisión humana en GitHub antes del merge es siempre obligatoria.

## 4. Escala, persistencia y alta disponibilidad

La versión actual está diseñada como una plataforma ligera y _self-hosted_ de nodo único (_single-node_):

- **Sin multi-tenant:** cada despliegue de ZeroMTTR atiende un entorno/equipo a la vez.
- **Sin alta disponibilidad multinodo:** el orquestador, el servidor MCP y el stack LGTM operan en contenedores individuales mediante Docker Compose.
- **Persistencia ligera:**
  - **Configuraciones en tiempo real y auditoría:** almacenadas en una base **SQLite local** dentro del volumen del orquestador;
  - **Historial de incidentes:** mantenido en memoria con instantánea en archivo JSON (sin base relacional dedicada a retención de largo plazo);
  - **Métricas, logs y trazas (stack LGTM):** retención de corto plazo orientada a investigación operativa reciente (24 horas por defecto en Prometheus).

## 5. Separación entre Demostración y Producción

- En despliegues públicos de demostración, los visitantes anónimos usan por defecto el **Modo Replay** (ejecución grabada), mientras que las ejecuciones reales (**Modo Live**) pueden protegerse con clave dedicada, Cloudflare Turnstile y cooldown global entre activaciones.
- Para uso exclusivo en producción, define `ENABLE_DEMO_MODE=false` en el orquestador: esto oculta el menú **Demostración** en el War Room y deshabilita por completo las rutas `/api/demo/*`.
