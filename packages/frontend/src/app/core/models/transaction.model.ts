export interface Transaction {
  id: number;
  accountId: number;
  date: string;
  amount: number;
  purpose: string | null;
  counterparty: string | null;
  categoryId: number | null;
}

export interface TransactionsQuery {
  accountId?: number;
  from?: string;
  to?: string;
  categoryId?: number;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface TransactionsResponse {
  items: Transaction[];
  total: number;
}

export interface UpdateTransactionCategory {
  categoryId: number | null;
}
