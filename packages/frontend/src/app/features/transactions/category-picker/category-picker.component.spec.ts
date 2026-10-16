import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';
import { CategoryPickerComponent } from './category-picker.component';

@Component({
  imports: [CategoryPickerComponent],
  template: `<app-category-picker
    [categories]="categories()"
    [(selectedId)]="selectedId"
    [disabled]="disabled()"
    (picked)="picks.push($event)"
  />`,
})
class HostComponent {
  readonly categories = signal<readonly CategoryRow[]>([
    categoryRow({ id: 1, name: 'Living' }),
    categoryRow({ id: 2, name: 'Rent', parent_id: 1 }),
    categoryRow({ id: 3, name: 'Food', parent_id: 1 }),
  ]);
  readonly selectedId = signal<number | null>(2);
  readonly disabled = signal<boolean>(false);
  readonly picks: number[] = [];
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('CategoryPickerComponent', () => {
  let host: HostComponent;
  let root: HTMLElement;
  let fixture: ComponentFixture<HostComponent>;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();
  }

  function treeRow(name: string): HTMLTableRowElement {
    const found: HTMLTableRowElement | undefined = Array.from(
      root.querySelectorAll<HTMLTableRowElement>('tbody tr'),
    ).find((el: HTMLTableRowElement) => el.textContent?.trim() === name);
    if (!found) throw new Error(`tree row "${name}" not rendered`);
    return found;
  }

  beforeEach(async () => {
    installMutationObserverMock();
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    root = fixture.nativeElement;
    await settle();
  });

  it('shows the initial selection without emitting a pick', () => {
    expect(root.querySelectorAll('tbody tr.p-treetable-row-selected')).toHaveLength(1);
    expect(treeRow('Rent').classList.contains('p-treetable-row-selected')).toBe(true);
    expect(host.picks).toEqual([]);
  });

  it('a click selects the category and emits it once', async () => {
    treeRow('Food').click();
    await settle();

    expect(host.selectedId()).toBe(3);
    expect(host.picks).toEqual([3]);
  });

  it('a selection set by the parent does not emit', async () => {
    host.selectedId.set(3);
    await settle();

    expect(treeRow('Food').classList.contains('p-treetable-row-selected')).toBe(true);
    expect(host.picks).toEqual([]);
  });

  it('disabled makes the tree inert', async () => {
    host.disabled.set(true);
    await settle();

    expect(root.querySelector('[inert]')).not.toBeNull();
  });
});
