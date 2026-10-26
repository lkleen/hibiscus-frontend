import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { installMutationObserverMock } from '../../utils/testing/mutation-observer-mock';
import { TranslationService } from '../../services/translation.service';
import { taxPlainDescription, taxSectionDescription } from '../tax-i18n';
import { taxSectionByCode } from '../tax-sections';
import {
  TaxSectionPickerComponent,
  type TaxSectionPickerOption,
} from './tax-section-picker.component';

@Component({
  imports: [TaxSectionPickerComponent],
  template: `
    <div class="row">
      <app-tax-section-picker
        [options]="options()"
        [(value)]="value"
        ariaLabel="Tax section"
        [muted]="false"
      />
    </div>
  `,
})
class HostComponent {
  rowClicks = 0;
  readonly value = signal<string>('');
  readonly options = signal<readonly TaxSectionPickerOption[]>([]);
}

describe('TaxSectionPickerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(() => {
    installMutationObserverMock();
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const i18n: TranslationService = TestBed.inject(TranslationService);
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    host.options.set([
      {
        value: '',
        label: 'None',
        code: null,
        description: taxPlainDescription('Not part of the tax return.'),
      },
      {
        value: 'St-SA',
        label: 'Special expenses',
        code: 'St-SA',
        description: taxSectionDescription(i18n, taxSectionByCode('St-SA')),
      },
      {
        value: 'St-AB',
        label: 'Extraordinary burdens',
        code: 'St-AB',
        description: taxSectionDescription(i18n, taxSectionByCode('St-AB')),
      },
    ]);
    (fixture.nativeElement as HTMLElement)
      .querySelector('.row')
      ?.addEventListener('click', () => host.rowClicks++);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  function trigger(): HTMLButtonElement {
    const found: HTMLButtonElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      'button',
    );
    if (!found) throw new Error('no trigger');
    return found;
  }

  function listbox(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="listbox"]');
  }

  function options(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
  }

  function key(name: string): void {
    const list: HTMLElement | null = listbox();
    if (!list) throw new Error('not open');
    list.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  }

  function open(): void {
    trigger().click();
    fixture.detectChanges();
  }

  it('opens and closes on the trigger and on Tab', () => {
    open();
    expect(listbox()).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    key('Tab');
    expect(listbox()).toBeNull();
  });

  it('keeps clicks on the trigger away from the surrounding row', () => {
    open();
    expect(host.rowClicks).toBe(0);
  });

  it('moves with the arrow keys, Home and End, and picks with Enter', () => {
    open();
    const list: HTMLElement = listbox() as HTMLElement;
    expect(list.getAttribute('aria-activedescendant')).toBe(options()[0].id);
    key('ArrowDown');
    expect(list.getAttribute('aria-activedescendant')).toBe(options()[1].id);
    key('End');
    expect(list.getAttribute('aria-activedescendant')).toBe(options()[2].id);
    key('Home');
    expect(list.getAttribute('aria-activedescendant')).toBe(options()[0].id);
    key('ArrowDown');
    key('Enter');
    expect(host.value()).toBe('St-SA');
    expect(listbox()).toBeNull();
    expect(trigger().textContent).toContain('Special expenses');
  });

  it('jumps to an option by typing its name', () => {
    open();
    key('e');
    key('x');
    expect((listbox() as HTMLElement).getAttribute('aria-activedescendant')).toBe(options()[2].id);
  });

  it('emits the clicked option', () => {
    open();
    options()[2].click();
    fixture.detectChanges();
    expect(host.value()).toBe('St-AB');
  });

  it('explains the hovered option, naming donations for the special expenses', () => {
    open();
    options()[1].dispatchEvent(new Event('pointermove', { bubbles: true }));
    fixture.detectChanges();
    const tip: HTMLElement | null = document.querySelector<HTMLElement>('[role="tooltip"]');
    if (!tip) throw new Error('no tooltip');
    expect(tip.textContent).toContain('donations');
    expect(tip.textContent).toContain('Not included:');
    expect(tip.textContent).toContain('Form: Anlage Sonderausgaben');
    expect(options()[1].getAttribute('aria-describedby')).toBe(tip.id);
    expect(options()[0].getAttribute('aria-describedby')).toBeNull();
  });

  it('keeps the highlight on its option when the options are replaced while open', () => {
    open();
    key('ArrowDown');
    host.options.set([...host.options()]);
    fixture.detectChanges();
    expect((listbox() as HTMLElement).getAttribute('aria-activedescendant')).toBe(options()[1].id);
  });
});
