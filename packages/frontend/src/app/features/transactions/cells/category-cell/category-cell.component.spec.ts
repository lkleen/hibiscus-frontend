import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Category } from '../../../../core/models/category.model';
import { CategoryPickerComponent } from '../../category-picker/category-picker.component';
import { CategoryCellComponent } from './category-cell.component';

describe('CategoryCellComponent', () => {
  let fixture: ComponentFixture<CategoryCellComponent>;
  let categoryChange: ReturnType<typeof vi.fn<(categoryId: number | null) => void>>;

  const categories: Category[] = [{ id: 7, name: 'Groceries', parentId: null, color: null }];

  beforeEach(() => {
    categoryChange = vi.fn<(categoryId: number | null) => void>();

    TestBed.configureTestingModule({ imports: [CategoryCellComponent] });
    fixture = TestBed.createComponent(CategoryCellComponent);
    fixture.componentRef.setInput('transactionId', 42);
    fixture.componentRef.setInput('categoryId', 7);
    fixture.componentRef.setInput('categories', categories);
    fixture.componentRef.setInput('failedUpdateId', null);
    fixture.componentInstance.categoryChange.subscribe(categoryChange);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('shows the row category in the picker', () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Groceries');
  });

  it('emits a picked category on categoryChange', () => {
    fixture.debugElement
      .query(By.directive(CategoryPickerComponent))
      .componentInstance.categoryChange.emit(null);

    expect(categoryChange).toHaveBeenCalledWith(null);
  });

  it('shows the save error only when failedUpdateId matches this cell’s transactionId', () => {
    const errorText = (): boolean =>
      ((fixture.nativeElement as HTMLElement).textContent ?? '').includes(
        'Could not save category',
      );

    expect(errorText()).toBe(false);

    fixture.componentRef.setInput('failedUpdateId', 99);
    fixture.detectChanges();
    expect(errorText()).toBe(false);

    fixture.componentRef.setInput('failedUpdateId', 42);
    fixture.detectChanges();
    expect(errorText()).toBe(true);
  });
});
