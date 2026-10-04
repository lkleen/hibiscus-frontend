import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';
import { account } from '../testing/transaction-fixture';
import { AccountFilterComponent } from './account-filter.component';

const ACCOUNTS: AccountRow[] = [
  account({ id: 1, bezeichnung: 'Checking', iban: 'DE02120300000000202051' }),
  account({ id: 2, bezeichnung: 'Savings', kontonummer: '87654321' }),
  account({ id: 3, bezeichnung: null, name: 'Jane Doe' }),
];

describe('AccountFilterComponent', () => {
  let fixture: ComponentFixture<AccountFilterComponent>;
  let root: HTMLElement;

  beforeEach(() => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      imports: [AccountFilterComponent],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(AccountFilterComponent);
    fixture.componentRef.setInput('accounts', ACCOUNTS);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  function trigger(): HTMLButtonElement {
    const button: HTMLButtonElement | null = root.querySelector('.account-filter__trigger');
    if (!button) throw new Error('trigger not rendered');
    return button;
  }

  function triggerText(): string {
    return trigger().textContent?.trim() ?? '';
  }

  /** The panel lives in the CDK overlay container, outside the component's own element. */
  function panel(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.account-filter__panel');
  }

  function open(): void {
    trigger().click();
    fixture.detectChanges();
  }

  /** Checkbox 0 is "All accounts", then one per account in input order. */
  function checkbox(index: number): HTMLInputElement {
    const boxes: HTMLInputElement[] = Array.from(
      panel()?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [],
    );
    const box: HTMLInputElement | undefined = boxes[index];
    if (!box) throw new Error(`checkbox ${index} not rendered`);
    return box;
  }

  function click(box: HTMLInputElement): void {
    box.click();
    fixture.detectChanges();
  }

  it('starts with every account checked', () => {
    expect(triggerText()).toBe('All accounts');
    open();
    expect(panel()).not.toBeNull();
    expect([0, 1, 2, 3].map((i: number): boolean => checkbox(i).checked)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('lists each account under its label with its IBAN, else account number, else holder', () => {
    open();
    const text: string = panel()?.textContent ?? '';
    expect(text).toContain('Checking');
    expect(text).toContain('DE02120300000000202051');
    expect(text).toContain('Savings');
    expect(text).toContain('87654321');
    expect(text).toContain('Jane Doe');
  });

  it('excludes an unchecked account and stays open for the next one', () => {
    open();
    click(checkbox(2));
    expect([...fixture.componentInstance.excludedIds()]).toEqual([2]);
    expect(triggerText()).toBe('2 of 3 accounts');
    expect(checkbox(0).indeterminate).toBe(true);
    expect(panel()).not.toBeNull();

    click(checkbox(3));
    expect(triggerText()).toBe('Checking');

    click(checkbox(2));
    expect([...fixture.componentInstance.excludedIds()]).toEqual([3]);
  });

  it('toggles every account with the "All accounts" row', () => {
    open();
    click(checkbox(0));
    expect([...fixture.componentInstance.excludedIds()].sort()).toEqual([1, 2, 3]);
    expect(triggerText()).toBe('No accounts');

    click(checkbox(0));
    expect(fixture.componentInstance.excludedIds().size).toBe(0);
    expect(triggerText()).toBe('All accounts');
  });

  it('checks every account when "All accounts" is clicked on a partial selection', () => {
    fixture.componentInstance.excludedIds.set(new Set<number>([1]));
    open();
    click(checkbox(0));
    expect(fixture.componentInstance.excludedIds().size).toBe(0);
  });

  it('closes on Escape and returns focus to the trigger', () => {
    trigger().focus();
    open();
    checkbox(1).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }),
    );
    fixture.detectChanges();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});
