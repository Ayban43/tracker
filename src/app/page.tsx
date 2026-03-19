"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  Car,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Fuel,
  Plus,
  Receipt,
  Sparkles,
  Users,
  UtensilsCrossed,
  Wallet,
  Waves,
} from "lucide-react";
import { getBrowserSupabaseClient } from "@/lib/supabase-browser";
import type { ExpenseShare, ExpenseWithShares, Member, Trip } from "@/lib/types";

type Tab = "overview" | "add" | "activity";

type FormState = {
  title: string;
  category: "car" | "food" | "gas" | "activity" | "other";
  splitMode: "equal" | "custom";
  total: string;
  serviceCharge: string;
  paidByMemberId: string;
  occurredOn: string;
  notes: string;
  participantIds: string[];
};

const today = new Date().toISOString().slice(0, 10);

const initialForm: FormState = {
  title: "",
  category: "food",
  splitMode: "equal",
  total: "",
  serviceCharge: "",
  paidByMemberId: "",
  occurredOn: today,
  notes: "",
  participantIds: [],
};

const tabs: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: "overview", label: "Overview", icon: Sparkles },
  { id: "add", label: "Add", icon: Plus },
  { id: "activity", label: "Activity", icon: Activity },
];

const RECEIPT_BUCKET = "expense-receipts";

function amountToCents(input: string): number | null {
  const value = Number(input.replaceAll(",", "").trim());
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

function formatAmount(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function splitEvenly(totalCents: number, ids: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  if (ids.length === 0) return result;

  const base = Math.floor(totalCents / ids.length);
  const remainder = totalCents % ids.length;

  ids.forEach((id, idx) => {
    result[id] = base + (idx < remainder ? 1 : 0);
  });

  return result;
}

function categoryIcon(category: "car" | "food" | "gas" | "activity" | "other") {
  if (category === "car") return <Car className="h-4 w-4" />;
  if (category === "food") return <UtensilsCrossed className="h-4 w-4" />;
  if (category === "gas") return <Fuel className="h-4 w-4" />;
  if (category === "activity") return <Waves className="h-4 w-4" />;
  return <Receipt className="h-4 w-4" />;
}

export default function Home() {
  const tripId = process.env.NEXT_PUBLIC_TRIP_ID ?? "";
  const supabase = useMemo(() => {
    try {
      return getBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const [, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<ExpenseWithShares[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [customShares, setCustomShares] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [activityStatusTab, setActivityStatusTab] = useState<"unsettled" | "settled">("unsettled");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "title_asc">("date_desc");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!supabase || !tripId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [tripRes, membersRes, expensesRes] = await Promise.all([
        supabase.from("trips").select("*").eq("id", tripId).maybeSingle<Trip>(),
        supabase
          .from("members")
          .select("*")
          .eq("trip_id", tripId)
          .order("sort_order", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true }),
        supabase
          .from("expenses")
          .select("*")
          .eq("trip_id", tripId)
          .order("occurred_on", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);

      if (tripRes.error) throw tripRes.error;
      if (membersRes.error) throw membersRes.error;
      if (expensesRes.error) throw expensesRes.error;

      const loadedMembers = (membersRes.data ?? []) as Member[];
      const loadedExpenses = (expensesRes.data ?? []) as ExpenseWithShares[];
      const ids = loadedExpenses.map((e) => e.id);
      let shares: ExpenseShare[] = [];

      if (ids.length > 0) {
        const sharesRes = await supabase
          .from("expense_shares")
          .select("*")
          .in("expense_id", ids)
          .order("created_at", { ascending: true });
        if (sharesRes.error) throw sharesRes.error;
        shares = (sharesRes.data ?? []) as ExpenseShare[];
      }

      const byExpense = new Map<string, ExpenseShare[]>();
      shares.forEach((share) => {
        const list = byExpense.get(share.expense_id) ?? [];
        list.push(share);
        byExpense.set(share.expense_id, list);
      });

      setTrip(tripRes.data ?? null);
      setMembers(loadedMembers);
      setExpenses(loadedExpenses.map((e) => ({ ...e, shares: byExpense.get(e.id) ?? [] })));

      setForm((current) => ({
        ...current,
        paidByMemberId: current.paidByMemberId || loadedMembers[0]?.id || "",
        participantIds: current.participantIds.length > 0 ? current.participantIds : loadedMembers.map((m) => m.id),
      }));

      if (Object.keys(customShares).length === 0) {
        const next: Record<string, string> = {};
        loadedMembers.forEach((m) => {
          next[m.id] = "";
        });
        setCustomShares(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, supabase]);

  useEffect(() => {
    return () => {
      if (receiptPreviewUrl) {
        URL.revokeObjectURL(receiptPreviewUrl);
      }
    };
  }, [receiptPreviewUrl]);

  const membersById = useMemo(() => {
    const map = new Map<string, Member>();
    members.forEach((m) => map.set(m.id, m));
    return map;
  }, [members]);
  const memberOrderById = useMemo(
    () => new Map(members.map((member, index) => [member.id, index])),
    [members],
  );

  const summary = useMemo(() => {
    const totalSpent = expenses.reduce((sum, e) => sum + e.amount_cents, 0);
    const unsettled = expenses.reduce(
      (sum, e) => sum + e.shares.filter((s) => !s.is_settled && s.owed_cents > 0).length,
      0,
    );

    const ledger = members.map((m) => {
      const owed = expenses.reduce((sum, e) => {
        const share = e.shares.find((s) => s.member_id === m.id);
        return sum + (share?.owed_cents ?? 0);
      }, 0);

      const unsettledShare = expenses.reduce((sum, e) => {
        const share = e.shares.find((s) => s.member_id === m.id && !s.is_settled);
        return sum + (share?.owed_cents ?? 0);
      }, 0);
      const settledShare = owed - unsettledShare;

      const creditOutstanding = expenses.reduce((sum, e) => {
        if (e.paid_by_member_id !== m.id) return sum;

        return (
          sum +
          e.shares.reduce((shareSum, share) => {
            if (share.is_settled) return shareSum;
            if (share.member_id === m.id) return shareSum;
            return shareSum + share.owed_cents;
          }, 0)
        );
      }, 0);

      const debitOutstanding = expenses.reduce((sum, e) => {
        return (
          sum +
          e.shares.reduce((shareSum, share) => {
            if (share.member_id !== m.id) return shareSum;
            if (share.is_settled) return shareSum;
            if (e.paid_by_member_id === m.id) return shareSum;
            return shareSum + share.owed_cents;
          }, 0)
        );
      }, 0);

      return {
        member: m,
        owed,
        settledShare,
        unsettledShare,
        openBalance: creditOutstanding - debitOutstanding,
      };
    });

    const totalShares = expenses.reduce((sum, e) => sum + e.shares.length, 0);
    const settledShares = expenses.reduce((sum, e) => sum + e.shares.filter((s) => s.is_settled).length, 0);

    return { totalSpent, unsettled, ledger, totalShares, settledShares };
  }, [expenses, members]);

  const filteredExpenses = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = expenses.filter((expense) => {
      if (!query) return true;
      const payer = membersById.get(expense.paid_by_member_id)?.name ?? "";
      const haystack = `${expense.title} ${expense.category} ${payer}`.toLowerCase();
      return haystack.includes(query);
    });

    filtered.sort((a, b) => {
      if (sortBy === "amount_desc") return b.amount_cents - a.amount_cents;
      if (sortBy === "amount_asc") return a.amount_cents - b.amount_cents;
      if (sortBy === "title_asc") return a.title.localeCompare(b.title);
      if (sortBy === "date_asc") {
        return (
          new Date(a.occurred_on).getTime() - new Date(b.occurred_on).getTime() ||
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      }

      return (
        new Date(b.occurred_on).getTime() - new Date(a.occurred_on).getTime() ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });

    return filtered;
  }, [expenses, membersById, searchQuery, sortBy]);
  const unsettledActivityExpenses = useMemo(
    () =>
      filteredExpenses.filter((expense) =>
        expense.shares.some((share) => !share.is_settled && share.owed_cents > 0),
      ),
    [filteredExpenses],
  );
  const settledActivityExpenses = useMemo(
    () =>
      filteredExpenses.filter(
        (expense) =>
          !expense.shares.some((share) => !share.is_settled && share.owed_cents > 0),
      ),
    [filteredExpenses],
  );
  const selectedActivityExpenses =
    activityStatusTab === "unsettled" ? unsettledActivityExpenses : settledActivityExpenses;
  const visibleSelectedActivityExpenses = showAll
    ? selectedActivityExpenses
    : selectedActivityExpenses.slice(0, 6);
  const settlementRate = summary.totalShares ? Math.round((summary.settledShares / summary.totalShares) * 100) : 0;
  const enteredSubtotalCents = useMemo(() => {
    if (form.splitMode !== "custom") return 0;

    return members
      .filter((member) => form.participantIds.includes(member.id))
      .reduce((sum, member) => {
        const cents = amountToCents(customShares[member.id] ?? "");
        return sum + (cents ?? 0);
      }, 0);
  }, [customShares, form.participantIds, form.splitMode, members]);
  const serviceChargePreviewCents =
    form.category === "food" ? amountToCents(form.serviceCharge) ?? 0 : 0;
  const totalInputCents = amountToCents(form.total) ?? 0;
  const targetSubtotalCents =
    form.category === "food"
      ? Math.max(totalInputCents - serviceChargePreviewCents, 0)
      : totalInputCents;
  const subtotalDiffCents = targetSubtotalCents - enteredSubtotalCents;
  const customFinalPreview = useMemo(() => {
    if (form.splitMode !== "custom") return [] as Array<{ memberName: string; finalCents: number }>;

    const baseByMember: Record<string, number> = {};
    const participantIds = members
      .filter((member) => form.participantIds.includes(member.id))
      .map((member) => member.id);
    participantIds.forEach((memberId) => {
      const base = amountToCents(customShares[memberId] ?? "");
      if (base && base > 0) baseByMember[memberId] = base;
    });

    const serviceByMember =
      form.category === "food" && serviceChargePreviewCents > 0
        ? splitEvenly(serviceChargePreviewCents, participantIds)
        : {};

    return participantIds
      .filter((memberId) => baseByMember[memberId] > 0)
      .map((memberId) => ({
      memberName: membersById.get(memberId)?.name ?? "Member",
      finalCents: baseByMember[memberId] + (serviceByMember[memberId] ?? 0),
    }));
  }, [
    customShares,
    form.category,
    form.participantIds,
    form.splitMode,
    membersById,
    members,
    serviceChargePreviewCents,
  ]);

  function toggleParticipant(memberId: string) {
    setForm((current) => {
      const has = current.participantIds.includes(memberId);
      return {
        ...current,
        participantIds: has
          ? current.participantIds.filter((id) => id !== memberId)
          : [...current.participantIds, memberId],
      };
    });
  }

  function handleReceiptChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (receiptPreviewUrl) {
      URL.revokeObjectURL(receiptPreviewUrl);
    }

    setReceiptFile(file);
    setReceiptPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  async function createExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !tripId) return;

    const totalCents = amountToCents(form.total);
    if (!totalCents) return setError("Enter a valid total amount.");

    const hasServiceChargeInput = form.category === "food" && form.serviceCharge.trim().length > 0;
    const parsedServiceCharge = hasServiceChargeInput ? amountToCents(form.serviceCharge) : 0;
    if (hasServiceChargeInput && parsedServiceCharge === null) {
      return setError("Enter a valid service charge amount.");
    }

    const serviceChargeCents = parsedServiceCharge ?? 0;
    if (form.category === "food" && serviceChargeCents > totalCents) {
      return setError("Service charge cannot be greater than total.");
    }
    if (!form.paidByMemberId) return setError("Select who paid.");
    if (form.participantIds.length === 0) return setError("Select at least one participant.");

    let sharesByMember: Record<string, number> = {};

    if (form.splitMode === "equal") {
      sharesByMember = splitEvenly(totalCents, form.participantIds);
    } else {
      const selected = new Set(form.participantIds);
      const parsed: Record<string, number> = {};

      Object.entries(customShares).forEach(([memberId, value]) => {
        if (!selected.has(memberId)) return;
        const cents = amountToCents(value);
        if (cents) parsed[memberId] = cents;
      });

      const customTotal = Object.values(parsed).reduce((sum, cents) => sum + cents, 0);
      const expectedSubtotal =
        form.category === "food" ? totalCents - serviceChargeCents : totalCents;
      if (customTotal !== expectedSubtotal) {
        return setError(`Custom split must equal ${formatAmount(expectedSubtotal)}.`);
      }

      sharesByMember = { ...parsed };

      if (serviceChargeCents > 0) {
        const serviceChargeSplit = splitEvenly(serviceChargeCents, form.participantIds);
        Object.entries(serviceChargeSplit).forEach(([memberId, value]) => {
          sharesByMember[memberId] = (sharesByMember[memberId] ?? 0) + value;
        });
      }
    }

    setIsSaving(true);
    setError(null);

    try {
      let receiptUrl: string | null = null;

      if (receiptFile) {
        const safeName = receiptFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const path = `${tripId}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from(RECEIPT_BUCKET)
          .upload(path, receiptFile, { upsert: false });

        if (uploadError) {
          throw new Error("Failed to upload receipt photo. Check storage bucket/policies.");
        }

        const { data: publicUrlData } = supabase.storage.from(RECEIPT_BUCKET).getPublicUrl(path);
        receiptUrl = publicUrlData.publicUrl;
      }

      const { data, error: expenseError } = await supabase
        .from("expenses")
        .insert({
          trip_id: tripId,
          title: form.title || `${form.category.toUpperCase()} expense`,
          category: form.category,
          split_mode: form.splitMode,
          amount_cents: totalCents,
          receipt_url: receiptUrl,
          paid_by_member_id: form.paidByMemberId,
          occurred_on: form.occurredOn,
          notes: form.notes || null,
        })
        .select("*")
        .single();

      if (expenseError) throw expenseError;

      const rows = Object.entries(sharesByMember).map(([memberId, owedCents]) => ({
        expense_id: data.id,
        member_id: memberId,
        owed_cents: owedCents,
        is_settled: memberId === form.paidByMemberId || owedCents === 0,
        settled_at: memberId === form.paidByMemberId || owedCents === 0 ? new Date().toISOString() : null,
      }));

      const { error: sharesError } = await supabase.from("expense_shares").insert(rows);
      if (sharesError) throw sharesError;

      setForm((current) => ({
        ...initialForm,
        paidByMemberId: current.paidByMemberId,
        participantIds: members.map((m) => m.id),
      }));
      if (receiptPreviewUrl) {
        URL.revokeObjectURL(receiptPreviewUrl);
      }
      setReceiptFile(null);
      setReceiptPreviewUrl(null);
      setActiveTab("activity");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create expense.");
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleSettled(expenseId: string, share: ExpenseShare, next: boolean) {
    if (!supabase) return;
    if (share.is_settled && !next) {
      const confirmed = window.confirm("Mark this payment as unsettled?");
      if (!confirmed) return;
    }

    setExpenses((current) =>
      current.map((expense) =>
        expense.id !== expenseId
          ? expense
          : {
              ...expense,
              shares: expense.shares.map((s) =>
                s.id === share.id
                  ? { ...s, is_settled: next, settled_at: next ? new Date().toISOString() : null }
                  : s,
              ),
            },
      ),
    );

    const { error: updateError } = await supabase
      .from("expense_shares")
      .update({ is_settled: next, settled_at: next ? new Date().toISOString() : null })
      .eq("id", share.id);

    if (updateError) {
      setError(updateError.message);
      await reload();
    }
  }

  if (!supabase || !tripId) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-md bg-[#090d1a] px-4 py-8 text-white">
        <section className="rounded-3xl border border-white/10 bg-white/10 p-5 backdrop-blur-xl">
          <h1 className="text-xl font-bold">Trip Expense Tracker</h1>
          <p className="mt-2 text-sm text-slate-200">Set these env vars first:</p>
          <ul className="mt-2 list-disc pl-5 text-xs text-slate-100">
            <li>NEXT_PUBLIC_SUPABASE_URL</li>
            <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
            <li>NEXT_PUBLIC_TRIP_ID</li>
          </ul>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#090d1a] text-white">
      <div className="relative overflow-hidden px-4 pb-24 pt-4">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,#2563eb33_0%,transparent_45%),radial-gradient(circle_at_left_30%,#14b8a633_0%,transparent_42%),linear-gradient(180deg,#090d1a_0%,#0c1020_100%)]" />

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl"
        >
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-cyan-200/80">Trip wallet</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-3">
              <div className="flex items-center gap-2 text-emerald-100">
                <Wallet className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-wide">Total spent</p>
              </div>
              <p className="mt-1 text-lg font-bold">{formatAmount(summary.totalSpent)}</p>
            </div>
            <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-3">
              <div className="flex items-center gap-2 text-amber-100">
                <CircleDollarSign className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-wide">Unsettled</p>
              </div>
              <p className="mt-1 text-lg font-bold">{summary.unsettled}</p>
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-cyan-100">
              <p className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Settlement progress</p>
              <p>{settlementRate}%</p>
            </div>
            <div className="h-2 rounded-full bg-white/15">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${settlementRate}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 18 }}
                className="h-2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500"
              />
            </div>
          </div>

          {error ? <p className="mt-3 rounded-xl bg-rose-500/20 px-3 py-2 text-sm text-rose-100">{error}</p> : null}
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.04 }}
          className="mt-4 rounded-2xl border border-white/10 bg-white/10 p-1 backdrop-blur"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-1/3 rounded-xl px-2 py-2 text-xs font-semibold transition ${
                  activeTab === tab.id
                    ? "bg-white text-slate-900"
                    : "text-slate-100/90 hover:text-white"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </span>
              </button>
            );
          })}
        </motion.section>

        <AnimatePresence mode="wait">
          {activeTab === "overview" ? (
            <motion.section
              key="overview"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mt-4 rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur-xl"
            >
              <h2 className="text-sm font-semibold text-cyan-100">To Pay / To Receive</h2>
              <div className="mt-3 space-y-2">
                {[...summary.ledger]
                  .sort(
                    (a, b) =>
                      (memberOrderById.get(a.member.id) ?? Number.MAX_SAFE_INTEGER) -
                      (memberOrderById.get(b.member.id) ?? Number.MAX_SAFE_INTEGER),
                  )
                  .map((entry) => (
                    <article key={entry.member.id} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">{entry.member.name}</p>
                        <p
                          className={`text-sm font-bold ${
                            entry.openBalance > 0
                              ? "text-emerald-300"
                              : entry.openBalance < 0
                                ? "text-rose-300"
                                : "text-cyan-200"
                          }`}
                        >
                          {entry.openBalance > 0
                            ? `To receive ${formatAmount(Math.abs(entry.openBalance))}`
                            : entry.openBalance < 0
                              ? `To pay ${formatAmount(Math.abs(entry.openBalance))}`
                              : "Balanced"}
                        </p>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-200">
                        <p className="rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                          My total share: <span className="font-semibold text-white">{formatAmount(entry.owed)}</span>
                        </p>
                        <p className="rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                          Already paid share:{" "}
                          <span className="font-semibold text-white">{formatAmount(entry.settledShare)}</span>
                        </p>
                      </div>
                      <p className="mt-2 text-xs text-slate-300">
                        Left to pay {formatAmount(entry.unsettledShare)}
                      </p>
                    </article>
                  ))}
              </div>
            </motion.section>
          ) : null}

          {activeTab === "add" ? (
            <motion.section
              key="add"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mt-4 rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur-xl"
            >
              <h2 className="text-sm font-semibold text-cyan-100">Add Expense</h2>
              <form onSubmit={createExpense} className="mt-3 space-y-3">
                <input
                  value={form.title}
                  onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))}
                  placeholder="Title"
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-300 focus:border-cyan-300/60 focus:outline-none"
                />

                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={form.total}
                    onChange={(e) => setForm((current) => ({ ...current, total: e.target.value }))}
                    placeholder={form.category === "food" ? "Total (incl. service)" : "Total"}
                    inputMode="decimal"
                    className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-300 focus:border-cyan-300/60 focus:outline-none"
                  />
                  <input
                    type="date"
                    value={form.occurredOn}
                    onChange={(e) => setForm((current) => ({ ...current, occurredOn: e.target.value }))}
                    className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-300/60 focus:outline-none"
                  />
                </div>

                {form.category === "food" ? (
                  <input
                    value={form.serviceCharge}
                    onChange={(e) => setForm((current) => ({ ...current, serviceCharge: e.target.value }))}
                    placeholder="Service charge (optional)"
                    inputMode="decimal"
                    className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-300 focus:border-cyan-300/60 focus:outline-none"
                  />
                ) : null}

                <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {(["food", "gas", "activity", "other"] as const).map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, category }))}
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                        form.category === category
                          ? "bg-white text-slate-900"
                          : "bg-white/10 text-slate-100"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {categoryIcon(category)}
                        {category}
                      </span>
                    </button>
                  ))}
                </div>

                <select
                  value={form.paidByMemberId}
                  onChange={(e) => setForm((current) => ({ ...current, paidByMemberId: e.target.value }))}
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-300/60 focus:outline-none"
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id} className="text-slate-900">
                      {member.name}
                    </option>
                  ))}
                </select>

                <div className="flex gap-2">
                  {(["equal", "custom"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, splitMode: mode }))}
                      className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                        form.splitMode === mode
                          ? "bg-cyan-400 text-slate-900"
                          : "bg-white/10 text-slate-100"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  {members.map((member) => {
                    const selected = form.participantIds.includes(member.id);
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => toggleParticipant(member.id)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          selected
                            ? "bg-blue-500 text-white"
                            : "bg-white/10 text-slate-100"
                        }`}
                      >
                        {member.name}
                      </button>
                    );
                  })}
                </div>

                {form.splitMode === "custom" ? (
                  <div className="rounded-xl border border-cyan-300/20 bg-cyan-500/10 p-3">
                    <p className="text-xs font-semibold text-cyan-100">Custom amounts</p>
                    <div className="mt-2 space-y-2">
                      {members
                        .filter((member) => form.participantIds.includes(member.id))
                        .map((member) => (
                          <label key={member.id} className="flex items-center justify-between text-sm">
                            <span>{member.name}</span>
                            <input
                              value={customShares[member.id] ?? ""}
                              onChange={(e) =>
                                setCustomShares((current) => ({ ...current, [member.id]: e.target.value }))
                              }
                              placeholder="0.00"
                              inputMode="decimal"
                              className="w-24 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-right text-white placeholder:text-slate-300 focus:border-cyan-300/60 focus:outline-none"
                            />
                          </label>
                        ))}
                    </div>
                    <div className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">
                      <p className="flex items-center justify-between text-slate-200">
                        <span>Subtotal entered</span>
                        <span className="font-semibold">{formatAmount(enteredSubtotalCents)}</span>
                      </p>
                      <p className="mt-1 flex items-center justify-between text-slate-200">
                        <span>
                          {form.category === "food" && serviceChargePreviewCents > 0
                            ? "Target subtotal (total - service)"
                            : "Target subtotal"}
                        </span>
                        <span className="font-semibold">{formatAmount(targetSubtotalCents)}</span>
                      </p>
                      <p
                        className={`mt-1 flex items-center justify-between font-semibold ${
                          subtotalDiffCents === 0
                            ? "text-emerald-300"
                            : subtotalDiffCents > 0
                              ? "text-amber-300"
                              : "text-rose-300"
                        }`}
                      >
                        <span>{subtotalDiffCents === 0 ? "Matched" : subtotalDiffCents > 0 ? "Remaining" : "Over by"}</span>
                        <span>{formatAmount(Math.abs(subtotalDiffCents))}</span>
                      </p>
                      {form.category === "food" && serviceChargePreviewCents > 0 ? (
                        <>
                          <p className="mt-1 flex items-center justify-between text-slate-200">
                            <span>Service charge</span>
                            <span className="font-semibold">{formatAmount(serviceChargePreviewCents)}</span>
                          </p>
                          <p className="mt-1 flex items-center justify-between text-cyan-200">
                            <span>Grand total with service</span>
                            <span className="font-semibold">
                              {formatAmount(totalInputCents)}
                            </span>
                          </p>
                        </>
                      ) : null}
                    </div>
                    {form.category === "food" && serviceChargePreviewCents > 0 && customFinalPreview.length > 0 ? (
                      <div className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">
                        <p className="font-semibold text-cyan-100">Final per person (incl. service)</p>
                        <div className="mt-1 space-y-1">
                          {customFinalPreview.map((item) => (
                            <p key={item.memberName} className="flex items-center justify-between text-slate-200">
                              <span>{item.memberName}</span>
                              <span className="font-semibold">{formatAmount(item.finalCents)}</span>
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="rounded-xl border border-white/15 bg-white/5 p-3">
                  <label className="text-xs font-semibold text-cyan-100">Receipt photo</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleReceiptChange}
                    className="mt-2 block w-full text-xs text-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-400 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-900"
                  />
                  {receiptPreviewUrl ? (
                    <img
                      src={receiptPreviewUrl}
                      alt="Receipt preview"
                      className="mt-2 h-28 w-full rounded-lg object-cover"
                    />
                  ) : null}
                </div>

                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
                  placeholder="Notes"
                  rows={2}
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-300 focus:border-cyan-300/60 focus:outline-none"
                />

                <button
                  type="submit"
                  disabled={isSaving || members.length === 0}
                  className="w-full rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-2.5 text-sm font-semibold text-slate-900 disabled:opacity-50"
                >
                  {isSaving ? "Saving..." : "Save expense"}
                </button>
              </form>
            </motion.section>
          ) : null}

          {activeTab === "activity" ? (
            <motion.section
              key="activity"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mt-4 space-y-3"
            >
              <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-cyan-100">Recent expenses</h2>
                  {unsettledActivityExpenses.length > 6 || settledActivityExpenses.length > 6 ? (
                    <button
                      type="button"
                      onClick={() => setShowAll((v) => !v)}
                      className="text-xs font-semibold text-cyan-200"
                    >
                      {showAll ? "Show less" : "Show all"}
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-slate-300">Tap a card to expand settlement items.</p>

                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <input
                    value={searchQuery}
                    onChange={(e) => {
                      setShowAll(false);
                      setSearchQuery(e.target.value);
                    }}
                    placeholder="Search title, category, payer..."
                    className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-300 focus:border-cyan-300/60 focus:outline-none"
                  />
                  <select
                    value={sortBy}
                    onChange={(e) => {
                      setShowAll(false);
                      setSortBy(
                        e.target.value as
                          | "date_desc"
                          | "date_asc"
                          | "amount_desc"
                          | "amount_asc"
                          | "title_asc",
                      );
                    }}
                    className="rounded-xl border border-white/15 bg-white/5 px-2 py-2 text-xs text-white focus:border-cyan-300/60 focus:outline-none"
                  >
                    <option value="date_desc" className="text-slate-900">
                      Newest
                    </option>
                    <option value="date_asc" className="text-slate-900">
                      Oldest
                    </option>
                    <option value="amount_desc" className="text-slate-900">
                      Amount high
                    </option>
                    <option value="amount_asc" className="text-slate-900">
                      Amount low
                    </option>
                    <option value="title_asc" className="text-slate-900">
                      Name A-Z
                    </option>
                  </select>
                </div>
              </div>

              {isLoading ? (
                <p className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-slate-200">Loading...</p>
              ) : null}

              {!isLoading && filteredExpenses.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-slate-200">
                  No expenses matched your search.
                </p>
              ) : null}

              {filteredExpenses.length > 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAll(false);
                      setActivityStatusTab("unsettled");
                    }}
                    className={`w-1/2 rounded-xl px-2 py-2 text-xs font-semibold transition ${
                      activityStatusTab === "unsettled"
                        ? "bg-white text-slate-900"
                        : "text-slate-200"
                    }`}
                  >
                    Unsettled ({unsettledActivityExpenses.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAll(false);
                      setActivityStatusTab("settled");
                    }}
                    className={`w-1/2 rounded-xl px-2 py-2 text-xs font-semibold transition ${
                      activityStatusTab === "settled" ? "bg-white text-slate-900" : "text-slate-200"
                    }`}
                  >
                    Settled ({settledActivityExpenses.length})
                  </button>
                </div>
              ) : null}

              {visibleSelectedActivityExpenses.map((expense) => {
                const payer = membersById.get(expense.paid_by_member_id)?.name ?? "Unknown";
                const isOpen = expanded.includes(expense.id);
                const unsettled = expense.shares.filter((s) => !s.is_settled && s.owed_cents > 0).length;

                return (
                  <motion.article
                    key={expense.id}
                    layout
                    className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur-xl"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((cur) =>
                          cur.includes(expense.id)
                            ? cur.filter((id) => id !== expense.id)
                            : [...cur, expense.id],
                        )
                      }
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-bold">{expense.title}</p>
                          <p className="mt-1 text-xs text-slate-300">{expense.category.toUpperCase()} | Paid by {payer}</p>
                          {expense.receipt_url ? (
                            <a
                              href={expense.receipt_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-block text-[11px] font-semibold text-cyan-200 underline underline-offset-2"
                              onClick={(event) => event.stopPropagation()}
                            >
                              View receipt
                            </a>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <p className="text-base font-bold">{formatAmount(expense.amount_cents)}</p>
                          <p className={`text-xs font-semibold ${unsettled ? "text-amber-300" : "text-emerald-300"}`}>
                            {unsettled ? `${unsettled} unsettled` : "All settled"}
                          </p>
                        </div>
                      </div>
                      <p className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-200">
                        {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {isOpen ? "Hide details" : "View details"}
                      </p>
                    </button>

                    <AnimatePresence>
                      {isOpen ? (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-3 space-y-2 overflow-hidden border-t border-white/10 pt-3"
                        >
                          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-100">
                            To pay
                          </p>
                          {expense.receipt_url ? (
                            <img
                              src={expense.receipt_url}
                              alt="Expense receipt"
                              className="h-36 w-full rounded-xl object-cover"
                            />
                          ) : null}
                          {expense.shares.map((share) => {
                            const member = membersById.get(share.member_id)?.name ?? "Member";
                            return (
                              <label
                                key={share.id}
                                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                              >
                                <span className="text-sm text-slate-100">{member}</span>
                                <span className="flex items-center gap-3">
                                  <span className="text-sm font-semibold text-slate-100">
                                    {formatAmount(share.owed_cents)}
                                  </span>
                                  <span className="flex items-center gap-2 text-xs font-semibold text-cyan-100">
                                    Settled
                                    <input
                                      type="checkbox"
                                      checked={share.is_settled}
                                      onChange={(e) => toggleSettled(expense.id, share, e.target.checked)}
                                      className="h-4 w-4 rounded border-white/20 bg-white/10"
                                    />
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </motion.article>
                );
              })}
            </motion.section>
          ) : null}
        </AnimatePresence>
      </div>

      {activeTab !== "add" ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 mx-auto flex w-full max-w-md justify-end px-6">
          <motion.button
            whileTap={{ scale: 0.97 }}
            type="button"
            onClick={() => setActiveTab("add")}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 px-5 py-3 text-sm font-semibold text-slate-900 shadow-2xl shadow-cyan-500/25"
          >
            <Plus className="h-4 w-4" />
            Add expense
          </motion.button>
        </div>
      ) : null}
    </main>
  );
}
