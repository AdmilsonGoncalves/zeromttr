import { Injector, runInInjectionContext, type StaticProvider } from '@angular/core';

/**
 * Instantiates an Angular class inside a lightweight synthetic injection context
 * without requiring TestBed or a DOM environment.
 */
export function createWithInjector<T>(
  ComponentType: new () => T,
  providers: StaticProvider[] = []
): T {
  const injector = Injector.create({ providers });
  return runInInjectionContext(injector, () => new ComponentType());
}
