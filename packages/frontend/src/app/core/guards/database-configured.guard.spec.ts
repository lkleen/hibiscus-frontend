import { TestBed } from '@angular/core/testing';
import { Route, Router, UrlSegment, UrlTree } from '@angular/router';
import type { Me } from '@hibiscus-frontend/shared/contracts/user';
import { Observable, of } from 'rxjs';
import { MeService } from '../services/me.service';
import { databaseConfiguredGuard, setupGuard } from './database-configured.guard';

function run(
  guard: typeof setupGuard,
  database: Me['database'],
  key: Me['key'] = 'configured',
): Observable<boolean | UrlTree> {
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: { load: () => of({ user: 'lars', database, key }) } },
      { provide: Router, useValue: { createUrlTree: (commands: string[]) => commands.join('/') } },
    ],
  });
  const segments: UrlSegment[] = ['de', 'accounts'].map((path) => new UrlSegment(path, {}));
  return TestBed.runInInjectionContext(
    () => guard({} as Route, segments) as Observable<boolean | UrlTree>,
  );
}

function result(observable: Observable<boolean | UrlTree>): boolean | UrlTree | undefined {
  let value: boolean | UrlTree | undefined;
  observable.subscribe((v) => (value = v));
  return value;
}

describe('databaseConfiguredGuard', () => {
  it('lets a configured user through', () => {
    expect(result(run(databaseConfiguredGuard, 'configured'))).toBe(true);
  });

  it('sends an unconfigured user to the setup of the same locale', () => {
    expect(result(run(databaseConfiguredGuard, 'unconfigured'))).toBe('de/setup');
  });

  it('sends a user without a key to the setup', () => {
    expect(result(run(databaseConfiguredGuard, 'configured', 'unconfigured'))).toBe('de/setup');
  });
});

describe('setupGuard', () => {
  it('opens the setup while the database is unconfigured', () => {
    expect(result(run(setupGuard, 'unconfigured'))).toBe(true);
  });

  it('sends a configured user to the app', () => {
    expect(result(run(setupGuard, 'configured'))).toBe('de/accounts');
  });

  it('stays open while only the key is missing', () => {
    expect(result(run(setupGuard, 'configured', 'unconfigured'))).toBe(true);
  });
});
