import { Component, DestroyRef, WritableSignal, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RibbonBandDirective } from './ribbon-band.directive';
import { RibbonGroupComponent } from './ribbon-group.component';
import { RibbonHost } from './ribbon-host';
import { RibbonStateStore } from './ribbon-state.store';
import { RibbonComponent } from './ribbon.component';

@Component({ selector: 'app-ribbon-probe', template: '' })
class ProbeComponent {
  static created = 0;
  static destroyed = 0;
  constructor() {
    ProbeComponent.created++;
    inject(DestroyRef).onDestroy((): void => {
      ProbeComponent.destroyed++;
    });
  }
}

@Component({
  selector: 'app-ribbon-test-host',
  imports: [RibbonComponent, RibbonBandDirective, RibbonGroupComponent, ProbeComponent],
  providers: [RibbonHost],
  template: `
    @if (showRibbon()) {
      <app-ribbon ribbonId="test" />
    }
    <ng-template
      appRibbonBand="period"
      ribbonLabelKey="ribbon.tab.period"
      [ribbonOrder]="1"
      [ribbonState]="periodState()"
    >
      <app-ribbon-group captionKey="ribbon.group.range"
        ><i class="period-body"></i><app-ribbon-probe
      /></app-ribbon-group>
    </ng-template>
    <ng-template
      appRibbonBand="filter"
      ribbonLabelKey="ribbon.tab.filter"
      [ribbonOrder]="0"
      [ribbonActive]="true"
    >
      <app-ribbon-group captionKey="ribbon.group.search" [grow]="true"
        ><i class="filter-body"></i
      ></app-ribbon-group>
    </ng-template>
    <ng-template
      appRibbonBand="selection"
      ribbonLabelKey="ribbon.tab.selection"
      [ribbonOrder]="2"
      [ribbonContextual]="true"
      [ribbonShown]="selectionShown()"
      ribbonState="3"
    >
      <app-ribbon-group captionKey="ribbon.group.selection"
        ><i class="selection-body"></i
      ></app-ribbon-group>
    </ng-template>
  `,
})
class TestHostComponent {
  readonly showRibbon: WritableSignal<boolean> = signal<boolean>(true);
  readonly selectionShown: WritableSignal<boolean> = signal<boolean>(false);
  readonly periodState: WritableSignal<string | null> = signal<string | null>('Jun – Oct');
}

// The CDK key manager reads `keyCode`, which `key` alone does not set.
const KEY_CODES: Record<string, number> = { ArrowRight: 39, Home: 36, End: 35 };

describe('RibbonComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let el: HTMLElement;

  beforeEach(async () => {
    ProbeComponent.created = 0;
    ProbeComponent.destroyed = 0;
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement;
    document.body.appendChild(el); // focus() only works on attached elements
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach((): void => el.remove());

  const tabs = (): HTMLButtonElement[] =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const tabLabels = (): string[] =>
    tabs().map((tab: HTMLButtonElement): string => tab.textContent.trim().split(/\s+/)[0] ?? '');
  /** True when the element exists and no ancestor panel/ribbon is `hidden`. */
  const visible = (selector: string): boolean => {
    const target: HTMLElement | null = el.querySelector(selector);
    return target !== null && target.closest('[hidden]') === null;
  };
  const anyPanelVisible = (): boolean =>
    Array.from(el.querySelectorAll<HTMLElement>('[role="tabpanel"]')).some(
      (panel: HTMLElement): boolean => panel.closest('[hidden]') === null,
    );
  const update = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const click = async (element: Element | null): Promise<void> => {
    if (!element) throw new Error('element not found');
    (element as HTMLElement).click();
    await update();
  };
  const key = async (target: HTMLElement, name: string): Promise<void> => {
    const event: KeyboardEvent = new KeyboardEvent('keydown', {
      key: name,
      keyCode: KEY_CODES[name],
      bubbles: true,
    });
    target.dispatchEvent(event);
    await update();
  };

  it('renders the shown tabs in order with an accessible tablist and the first band', () => {
    expect(el.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBeTruthy();
    expect(tabs().length).toBe(2);
    expect(tabs()[0]?.textContent).toContain('Filter');
    expect(tabs()[1]?.textContent).toContain('Period');
    expect(tabs()[0]?.getAttribute('aria-selected')).toBe('true');
    expect(visible('.filter-body')).toBe(true);
    expect(visible('.period-body')).toBe(false);
    for (const tab of tabs()) {
      const panel: HTMLElement | null = el.querySelector(`#${tab.getAttribute('aria-controls')}`);
      expect(panel?.getAttribute('role')).toBe('tabpanel');
    }
    expect(tabs()[0]?.querySelector('.ribbon__dot')).not.toBeNull();
    expect(tabs()[1]?.querySelector('.ribbon__state')?.textContent).toBe('Jun – Oct');
  });

  it('switches the band when another tab is clicked', async () => {
    await click(tabs()[1] ?? null);
    expect(tabs()[1]?.getAttribute('aria-selected')).toBe('true');
    expect(visible('.period-body')).toBe(true);
    expect(visible('.filter-body')).toBe(false);
  });

  it('moves focus with arrow keys, wraps, and supports Home and End', async () => {
    tabs()[0]?.focus();
    await update();
    await key(tabs()[0] as HTMLElement, 'ArrowRight');
    expect(document.activeElement).toBe(tabs()[1]);
    expect(tabs()[1]?.tabIndex).toBe(0);
    expect(tabs()[0]?.tabIndex).toBe(-1);
    await key(tabs()[1] as HTMLElement, 'ArrowRight');
    expect(document.activeElement).toBe(tabs()[0]);
    await key(tabs()[0] as HTMLElement, 'End');
    expect(document.activeElement).toBe(tabs()[1]);
    await key(tabs()[1] as HTMLElement, 'Home');
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it('toggles tabs-only when the active tab is clicked, and returns to full on another tab', async () => {
    await click(tabs()[0] ?? null);
    expect(anyPanelVisible()).toBe(false);
    expect(tabs().length).toBe(2);
    await click(tabs()[0] ?? null);
    expect(visible('.filter-body')).toBe(true);
    await click(tabs()[0] ?? null);
    await click(tabs()[1] ?? null);
    expect(visible('.period-body')).toBe(true);
  });

  it('hides to a slim line of state chips and shows again', async () => {
    host.selectionShown.set(true);
    await update();
    await click(el.querySelector('button[title="Hide toolbar"]'));
    expect(anyPanelVisible()).toBe(false);
    expect(el.querySelector<HTMLElement>('.ribbon:not(.ribbon--hidden)')?.hidden).toBe(true);
    const chips: string[] = Array.from(el.querySelectorAll('.ribbon__chip')).map(
      (chip: Element): string => chip.textContent.replace(/\s+/g, ' ').trim(),
    );
    expect(chips).toEqual(['Period Jun – Oct', 'Selection 3']);
    await click(el.querySelector('button[title="Show toolbar"]'));
    expect(el.querySelector<HTMLElement>('.ribbon:not(.ribbon--hidden)')?.hidden).toBe(false);
    expect(visible('.filter-body')).toBe(true);
  });

  it('adds a contextual tab without stealing selection and falls back when it goes away', async () => {
    host.selectionShown.set(true);
    await update();
    expect(tabLabels()).toEqual(['Filter', 'Period', 'Selection']);
    expect(tabs()[2]?.classList).toContain('ribbon__tab--contextual');
    expect(tabs()[0]?.getAttribute('aria-selected')).toBe('true');

    await click(tabs()[2] ?? null);
    expect(visible('.selection-body')).toBe(true);
    host.selectionShown.set(false);
    await update();
    expect(tabs().length).toBe(2);
    expect(tabs()[0]?.getAttribute('aria-selected')).toBe('true');
    expect(visible('.filter-body')).toBe(true);
  });

  it('creates each band once and keeps it alive across tab switches and collapse', async () => {
    expect(ProbeComponent.created).toBe(1);
    await click(tabs()[0] ?? null); // tabs only
    await click(tabs()[1] ?? null); // other band, full
    await click(el.querySelector('button[title="Hide toolbar"]'));
    await click(el.querySelector('button[title="Show toolbar"]'));
    expect(ProbeComponent.created).toBe(1);
    expect(ProbeComponent.destroyed).toBe(0);
  });

  it('restores the selected band and mode after the ribbon is re-created', async () => {
    await click(tabs()[1] ?? null);
    await click(tabs()[1] ?? null);
    host.showRibbon.set(false);
    await update();
    expect(el.querySelector('app-ribbon')).toBeNull();
    host.showRibbon.set(true);
    await update();
    expect(tabs()[1]?.getAttribute('aria-selected')).toBe('true');
    expect(anyPanelVisible()).toBe(false);
    expect(TestBed.inject(RibbonStateStore).state('test')().mode).toBe('tabs');
  });
});
