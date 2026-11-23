import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Timeline } from 'primeng/timeline';
import { Tooltip } from 'primeng/tooltip';
import { I18nService, type TranslationDictionary } from '../../core/i18n.service.js';
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
  readonly i18n: I18nService;

  readonly stages = input.required<FsmStageItem[]>();
  readonly hintKey = input.required<keyof TranslationDictionary>();
  readonly liveWaitSeconds = input.required<number>();

  readonly formattedHint = computed<string>(() => {
    return this.i18n.t(this.hintKey()).replace('{N}', this.liveWaitSeconds().toString());
  });

  constructor(i18n?: I18nService) {
    this.i18n = i18n ?? inject(I18nService);
  }
}
