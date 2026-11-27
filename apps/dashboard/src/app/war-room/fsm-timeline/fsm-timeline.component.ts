import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Timeline } from 'primeng/timeline';
import { Tooltip } from 'primeng/tooltip';
import { FsmStageStatus } from '../../core/constants.js';
import { I18nService, type TranslationDictionary } from '../../core/i18n/i18n.service.js';
import type { FsmStageItem } from '../../core/incident.service.js';

/**
 * Horizontal FSM incident lifecycle timeline with live stage status and contextual hints.
 */
@Component({
  selector: 'app-fsm-timeline',
  imports: [CommonModule, Timeline, Tooltip],
  templateUrl: './fsm-timeline.component.html',
  styleUrl: './fsm-timeline.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FsmTimelineComponent {
  readonly i18n = inject(I18nService);
  readonly stageStatus = FsmStageStatus;

  readonly stagesSignal = signal<FsmStageItem[]>([]);
  readonly hintKeySignal = signal<keyof TranslationDictionary>('fsmHintAwaitingAlert');
  readonly liveWaitSecondsSignal = signal<number>(0);

  @Input({ required: true })
  set stages(value: FsmStageItem[]) {
    this.stagesSignal.set(value);
  }

  @Input({ required: true })
  set hintKey(value: keyof TranslationDictionary) {
    this.hintKeySignal.set(value);
  }

  @Input({ required: true })
  set liveWaitSeconds(value: number) {
    this.liveWaitSecondsSignal.set(value);
  }

  readonly formattedHint = computed<string>(() => {
    return this.i18n
      .t(this.hintKeySignal())
      .replace('{N}', this.liveWaitSecondsSignal().toString());
  });
}
