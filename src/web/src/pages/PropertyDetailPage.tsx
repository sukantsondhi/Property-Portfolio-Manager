import {
  ArrowLeft,
  BadgeCheck,
  Bath,
  BedDouble,
  BellRing,
  CirclePoundSterling,
  CalendarClock,
  CalendarPlus,
  CalendarRange,
  FileText,
  Home,
  MapPin,
  Pencil,
  Plus,
  ReceiptText,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { DocumentUpload } from "../components/DocumentUpload";
import { PropertyForm } from "../components/PropertyForm";
import { RentPaymentForm } from "../components/RentPaymentForm";
import { RecordForm, type Field } from "../components/RecordForm";
import { RecordMenu } from "../components/RecordMenu";
import { Empty, Modal, Notice } from "../components/UI";
import { usePortfolio } from "../context/PortfolioContext";
import { date, initials, money, title } from "../lib/format";
import { calculateRentLedger, calculateRentMonth } from "../lib/finance";
import type { PortfolioRecord, RecordKind } from "../types";
import { api } from "../lib/api";

const tenantFields: Field[] = [
  { name: "firstName", required: true },
  { name: "lastName", required: true },
  { name: "email", type: "email", required: true },
  { name: "phone" },
  { name: "dateOfBirth", type: "date" },
  { name: "university", label: "University (if applicable)" },
  { name: "course" },
  { name: "studentId", label: "Student ID" },
  { name: "emergencyContactName" },
  { name: "emergencyContactPhone" },
  { name: "room" },
  { name: "monthlyRentPence", label: "Tenant monthly rent", type: "money", required: true },
  {
    name: "rentFrequency",
    type: "select",
    required: true,
    options: ["monthly", "quarterly", "yearly"].map((value) => ({ label: title(value), value })),
  },
  { name: "depositPence", label: "Deposit", type: "money" },
  { name: "depositBankReference", label: "Deposit bank reference" },
  {
    name: "depositStatus",
    type: "select",
    required: true,
    options: ["not_received", "received", "protected", "returned"].map((value) => ({ label: title(value), value })),
  },
  { name: "notes", type: "textarea", wide: true },
];

const complianceFields: Field[] = [
  {
    name: "category",
    type: "select",
    required: true,
    options: [
      "epc",
      "boiler",
      "gas_safety",
      "eicr",
      "insurance",
      "hmo_licence",
      "fire_safety",
      "other",
    ].map((value) => ({ label: title(value), value })),
  },
  { name: "title", required: true },
  { name: "provider" },
  { name: "reference" },
  { name: "issueDate", type: "date" },
  { name: "expiryDate", label: "Due or expiry date", type: "date", required: true },
  {
    name: "status",
    type: "select",
    required: true,
    options: ["valid", "due_soon", "expired", "not_required"].map((value) => ({
      label: title(value),
      value,
    })),
  },
  { name: "reminderEnabled", label: "Send email reminder", type: "checkbox" },
  {
    name: "reminderOffset1",
    label: "First reminder (days before)",
    type: "number",
    required: true,
  },
  { name: "reminderOffset2", label: "Second reminder (optional)", type: "number" },
  { name: "reminderOffset3", label: "Third reminder (optional)", type: "number" },
  { name: "notes", type: "textarea", wide: true },
];

const expenseFields: Field[] = [
  {
    name: "category",
    type: "select",
    required: true,
    options: [
      "mortgage",
      "maintenance",
      "utilities",
      "insurance",
      "tax",
      "management",
      "furnishing",
      "other",
    ].map((value) => ({ label: title(value), value })),
  },
  { name: "supplier" },
  { name: "amountPence", label: "Amount", type: "money", required: true },
  { name: "expenseDate", type: "date", required: true },
  { name: "recurring", type: "checkbox" },
  { name: "description", required: true, wide: true },
  { name: "documentId" },
];

type Tab =
  | "overview"
  | "tenancy"
  | "tenants"
  | "guarantors"
  | "compliance"
  | "finance"
  | "documents";
type FormState = {
  kind: RecordKind;
  record?: PortfolioRecord;
  defaults?: Record<string, unknown>;
};

export function PropertyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { records, refresh, setArchived } = usePortfolio();
  const property = records.find(
    (record) => record.kind === "property" && record.id === id,
  );
  const [tab, setTab] = useState<Tab>("overview");
  const [form, setForm] = useState<FormState>();
  const [upload, setUpload] = useState<"other" | "compliance">();
  const [recordingRent, setRecordingRent] = useState(false);
  const [editingRent, setEditingRent] = useState<PortfolioRecord>();
  const [startingYear, setStartingYear] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [lifecycleError, setLifecycleError] = useState("");
  const related = useMemo(
    () => records.filter((record) => record.propertyId === id),
    [records, id],
  );

  if (!property)
    return (
      <div className="page">
        <Empty
          title="Property not found"
          description="This property may have been archived."
          action={
            <Link className="button secondary" to="/app/properties">
              Back to properties
            </Link>
          }
        />
      </div>
    );

  const rentalYears = related
    .filter((record) => record.kind === "rentalYear")
    .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
  const currentYear = rentalYears.find((record) => record.status === "current");
  const requestedYear = rentalYears.find((record) => record.id === searchParams.get("year"));
  const selectedYear = requestedYear?.status === "restored" ? requestedYear : currentYear;
  const editingHistory = selectedYear?.status === "restored";
  const restoredYearInProgress = rentalYears.find((record) => record.status === "restored");
  const historicalSnapshot = editingHistory && selectedYear?.propertySnapshot && typeof selectedYear.propertySnapshot === "object"
    ? selectedYear.propertySnapshot as PortfolioRecord
    : undefined;
  const displayedProperty: PortfolioRecord = historicalSnapshot
    ? { ...property, ...historicalSnapshot, id: property.id, organizationId: property.organizationId, kind: "property", archived: property.archived }
    : property;
  const currentRelated = selectedYear
    ? related.filter(
        (record) =>
          (!editingHistory && record.kind === "compliance" && !record.rentalYearId) ||
          record.kind === "rentalYear" ||
          record.rentalYearId === selectedYear.id,
      )
    : related;
  const currentRecords = selectedYear
    ? records.filter(
        (record) =>
          (!editingHistory && !record.rentalYearId) || record.rentalYearId === selectedYear.id,
      )
    : records;
  const tenants = currentRelated.filter((record) => record.kind === "tenant");
  const tenantIds = new Set(tenants.map((tenant) => tenant.id));
  const guarantors = currentRecords.filter(
    (record) =>
      record.kind === "guarantor" &&
      tenantIds.has(String(record.tenantId ?? "")),
  );
  const tenantOptions = tenants.map((tenant) => ({
    label: `${tenant.firstName} ${tenant.lastName}`,
    value: tenant.id,
  }));
  const compliance = currentRelated.filter(
    (record) => record.kind === "compliance",
  );
  const expenses = currentRelated.filter((record) => record.kind === "expense");
  const documents = currentRelated.filter(
    (record) => record.kind === "document",
  );
  const tenancies = currentRelated.filter(
    (record) => record.kind === "tenancy",
  );
  const payments = currentRelated.filter((record) => record.kind === "rentPayment");
  const tabItems: [Tab, string, typeof Home][] = [
    ["overview", "Overview", Home],
    ["tenancy", "Tenancy", CalendarRange],
    ["tenants", "Tenants", Users],
    ["guarantors", "Guarantors", UserRound],
    ["compliance", "Compliance", ShieldCheck],
    ["finance", "Finance", ReceiptText],
    ["documents", "Documents", FileText],
  ];

  const fieldsFor = (kind: RecordKind): Field[] => {
    if (kind === "tenant") return tenantFields;
    if (kind === "guarantor")
      return [
        {
          name: "tenantId",
          label: "Linked tenant",
          type: "select",
          required: true,
          placeholder: "Select a tenant…",
          options: tenantOptions,
        },
        { name: "name", required: true },
        { name: "email", type: "email" },
        { name: "phone" },
        { name: "address", wide: true },
        { name: "relationship" },
        {
          name: "status",
          type: "select",
          required: true,
          options: ["pending", "approved", "declined"].map((value) => ({
            label: title(value),
            value,
          })),
        },
        { name: "notes", type: "textarea", wide: true },
      ];
    if (kind === "reference")
      return [
        {
          name: "tenantId",
          type: "select",
          required: true,
          options: tenantOptions,
        },
        { name: "refereeName", required: true },
        { name: "organisation" },
        { name: "email", type: "email" },
        { name: "phone" },
        {
          name: "type",
          type: "select",
          required: true,
          options: [
            "landlord",
            "employer",
            "academic",
            "personal",
            "other",
          ].map((value) => ({ label: title(value), value })),
        },
        {
          name: "status",
          type: "select",
          required: true,
          options: ["requested", "received", "approved", "declined"].map(
            (value) => ({ label: title(value), value }),
          ),
        },
        { name: "notes", type: "textarea", wide: true },
      ];
    if (kind === "compliance") return complianceFields;
    return expenseFields;
  };

  const defaultsFor = (state: FormState) => {
    if (state.record) return state.defaults ?? {};
    const restoredYear = editingHistory && selectedYear ? { rentalYearId: selectedYear.id } : {};
    if (state.kind === "compliance")
      return { propertyId: id, ...restoredYear, reminderEnabled: true, reminderOffsetsDays: [30, 7, 1] };
    if (state.kind === "tenant")
      return { propertyId: id, ...restoredYear, rentFrequency: "monthly", depositStatus: "not_received", ...state.defaults };
    return { propertyId: id, ...restoredYear, ...state.defaults };
  };

  const changeYear = (yearId: string) => {
    const year = rentalYears.find((candidate) => candidate.id === yearId);
    if (!year || year.status === "current") navigate(`/app/properties/${id}`);
    else if (year.status === "restored") navigate(`/app/properties/${id}?year=${year.id}`);
    else navigate(`/app/history/${id}/${year.id}`);
  };

  const saveRestoredYear = async () => {
    if (!selectedYear || !window.confirm(`Save the edits to ${String(selectedYear.label)} and return this rental year to read-only History?`)) return;
    setSavingHistory(true);
    setLifecycleError("");
    try {
      await api.saveRentalYearToHistory(id!, selectedYear);
      await refresh();
      navigate(`/app/history/${id}/${selectedYear.id}`);
    } catch (reason) {
      setLifecycleError(reason instanceof Error ? reason.message : "Unable to save this rental year to History.");
    } finally {
      setSavingHistory(false);
    }
  };

  return (
    <div className="page detail-page">
      <Link className="back" to="/app/properties">
        <ArrowLeft />
        All properties
      </Link>
      <header className="detail-header">
        <div>
          <div className="detail-statuses">
            <span className={`status ${displayedProperty.status}`}>
              {String(displayedProperty.status)}
            </span>
            {selectedYear && (
              <span className={`status ${editingHistory ? "restored" : "current"}`}>
                <CalendarClock />
                {String(selectedYear.label)}{editingHistory ? " · editing" : ""}
              </span>
            )}
          </div>
          <h1>{String(displayedProperty.name)}</h1>
          <p>
            <MapPin />
            {String(displayedProperty.addressLine1)}, {String(displayedProperty.city)},{" "}
            {String(displayedProperty.postcode)}
          </p>
        </div>
        <div className="header-actions">
          {rentalYears.length > 0 && <label className="rental-year-switcher"><span>Rental year</span><select aria-label="Rental year" value={selectedYear?.id || ""} onChange={(event) => changeYear(event.target.value)}>{rentalYears.map((year) => <option key={year.id} value={year.id}>{String(year.label)}{year.status === "current" ? " (current)" : year.status === "restored" ? " (editing)" : " (history)"}</option>)}</select></label>}
          <button
            className="button secondary"
            onClick={() => setForm({ kind: "property", record: displayedProperty })}
          >
            Edit property
          </button>
          <button
            className="button primary"
            disabled={Boolean(restoredYearInProgress)}
            onClick={() => setStartingYear(true)}
            title={restoredYearInProgress ? "Save the restored year back to History before starting another rental year." : undefined}
          >
            <CalendarPlus />
            Start rental year
          </button>
          {editingHistory && <button className="button primary" disabled={savingHistory} onClick={() => void saveRestoredYear()}><CalendarRange />{savingHistory ? "Saving…" : "Save edits to History"}</button>}
        </div>
      </header>
      {editingHistory && <Notice type="warning">You restored {String(selectedYear?.label)} for correction. Its records are editable until you select <strong>Save edits to History</strong>. The current rental year remains available in the year selector.</Notice>}
      {restoredYearInProgress && !editingHistory && <Notice type="warning">{String(restoredYearInProgress.label)} is restored for correction. Select it from the rental-year list and save its edits to History before starting another rental year.</Notice>}
      {lifecycleError && <Notice type="error">{lifecycleError}</Notice>}
      <nav className="tabs">
        {tabItems.map(([key, label, Icon]) => (
          <button
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
            key={key}
          >
            <Icon />
            {label}
            <span>
              {key === "tenants"
                ? tenants.length
                : key === "guarantors"
                  ? guarantors.length
                : key === "compliance"
                  ? compliance.length
                  : key === "documents"
                    ? documents.length
                    : ""}
            </span>
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <section className="detail-grid">
          <article className="panel">
            <header>
              <div>
                <span className="eyebrow">Property profile</span>
                <h2>Key details</h2>
              </div>
              <Home />
            </header>
            <dl className="detail-list">
              <div>
                <dt>Property type</dt>
                <dd>{title(String(displayedProperty.propertyType))}</dd>
              </div>
              <div>
                <dt>Bedrooms</dt>
                <dd>
                  <BedDouble />
                  {String(displayedProperty.bedrooms)}
                </dd>
              </div>
              <div>
                <dt>Bathrooms</dt>
                <dd>
                  <Bath />
                  {String(displayedProperty.bathrooms)}
                </dd>
              </div>
              <div>
                <dt>Purchase price</dt>
                <dd>{money(displayedProperty.purchasePricePence)}</dd>
              </div>
              <div>
                <dt>Monthly rent</dt>
                <dd>
                  {displayedProperty.monthlyRentPence
                    ? money(displayedProperty.monthlyRentPence)
                    : displayedProperty.annualRentPence
                      ? money(Math.round(Number(displayedProperty.annualRentPence) / 12))
                      : "Not set"}
                </dd>
              </div>
              <div>
                <dt>Yearly / tenancy rent</dt>
                <dd>
                  {displayedProperty.annualRentPence
                    ? money(displayedProperty.annualRentPence)
                    : "Not set"}
                </dd>
              </div>
              <div>
                <dt>Tenancy dates</dt>
                <dd>{displayedProperty.tenancyStartDate ? `${date(displayedProperty.tenancyStartDate)} — ${date(displayedProperty.tenancyEndDate)}` : "Not set"}</dd>
              </div>
              <div>
                <dt>Monthly rent collection date</dt>
                <dd>{displayedProperty.rentCollectionDay ? `Day ${String(displayedProperty.rentCollectionDay)} of every month` : "Not set"}</dd>
              </div>
              <div>
                <dt>Acquired</dt>
                <dd>{date(displayedProperty.acquisitionDate)}</dd>
              </div>
            </dl>
          </article>
          <article className="panel">
            <header>
              <div>
                <span className="eyebrow">Notes</span>
                <h2>Property notes</h2>
              </div>
            </header>
            <p className="notes">
              {String(
                displayedProperty.notes || "No notes have been added for this property.",
              )}
            </p>
          </article>
        </section>
      )}

      {tab === "tenancy" && (
        <TenancyOverview
          property={displayedProperty}
          currentYear={selectedYear}
          tenants={tenants}
          tenancies={tenancies}
          payments={payments}
          onEditPayment={setEditingRent}
          onDeletePayment={(payment) => setArchived(payment, true)}
        />
      )}

      {tab === "tenants" && (
        <TenantWorkspace
          propertyId={id!}
          tenants={tenants}
          records={currentRecords}
          tenancies={tenancies}
          payments={payments}
          onForm={setForm}
          onRecordRent={() => setRecordingRent(true)}
        />
      )}

      {tab === "guarantors" && (
        <GuarantorWorkspace
          propertyId={id!}
          guarantors={guarantors}
          tenants={tenants}
          onForm={setForm}
        />
      )}

      {tab === "compliance" && (
        <RecordSection
          title="Compliance records"
          description="Certificates, cover, renewal dates and email reminders."
          records={compliance}
          empty="No compliance records yet."
          onAdd={() => setForm({ kind: "compliance" })}
          secondaryAction={() => setUpload("compliance")}
          secondaryLabel="Upload compliance"
          onEdit={(record) => setForm({ kind: "compliance", record })}
          render={(record) => (
            <>
              <span className={`record-icon ${record.status}`}>
                <CalendarClock />
              </span>
              <div>
                <strong>{String(record.title)}</strong>
                <small>
                  {title(String(record.category))} · Expires{" "}
                  {date(record.expiryDate)}
                  {record.reminderEnabled !== false
                    ? ` · Email ${(Array.isArray(record.reminderOffsetsDays) ? record.reminderOffsetsDays : [30, 7, 1]).join(", ")} days before and on the due date`
                    : ""}
                </small>
              </div>
              {record.reminderEnabled !== false && <BellRing size={18} />}
              <span className={`status ${record.status}`}>
                {title(String(record.status))}
              </span>
            </>
          )}
        />
      )}
      {tab === "finance" && (
        <RecordSection
          title="Property expenses"
          description="Costs used in portfolio profitability."
          records={expenses}
          empty="No expenses recorded yet."
          onAdd={() => setForm({ kind: "expense" })}
          onEdit={(record) => setForm({ kind: "expense", record })}
          render={(record) => (
            <>
              <span className="record-icon">
                <ReceiptText />
              </span>
              <div>
                <strong>{String(record.description)}</strong>
                <small>
                  {title(String(record.category))} · {date(record.expenseDate)}
                </small>
              </div>
              <b>{money(record.amountPence)}</b>
            </>
          )}
        />
      )}
      {tab === "documents" && (
        <RecordSection
          title="Private documents"
          description="Files are stored privately in Azure Blob Storage."
          records={documents}
          empty="No documents uploaded for this property."
          onAdd={() => setUpload("other")}
          addLabel="Upload document"
          render={(record) => (
            <>
              <span className="record-icon">
                <FileText />
              </span>
              <div>
                <strong>{String(record.fileName)}</strong>
                <small>
                  {title(String(record.category))} ·{" "}
                  {(Number(record.size) / 1024 / 1024).toFixed(1)} MB
                </small>
              </div>
            </>
          )}
          download
        />
      )}

      {form?.kind === "property" && (
        <PropertyForm
          record={form.record}
          rentalYear={editingHistory ? selectedYear : undefined}
          onClose={() => setForm(undefined)}
          onDone={refresh}
        />
      )}
      {form && form.kind !== "property" && (
        <RecordForm
          kind={form.kind}
          record={form.record}
          fields={fieldsFor(form.kind)}
          defaults={defaultsFor(form)}
          onClose={() => setForm(undefined)}
        />
      )}
      {upload && (
        <DocumentUpload
          propertyId={id}
          rentalYearId={editingHistory ? selectedYear?.id : undefined}
          defaultCategory={upload}
          onClose={() => setUpload(undefined)}
          onDone={refresh}
        />
      )}
      {(recordingRent || editingRent) && (
        <RentPaymentForm
          propertyId={id!}
          tenants={tenants}
          payments={payments}
          rentalYearId={selectedYear?.id}
          record={editingRent}
          onClose={() => { setRecordingRent(false); setEditingRent(undefined); }}
        />
      )}
      {startingYear && (
        <StartRentalYearModal
          propertyId={id!}
          currentYear={currentYear}
          annualRentPence={Number(property.annualRentPence || 0)}
          onClose={() => setStartingYear(false)}
          onDone={refresh}
        />
      )}
    </div>
  );
}

function StartRentalYearModal({
  propertyId,
  currentYear,
  annualRentPence,
  onClose,
  onDone,
}: {
  propertyId: string;
  currentYear?: PortfolioRecord;
  annualRentPence: number;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const now = new Date();
  const defaultStart = `${now.getUTCFullYear()}-09-01`;
  const defaultEnd = `${now.getUTCFullYear() + 1}-08-31`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const result = await api.startRentalYear(propertyId, {
        label: String(data.get("label")),
        startDate: String(data.get("startDate")),
        endDate: String(data.get("endDate")),
        annualRentPence: Math.round(Number(data.get("annualRent") || 0) * 100),
      });
      await onDone();
      if (result.backupEmail === "failed")
        window.alert("The rental year was started, but the owner backup email could not be delivered. Ask a super administrator to check the email configuration before the next rollover.");
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to start the rental year.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Start a new rental year" onClose={onClose}>
      <form className="record-form" onSubmit={submit}>
        <Notice>
          {currentYear
            ? `${String(currentYear.label)} will close and its tenancy records and documents will appear in History.`
            : "Existing tenancy records and documents will be placed in a previous-history year."}{" "}
          Compliance records stay current.
        </Notice>
        {error && <Notice type="error">{error}</Notice>}
        <div className="form-grid">
          <label>
            <span>
              Rental year label <b>*</b>
            </span>
            <input
              name="label"
              required
              maxLength={80}
              defaultValue={`${now.getUTCFullYear()}/${String(now.getUTCFullYear() + 1).slice(-2)}`}
            />
          </label>
          <label>
            <span>
              Start date <b>*</b>
            </span>
            <input
              name="startDate"
              type="date"
              required
              defaultValue={defaultStart}
            />
          </label>
          <label>
            <span>
              End date <b>*</b>
            </span>
            <input
              name="endDate"
              type="date"
              required
              defaultValue={defaultEnd}
            />
          </label>
          <label>
            <span>
              Total property rent for this year <b>*</b>
            </span>
            <input
              name="annualRent"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={
                annualRentPence ? (annualRentPence / 100).toFixed(2) : ""
              }
            />
          </label>
          <label className="wide rollover-confirm">
            <input name="confirm" type="checkbox" required />
            <span>
              I confirm the outgoing year's records should become read-only
              history.
            </span>
          </label>
        </div>
        <footer>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Starting…" : "Start rental year"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function paymentMonth(record: PortfolioRecord) {
  return String(record.appliesToMonth || record.paidDate || record.dueDate || "").slice(0, 7);
}

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function TenancyOverview({
  property,
  currentYear,
  tenants,
  tenancies,
  payments,
  onEditPayment,
  onDeletePayment,
}: {
  property: PortfolioRecord;
  currentYear?: PortfolioRecord;
  tenants: PortfolioRecord[];
  tenancies: PortfolioRecord[];
  payments: PortfolioRecord[];
  onEditPayment: (payment: PortfolioRecord) => void;
  onDeletePayment: (payment: PortfolioRecord) => Promise<void>;
}) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const availableMonths = useMemo(
    () => [...new Set([
      currentMonth,
      ...payments.map(paymentMonth).filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)),
    ])].sort((a, b) => b.localeCompare(a)),
    [currentMonth, payments],
  );
  const [requestedMonth, setRequestedMonth] = useState(currentMonth);
  const [deletingPaymentId, setDeletingPaymentId] = useState("");
  const [error, setError] = useState("");
  const selectedMonth = availableMonths.includes(requestedMonth) ? requestedMonth : currentMonth;
  const selectedMonthLabel = monthLabel(selectedMonth);
  const selectedPayments = payments.filter((payment) => paymentMonth(payment) === selectedMonth);
  const totalReceived = payments.reduce((sum, item) => sum + Number(item.amountPaidPence || 0), 0);
  const expectedRangeStart = String(currentYear?.startDate || property.tenancyStartDate || "").slice(0, 7);
  const expectedRangeEnd = String(currentYear?.endDate || property.tenancyEndDate || "").slice(0, 7);
  const financeRecords = [property, ...(currentYear ? [currentYear] : []), ...tenants, ...tenancies, ...payments];
  const selectedSummary = calculateRentMonth(financeRecords, property.id, selectedMonth);
  const received = selectedSummary.receivedPence;
  const todayMonth = new Date().toISOString().slice(0, 7);
  const dueThroughMonth = expectedRangeEnd && expectedRangeEnd < todayMonth ? expectedRangeEnd : todayMonth;
  const dueToDate = calculateRentLedger(financeRecords, dueThroughMonth);
  const fullYear = calculateRentLedger(financeRecords, expectedRangeEnd || dueThroughMonth);
  const selectedInsideRange =
    (!expectedRangeStart || selectedMonth >= expectedRangeStart) &&
    (!expectedRangeEnd || selectedMonth <= expectedRangeEnd);
  const propertyMonthlyFallback = Number(property.monthlyRentPence || 0);
  const fallbackMonths = /^\d{4}-\d{2}$/.test(expectedRangeStart) && /^\d{4}-\d{2}$/.test(dueThroughMonth) && dueThroughMonth >= expectedRangeStart
    ? (Number(dueThroughMonth.slice(0, 4)) - Number(expectedRangeStart.slice(0, 4))) * 12 + Number(dueThroughMonth.slice(5, 7)) - Number(expectedRangeStart.slice(5, 7)) + 1
    : 0;
  const totalDue = tenants.length ? dueToDate.expectedPence : propertyMonthlyFallback * fallbackMonths;
  const expectedForSelectedMonth = tenants.length
    ? selectedSummary.expectedPence
    : selectedInsideRange
      ? propertyMonthlyFallback
      : 0;
  const expectedYear = Number(
    currentYear?.annualRentPence ||
    property.annualRentPence ||
    (tenants.length ? fullYear.expectedPence : propertyMonthlyFallback * 12),
  );
  const selectedTenantRows = new Map(
    selectedSummary.tenants.map((tenant) => [tenant.tenantId, tenant]),
  );
  const visibleTenants = tenants.filter((tenant) => {
    const row = selectedTenantRows.get(tenant.id);
    return Boolean(row?.expectedPence || row?.hasPayments);
  });
  const deletePayment = async (payment: PortfolioRecord, tenantName: string) => {
    const linkedCount = payment.advancePaymentId
      ? payments.filter((candidate) => candidate.advancePaymentId === payment.advancePaymentId).length
      : 1;
    const confirmed = window.confirm(payment.advancePaymentId
      ? `Delete the linked advance payment for ${tenantName}? All ${linkedCount} monthly allocations will move to Archive together and can be restored later.`
      : `Delete this ${monthLabel(paymentMonth(payment))} rent entry for ${tenantName}? It will move to Archive and can be restored later.`);
    if (!confirmed) return;
    setDeletingPaymentId(payment.id);
    setError("");
    try {
      await onDeletePayment(payment);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete this rent entry.");
    } finally {
      setDeletingPaymentId("");
    }
  };
  return (
    <section className="panel records-panel tenancy-overview">
      <header>
        <div><span className="eyebrow">{selectedMonth === currentMonth ? "Current month" : "Recorded month"}</span><h2>Tenancy rent status</h2><p>{selectedMonthLabel} · status is based on rent entries attributed to this month.</p></div>
        <div className="tenancy-month-controls">
          <label><span>Rent status month</span><select aria-label="Rent status month" value={selectedMonth} onChange={(event) => setRequestedMonth(event.target.value)}>{availableMonths.map((month) => <option key={month} value={month}>{monthLabel(month)}{month === currentMonth ? " (current)" : ""}</option>)}</select></label>
          <CirclePoundSterling />
        </div>
      </header>
      {error && <Notice type="error">{error}</Notice>}
      <div className="tenancy-totals">
        <article><small>Total rent due so far</small><strong>{money(totalDue)}</strong></article>
        <article><small>Total rent received so far</small><strong>{money(totalReceived)} <span>/ {money(expectedYear)}</span></strong><p>Received / expected for the rental year</p><progress aria-label="Rental-year rent received" max={Math.max(expectedYear, 1)} value={Math.min(totalReceived, Math.max(expectedYear, 1))} /></article>
        <article><small>Rent received in {selectedMonthLabel}</small><strong>{money(received)} <span>/ {money(expectedForSelectedMonth)}</span></strong><p>Received / expected for {selectedMonthLabel}</p><progress aria-label={`Rent received in ${selectedMonthLabel}`} max={Math.max(expectedForSelectedMonth, 1)} value={Math.min(received, Math.max(expectedForSelectedMonth, 1))} /></article>
      </div>
      {visibleTenants.length ? <div className="record-list">{visibleTenants.map((tenant) => {
        const tenantPayments = selectedPayments
          .filter((item) => item.tenantId === tenant.id)
          .sort((a, b) => String(b.paidDate).localeCompare(String(a.paidDate)));
        const payment = tenantPayments[0];
        const tenantReceived = tenantPayments.reduce((sum, item) => sum + Number(item.amountPaidPence || 0), 0);
        const status = String(payment?.status || "due");
        const tenantName = `${String(tenant.firstName)} ${String(tenant.lastName)}`;
        return <article className="tenant-rent-record" key={tenant.id}>
          <span className="person-avatar">{initials(tenantName)}</span>
          <div className="tenant-rent-content">
            <div className="tenant-rent-heading"><div><strong>{tenantName}</strong><small>{money(tenant.monthlyRentPence)} monthly · {payment ? `${money(tenantReceived)} received in ${selectedMonthLabel}` : `No rent recorded for ${selectedMonthLabel}`}</small></div><span className={`status ${status}`}>{title(status)}</span></div>
            {Boolean(tenant.notes) && <div className="tenant-specific-note"><strong>Tenant notes</strong><span>{String(tenant.notes)}</span></div>}
            {tenantPayments.length > 0 && <div className="rent-entry-list">{tenantPayments.map((entry) => <article className="rent-entry" key={entry.id}>
              <div className="rent-entry-main">
                <div><strong>{money(entry.amountPaidPence)}</strong><span className={`status ${String(entry.status)}`}>{title(String(entry.status))}</span></div>
                <small>Recorded {date(entry.paidDate)} · {title(String(entry.method || "bank_transfer"))}{entry.bankReference ? ` · Ref ${String(entry.bankReference)}` : ""}</small>
                {Boolean(entry.advancePaymentId) && <small>Linked advance allocation · {monthLabel(String(entry.advanceCoveredFrom || paymentMonth(entry)))} to {monthLabel(String(entry.advanceCoveredTo || paymentMonth(entry)))}</small>}
                {Boolean(entry.notes) && <div className="payment-notes"><strong>Rent note</strong><span>{String(entry.notes)}</span></div>}
              </div>
              <div className="rent-entry-actions">
                <button type="button" className="button secondary compact" onClick={() => onEditPayment(entry)}><Pencil />Edit</button>
                <button type="button" className="button danger compact" disabled={deletingPaymentId === entry.id} onClick={() => void deletePayment(entry, tenantName)}><Trash2 />{deletingPaymentId === entry.id ? "Deleting…" : "Delete"}</button>
              </div>
            </article>)}</div>}
          </div>
        </article>;
      })}</div> : <Empty icon={Users} title="No rent expected" description={`No tenant rent is expected for ${selectedMonthLabel}.`} />}
    </section>
  );
}

function TenantWorkspace({
  propertyId,
  tenants,
  records,
  tenancies,
  payments,
  onForm,
  onRecordRent,
}: {
  propertyId: string;
  tenants: PortfolioRecord[];
  records: PortfolioRecord[];
  tenancies: PortfolioRecord[];
  payments: PortfolioRecord[];
  onForm: (state: FormState) => void;
  onRecordRent: () => void;
}) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  return (
    <section className="panel records-panel">
      <header>
        <div>
          <span className="eyebrow">Property workspace</span>
          <h2>Student tenants</h2>
          <p>
            Tenants, references and agreements belonging to this property.
          </p>
        </div>
        <div className="split-actions tenant-actions">
          <button className="button secondary" disabled={!tenants.length} onClick={() => onForm({ kind: "reference" })}><BadgeCheck />Reference</button>
          <button className="button secondary" disabled={!tenants.length} onClick={onRecordRent}><CirclePoundSterling />Record rent</button>
          <button className="button primary" onClick={() => onForm({ kind: "tenant", defaults: { propertyId } })}><Plus />Add tenant</button>
        </div>
      </header>
      {tenants.length ? (
        <div className="people-grid">
          {tenants.map((tenant) => {
            const guarantors = records.filter(
              (record) =>
                record.kind === "guarantor" && record.tenantId === tenant.id,
            );
            const references = records.filter(
              (record) =>
                record.kind === "reference" && record.tenantId === tenant.id,
            );
            const agreements = tenancies.filter(
              (record) =>
                Array.isArray(record.tenantIds) &&
                record.tenantIds.includes(tenant.id),
            );
            const agreement =
              agreements.find((record) => record.status === "active") ??
              [...agreements].sort((a, b) =>
                String(b.startDate).localeCompare(String(a.startDate)),
              )[0];
            const monthlyPayment = payments
              .filter((payment) => payment.tenantId === tenant.id && paymentMonth(payment) === currentMonth)
              .sort((a, b) => String(b.paidDate).localeCompare(String(a.paidDate)))[0];
            const rentStatus = String(monthlyPayment?.status || "due");
            return (
              <article className="person-card" key={tenant.id}>
                <header>
                  <span className="person-avatar">
                    {initials(`${tenant.firstName} ${tenant.lastName}`)}
                  </span>
                  <RecordMenu
                    record={tenant}
                    onEdit={() => onForm({ kind: "tenant", record: tenant })}
                  />
                </header>
                <h2>
                  {String(tenant.firstName)} {String(tenant.lastName)}
                </h2>
                <p>
                  {String(tenant.email || "No email")} ·{" "}
                  {String(tenant.phone || "No phone")}
                </p>
                {Boolean(tenant.university || tenant.course) && <div className="student-meta">
                  {Boolean(tenant.university) && <span><UserRound />{String(tenant.university)}</span>}
                  {Boolean(tenant.course) && <span>{String(tenant.course)}</span>}
                </div>}
                <div className="tenant-tenancy">
                  <div>
                    <small>Tenant rent</small>
                    <strong>
                      {Number(tenant.monthlyRentPence || agreement?.rentPence || 0) > 0
                        ? `${money(tenant.monthlyRentPence || agreement?.rentPence)} monthly`
                        : "Not set"}
                    </strong>
                  </div>
                  <div>
                    <small>Tenancy dates</small>
                    <strong>
                      {agreement
                        ? `${date(agreement.startDate)} — ${agreement.endDate ? date(agreement.endDate) : "Ongoing"}`
                        : "No tenancy added"}
                    </strong>
                  </div>
                  <div>
                    <small>Rent status</small>
                    <strong><span className={`status ${rentStatus}`}>{title(rentStatus)}</span></strong>
                  </div>
                  <div>
                    <small>Room</small>
                    <strong>{String(tenant.room || agreement?.room || "Not set")}</strong>
                  </div>
                </div>
                {Boolean(tenant.notes) && <p className="tenant-notes"><strong>Notes</strong>{String(tenant.notes)}</p>}
                <footer>
                  <span className={guarantors.length ? "complete" : ""}>
                    <ShieldCheck />
                    {guarantors.length} guarantor
                  </span>
                  <span className={references.length ? "complete" : ""}>
                    <BadgeCheck />
                    {references.length} reference
                  </span>
                  <span className={agreements.length ? "complete" : ""}>
                    <Users />
                    {agreements.length} agreement
                  </span>
                </footer>
                {references.length > 0 && (
                  <div className="record-list compact-records">
                    {references.map((record) => (
                      <article key={record.id}>
                        <span className="record-icon">
                          <BadgeCheck />
                        </span>
                        <div>
                          <strong>{String(record.refereeName)}</strong>
                          <small>
                            {title(record.kind)} ·{" "}
                            {title(String(record.status))}
                          </small>
                        </div>
                        <RecordMenu
                          record={record}
                          onEdit={() => onForm({ kind: record.kind, record })}
                        />
                      </article>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          icon={Users}
          title="No tenants linked to this property"
          description="Add the property's first tenant, then attach references and tenancy details."
          action={
            <button
              className="button primary"
              onClick={() =>
                onForm({ kind: "tenant", defaults: { propertyId } })
              }
            >
              <Plus />
              Add tenant
            </button>
          }
        />
      )}
      {tenancies.length > 0 && (
        <div className="record-list tenancy-list">
          {tenancies.map((record) => (
            <article key={record.id}>
              <span className="record-icon">
                <Users />
              </span>
              <div>
                <strong>{String(record.room || "Whole property")}</strong>
                <small>
                  {date(record.startDate)} — {date(record.endDate)} ·{" "}
                  {Number(record.rentPence) > 0
                    ? `${money(record.rentPence)} ${String(record.rentFrequency)}`
                    : "Rent not set"}
                </small>
              </div>
              <span className={`status ${record.status}`}>
                {title(String(record.status))}
              </span>
              <span className="status current">Legacy agreement</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function GuarantorWorkspace({
  propertyId,
  guarantors,
  tenants,
  onForm,
}: {
  propertyId: string;
  guarantors: PortfolioRecord[];
  tenants: PortfolioRecord[];
  onForm: (state: FormState) => void;
}) {
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const addGuarantor = () =>
    onForm({
      kind: "guarantor",
      defaults: {
        propertyId,
        tenantId: tenants.length === 1 ? tenants[0].id : "",
        status: "pending",
      },
    });

  return (
    <section className="panel records-panel">
      <header>
        <div>
          <span className="eyebrow">Property workspace</span>
          <h2>Guarantors</h2>
          <p>
            Store guarantor contact and approval details and link each record
            to a tenant at this property.
          </p>
        </div>
        <button
          className="button primary"
          onClick={addGuarantor}
          disabled={!tenants.length}
          title={!tenants.length ? "Add a tenant before adding a guarantor" : undefined}
        >
          <Plus />
          Add guarantor
        </button>
      </header>
      {!tenants.length ? (
        <Empty
          icon={Users}
          title="Add a tenant first"
          description="A guarantor must be linked to a tenant at this property. Add the tenant in the Tenants tab, then return here."
        />
      ) : guarantors.length ? (
        <div className="people-grid guarantor-grid">
          {guarantors.map((guarantor) => {
            const tenant = tenantById.get(String(guarantor.tenantId));
            const tenantName = tenant
              ? `${String(tenant.firstName)} ${String(tenant.lastName)}`
              : "Linked tenant unavailable";
            return (
              <article className="person-card guarantor-profile" key={guarantor.id}>
                <header>
                  <span className="person-avatar">
                    {initials(String(guarantor.name))}
                  </span>
                  <RecordMenu
                    record={guarantor}
                    onEdit={() =>
                      onForm({ kind: "guarantor", record: guarantor })
                    }
                  />
                </header>
                <h2>{String(guarantor.name)}</h2>
                <p>
                  {String(guarantor.email || "No email")} ·{" "}
                  {String(guarantor.phone || "No phone")}
                </p>
                <div className="guarantor-link">
                  <UserRound />
                  <div>
                    <small>Linked tenant</small>
                    <strong>{tenantName}</strong>
                  </div>
                </div>
                <dl className="guarantor-profile-details">
                  <div>
                    <dt>Relationship</dt>
                    <dd>{String(guarantor.relationship || "Not set")}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <span className={`status ${String(guarantor.status)}`}>
                        {title(String(guarantor.status))}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd>{String(guarantor.address || "Not set")}</dd>
                  </div>
                </dl>
                {Boolean(guarantor.notes) && (
                  <p className="guarantor-notes">{String(guarantor.notes)}</p>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          icon={UserRound}
          title="No guarantors added"
          description="Add a guarantor and choose the tenant they guarantee."
          action={
            <button className="button primary" onClick={addGuarantor}>
              <Plus />
              Add guarantor
            </button>
          }
        />
      )}
    </section>
  );
}

function RecordSection({
  title: heading,
  description,
  records,
  empty,
  onAdd,
  onEdit,
  render,
  addLabel = "Add record",
  download = false,
  secondaryAction,
  secondaryLabel,
}: {
  title: string;
  description: string;
  records: PortfolioRecord[];
  empty: string;
  onAdd?: () => void;
  onEdit?: (record: PortfolioRecord) => void;
  render: (record: PortfolioRecord) => React.ReactNode;
  addLabel?: string;
  download?: boolean;
  secondaryAction?: () => void;
  secondaryLabel?: string;
}) {
  return (
    <section className="panel records-panel">
      <header>
        <div>
          <span className="eyebrow">Property workspace</span>
          <h2>{heading}</h2>
          <p>{description}</p>
        </div>
        {(onAdd || secondaryAction) && <div className="split-actions">
          {secondaryAction && <button className="button secondary" onClick={secondaryAction}><FileText />{secondaryLabel}</button>}
          {onAdd && (
            <button className="button primary" onClick={onAdd}>
              <Plus />
              {addLabel}
            </button>
          )}
        </div>}
      </header>
      {records.length ? (
        <div className="record-list">
          {records.map((record) => (
            <article key={record.id}>
              {render(record)}
              <RecordMenu
                record={record}
                onEdit={onEdit ? () => onEdit(record) : undefined}
                download={download}
              />
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={empty}
          description="Use the action above when you are ready."
        />
      )}
    </section>
  );
}
