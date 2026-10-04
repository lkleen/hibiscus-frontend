import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TabNavComponent, TabNavItem } from './tab-nav.component';

describe('TabNavComponent', () => {
  it('renders one link per tab under the base path, labelled by the aria key', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(TabNavComponent);
    const tabs: readonly TabNavItem[] = [
      { path: 'date-presets', labelKey: 'settings.tab.datePresets' },
    ];
    fixture.componentRef.setInput('tabs', tabs);
    fixture.componentRef.setInput('basePath', ['/', 'en', 'settings']);
    fixture.componentRef.setInput('ariaLabelKey', 'settings.tabs.label');
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const links: NodeListOf<HTMLAnchorElement> = el.querySelectorAll('a.tab-nav__tab');
    expect(links.length).toBe(1);
    expect(links[0]?.getAttribute('href')).toBe('/en/settings/date-presets');
    expect(el.querySelector('nav')?.getAttribute('aria-label')).toBeTruthy();
  });
});
