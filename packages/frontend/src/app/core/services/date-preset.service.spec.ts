import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DatePreset, DatePresetList } from '@hibiscus-frontend/shared/contracts/user-settings';
import { DatePresetService } from './date-preset.service';

const URL = '/api/settings/date-presets';

function relative(unit: 'day' | 'month', offset: number, count: number): DatePreset {
  return { id: `${unit}${offset}${count}`, name: null, kind: 'relative', unit, offset, count };
}

describe('DatePresetService', () => {
  let service: DatePresetService;
  let httpMock: HttpTestingController;
  const defaults: DatePresetList = [relative('month', 0, 1)];

  function noContent(req: TestRequest): void {
    req.flush(null, { status: 204, statusText: 'No Content' });
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(DatePresetService);
    httpMock.expectOne(URL).flush(defaults);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('loads once on construction', () => {
    expect(service.loaded()).toBe(true);
    expect(service.presets()).toEqual(defaults);
    expect(service.loadError()).toBe(false);
  });

  it('updates presets only after the server confirmed the save', () => {
    const next: DatePresetList = [relative('day', 0, 1)];
    service.save(next);

    const req: TestRequest = httpMock.expectOne(URL);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(next);
    expect(service.saving()).toBe(true);
    expect(service.presets()).toEqual(defaults);

    noContent(req);
    expect(service.presets()).toEqual(next);
    expect(service.saving()).toBe(false);
  });

  it('sends a second write only after the first completed', () => {
    const first: DatePresetList = [relative('day', 0, 1)];
    const second: DatePresetList = [relative('day', -1, 1)];
    service.save(first);
    service.save(second);

    const firstReq: TestRequest = httpMock.expectOne(URL);
    expect(firstReq.request.body).toEqual(first);
    noContent(firstReq);

    const secondReq: TestRequest = httpMock.expectOne(URL);
    expect(secondReq.request.body).toEqual(second);
    expect(service.saving()).toBe(true);
    noContent(secondReq);
    expect(service.presets()).toEqual(second);
    expect(service.saving()).toBe(false);
  });

  it('restores defaults with DELETE then GET', () => {
    const restored: DatePresetList = [relative('month', -1, 1)];
    service.restoreDefaults();

    const del: TestRequest = httpMock.expectOne(URL);
    expect(del.request.method).toBe('DELETE');
    noContent(del);

    const get: TestRequest = httpMock.expectOne(URL);
    expect(get.request.method).toBe('GET');
    get.flush(restored);
    expect(service.presets()).toEqual(restored);
    expect(service.saving()).toBe(false);
  });

  it('flags a failed save, keeps the list and keeps accepting writes', () => {
    service.save([relative('day', 0, 1)]);
    httpMock.expectOne(URL).flush('boom', { status: 500, statusText: 'Server Error' });

    expect(service.saveError()).toBe(true);
    expect(service.saving()).toBe(false);
    expect(service.presets()).toEqual(defaults);

    const ok: DatePresetList = [relative('day', 0, 1)];
    service.save(ok);
    noContent(httpMock.expectOne(URL));
    expect(service.presets()).toEqual(ok);
    expect(service.saveError()).toBe(false);
  });

  describe('label', () => {
    it('prefers the given name', () => {
      expect(service.label({ ...relative('month', 0, 1), name: 'Mine' })).toBe('Mine');
    });

    it('generates names from the definition', () => {
      expect(service.label(relative('month', 0, 1))).toBe('Current month');
      expect(service.label(relative('month', -1, 1))).toBe('Last month');
      expect(service.label(relative('month', 0, 3))).toBe('Last 3 months');
      expect(service.label(relative('month', -2, 3))).toBe('3 months ending 2 months ago');
      expect(service.label(relative('day', 0, 1))).toBe('Today');
      expect(service.label(relative('day', -1, 1))).toBe('Yesterday');
      expect(
        service.label({ id: 'g', name: null, kind: 'fixed', from: '2026-01-01', to: '2026-02-01' }),
      ).toBe('2026-01-01 to 2026-02-01');
    });
  });
});
