import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  signal,
  type Signal,
} from '@angular/core';
import type { TaxDescription } from '../tax-i18n';
import { TaxCodeComponent } from '../tax-code/tax-code.component';
import { TaxDescriptionComponent } from './tax-description.component';

/** One choice of the picker. */
export interface TaxSectionPickerOption {
  readonly value: string;
  readonly label: string;
  /** The code stamp shown before the label; `null` for none. */
  readonly code: string | null;
  /** The tooltip content; `null` = no tooltip for this choice. */
  readonly description: TaxDescription | null;
  /** Drawn muted (a choice that is inherited). */
  readonly inherited?: boolean;
  readonly disabled?: boolean;
}

/** How long typed characters keep building one typeahead search term. */
const TYPEAHEAD_RESET_MS = 600;

let nextId = 0;

/**
 * A single-choice picker for a tax section: a trigger button and a CDK overlay listbox in which the
 * active option (hovered, or reached by keyboard) explains itself in a panel beside the list. A
 * native `<select>` cannot do that, as the browser draws its menu.
 *
 * The explanation sits next to the list instead of floating over it, so it never blocks an option
 * and is not clipped by the table's scroll container. On a touch screen there is no hover: the
 * option last tapped or moved to stays active and keeps its explanation shown.
 *
 * Focus is on the listbox while open and the active option is announced through
 * `aria-activedescendant`; the tip is linked to it with `aria-describedby`.
 */
@Component({
  selector: 'app-tax-section-picker',
  templateUrl: './tax-section-picker.component.html',
  styleUrl: './tax-section-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OverlayModule, CdkTrapFocus, TaxCodeComponent, TaxDescriptionComponent],
})
export class TaxSectionPickerComponent {
  readonly options = input.required<readonly TaxSectionPickerOption[]>();
  readonly ariaLabel = input.required<string>();
  /** Draws the trigger muted (the shown choice is inherited). */
  readonly muted = input<boolean>(false);
  /** The `value` of the chosen option. */
  readonly value = model.required<string>();

  private readonly idPrefix: string = `tax-section-picker-${nextId++}`;
  protected readonly tipId: string = `${this.idPrefix}-tip`;
  protected readonly isOpen = signal<boolean>(false);

  protected readonly panelPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];

  /** The option the trigger shows; a `value` that no option has is a caller bug. */
  protected readonly selected: Signal<TaxSectionPickerOption> = computed(
    (): TaxSectionPickerOption => {
      const value: string = this.value();
      const found: TaxSectionPickerOption | undefined = this.options().find(
        (option: TaxSectionPickerOption): boolean => option.value === value,
      );
      if (found === undefined) throw new Error(`tax section picker has no option "${value}"`);
      return found;
    },
  );

  /**
   * The highlighted option, by value rather than index: the row can re-render with other options
   * (an inherited section changes) while the popup is open, and the highlight must not jump.
   * `null` = follow the chosen value.
   */
  private readonly activeValue = signal<string | null>(null);

  protected readonly activeIndex: Signal<number> = computed((): number => {
    const options: readonly TaxSectionPickerOption[] = this.options();
    const wanted: string = this.activeValue() ?? this.value();
    const index: number = options.findIndex(
      (option: TaxSectionPickerOption): boolean => option.value === wanted,
    );
    return index >= 0 ? index : options.findIndex(isEnabled);
  });

  protected readonly active: Signal<TaxSectionPickerOption> = computed(
    (): TaxSectionPickerOption => {
      const option: TaxSectionPickerOption | undefined = this.options()[this.activeIndex()];
      if (option === undefined) throw new Error('tax section picker has no selectable option');
      return option;
    },
  );

  private typeahead = '';
  private typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy((): void => this.clearTypeahead());
  }

  protected optionId(index: number): string {
    return `${this.idPrefix}-option-${index}`;
  }

  /**
   * Click and keys on the trigger stop here. The picker sits in a selectable table row: PrimeNG
   * would select the row on click (re-rendering it under the open popup) and cancel Enter's
   * default on keydown, which swallows the button's own activation. The popup lives in the CDK
   * overlay container, outside the row, so its events never reach the row.
   */
  protected onTriggerClick(event: Event): void {
    event.stopPropagation();
    this.toggle();
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.open();
    }
  }

  protected close(): void {
    this.isOpen.set(false);
    this.clearTypeahead();
  }

  protected activate(index: number): void {
    const option: TaxSectionPickerOption | undefined = this.options()[index];
    if (option === undefined) throw new Error(`no tax section option at ${index}`);
    if (isEnabled(option)) this.activeValue.set(option.value);
  }

  protected choose(index: number): void {
    const option: TaxSectionPickerOption | undefined = this.options()[index];
    if (option === undefined) throw new Error(`no tax section option at ${index}`);
    if (!isEnabled(option)) return;
    if (option.value !== this.value()) this.value.set(option.value);
    this.close();
  }

  /**
   * Hover (`choose` false) highlights, a click (`choose` true) picks. One handler on the list
   * instead of one per option: the options are not focusable, the list is.
   */
  protected onListPointer(event: Event, choose: boolean): void {
    if (!(event.target instanceof Element)) return;
    const optionElement: Element | null = event.target.closest('[role="option"]');
    if (optionElement === null) return;
    const index = Number(optionElement.getAttribute('data-index'));
    if (!Number.isInteger(index)) throw new Error('tax section option without an index');
    if (choose) this.choose(index);
    else this.activate(index);
  }

  protected onListKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        this.move(this.step(1));
        break;
      case 'ArrowUp':
        this.move(this.step(-1));
        break;
      case 'Home':
        this.move(this.options().findIndex(isEnabled));
        break;
      case 'End':
        this.move(this.lastEnabledIndex());
        break;
      case 'Enter':
      case ' ':
        this.choose(this.activeIndex());
        break;
      case 'Tab':
        this.close();
        return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          this.search(event.key);
          break;
        }
        return;
    }
    event.preventDefault();
  }

  private toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  private open(): void {
    this.activeValue.set(null);
    this.isOpen.set(true);
  }

  /** The next enabled index in `direction`, stopping at the ends. */
  private step(direction: 1 | -1): number {
    const options: readonly TaxSectionPickerOption[] = this.options();
    let index: number = this.activeIndex() + direction;
    while (index >= 0 && index < options.length) {
      if (isEnabled(options[index])) return index;
      index += direction;
    }
    return this.activeIndex();
  }

  private lastEnabledIndex(): number {
    const options: readonly TaxSectionPickerOption[] = this.options();
    for (let index = options.length - 1; index >= 0; index--) {
      if (isEnabled(options[index])) return index;
    }
    return -1;
  }

  private move(index: number): void {
    if (index < 0) return;
    this.activate(index);
    // The option elements exist already; keep the active one visible in the scrolling list.
    document.getElementById(this.optionId(index))?.scrollIntoView({ block: 'nearest' });
  }

  private search(character: string): void {
    if (this.typeaheadTimer !== null) clearTimeout(this.typeaheadTimer);
    this.typeahead += character.toLowerCase();
    this.typeaheadTimer = setTimeout((): void => this.clearTypeahead(), TYPEAHEAD_RESET_MS);
    const term: string = this.typeahead;
    const index: number = this.options().findIndex(
      (option: TaxSectionPickerOption): boolean =>
        isEnabled(option) &&
        (option.label.toLowerCase().startsWith(term) ||
          (option.code?.toLowerCase().startsWith(term) ?? false)),
    );
    this.move(index);
  }

  /** Ends the current search term and its reset timer. */
  private clearTypeahead(): void {
    this.typeahead = '';
    if (this.typeaheadTimer !== null) clearTimeout(this.typeaheadTimer);
    this.typeaheadTimer = null;
  }
}

function isEnabled(option: TaxSectionPickerOption): boolean {
  return option.disabled !== true;
}
