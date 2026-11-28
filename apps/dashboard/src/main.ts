import '@angular/compiler';
import 'zone.js';
import './styles.css';
import { enableProdMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component.js';
import { appConfig } from './app/app.config.js';

export { appConfig };

/**
 * Enables Angular production mode when running a production Vite bundle.
 */
export function configureAngularRuntimeMode(isProd = Boolean(import.meta.env?.PROD)): boolean {
  if (isProd) {
    enableProdMode();
    return true;
  }
  return false;
}

/**
 * Returns a readiness marker indicating the dashboard module is loaded.
 */
export function initDashboard(): { status: string } {
  return { status: 'initialized' };
}

/**
 * Bootstraps the standalone Angular War Room application.
 */
export function startApp(): Promise<unknown> {
  configureAngularRuntimeMode();
  return bootstrapApplication(AppComponent, appConfig);
}

// Bootstrap automatically when running in browser
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  startApp().catch((err: unknown) => {
    console.error('Failed to bootstrap ZeroMTTR War Room Dashboard:', err);
  });
}
