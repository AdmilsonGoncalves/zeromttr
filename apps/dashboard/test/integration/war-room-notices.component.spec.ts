// @vitest-environment happy-dom
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nService } from '../../src/app/core/i18n/i18n.service.js';
import { WarRoomNoticesComponent } from '../../src/app/war-room/war-room-notices/war-room-notices.component.js';
import { createDashboardFixture } from '../helpers/testbed.helper.js';

const TURNSTILE_SCRIPT_ID = 'cf-turnstile-api-script';

describe('WarRoomNoticesComponent (TestBed)', () => {
  let i18n: I18nService;

  beforeEach(() => {
    i18n = new I18nService();
    delete window.turnstile;
    document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
  });

  afterEach(() => {
    delete window.turnstile;
    document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
  });

  it('should_mount_turnstile_widget_via_reactive_effect_and_emit_token_callbacks', () => {
    let capturedOptions:
      | {
          sitekey: string;
          theme?: string;
          size?: string;
          appearance?: string;
          callback?: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        }
      | undefined;

    const renderSpy = vi.fn((_host: HTMLElement, options) => {
      capturedOptions = options;
      return 'widget-123';
    });
    const resetSpy = vi.fn();
    const removeSpy = vi.fn();

    window.turnstile = {
      render: renderSpy,
      reset: resetSpy,
      remove: removeSpy
    };

    const fixture = createDashboardFixture(WarRoomNoticesComponent, {
      providers: [{ provide: I18nService, useValue: i18n }]
    });
    const component = fixture.componentInstance;

    const emittedTokens: Array<string | null> = [];
    component.turnstileTokenChange.subscribe((token) => emittedTokens.push(token));

    // Initially hidden when siteKey is null
    expect(fixture.nativeElement.textContent.trim()).toBe('');

    // Setting inputs renders #turnstileContainer and triggers the reactive mount effect
    fixture.componentRef.setInput('turnstileSiteKey', '0x4AAAAAA');
    fixture.componentRef.setInput('simulationLockedByTurnstile', true);
    fixture.detectChanges();
    TestBed.tick();

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(capturedOptions?.sitekey).toBe('0x4AAAAAA');
    expect(capturedOptions?.size).toBe('normal');
    expect(capturedOptions?.appearance).toBe('interaction-only');
    expect(fixture.nativeElement.textContent).toContain(i18n.t('turnstilePendingNotice'));
    expect(fixture.nativeElement.textContent).not.toContain('replayNotice');

    // Callbacks from Turnstile propagate through Output
    capturedOptions?.callback?.('cf-token-valid');
    fixture.componentRef.setInput('simulationLockedByTurnstile', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(i18n.t('turnstileVerifiedBadge'));

    capturedOptions?.['expired-callback']?.();
    capturedOptions?.['error-callback']?.();
    expect(emittedTokens).toEqual(['cf-token-valid', null, null]);

    fixture.destroy();
    expect(removeSpy).toHaveBeenCalledWith('widget-123');
    expect(emittedTokens[emittedTokens.length - 1]).toBeNull();
  });

  it('should_reset_mounted_turnstile_widget_when_turnstileResetTrigger_increments', () => {
    const renderSpy = vi.fn(() => 'widget-reset-1');
    const resetSpy = vi.fn();
    const removeSpy = vi.fn();

    window.turnstile = {
      render: renderSpy,
      reset: resetSpy,
      remove: removeSpy
    };

    const fixture = createDashboardFixture(WarRoomNoticesComponent, {
      providers: [{ provide: I18nService, useValue: i18n }]
    });

    fixture.componentRef.setInput('turnstileSiteKey', '0x4BBBBBB');
    fixture.detectChanges();
    TestBed.tick();

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(resetSpy).not.toHaveBeenCalled();

    fixture.componentRef.setInput('turnstileResetTrigger', 1);
    fixture.detectChanges();
    TestBed.tick();

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(resetSpy).toHaveBeenCalledWith('widget-reset-1');

    fixture.destroy();
  });

  it('should_inject_turnstile_script_surface_load_error_and_recover_on_retry', () => {
    const appendedScripts: HTMLScriptElement[] = [];
    const appendSpy = vi
      .spyOn(document.head, 'appendChild')
      .mockImplementation(<T extends Node>(node: T): T => {
        if (node instanceof HTMLScriptElement && node.id === TURNSTILE_SCRIPT_ID) {
          appendedScripts.push(node);
          return node;
        }
        return Node.prototype.appendChild.call(document.head, node) as T;
      });

    try {
      const fixture = createDashboardFixture(WarRoomNoticesComponent, {
        providers: [{ provide: I18nService, useValue: i18n }]
      });
      const component = fixture.componentInstance;

      const tokenSpy = vi.fn();
      component.turnstileTokenChange.subscribe(tokenSpy);

      fixture.componentRef.setInput('turnstileSiteKey', '0x4CCCCCC');
      fixture.detectChanges();
      TestBed.tick();

      expect(appendedScripts).toHaveLength(1);
      expect(appendedScripts[0]?.src).toContain('challenges.cloudflare.com/turnstile/v0/api.js');

      // Simulate script network error
      appendedScripts[0]?.dispatchEvent(new Event('error'));
      fixture.detectChanges();

      expect(component.turnstileLoadErrorSignal()).toBe(true);
      expect(tokenSpy).toHaveBeenCalledWith(null);
      expect(fixture.nativeElement.textContent).toContain(i18n.t('turnstileLoadFailedNotice'));

      // Retry script load and simulate successful Turnstile availability
      const renderSpy = vi.fn(() => 'widget-recovered');
      component.retryTurnstileLoad();
      fixture.detectChanges();

      expect(appendedScripts).toHaveLength(2);

      window.turnstile = {
        render: renderSpy,
        reset: vi.fn(),
        remove: vi.fn()
      };
      appendedScripts[1]?.dispatchEvent(new Event('load'));
      fixture.detectChanges();

      expect(component.turnstileLoadErrorSignal()).toBe(false);
      expect(renderSpy).toHaveBeenCalledTimes(1);

      fixture.destroy();
    } finally {
      appendSpy.mockRestore();
    }
  });

  it('should_safely_ignore_retryTurnstileLoad_when_host_element_or_site_key_is_missing', () => {
    const fixture = createDashboardFixture(WarRoomNoticesComponent, {
      providers: [{ provide: I18nService, useValue: i18n }]
    });
    const component = fixture.componentInstance;

    component.turnstileLoadErrorSignal.set(true);
    component.retryTurnstileLoad();
    expect(component.turnstileLoadErrorSignal()).toBe(true);

    fixture.destroy();
  });
});
