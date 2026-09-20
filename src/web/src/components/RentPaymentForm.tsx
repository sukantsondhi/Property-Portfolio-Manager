import { useEffect, useMemo, useState, type FormEvent } from "react";
import { usePortfolio } from "../context/PortfolioContext";
import { ApiError } from "../lib/api";
import { date, money, title } from "../lib/format";
import type { PortfolioRecord } from "../types";
import { Modal, Notice } from "./UI";

const today = () => new Date().toISOString().slice(0, 10);

const addMonths = (month: string, offset: number) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const value = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
};

const monthLabel = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
};

const monthEndDate = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
};

const paymentMonth = (payment: PortfolioRecord) =>
  String(payment.appliesToMonth || payment.paidDate || payment.dueDate || "").slice(0, 7);

export function RentPaymentForm({
  propertyId,
  tenants,
  payments = [],
  rentalYearId,
  record,
  onClose,
}: {
  propertyId: string;
  tenants: PortfolioRecord[];
  payments?: PortfolioRecord[];
  rentalYearId?: string;
  record?: PortfolioRecord;
  onClose: () => void;
}) {
  const { refresh, save, saveRentAdvance, updateRentAdvance } = usePortfolio();
  const editing = !!record;
  const editingAdvance = record?.status === "in_advance";
  const initialDate = String(record?.paidDate || today());
  const initialMonth = record ? paymentMonth(record) : initialDate.slice(0, 7);
  const [tenantId, setTenantId] = useState(String(record?.tenantId || tenants[0]?.id || ""));
  const [recordedDate, setRecordedDate] = useState(initialDate);
  const [status, setStatus] = useState(String(record?.status || "paid"));
  const [adjustedMonth, setAdjustedMonth] = useState(initialMonth);
  const [additionalMonthsInput, setAdditionalMonthsInput] = useState(String(record?.advanceAdditionalMonths || 1));
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tenant = useMemo(
    () => tenants.find((candidate) => candidate.id === tenantId),
    [tenantId, tenants],
  );
  const monthlyRentPence = Number(tenant?.monthlyRentPence || 0);
  const additionalMonths = Number(additionalMonthsInput);
  const advanceMonthsValid = /^[1-9][0-9]?$/.test(additionalMonthsInput) && additionalMonths <= 48;
  const advanceMonthCount = (advanceMonthsValid ? additionalMonths : 0) + 1;
  const firstCoveredMonth = recordedDate.slice(0, 7);
  const lastCoveredMonth = addMonths(firstCoveredMonth, advanceMonthsValid ? additionalMonths : 0);
  const advanceTotalPence = monthlyRentPence * advanceMonthCount;
  const advanceReceiptMonth = String(record?.advanceCoveredFrom || initialMonth);
  const effectiveMonth = status === "adjusted" ? adjustedMonth : firstCoveredMonth;
  const monthPayments = useMemo(
    () => payments
      .filter((payment) => payment.id !== record?.id && payment.tenantId === tenantId && paymentMonth(payment) === effectiveMonth)
      .sort((a, b) => String(b.paidDate).localeCompare(String(a.paidDate))),
    [effectiveMonth, payments, record?.id, tenantId],
  );
  const existingPaid = monthPayments.find((payment) => payment.status === "paid");
  const existingAdvance = monthPayments.find((payment) => payment.status === "in_advance");
  const willOverride = !editing && status !== "in_advance" && !!existingPaid && !existingAdvance;
  const blockedByAdvance = !editingAdvance && status !== "in_advance" && !!existingAdvance;
  const editBlockedByPaid = editing && !editingAdvance && effectiveMonth !== initialMonth && !!existingPaid;
  const advanceConflict = !editing && status === "in_advance" && monthPayments.length > 0;
  const additiveEntry = !editing && !existingPaid && !existingAdvance && ["partial", "late", "adjusted"].includes(status) && monthPayments.length > 0;
  const paidAfterInstalments = !editing && !existingPaid && !existingAdvance && status === "paid" && monthPayments.length > 0;
  const outstandingPaidAmountPence = Math.max(
    0,
    monthlyRentPence - monthPayments.reduce((sum, payment) => sum + Number(payment.amountPaidPence || 0), 0),
  );
  const defaultAmountPaid = editing && !editingAdvance
    ? (Number(record?.amountPaidPence || 0) / 100).toFixed(2)
    : paidAfterInstalments
    ? (outstandingPaidAmountPence / 100).toFixed(2)
    : monthlyRentPence
      ? (monthlyRentPence / 100).toFixed(2)
      : "0.00";
  const tenantName = tenant
    ? `${String(tenant.firstName)} ${String(tenant.lastName)}`
    : "this tenant";

  useEffect(() => {
    setOverrideConfirmed(false);
  }, [effectiveMonth, existingPaid?._etag, existingPaid?.id, status, tenantId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const notes = String(form.get("notes") ?? "").trim();
    const appliesToMonth = status === "adjusted"
      ? String(form.get("appliesToMonth") ?? "")
      : recordedDate.slice(0, 7);
    if (status === "adjusted" && (!notes || !appliesToMonth)) {
      setError("Adjusted rent requires a reason and the month it applies to.");
      return;
    }
    if (status === "in_advance" && !editingAdvance && !advanceMonthsValid) {
      setError("Additional months must be a natural number from 1 to 48.");
      return;
    }
    if (editBlockedByPaid) {
      setError("A separate Paid entry already exists for this tenant and month.");
      return;
    }
    if (blockedByAdvance || advanceConflict) {
      setError("Choose a month without a linked advance-rent allocation.");
      return;
    }
    if (willOverride && !overrideConfirmed) {
      setError("Confirm that the existing Paid entry should be replaced.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const common = {
        propertyId,
        tenantId,
        tenancyId: String(record?.tenancyId || (willOverride ? existingPaid?.tenancyId : "") || ""),
        ...(rentalYearId ? { rentalYearId } : {}),
        paidDate: recordedDate,
        bankReference: String(form.get("bankReference") ?? ""),
        rentFrequency: String(form.get("rentFrequency")),
        method: String(form.get("method")),
        notes,
      };
      if (status === "in_advance") {
        if (!monthlyRentPence) {
          setError("Set a positive monthly rent for this tenant before recording rent in advance.");
          return;
        }
        if (editingAdvance && record) await updateRentAdvance(record, common);
        else await saveRentAdvance({ ...common, additionalMonths });
      } else {
        await save("rentPayment", {
          ...common,
          dueDate: editing ? String(record?.dueDate || recordedDate) : recordedDate,
          appliesToMonth,
          amountDuePence: editing ? Number(record?.amountDuePence ?? monthlyRentPence) : monthlyRentPence,
          amountPaidPence: Math.round(Number(form.get("amountPaid") || 0) * 100),
          status,
        }, record ?? (willOverride ? existingPaid : undefined));
      }
      onClose();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) void refresh();
      setError(reason instanceof Error ? reason.message : "Unable to record rent.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={editingAdvance ? "Edit advance payment" : editing ? "Edit rent entry" : "Record rent"} onClose={onClose}>
      <form className="record-form" onSubmit={submit}>
        {error && <Notice type="error">{error}</Notice>}
        <Notice>{editingAdvance ? "This receipt is linked across its covered months. Saving updates the date, method, reference and notes on every linked allocation; the months and calculated amounts stay connected." : editing ? "Saving updates this specific rent entry; it does not create another payment." : status === "in_advance" ? "The total is calculated from the tenant's monthly rent. A linked rent entry will be created for the payment month and every additional month selected." : "Payments are attributed to the month of the recorded date. Use Adjusted to select a different month and explain why."}</Notice>
        {willOverride && <>
          <Notice type="warning"><strong>Paid rent is already recorded for {tenantName} in {monthLabel(effectiveMonth)}.</strong><br />Saving will replace the {money(existingPaid?.amountPaidPence)} entry recorded {date(existingPaid?.paidDate)}; it will not create another entry. To record instalments, first replace it with Partial, Late or Adjusted, then reopen Record rent to add the next payment.</Notice>
          <label className="rent-override-confirm"><input type="checkbox" checked={overrideConfirmed} onChange={(event) => setOverrideConfirmed(event.target.checked)} /><span>I understand and want to replace the existing Paid entry for {monthLabel(effectiveMonth)}.</span></label>
        </>}
        {blockedByAdvance && <Notice type="error">{monthLabel(effectiveMonth)} is already covered by a linked advance payment. That allocation cannot be overwritten with an ordinary rent entry.</Notice>}
        {editBlockedByPaid && <Notice type="error">A separate Paid entry already exists for {tenantName} in {monthLabel(effectiveMonth)}. Edit that Paid entry or keep this entry in another month.</Notice>}
        {advanceConflict && <Notice type="error">An advance payment can only start in a month with no existing rent entries for this tenant.</Notice>}
        {additiveEntry && <Notice type="success">This will add another {title(status)} entry for {tenantName} in {monthLabel(effectiveMonth)}. Partial, Late and Adjusted payments can have multiple entries.</Notice>}
        {paidAfterInstalments && <Notice type="warning">This will add the single Paid entry for {monthLabel(effectiveMonth)}. Existing Partial, Late or Adjusted amounts remain in the month's received total.</Notice>}
        <div className="form-grid">
          <label><span>Tenant <b>*</b></span><select required disabled={editing} value={tenantId} onChange={(event) => setTenantId(event.target.value)}>{tenants.map((item) => <option key={item.id} value={item.id}>{String(item.firstName)} {String(item.lastName)}</option>)}</select></label>
          <label><span>Tenant monthly rent</span><input readOnly value={monthlyRentPence ? money(monthlyRentPence) : "Not set"} /></label>
          {status === "in_advance"
            ? <label><span>Rent received (calculated)</span><input readOnly aria-label="Calculated rent received" value={money(advanceTotalPence)} /></label>
            : <label><span>Rent received <b>*</b></span><input key={editing ? `${record?.id}-${effectiveMonth}` : `${tenantId}-${status}-${effectiveMonth}-${defaultAmountPaid}`} name="amountPaid" type="number" min="0" step="0.01" required defaultValue={defaultAmountPaid} /></label>}
          <label><span>Date <b>*</b></span><input name="paidDate" type="date" required min={editingAdvance ? `${advanceReceiptMonth}-01` : undefined} max={editingAdvance ? monthEndDate(advanceReceiptMonth) : undefined} value={recordedDate} onChange={(event) => { const nextDate = event.target.value; if (status !== "adjusted" || adjustedMonth === firstCoveredMonth) setAdjustedMonth(nextDate.slice(0, 7)); setRecordedDate(nextDate); }} /></label>
          <label><span>Rent frequency <b>*</b></span><select name="rentFrequency" required defaultValue={String(record?.rentFrequency || tenant?.rentFrequency || "monthly")}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label>
          <label><span>Status <b>*</b></span><select name="status" required disabled={editingAdvance} value={status} onChange={(event) => { const nextStatus = event.target.value; setStatus(nextStatus); if (nextStatus === "adjusted") setAdjustedMonth(firstCoveredMonth); }}><option value="due">Due</option><option value="partial">Partial</option><option value="paid">Paid</option><option value="late">Late</option><option value="waived">Waived</option><option value="adjusted">Adjusted</option>{(!editing || editingAdvance) && <option value="in_advance">In advance</option>}</select></label>
          {status === "adjusted" && <label><span>Applies to month <b>*</b></span><input name="appliesToMonth" type="month" required value={adjustedMonth} onChange={(event) => setAdjustedMonth(event.target.value)} /></label>}
          {status === "in_advance" && <>
            {!editingAdvance && <label><span>Additional months after {monthLabel(firstCoveredMonth)} <b>*</b></span><input aria-label="Additional months paid in advance" name="additionalMonths" type="text" inputMode="numeric" pattern="[1-9][0-9]?" maxLength={2} required value={additionalMonthsInput} onChange={(event) => { if (/^\d{0,2}$/.test(event.target.value)) setAdditionalMonthsInput(event.target.value); }} /><small>Enter a whole number from 1 to 48. For example, 2 covers the payment month plus the following two months.</small></label>}
            <div className="rent-preview advance-preview"><span>Advance coverage</span><strong>{monthLabel(firstCoveredMonth)} to {monthLabel(lastCoveredMonth)} · {advanceMonthCount} months · {money(advanceTotalPence)}</strong></div>
          </>}
          <label><span>Method <b>*</b></span><select name="method" required defaultValue={String(record?.method || "bank_transfer")}><option value="bank_transfer">Bank</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
          <label><span>Rent bank reference</span><input name="bankReference" maxLength={1000} defaultValue={String(record?.bankReference || "")} /></label>
          <label className="wide"><span>Notes{status === "adjusted" && <b> *</b>}</span><textarea name="notes" rows={4} required={status === "adjusted"} defaultValue={String(record?.notes || "")} placeholder={status === "adjusted" ? "Explain the adjustment…" : "Optional payment note"} /></label>
        </div>
        <footer><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !tenants.length || blockedByAdvance || editBlockedByPaid || advanceConflict || (status === "in_advance" && !editingAdvance && !advanceMonthsValid) || (willOverride && !overrideConfirmed)}>{busy ? "Saving…" : editing ? "Save changes" : willOverride ? "Replace rent entry" : "Record rent"}</button></footer>
      </form>
    </Modal>
  );
}
