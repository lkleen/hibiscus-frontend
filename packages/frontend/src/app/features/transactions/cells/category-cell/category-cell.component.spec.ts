import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { categoryRow } from '../../../../core/utils/testing/category-row-fixture';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import { CategoryPickerComponent } from '../../category-picker/category-picker.component';
import { CategoryCellComponent } from './category-cell.component';

describe('CategoryCellComponent', () => {
  let fixture: ComponentFixture<CategoryCellComponent>;
  let categoryChange: ReturnType<typeof vi.fn<(categoryId: number | null) => void>>;

  const categories: CategoryRow[] = [categoryRow({ id: 7, name: 'Groceries' })];

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

  it("shows the save error only when failedUpdateId matches this cell's transactionId", () => {
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

  it('renders an "r,g,b" custom color as rgb() CSS value', () => {
    const categoriesWithColor = [
      categoryRow({ id: 7, name: 'Groceries', color: '47,111,79', customcolor: 1 }),
    ];

    fixture.componentRef.setInput('categoryId', 7);
    fixture.componentRef.setInput('categories', categoriesWithColor);
    fixture.detectChanges();

    const swatch = fixture.nativeElement.querySelector('.category-picker__swatch');
    expect(swatch?.style.background).toBe('rgb(47 111 79)');
  });
});
