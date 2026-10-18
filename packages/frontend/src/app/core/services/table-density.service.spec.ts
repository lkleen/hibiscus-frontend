import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { TableDensities } from '@hibiscus-frontend/shared/contracts/user-settings';
import { TableDensityService } from './table-density.service';

const URL = '/api/settings/table-densities';

describe('TableDensityService', () => {
  let service: TableDensityService;
  let httpMock: HttpTestingController;

  function noContent(req: TestRequest): void {
    req.flush(null, { status: 204, statusText: 'No Content' });
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(TableDensityService);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('is normal for every view until the load answers', () => {
    TestBed.tick();
    expect(service.loaded()).toBe(false);
    expect(service.densityFor('categories')()).toBe('normal');
    httpMock.expectOne(URL).flush({ categories: 'compact' });
  });

  it('loads once and reads each view from the stored map', () => {
    const categories = service.densityFor('categories');
    httpMock.expectOne(URL).flush({ categories: 'compact' } satisfies TableDensities);
    TestBed.tick();
    expect(service.loaded()).toBe(true);
    expect(categories()).toBe('compact');
    expect(service.densityFor('transactions-list')()).toBe('normal');
  });

  it('adopts a saved density only after confirmation and PUTs the whole merged map', () => {
    const categories = service.densityFor('categories');
    httpMock.expectOne(URL).flush({ 'transactions-list': 'spacious' } satisfies TableDensities);
    TestBed.tick();
    service.save('categories', 'compact');

    const req: TestRequest = httpMock.expectOne(URL);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ 'transactions-list': 'spacious', categories: 'compact' });
    expect(service.saving()).toBe(true);
    expect(categories()).toBe('normal');

    noContent(req);
    TestBed.tick();
    expect(categories()).toBe('compact');
    expect(service.saving()).toBe(false);
  });

  it('merges each write into the map as it stands when its turn comes', () => {
    httpMock.expectOne(URL).flush({});
    service.save('categories', 'compact');
    service.save('transactions-list', 'comfortable');

    const first: TestRequest = httpMock.expectOne(URL);
    expect(first.request.body).toEqual({ categories: 'compact' });
    noContent(first);
    const second: TestRequest = httpMock.expectOne(URL);
    expect(second.request.body).toEqual({
      categories: 'compact',
      'transactions-list': 'comfortable',
    });
    noContent(second);
    expect(service.densityFor('transactions-list')()).toBe('comfortable');
  });

  it('refuses to save before the load answered, so no other view is erased', () => {
    service.save('categories', 'compact');
    TestBed.tick();
    expect(service.saveError()).toBe(true);
    httpMock.expectOne(URL).flush({ categories: 'normal' });
    httpMock.verify();
  });

  it('flags a failed save, keeps the density and keeps accepting writes', () => {
    const categories = service.densityFor('categories');
    httpMock.expectOne(URL).flush({});
    service.save('categories', 'compact');
    httpMock.expectOne(URL).flush('boom', { status: 500, statusText: 'Server Error' });
    expect(service.saveError()).toBe(true);
    expect(service.saving()).toBe(false);
    expect(categories()).toBe('normal');

    service.save('categories', 'compact');
    noContent(httpMock.expectOne(URL));
    expect(categories()).toBe('compact');
    expect(service.saveError()).toBe(false);
  });
});
