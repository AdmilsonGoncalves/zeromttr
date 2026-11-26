import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { Tooltip } from 'primeng/tooltip';
import { I18nService, Language } from '../../core/i18n/i18n.service.js';

export interface LocaleOption {
  code: Language;
  flag: string;
  label: string;
}

const LOCALE_OPTIONS: LocaleOption[] = [
  { code: Language.PT_BR, flag: '🇧🇷', label: 'Português' },
  { code: Language.EN_US, flag: '🇺🇸', label: 'English' },
  { code: Language.ES_ES, flag: '🇪🇸', label: 'Español' }
];

/**
 * Compact flag dropdown locale switcher supporting Portuguese, English, and Spanish.
 */
@Component({
  selector: 'app-locale-switcher',
  imports: [NgClass, Tooltip],
  templateUrl: './locale-switcher.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LocaleSwitcherComponent {
  readonly i18n: I18nService;
  readonly localeOptions: LocaleOption[] = LOCALE_OPTIONS;

  readonly currentLangSignal = signal<Language>(Language.PT_BR);
  readonly isOpenSignal = signal<boolean>(false);
  readonly activeLocale = computed<LocaleOption>(() => {
    const code = this.currentLangSignal();
    return this.localeOptions.find((opt) => opt.code === code) ?? this.localeOptions[0]!;
  });

  @ViewChild('rootRef') rootRef?: ElementRef<HTMLElement>;
  @ViewChild('triggerBtn') triggerBtn?: ElementRef<HTMLButtonElement>;

  @Input({ required: true })
  set currentLang(value: Language) {
    this.currentLangSignal.set(value);
  }

  @Output() readonly langChange = new EventEmitter<Language>();

  constructor(...args: [I18nService?]) {
    const [i18n] = args;
    this.i18n = i18n ?? inject(I18nService);
  }

  /**
   * Toggles the locale selection dropdown menu.
   */
  toggleMenu(): void {
    this.isOpenSignal.update((open) => !open);
  }

  /**
   * Emits the newly chosen language and closes the dropdown menu.
   */
  selectLocale(code: Language): void {
    this.langChange.emit(code);
    this.isOpenSignal.set(false);
    this.triggerBtn?.nativeElement?.focus();
  }

  /**
   * Handles keyboard navigation and Escape dismissal inside the locale menu.
   */
  onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.isOpenSignal.set(false);
      this.triggerBtn?.nativeElement?.focus();
      return;
    }

    if (event.key === 'Tab') {
      this.isOpenSignal.set(false);
      return;
    }

    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      event.preventDefault();
      const buttons = Array.from(
        this.rootRef?.nativeElement?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitemradio"]'
        ) ?? []
      );
      if (buttons.length === 0) {
        return;
      }
      const activeIdx = buttons.indexOf(globalThis.document?.activeElement as HTMLButtonElement);
      let nextIdx = 0;
      if (event.key === 'End') {
        nextIdx = buttons.length - 1;
      } else if (event.key === 'ArrowDown') {
        nextIdx = activeIdx < 0 ? 0 : (activeIdx + 1) % buttons.length;
      } else if (event.key === 'ArrowUp') {
        nextIdx = activeIdx <= 0 ? buttons.length - 1 : activeIdx - 1;
      }
      buttons[nextIdx]?.focus();
    }
  }

  /**
   * Closes the dropdown when a pointer click lands outside the switcher.
   */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.isOpenSignal()) {
      return;
    }
    const target = event.target as Node | null;
    if (target && !this.rootRef?.nativeElement?.contains(target)) {
      this.isOpenSignal.set(false);
    }
  }
}
