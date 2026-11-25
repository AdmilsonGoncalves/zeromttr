import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nService } from '../src/app/core/i18n.service.js';
import { FsmTimelineComponent } from '../src/app/war-room/fsm-timeline/fsm-timeline.component.js';

describe('FsmTimelineComponent', () => {
  let i18n: I18nService;
  let component: FsmTimelineComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new FsmTimelineComponent(i18n);
    component.stages = [];
    component.hintKey = 'fsmHintAwaitingAlert';
    component.liveWaitSeconds = 17;
  });

  it('should format hint with liveWaitSeconds signal', () => {
    expect(component.formattedHint()).toContain('17');
  });

  it('should reactively update formattedHint when hintKey, seconds, or language change', () => {
    component.liveWaitSeconds = 42;
    expect(component.formattedHint()).toContain('42');

    i18n.setLang('en');
    expect(component.formattedHint()).toContain('42');

    component.hintKey = 'fsmHintNotified';
    expect(component.formattedHint()).toBe(i18n.t('fsmHintNotified'));
  });
});
