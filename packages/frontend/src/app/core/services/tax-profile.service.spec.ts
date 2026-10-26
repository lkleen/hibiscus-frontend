import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { TaxProfile } from '@hibiscus-frontend/shared/contracts/user-settings';
import { TaxProfileService } from './tax-profile.service';

const URL = '/api/settings/tax-profile';

const STORED: TaxProfile = {
  situations: { employed: true, children: null, household: null, rental: false, donations: null },
  hintDismissedYear: 2025,
};

describe('TaxProfileService', () => {
  let service: TaxProfileService;
  let httpMock: HttpTestingController;

  function noContent(req: TestRequest): void {
    req.flush(null, { status: 204, statusText: 'No Content' });
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(TaxProfileService);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('is null until the load answers', () => {
    TestBed.tick();
    expect(service.loaded()).toBe(false);
    expect(service.profile()).toBeNull();
    httpMock.expectOne(URL).flush(STORED);
  });

  it('loads once and exposes the stored profile', () => {
    httpMock.expectOne(URL).flush(STORED);
    TestBed.tick();
    expect(service.loaded()).toBe(true);
    expect(service.profile()).toEqual(STORED);
  });

  it('adopts a saved profile only after confirmation and PUTs the whole profile', () => {
    httpMock.expectOne(URL).flush(STORED);
    TestBed.tick();
    const next: TaxProfile = { ...STORED, hintDismissedYear: 2026 };
    service.save(next);

    const req: TestRequest = httpMock.expectOne(URL);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(next);
    expect(service.saving()).toBe(true);
    expect(service.profile()).toEqual(STORED);

    noContent(req);
    TestBed.tick();
    expect(service.profile()).toEqual(next);
    expect(service.saving()).toBe(false);
  });

  it('flags a failed save, keeps the profile and keeps accepting writes', () => {
    httpMock.expectOne(URL).flush(STORED);
    service.save({ ...STORED, hintDismissedYear: 2026 });
    httpMock.expectOne(URL).flush('boom', { status: 500, statusText: 'Server Error' });
    expect(service.saveError()).toBe(true);
    expect(service.saving()).toBe(false);
    expect(service.profile()).toEqual(STORED);

    service.save({ ...STORED, hintDismissedYear: 2026 });
    noContent(httpMock.expectOne(URL));
    expect(service.profile()).toEqual({ ...STORED, hintDismissedYear: 2026 });
    expect(service.saveError()).toBe(false);
  });
});
