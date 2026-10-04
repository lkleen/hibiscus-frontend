import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  Signal,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import { TranslationService } from '../../../core/services/translation.service';
import { accountLabel } from '../../../core/utils/account-label';

/** A panel row: the account, the name it is shown under, and its IBAN (else account number). */
export interface AccountFilterItem {
  readonly id: number;
  readonly label: string;
  readonly number: string;
  readonly checked: boolean;
}

let nextId = 0;

/**
 * Account picker for the transactions toolbar: a dropdown of checkboxes, one per account, plus an
 * "All accounts" row. Only transactions of checked accounts are shown.
 *
 * The state is the set of *excluded* account ids, so every account is checked by default —
 * including accounts that load after the user unchecked others. Session-only state of the parent.
 *
 * A CDK overlay, not a CDK menu: a menu item closes the menu on click, which would make ticking
 * several accounts one dropdown trip each.
 */
@Component({
  selector: 'app-account-filter',
  templateUrl: './account-filter.component.html',
  styleUrl: './account-filter.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OverlayModule, CdkTrapFocus],
})
export class AccountFilterComponent {
  protected readonly i18n = inject(TranslationService);

  readonly accounts = input.required<readonly AccountRow[]>();
  readonly excludedIds = model<ReadonlySet<number>>(new Set<number>());

  protected readonly id: string = `account-filter-${nextId++}`;
  protected readonly isOpen = signal<boolean>(false);

  protected readonly panelPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];

  protected readonly items: Signal<readonly AccountFilterItem[]> = computed(
    (): readonly AccountFilterItem[] => {
      const excluded: ReadonlySet<number> = this.excludedIds();
      return this.accounts().map((account: AccountRow): AccountFilterItem => ({
        id: account.id,
        label: accountLabel(account),
        number: account.iban ?? account.kontonummer,
        checked: !excluded.has(account.id),
      }));
    },
  );

  private readonly checkedCount: Signal<number> = computed(
    (): number => this.items().filter((item: AccountFilterItem): boolean => item.checked).length,
  );

  protected readonly allChecked: Signal<boolean> = computed(
    (): boolean => this.checkedCount() === this.items().length,
  );

  protected readonly someChecked: Signal<boolean> = computed(
    (): boolean => this.checkedCount() > 0 && !this.allChecked(),
  );

  protected readonly triggerLabel: Signal<string> = computed((): string => {
    const items: readonly AccountFilterItem[] = this.items();
    const checked: readonly AccountFilterItem[] = items.filter(
      (item: AccountFilterItem): boolean => item.checked,
    );
    if (checked.length === items.length) return this.i18n.t('accountFilter.all');
    if (checked.length === 0) return this.i18n.t('accountFilter.none');
    if (checked.length === 1) return checked[0].label;
    return this.i18n.t('accountFilter.some', { count: checked.length, total: items.length });
  });

  protected toggleOpen(): void {
    this.isOpen.set(!this.isOpen());
  }

  /**
   * Backdrop click or Escape (the CDK overlay detaches itself on Escape). Focus goes back to the
   * trigger through `cdkTrapFocusAutoCapture`, which restores what was focused before opening.
   */
  protected onDetach(): void {
    this.isOpen.set(false);
  }

  protected toggleAccount(accountId: number): void {
    const next: Set<number> = new Set<number>(this.excludedIds());
    if (next.has(accountId)) next.delete(accountId);
    else next.add(accountId);
    this.excludedIds.set(next);
  }

  /** Checks every account unless all are checked already, in which case it unchecks them all. */
  protected toggleAll(): void {
    this.excludedIds.set(
      this.allChecked()
        ? new Set<number>(this.accounts().map((account: AccountRow): number => account.id))
        : new Set<number>(),
    );
  }
}
