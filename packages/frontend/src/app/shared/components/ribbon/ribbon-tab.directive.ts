import { Directive, ElementRef, inject } from '@angular/core';
import type { FocusableOption } from '@angular/cdk/a11y';

/** Makes a ribbon tab button focusable by the strip's `FocusKeyManager`. */
@Directive({ selector: 'button[appRibbonTab]' })
export class RibbonTabDirective implements FocusableOption {
  private readonly el: ElementRef<HTMLButtonElement> = inject(ElementRef);

  focus(): void {
    this.el.nativeElement.focus();
  }
}
