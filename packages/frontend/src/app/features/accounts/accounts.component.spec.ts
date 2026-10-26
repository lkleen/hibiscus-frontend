import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { TaxProfile } from '@hibiscus-frontend/shared/contracts/user-settings';
import { AccountsComponent } from './accounts.component';

const PROFILE: TaxProfile = {
  situations: { employed: null, children: null, household: null, rental: null, donations: null },
  hintDismissedYear: null,
};

describe('AccountsComponent tax hint', () => {
  let fixture: ComponentFixture<AccountsComponent>;
  let httpMock: HttpTestingController;
  let root: HTMLElement;

  afterEach(() => {
    fixture.destroy();
    httpMock.verify();
    vi.useRealTimers();
  });

  /** Creates the page on `date`; `profile` is answered at once unless it is `'pending'`. */
  async function create(date: string, profile: TaxProfile | 'pending'): Promise<void> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(date));
    TestBed.configureTestingModule({
      imports: [AccountsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AccountsComponent);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    httpMock.expectOne('/api/accounts').flush([]);
    if (profile !== 'pending') httpMock.expectOne('/api/settings/tax-profile').flush(profile);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function hint(): HTMLElement | null {
    return root.querySelector<HTMLElement>('.tax-hint');
  }

  it('shows the hint for last year with a locale-prefixed link, from January to July', async () => {
    await create('2026-01-01T12:00:00', PROFILE);

    expect(hint()?.getAttribute('role')).toBe('status');
    expect(hint()?.textContent).toContain('Prepare your tax return for 2025');
    expect(hint()?.querySelector('a')?.getAttribute('href')).toMatch(
      /^\/(en|de)\/tax-return\/2025$/,
    );
  });

  it('still shows the hint on 31 July', async () => {
    await create('2026-07-31T12:00:00', PROFILE);

    expect(hint()).not.toBeNull();
  });

  it('hides the hint from 1 August', async () => {
    await create('2026-08-01T12:00:00', PROFILE);

    expect(hint()).toBeNull();
  });

  it('hides the hint once last year was dismissed, but not an older dismissal', async () => {
    await create('2026-03-01T12:00:00', { ...PROFILE, hintDismissedYear: 2025 });
    expect(hint()).toBeNull();
    fixture.destroy();
    TestBed.resetTestingModule();

    await create('2026-03-01T12:00:00', { ...PROFILE, hintDismissedYear: 2024 });
    expect(hint()).not.toBeNull();
  });

  it('hides the hint until the profile has loaded', async () => {
    await create('2026-03-01T12:00:00', 'pending');

    expect(hint()).toBeNull();
    httpMock.expectOne('/api/settings/tax-profile').flush(PROFILE);
    fixture.detectChanges();
    expect(hint()).not.toBeNull();
  });

  it('saves the dismissed year with the whole profile when "Not now" is clicked', async () => {
    await create('2026-03-01T12:00:00', PROFILE);

    root.querySelector<HTMLButtonElement>('.tax-hint__dismiss')!.click();

    const put = httpMock.expectOne('/api/settings/tax-profile');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ ...PROFILE, hintDismissedYear: 2025 });
    put.flush(null);
    fixture.detectChanges();
    expect(hint()).toBeNull();
  });
});
