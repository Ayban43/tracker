export type SplitMode = "equal" | "custom";
export type ExpenseCategory = "car" | "food" | "gas" | "activity" | "other";

export type Trip = {
  id: string;
  name: string;
  sort_order: number | null;
  created_at: string;
};

export type Member = {
  id: string;
  trip_id: string;
  name: string;
  sort_order: number | null;
  created_at: string;
};

export type Expense = {
  id: string;
  trip_id: string;
  title: string;
  category: ExpenseCategory;
  split_mode: SplitMode;
  amount_cents: number;
  receipt_url: string | null;
  paid_by_member_id: string;
  occurred_on: string;
  notes: string | null;
  created_at: string;
};

export type ExpenseShare = {
  id: string;
  expense_id: string;
  member_id: string;
  owed_cents: number;
  is_settled: boolean;
  settled_at: string | null;
  created_at: string;
};

export type ExpenseWithShares = Expense & {
  shares: ExpenseShare[];
};


