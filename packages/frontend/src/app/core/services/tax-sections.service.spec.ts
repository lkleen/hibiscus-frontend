import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { TaxSection } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { TaxSectionsService } from './tax-sections.service';
import { TaxTagsService } from './tax-tags.service';

function section(code: string, name: string = code): TaxSection {
  return { code, name, form: null, belongs: null, excludes: null, receipts: null, note: null };
}

describe('TaxSectionsService', () => {
  let service: TaxSectionsService;
  let tags: TaxTagsService;
  let httpMock: HttpTestingController;
  const noContent: { status: number; statusText: string } = {
    status: 204,
    statusText: 'No Content',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TaxSectionsService);
    tags = TestBed.inject(TaxTagsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function load(): void {
    service.load().subscribe();
    httpMock.expectOne('/api/tax-sections').flush([section('St-B'), section('St-A')]);
  }

  it('is null until loaded, then holds the sections in code order', () => {
    expect(service.sections()).toBeNull();
    load();
    expect(service.sections()?.map((s: TaxSection) => s.code)).toEqual(['St-A', 'St-B']);
  });

  it('create adds the stored section in code order', () => {
    load();
    service.create(section('St-AA')).subscribe();
    httpMock.expectOne('/api/tax-sections').flush(section('St-AA'), {
      status: 201,
      statusText: 'Created',
    });
    expect(service.sections()?.map((s: TaxSection) => s.code)).toEqual(['St-A', 'St-AA', 'St-B']);
  });

  it('create keeps the list untouched on an error', () => {
    let error: unknown = null;
    service.create(section('St-C')).subscribe({ error: (e: unknown) => (error = e) });
    httpMock.expectOne('/api/tax-sections').flush('x', { status: 500, statusText: 'err' });
    expect(error).not.toBeNull();
    expect(service.sections()).toBeNull();
  });

  it('update replaces the section after a 204 and moves the tags on a code change', () => {
    load();
    tags.load().subscribe();
    httpMock.expectOne('/api/tax-tags').flush([{ category_id: 1, code: 'St-A' }]);
    service.update('St-A', { expected: section('St-A'), next: section('St-Z', 'Z') }).subscribe();
    const req = httpMock.expectOne('/api/tax-sections/St-A');
    expect(req.request.method).toBe('PUT');
    expect(service.sections()?.[0]?.code).toBe('St-A');
    req.flush(null, noContent);
    expect(service.sections()?.map((s: TaxSection) => s.code)).toEqual(['St-B', 'St-Z']);
    expect(tags.tags()?.get(1)).toBe('St-Z');
  });

  it('update leaves the list alone on 409', () => {
    load();
    let error: unknown = null;
    service
      .update('St-A', { expected: section('St-A'), next: section('St-A', 'N') })
      .subscribe({ error: (e: unknown) => (error = e) });
    httpMock
      .expectOne('/api/tax-sections/St-A')
      .flush({ error: 'conflict' }, { status: 409, statusText: 'Conflict' });
    expect(error).not.toBeNull();
    expect(service.sections()?.[0]?.name).toBe('St-A');
  });

  it('remove drops the section after a 204', () => {
    load();
    service.remove('St-A').subscribe();
    const req = httpMock.expectOne('/api/tax-sections/St-A');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, noContent);
    expect(service.sections()?.map((s: TaxSection) => s.code)).toEqual(['St-B']);
  });
});
