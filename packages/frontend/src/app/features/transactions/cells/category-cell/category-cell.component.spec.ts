import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Category } from '../../../../core/models/category.model';
import { CategoryPickerComponent } from '../../category-picker/category-picker.component';
import { cellParams, gridContext, transaction } from '../../testing/transaction-fixture';
import { CategoryCellComponent } from './category-cell.component';

describe('CategoryCellComponent', () => {
  let fixture: ComponentFixture<CategoryCellComponent>;
  let categoryUpdateErrorId: ReturnType<typeof signal<number | null>>;
  let changeCategory: ReturnType<typeof vi.fn<(id: number, categoryId: number | null) => void>>;

  beforeEach(() => {
    categoryUpdateErrorId = signal<number | null>(null);
    changeCategory = vi.fn<(id: number, categoryId: number | null) => void>();
    const categories: Category[] = [{ id: 7, name: 'Groceries', parentId: null, color: null }];
    const context = gridContext({
      categories: signal(categories),
      categoryUpdateErrorId,
      changeCategory,
    });

    TestBed.configureTestingModule({ imports: [CategoryCellComponent] });
    fixture = TestBed.createComponent(CategoryCellComponent);
    fixture.componentInstance.agInit(cellParams(transaction({ id: 42, umsatztypId: 7 }), context));
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('shows the row category in the picker', () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Groceries');
  });

  it('reports a picked category together with the row id', () => {
    fixture.debugElement
      .query(By.directive(CategoryPickerComponent))
      .componentInstance.categoryChange.emit(null);

    expect(changeCategory).toHaveBeenCalledWith(42, null);
  });

  it('shows the save error only for the row whose update failed', () => {
    const errorText = (): boolean =>
      ((fixture.nativeElement as HTMLElement).textContent ?? '').includes(
        'Could not save category',
      );

    expect(errorText()).toBe(false);

    categoryUpdateErrorId.set(99);
    fixture.detectChanges();
    expect(errorText()).toBe(false);

    categoryUpdateErrorId.set(42);
    fixture.detectChanges();
    expect(errorText()).toBe(true);
  });
});
