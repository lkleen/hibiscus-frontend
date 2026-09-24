import { Theme, themeQuartz } from 'ag-grid-community';

/**
 * Bridges the app's design tokens to ag-Grid's Theming API. Every value is a `var(--base-table-*)`
 * reference; those component tokens are declared in base-table.component.scss and default to the
 * global `--surface-*` / `--text-*` / `--color-accent*` tokens, so the grid follows the active
 * theme identity and the `.dark-mode` axis through CSS alone — no JS re-theming on switch.
 */
export const baseTableTheme: Theme = themeQuartz.withParams({
  backgroundColor: 'var(--base-table-bg)',
  foregroundColor: 'var(--base-table-color)',
  borderColor: 'var(--base-table-border-color)',
  accentColor: 'var(--base-table-accent)',
  headerBackgroundColor: 'var(--base-table-header-bg)',
  headerTextColor: 'var(--base-table-header-color)',
  headerFontWeight: 600,
  oddRowBackgroundColor: 'var(--base-table-row-alt-bg)',
  rowHoverColor: 'var(--base-table-row-hover-bg)',
  wrapperBorderRadius: 'var(--base-table-radius)',
  fontFamily: 'var(--base-table-font-family)',
  fontSize: 'var(--base-table-font-size)',
  cellHorizontalPadding: 'var(--base-table-cell-padding-x)',
  browserColorScheme: 'inherit',
});
