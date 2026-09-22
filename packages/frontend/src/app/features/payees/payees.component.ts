import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { Payee } from '../../core/models/payee.model';

@Component({
  selector: 'app-payees',
  templateUrl: './payees.component.html',
  styleUrl: './payees.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayeesComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly searchTerm = signal('');
  protected readonly payees = signal<Payee[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  constructor() {
    toObservable(this.searchTerm)
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => {
          this.loading.set(true);
          this.error.set(false);
          return this.api.getPayees(q || undefined).pipe(
            catchError(() => {
              this.error.set(true);
              return of<Payee[]>([]);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((payees) => {
        this.payees.set(payees);
        this.loading.set(false);
      });
  }

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchTerm.set(value);
  }
}
