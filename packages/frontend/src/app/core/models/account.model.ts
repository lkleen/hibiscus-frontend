export interface Account {
  id: number;
  name: string;
  iban: string | null;
  currency: string;
  balance: number | null;
}
