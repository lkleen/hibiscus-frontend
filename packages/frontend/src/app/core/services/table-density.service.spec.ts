import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TABLE_DENSITIES, TableDensityService } from './table-density.service';

const URL = '/api/settings/table-density';

describe('TableDensityService', () => {
  let service: TableDensityService;
  let httpMock: HttpTestingController;

  function noContent(req: TestRequest): void {
    req.flush(null, { status: 204, statusText: 'No Content' });
  }

  function densityClasses(): string[] {
    return Array.from(document.documentElement.classList).filter((c: string) =>
      c.startsWith('table-density-'),
    );
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
    document.documentElement.classList.remove(...TABLE_DENSITIES.map((d) => `table-density-${d}`));
  });

  it('is normal and sets no class until the load answers', () => {
    TestBed.tick();
    expect(service.loaded()).toBe(false);
    expect(service.density()).toBe('normal');
    expect(densityClasses()).toEqual([]);
    httpMock.expectOne(URL).flush(JSON.stringify('compact'));
  });

  it('loads once and applies exactly one class', () => {
    httpMock.expectOne(URL).flush('compact');
    TestBed.tick();
    expect(service.loaded()).toBe(true);
    expect(service.density()).toBe('compact');
    expect(densityClasses()).toEqual(['table-density-compact']);
  });

  it('adopts a saved density only after confirmation and swaps the class', () => {
    httpMock.expectOne(URL).flush('normal');
    TestBed.tick();
    service.save('spacious');

    const req: TestRequest = httpMock.expectOne(URL);
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.get('Content-Type')).toBe('application/json');
    expect(req.request.body).toBe('"spacious"');
    expect(service.saving()).toBe(true);
    expect(service.density()).toBe('normal');

    noContent(req);
    TestBed.tick();
    expect(service.density()).toBe('spacious');
    expect(service.saving()).toBe(false);
    expect(densityClasses()).toEqual(['table-density-spacious']);
  });

  it('sends writes in call order', () => {
    httpMock.expectOne(URL).flush('normal');
    service.save('compact');
    service.save('comfortable');

    const first: TestRequest = httpMock.expectOne(URL);
    expect(first.request.body).toBe('"compact"');
    noContent(first);
    const second: TestRequest = httpMock.expectOne(URL);
    expect(second.request.body).toBe('"comfortable"');
    noContent(second);
    expect(service.density()).toBe('comfortable');
  });

  it('flags a failed save, keeps the density and keeps accepting writes', () => {
    httpMock.expectOne(URL).flush('normal');
    service.save('compact');
    httpMock.expectOne(URL).flush('boom', { status: 500, statusText: 'Server Error' });
    expect(service.saveError()).toBe(true);
    expect(service.saving()).toBe(false);
    expect(service.density()).toBe('normal');

    service.save('compact');
    noContent(httpMock.expectOne(URL));
    expect(service.density()).toBe('compact');
    expect(service.saveError()).toBe(false);
  });
});
