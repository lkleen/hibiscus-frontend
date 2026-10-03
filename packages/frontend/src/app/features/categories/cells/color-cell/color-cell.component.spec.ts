import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ColorCellComponent } from './color-cell.component';

describe('ColorCellComponent', () => {
  let fixture: ComponentFixture<ColorCellComponent>;
  let root: HTMLElement;

  function render(cssColor: string | null, stored: string | null): void {
    fixture.componentRef.setInput('cssColor', cssColor);
    fixture.componentRef.setInput('stored', stored);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ColorCellComponent] });
    fixture = TestBed.createComponent(ColorCellComponent);
    root = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => fixture.destroy());

  it('shows a swatch and the stored value', () => {
    render('rgb(10 20 30)', '10,20,30');

    const swatch: HTMLElement | null = root.querySelector('.category-color-cell__swatch');
    expect(swatch).not.toBeNull();
    expect(swatch?.style.backgroundColor).toBe('rgb(10 20 30)');
    expect(root.textContent).toContain('10,20,30');
  });

  it('shows a dash and no swatch without a colour', () => {
    render(null, null);

    expect(root.querySelector('.category-color-cell__swatch')).toBeNull();
    expect(root.textContent?.trim()).toBe('—');
  });
});
