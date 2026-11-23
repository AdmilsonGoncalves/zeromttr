import { Injector, runInInjectionContext, type InputSignal } from '@angular/core';
import { SIGNAL, signalSetFn, type SignalNode } from '@angular/core/primitives/signals';

/**
 * Instantiates an Angular component within a minimal injection context for pure Node unit tests.
 */
export function createInInjectionContext<T>(factory: () => T): T {
  const injector = Injector.create({ providers: [] });
  return runInInjectionContext(injector, factory);
}

/**
 * Sets the value of an Angular signal input (`input()` / `input.required()`) in unit tests.
 */
export function setInputSignal<T>(signalRef: InputSignal<T>, value: T): void {
  const node = (signalRef as unknown as Record<symbol, SignalNode<T>>)[SIGNAL];
  signalSetFn(node, value);
}
