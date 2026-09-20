import { ArrowLeft, CalendarRange, FileText, ReceiptText, RotateCcw, ShieldCheck, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RecordMenu } from "../components/RecordMenu";
import { Empty, Notice, PageHeader } from "../components/UI";
import { usePortfolio } from "../context/PortfolioContext";
import { date, money, title } from "../lib/format";
import { api } from "../lib/api";
import type { PortfolioRecord } from "../types";

const hiddenFields = new Set(["organizationId", "_etag", "kind", "propertySnapshot", "blobName"]);
type HistoryTab = "overview" | "tenancy" | "tenants" | "guarantors" | "compliance" | "finance" | "documents";

function recordName(record: PortfolioRecord) {
  const person = `${String(record.firstName || "")} ${String(record.lastName || "")}`.trim();
  return String(record.name || record.title || record.description || record.fileName || record.refereeName || person || title(record.kind));
}

function fieldLabel(key: string) {
  return title(key.replace(/Pence$/, "").replace(/([a-z])([A-Z])/g, "$1_$2"));
}

function fieldValue(key: string, value: unknown) {
  if (key.endsWith("Pence")) return money(value);
  if (Array.isArray(value)) return value.join(", ") || "None";
  if (value && typeof value === "object") return JSON.stringify(value);
  if (value === "" || value === undefined || value === null) return "Not recorded";
  return String(value);
}

export function HistoryDetailPage() {
  const [tab, setTab] = useState<HistoryTab>("overview");
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");
  const { propertyId, yearId } = useParams();
  const navigate = useNavigate();
  const { records, refresh } = usePortfolio();
  const property = records.find((record) => record.kind === "property" && record.id === propertyId);
  const year = records.find((record) => record.kind === "rentalYear" && record.id === yearId && record.propertyId === propertyId && record.status === "closed");
  const related = records.filter((record) => record.rentalYearId === yearId);
  if (!property || !year) return <div className="page"><Empty title="Historical rental year not found" description="The property or closed rental year is unavailable." action={<Link className="button secondary" to="/app/history">Back to history</Link>} /></div>;
  const historicalProperty = year.propertySnapshot && typeof year.propertySnapshot === "object"
    ? year.propertySnapshot as PortfolioRecord
    : property;
  const payments = related.filter((record) => record.kind === "rentPayment");
  const expenses = related.filter((record) => record.kind === "expense");
  const documents = related.filter((record) => record.kind === "document");
  const tenants = related.filter((record) => record.kind === "tenant");
  const guarantors = related.filter((record) => record.kind === "guarantor");
  const compliance = related.filter((record) => record.kind === "compliance");
  const availableYears = records
    .filter((record) => record.kind === "rentalYear" && record.propertyId === propertyId)
    .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
  const changeYear = (selectedId: string) => {
    const selected = availableYears.find((candidate) => candidate.id === selectedId);
    if (!selected || selected.status === "current") navigate(`/app/properties/${propertyId}`);
    else if (selected.status === "restored") navigate(`/app/properties/${propertyId}?year=${selected.id}`);
    else navigate(`/app/history/${propertyId}/${selected.id}`);
  };
  const restoreYear = async () => {
    if (!window.confirm(`Restore ${String(year.label)} for editing? It will leave read-only History until you save the edits back.`)) return;
    setRestoring(true);
    setError("");
    try {
      await api.restoreRentalYear(propertyId!, year);
      await refresh();
      navigate(`/app/properties/${propertyId}?year=${year.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to restore this rental year.");
    } finally {
      setRestoring(false);
    }
  };
  const sections: Record<Exclude<HistoryTab, "documents">, { heading: string; icon: ReactNode; records: PortfolioRecord[] }[]> = {
    overview: [
      { heading: "Property snapshot", icon: <CalendarRange />, records: [historicalProperty] },
      { heading: "Rental year", icon: <CalendarRange />, records: [year] },
    ],
    tenancy: [
      { heading: "Tenancy agreements", icon: <CalendarRange />, records: related.filter((record) => record.kind === "tenancy") },
    ],
    tenants: [
      { heading: "Tenants", icon: <Users />, records: tenants },
      { heading: "References", icon: <Users />, records: related.filter((record) => record.kind === "reference") },
    ],
    guarantors: [{ heading: "Guarantors", icon: <Users />, records: guarantors }],
    compliance: [{ heading: "Compliance snapshot", icon: <ShieldCheck />, records: compliance }],
    finance: [
      { heading: "Rent payments", icon: <ReceiptText />, records: payments },
      { heading: "Expenses", icon: <ReceiptText />, records: expenses },
    ],
  };
  const tabItems: [HistoryTab, string, ReactNode, number | undefined][] = [
    ["overview", "Overview", <CalendarRange />, undefined],
    ["tenancy", "Tenancy", <CalendarRange />, related.filter((record) => record.kind === "tenancy").length],
    ["tenants", "Tenants", <Users />, tenants.length],
    ["guarantors", "Guarantors", <Users />, guarantors.length],
    ["compliance", "Compliance", <ShieldCheck />, compliance.length],
    ["finance", "Finance", <ReceiptText />, payments.length + expenses.length],
    ["documents", "Documents", <FileText />, documents.length],
  ];
  return <div className="page">
    <Link className="back" to="/app/history"><ArrowLeft />History</Link>
    <PageHeader eyebrow="Read-only rental year" title={`${String(historicalProperty.name)} · ${String(year.label)}`} description={`${date(year.startDate)} — ${date(year.endDate)}. Historical records cannot be edited or archived.`} actions={<><label className="rental-year-switcher"><span>Rental year</span><select aria-label="Rental year" value={year.id} onChange={(event) => changeYear(event.target.value)}>{availableYears.map((item) => <option key={item.id} value={item.id}>{String(item.label)}{item.status === "current" ? " (current)" : item.status === "restored" ? " (editing)" : " (history)"}</option>)}</select></label><button className="button primary" disabled={restoring} onClick={() => void restoreYear()}><RotateCcw />{restoring ? "Restoring…" : "Restore for editing"}</button></>} />
    {error && <Notice type="error">{error}</Notice>}
    <section className="finance-summary"><article><span className="net"><CalendarRange /></span><div><small>Expected rent</small><strong>{money(year.annualRentPence)}</strong></div></article><article><span className="up"><ReceiptText /></span><div><small>Rent received</small><strong>{money(payments.reduce((sum, record) => sum + Number(record.amountPaidPence || 0), 0))}</strong></div></article><article><span className="down"><ReceiptText /></span><div><small>Expenses</small><strong>{money(expenses.reduce((sum, record) => sum + Number(record.amountPence || 0), 0))}</strong></div></article></section>
    <nav className="tabs" aria-label="Historical property sections">
      {tabItems.map(([key, label, icon, count]) => <button className={tab === key ? "active" : ""} onClick={() => setTab(key)} key={key}>{icon}{label}{count !== undefined && <span>{count}</span>}</button>)}
    </nav>
    <section className="history-detail-grid">
      {tab === "documents"
        ? <HistoricalRecords heading="Documents" icon={<FileText />} records={documents} download />
        : sections[tab].map((section) => <HistoricalRecords key={section.heading} {...section} />)}
    </section>
  </div>;
}

function HistoricalRecords({ heading, icon, records, download = false }: { heading: string; icon: ReactNode; records: PortfolioRecord[]; download?: boolean }) {
  return <article className={`panel records-panel ${download ? "history-doc-panel" : ""}`}><header><div><span className="eyebrow">Historical snapshot</span><h2>{heading}</h2></div>{icon}</header>{records.length ? <div className="record-list history-record-list">{records.map((record, index) => <article key={record.id || `${heading}-${index}`}><div><strong>{recordName(record)}</strong><dl className="history-record-details">{Object.entries(record).filter(([key]) => !hiddenFields.has(key)).map(([key, value]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd>{fieldValue(key, value)}</dd></div>)}</dl></div>{download && <RecordMenu record={record} download readOnly />}</article>)}</div> : <Empty title={`No ${heading.toLowerCase()}`} description="Nothing was recorded for this rental year." />}</article>;
}
