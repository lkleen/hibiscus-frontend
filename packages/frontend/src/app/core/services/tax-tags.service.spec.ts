import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { TaxTagChange } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { TaxTagConflictError, TaxTagsService } from './tax-tags.service';

describe('TaxTagsService', () => {
  let service: TaxTagsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TaxTagsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function load(): void {
    service.load().subscribe();
    httpMock.expectOne('/api/tax-tags').flush([
      { category_id: 1, code: 'St-AB' },
      { category_id: 2, code: 'St-0' },
    ]);
  }

  const change: TaxTagChange = { category_id: 1, expected: 'St-AB', next: 'St-SA' };

  it('is null until loaded, then holds the map', () => {
    expect(service.tags()).toBeNull();
    load();
    expect(service.tags()?.get(1)).toBe('St-AB');
    expect(service.tags()?.size).toBe(2);
  });

  it('throws synchronously for an empty change list', () => {
    expect(() => service.save([])).toThrow();
  });

  it('applies the changes after a 204', () => {
    load();
    service.save([change, { category_id: 2, expected: 'St-0', next: null }]).subscribe();
    const req = httpMock.expectOne('/api/tax-tags');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      changes: [change, { category_id: 2, expected: 'St-0', next: null }],
    });
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(service.tags()?.get(1)).toBe('St-SA');
    expect(service.tags()?.has(2)).toBe(false);
  });

  it('throws when another save is in flight, and frees the slot afterwards', () => {
    load();
    service.save([change]).subscribe();
    expect(() => service.save([change])).toThrow();
    httpMock.expectOne('/api/tax-tags').flush(null, { status: 204, statusText: 'No Content' });
    service.save([{ ...change, expected: 'St-SA', next: 'St-AB' }]).subscribe();
    httpMock.expectOne('/api/tax-tags').flush(null, { status: 204, statusText: 'No Content' });
  });

  it('reloads on 409 and errors with the conflicting ids', () => {
    load();
    let error: unknown = null;
    service.save([change]).subscribe({ error: (e: unknown) => (error = e) });
    httpMock
      .expectOne('/api/tax-tags')
      .flush({ error: 'conflict', conflictIds: [1] }, { status: 409, statusText: 'Conflict' });
    httpMock.expectOne('/api/tax-tags').flush([{ category_id: 1, code: 'St-V' }]);
    expect(error).toBeInstanceOf(TaxTagConflictError);
    expect((error as TaxTagConflictError).conflictIds).toEqual([1]);
    expect(service.tags()?.get(1)).toBe('St-V');
  });

  it('propagates other errors and leaves the map alone', () => {
    load();
    let error: unknown = null;
    service.save([change]).subscribe({ error: (e: unknown) => (error = e) });
    httpMock.expectOne('/api/tax-tags').flush('x', { status: 500, statusText: 'Server Error' });
    expect(error).not.toBeInstanceOf(TaxTagConflictError);
    expect(error).not.toBeNull();
    expect(service.tags()?.get(1)).toBe('St-AB');
  });
});
