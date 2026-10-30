/**
 * One booking line as fetched from the bank (MT940 `:61:`/`:86:` for booked lines, MT942 for
 * pending ones), before it is converted into a Hibiscus `umsatz` row. The fields mirror what
 * hbci4java's `GVRKUms.UmsLine` hands to Hibiscus's `Converter.HBCIUmsatz2HibiscusUmsatz`; the
 * conversion itself lives in `umsatz-merge.ts`.
 */
export interface FetchedBooking {
  /** yyyy-MM-dd */
  bookingDate: string;
  /** yyyy-MM-dd */
  valueDate: string;
  amount: number;
  /** Running balance after this booking from MT940, null for pending. */
  balanceAfter: number | null;
  /** MT940 `:86:` text (`?00`) -> `umsatz.art`. */
  bookingText: string | null;
  primanota: string | null;
  customerRef: string | null;
  /** '999' must become null like Hibiscus. */
  gvCode: string | null;
  addKey: string | null;
  /** IBAN or account number (`?31`). */
  counterpartyAccount: string | null;
  /** BIC or BLZ (`?30`). */
  counterpartyBlz: string | null;
  /** `?32` */
  counterpartyName: string | null;
  /** `?33` */
  counterpartyName2: string | null;
  /**
   * Raw purpose lines as delivered (`?20`-`?29`, then `?60`-`?63`), absent sub-fields left out.
   * For an unstructured `:86:` (`gvCode` '999') hbci4java delivers no lines but the whole text
   * after the GV code as one block; pass that block here (one or more entries, they are joined
   * without separator) and the converter cuts it into 27-character lines like Hibiscus does.
   */
  purposeLines: string[];
  pending: boolean;
}

export interface StatementBalance {
  booked: number;
  available: number | null;
}

export interface MergeParams {
  kontoId: number;
  bookings: FetchedBooking[];
  balance: StatementBalance | null;
}

export interface MergeResult {
  inserted: number;
  deleted: number;
}
