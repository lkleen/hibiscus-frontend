import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LocaleService } from '../../../../core/services/locale.service';
import { cellParams, gridContext, transaction } from '../../testing/transaction-fixture';
import { AmountCellComponent } from './amount-cell.component';

registerLocaleData(localeDe);

describe('AmountCellComponent', () => {
  let fixture: ComponentFixture<AmountCellComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AmountCellComponent] });
    fixture = TestBed.createComponent(AmountCellComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  function render(value: number | null): void {
    fixture.componentInstance.agInit(cellParams(transaction(), gridContext(), value));
    fixture.detectChanges();
  }

  function text(selector: string): string {
    return host.querySelector(selector)?.textContent?.trim() ?? '';
  }

  it('renders both amount formats so a theme can pick one', () => {
    render(-1234.5);

    expect(text('.transaction-table__amount-signed')).toBe('-1,234.50');
    expect(text('.transaction-table__amount-paren')).toBe('1,234.50');
  });

  it('marks negative and positive amounts with the classes the themes target', () => {
    render(-5);
    expect(host.classList).toContain('transaction-table__amount--negative');
    expect(host.classList).not.toContain('transaction-table__amount--positive');

    render(5);
    expect(host.classList).toContain('transaction-table__amount--positive');
    expect(host.classList).not.toContain('transaction-table__amount--negative');
  });

  it('marks a zero amount as neither negative nor positive', () => {
    render(0);

    expect(host.classList).not.toContain('transaction-table__amount--negative');
    expect(host.classList).not.toContain('transaction-table__amount--positive');
  });

  it('renders a dash for a missing value, e.g. a transaction without a balance', () => {
    render(null);

    expect(host.textContent?.trim()).toBe('—');
    expect(host.querySelector('.transaction-table__amount-signed')).toBeNull();
    expect(host.classList).not.toContain('transaction-table__amount--negative');
  });

  it('follows the active locale and updates on refresh', () => {
    TestBed.inject(LocaleService).locale.set('de');
    render(-1234.5);
    expect(text('.transaction-table__amount-signed')).toBe('-1.234,50');

    fixture.componentInstance.refresh(cellParams(transaction(), gridContext(), 99));
    fixture.detectChanges();
    expect(text('.transaction-table__amount-signed')).toBe('99,00');
  });
});
