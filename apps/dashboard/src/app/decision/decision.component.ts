import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { isEmpty, isNonEmptyString, isNumber, toErrorMessage } from '@zeromttr/utils';
import { Button } from 'primeng/button';
import { Card } from 'primeng/card';
import { Tag } from 'primeng/tag';
import {
  type DecisionPayload,
  I18nService,
  type IncidentDecisionAction,
  IncidentService
} from '../core/index.js';

@Component({
  selector: 'app-decision',
  imports: [CommonModule, RouterModule, Button, Card, Tag],
  templateUrl: './decision.component.html',
  styleUrl: './decision.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DecisionComponent implements OnInit {
  readonly route: ActivatedRoute;
  readonly i18n: I18nService;
  readonly incidentService: IncidentService;

  readonly incidentId = signal<string>('');
  readonly action = signal<IncidentDecisionAction | null>(null);
  readonly sig = signal<string>('');
  readonly exp = signal<number>(0);
  readonly isExpired = signal<boolean>(false);
  readonly isValid = signal<boolean>(false);
  readonly isSubmitting = signal<boolean>(false);
  readonly status = signal<'idle' | 'success' | 'error'>('idle');
  readonly errorMessage = signal<string>('');

  readonly expirationFormatted = computed<string>(() => {
    const expiration = this.exp();
    if (expiration <= 0) {
      return 'N/A';
    }
    return new Date(expiration * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  });

  constructor(...args: [ActivatedRoute?, I18nService?, IncidentService?]) {
    const [route, i18n, incidentService] = args;
    this.route = route ?? inject(ActivatedRoute);
    this.i18n = i18n ?? inject(I18nService);
    this.incidentService = incidentService ?? inject(IncidentService);
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.incidentId.set(id);

    this.parseFragment();
  }

  parseFragment(): void {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (isEmpty(hash) || hash.length < 2) {
      this.isValid.set(false);
      this.errorMessage.set('Fragmento HMAC ausente na URL (#action=...&sig=...&exp=...)');
      return;
    }

    const fragmentString = hash.startsWith('#') ? hash.slice(1) : hash;
    const params = new URLSearchParams(fragmentString);

    const actionParam = params.get('action');
    const sigParam = params.get('sig');
    const expRaw = params.get('exp');
    const expParam = isNonEmptyString(expRaw) ? Number(expRaw) : NaN;

    if (!isNonEmptyString(actionParam) || (actionParam !== 'approve' && actionParam !== 'reject')) {
      this.isValid.set(false);
      this.errorMessage.set('Parâmetro action inválido no hash (esperado approve ou reject)');
      return;
    }

    if (!isNonEmptyString(sigParam)) {
      this.isValid.set(false);
      this.errorMessage.set('Assinatura sig HMAC ausente no hash');
      return;
    }

    if (!isNumber(expParam) || expParam <= 0) {
      this.isValid.set(false);
      this.errorMessage.set('Timestamp exp inválido no hash');
      return;
    }

    this.action.set(actionParam);
    this.sig.set(sigParam);
    this.exp.set(expParam);

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (expParam < nowSeconds) {
      this.isExpired.set(true);
      this.isValid.set(false);
      this.errorMessage.set('Link de decisão HMAC expirou');
      return;
    }

    this.isExpired.set(false);
    this.isValid.set(true);
  }

  async executeDecision(): Promise<void> {
    if (!this.isValid() || this.isExpired()) {
      return;
    }

    this.isSubmitting.set(true);
    this.status.set('idle');

    try {
      const payload: DecisionPayload = {
        action: this.action()!,
        sig: this.sig(),
        exp: this.exp()
      };

      const success = await this.incidentService.submitDecision(this.incidentId(), payload);
      this.isSubmitting.set(false);

      if (success) {
        this.status.set('success');
      } else {
        this.status.set('error');
      }
    } catch (err: unknown) {
      this.isSubmitting.set(false);
      this.errorMessage.set(toErrorMessage(err));
      this.status.set('error');
    }
  }
}
