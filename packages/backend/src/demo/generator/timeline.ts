import { dayOf, yearOf } from './calendar';
import type { Day } from './calendar';

/**
 * The fixed dates of Tobias Testmann's life. Everything in the demo data hangs off these, so the
 * story stays the same whatever the seed.
 */
export const STORY_START: Day = dayOf(2014, 1, 1);
export const BIGGER_FLAT: Day = dayOf(2016, 9, 1);
export const CAR_BOUGHT: Day = dayOf(2018, 4, 14);
export const MET_SABINE: Day = dayOf(2019, 2, 16);
export const SABINE_MOVES_IN: Day = dayOf(2019, 10, 1);
export const CORONA_LOCKDOWN: Day = dayOf(2020, 3, 16);
export const JOINT_ACCOUNT_OPENED: Day = dayOf(2020, 5, 4);
export const WEDDING: Day = dayOf(2020, 8, 22);
export const OFFICE_REOPENED: Day = dayOf(2021, 7, 1);
export const HOUSE_HANDOVER: Day = dayOf(2021, 4, 1);
export const RENOVATION_END: Day = dayOf(2021, 12, 15);
export const JOB_CHANGE: Day = dayOf(2022, 4, 1);
export const PREGNANCY_KNOWN: Day = dayOf(2022, 7, 9);
export const EMIL_BORN: Day = dayOf(2023, 3, 17);
export const PARENTAL_LEAVE_START: Day = dayOf(2023, 5, 1);
export const PARENTAL_LEAVE_END: Day = dayOf(2023, 7, 1);
export const D_TICKET: Day = dayOf(2023, 5, 1);
export const KITA_START: Day = dayOf(2024, 8, 1);

export const OLD_EMPLOYER = 'Kleinkram Software GmbH';
export const NEW_EMPLOYER = 'Wolkenschieber Systems AG';

/** Net monthly salary in euros, by year; the 2022 entry applies from the job change. */
const NET_SALARY: Record<number, number> = {
  2014: 2480,
  2015: 2560,
  2016: 2650,
  2017: 2750,
  2018: 2890,
  2019: 2990,
  2020: 3050,
  2021: 3140,
  2022: 4380,
  2023: 4510,
  2024: 4650,
  2025: 4780,
  2026: 4900,
};

/** Net salary in cents paid for the month containing `day`. */
export function netSalaryCents(day: Day): number {
  /** The old employer's last raise, January to March 2022. */
  if (day < JOB_CHANGE && yearOf(day) === 2022) return 3200_00;
  const euros: number | undefined = NET_SALARY[Math.min(yearOf(day), 2026)];
  if (euros === undefined) throw new Error(`No salary for ${yearOf(day)}`);
  return euros * 100;
}

/** How much prices have risen since 2014; small purchases scale with it. */
const PRICE_INDEX: Record<number, number> = {
  2014: 1.0,
  2015: 1.005,
  2016: 1.01,
  2017: 1.027,
  2018: 1.045,
  2019: 1.06,
  2020: 1.065,
  2021: 1.098,
  2022: 1.176,
  2023: 1.247,
  2024: 1.275,
  2025: 1.302,
  2026: 1.329,
};

export function priceIndex(day: Day): number {
  const index: number | undefined = PRICE_INDEX[Math.min(yearOf(day), 2026)];
  if (index === undefined) throw new Error(`No price index for ${yearOf(day)}`);
  return index;
}

/** True while Tobias is in the joint household (shared shopping goes over the joint account). */
export function hasJointAccount(day: Day): boolean {
  return day >= JOINT_ACCOUNT_OPENED;
}
