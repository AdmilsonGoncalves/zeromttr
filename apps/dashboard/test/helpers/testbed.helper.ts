import '@angular/compiler';
import {
  type EnvironmentProviders,
  type Provider,
  type Type,
  provideZonelessChangeDetection
} from '@angular/core';
import { type ComponentFixture, TestBed, getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

let isTestEnvironmentInitialized = false;

/**
 * Ensures Angular's browser testing environment is initialized once per Vitest worker.
 */
export function ensureAngularTestEnvironment(): void {
  if (isTestEnvironmentInitialized) {
    return;
  }
  if (!getTestBed().platform) {
    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  }
  isTestEnvironmentInitialized = true;
}

export interface DashboardTestBedOptions {
  imports?: Array<Type<unknown> | Record<string, unknown>>;
  providers?: Array<Provider | EnvironmentProviders>;
}

/**
 * Resets and configures Angular TestBed with zoneless change detection for fast happy-dom tests.
 */
export function configureDashboardTestBed(options: DashboardTestBedOptions = {}): void {
  ensureAngularTestEnvironment();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: options.imports ?? [],
    providers: [provideZonelessChangeDetection(), ...(options.providers ?? [])]
  });
}

/**
 * Creates a component fixture in TestBed and triggers initial change detection and effects.
 */
export function createDashboardFixture<T>(
  ComponentType: Type<T>,
  options: DashboardTestBedOptions = {}
): ComponentFixture<T> {
  configureDashboardTestBed({
    imports: [ComponentType, ...(options.imports ?? [])],
    providers: options.providers
  });
  const fixture = TestBed.createComponent(ComponentType);
  fixture.detectChanges();
  return fixture;
}
