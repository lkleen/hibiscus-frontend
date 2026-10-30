import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
  type Signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type {
  UserDatabaseResponse,
  UserDatabaseTestResponse,
} from '@hibiscus-frontend/shared/contracts/user';
import type { TranslationKey } from '../../../core/models/translation.model';
import { ApiService } from '../../../core/services/api.service';
import { MeService } from '../../../core/services/me.service';
import { TranslationService } from '../../../core/services/translation.service';
import { testResultOf, userErrorOf } from '../../../core/utils/user-errors';
import {
  databaseProblems,
  databaseRequestOf,
  draftOfDatabase,
  isAllowedEntry,
  splitHostEntry,
  type DatabaseDraft,
  type DatabaseField,
  type DatabaseProblem,
} from './database-form.model';

/**
 * The user's Hibiscus database connection: host (from the operator's allowlist), port, name, user
 * and password, with a connection test. Used by the first-run setup and by Settings → Database.
 * An empty password keeps the stored one.
 */
@Component({
  selector: 'app-database-form',
  templateUrl: './database-form.component.html',
  styleUrl: './database-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DatabaseFormComponent {
  private readonly api = inject(ApiService);
  private readonly me = inject(MeService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly i18n = inject(TranslationService);

  /** Emits after the settings were stored. */
  readonly saved = output<void>();

  protected readonly loaded = signal<UserDatabaseResponse | null>(null);
  protected readonly loadError = signal(false);
  protected readonly draft = signal<DatabaseDraft>(draftOfDatabase(null));
  protected readonly showProblems = signal(false);
  protected readonly testing = signal(false);
  protected readonly testResult = signal<UserDatabaseTestResponse | null>(null);
  protected readonly saving = signal(false);
  protected readonly savedNotice = signal(false);
  protected readonly saveError = signal<TranslationKey | null>(null);

  protected readonly passwordSet: Signal<boolean> = computed(
    () => this.loaded()?.database?.passwordSet ?? false,
  );
  protected readonly allowedHosts: Signal<readonly string[]> = computed(
    () => this.loaded()?.allowedHosts ?? [],
  );
  protected readonly problems: Signal<readonly DatabaseProblem[]> = computed(() =>
    databaseProblems(this.draft(), this.passwordSet()),
  );

  constructor() {
    this.api
      .getUserDatabase()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: UserDatabaseResponse): void => {
          this.loaded.set(response);
          this.draft.set(draftOfDatabase(response.database));
        },
        error: (): void => this.loadError.set(true),
      });
  }

  protected problem(field: DatabaseProblem): boolean {
    return this.showProblems() && this.problems().includes(field);
  }

  protected onText(field: DatabaseField, event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) throw new Error('Expected an input event');
    const value: string = event.target.value;
    this.draft.update((draft: DatabaseDraft): DatabaseDraft => {
      if (field === 'host' && isAllowedEntry(value, this.allowedHosts())) {
        // Picking a `host:port` entry from the list fills both fields.
        const entry = splitHostEntry(value);
        return { ...draft, host: entry.host, port: entry.port ?? draft.port };
      }
      return { ...draft, [field]: value };
    });
    this.testResult.set(null);
    this.savedNotice.set(false);
  }

  protected test(): void {
    this.showProblems.set(true);
    if (this.problems().length > 0 || this.testing()) return;
    this.testing.set(true);
    this.testResult.set(null);
    this.saveError.set(null);
    this.api.testUserDatabase(databaseRequestOf(this.draft())).subscribe({
      next: (result: UserDatabaseTestResponse): void => {
        this.testing.set(false);
        this.testResult.set(result);
      },
      error: (failure: unknown): void => {
        this.testing.set(false);
        if (userErrorOf(failure) === 'host-not-allowed') {
          this.saveError.set('database.error.host');
          return;
        }
        this.testResult.set(
          testResultOf(failure) ?? {
            ok: false,
            hibiscusSchema: false,
            error: this.describe(failure),
          },
        );
      },
    });
  }

  protected save(): void {
    this.showProblems.set(true);
    if (this.problems().length > 0 || this.saving()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.savedNotice.set(false);
    this.api.saveUserDatabase(databaseRequestOf(this.draft())).subscribe({
      next: (): void => {
        this.draft.update((draft: DatabaseDraft) => ({ ...draft, password: '' }));
        this.api.getUserDatabase().subscribe({
          next: (response: UserDatabaseResponse): void => this.loaded.set(response),
        });
        // The route guards and the banner read the user's state from here.
        this.me.refresh().subscribe({
          next: (): void => {
            this.saving.set(false);
            this.savedNotice.set(true);
            this.saved.emit();
          },
          error: (): void => {
            this.saving.set(false);
            this.saveError.set('database.error.failed');
          },
        });
      },
      error: (failure: unknown): void => {
        this.saving.set(false);
        const result: UserDatabaseTestResponse | null = testResultOf(failure);
        if (result !== null) {
          this.testResult.set(result);
          this.saveError.set('database.error.connection');
          return;
        }
        const code = userErrorOf(failure);
        this.saveError.set(
          code === 'host-not-allowed'
            ? 'database.error.host'
            : code === 'busy'
              ? 'database.error.busy'
              : code === 'database-in-use'
                ? 'database.error.inUse'
                : 'database.error.failed',
        );
      },
    });
  }

  private describe(failure: unknown): string {
    return failure instanceof HttpErrorResponse ? `HTTP ${failure.status}` : String(failure);
  }
}
