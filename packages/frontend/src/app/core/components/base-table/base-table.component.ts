import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewContainerRef,
  ViewEncapsulation,
  inject,
  isDevMode,
} from '@angular/core';
import {
  AgGridAngular,
  AngularFrameworkComponentWrapper,
  AngularFrameworkOverrides,
} from 'ag-grid-angular';
import {
  CellStyleModule,
  ClientSideRowModelModule,
  ColumnAutoSizeModule,
  LocaleModule,
  ModuleRegistry,
  PaginationModule,
  RowAutoHeightModule,
  enableDevValidations,
} from 'ag-grid-community';
import { baseTableTheme } from './base-table.theme';

// Registered once for every table in the app: add a module here when a table needs a new feature.
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  PaginationModule,
  RowAutoHeightModule,
  LocaleModule,
  CellStyleModule,
  ColumnAutoSizeModule,
]);

// Turns cryptic `error #<n>` grid messages (e.g. an unregistered module) into readable ones. Only
// bundled for development builds.
if (isDevMode()) {
  enableDevValidations();
}

/**
 * The one table component of the app: an `<ag-grid-angular>` that already carries the project
 * theme. Use it exactly like `<ag-grid-angular>` (same inputs/outputs) — never the raw ag-Grid
 * component. It extends `AgGridAngular` instead of wrapping it, so the full ag-Grid API is available
 * without re-declaring (and thereby mirroring) any of its inputs or outputs. The only thing it adds
 * is the default `theme`; a `[theme]` binding on the element still takes precedence.
 *
 * `providers` must be repeated here — Angular doesn't inherit them from the parent component.
 * `ViewEncapsulation.None` because the styles target ag-Grid's own DOM.
 */
@Component({
  selector: 'app-base-table',
  template: '',
  styleUrl: './base-table.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [AngularFrameworkOverrides, AngularFrameworkComponentWrapper],
  host: { class: 'base-table' },
})
export class BaseTableComponent<TData = unknown> extends AgGridAngular<TData> {
  constructor() {
    super(
      inject(ElementRef),
      inject(ViewContainerRef),
      inject(AngularFrameworkOverrides),
      inject(AngularFrameworkComponentWrapper),
    );
    this.theme = baseTableTheme;
  }
}
