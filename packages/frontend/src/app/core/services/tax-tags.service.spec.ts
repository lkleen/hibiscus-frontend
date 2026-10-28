import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TaxTagsService } from './tax-tags.service';

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

  it('is null until loaded, then holds the map', () => {
    expect(service.tags()).toBeNull();
    load();
    expect(service.tags()?.get(1)).toBe('St-AB');
    expect(service.tags()?.size).toBe(2);
  });

  it('applySaved sets, changes and removes a tag', () => {
    load();
    service.applySaved(3, 'St-V');
    service.applySaved(1, 'St-SA');
    service.applySaved(2, null);
    expect(service.tags()?.get(3)).toBe('St-V');
    expect(service.tags()?.get(1)).toBe('St-SA');
    expect(service.tags()?.has(2)).toBe(false);
  });

  it('applySaved throws while the tags are not loaded', () => {
    expect(() => service.applySaved(1, 'St-AB')).toThrow();
  });

  it('renameCode moves the tags of a renamed section and keeps St-0', () => {
    load();
    service.renameCode('St-AB', 'St-XY');
    expect(service.tags()?.get(1)).toBe('St-XY');
    expect(service.tags()?.get(2)).toBe('St-0');
  });

  it('renameCode before the load does nothing', () => {
    service.renameCode('St-AB', 'St-XY');
    expect(service.tags()).toBeNull();
  });
});
