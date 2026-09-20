import { ArrowDownRight, ArrowUpRight, Building2, ChevronRight, CirclePoundSterling, ReceiptText, ShieldCheck, WalletCards } from "lucide-react";
import { useState } from "react";
import { Empty, PageHeader } from "../components/UI";
import { usePortfolio } from "../context/PortfolioContext";
import { date, money, title } from "../lib/format";
import { calculateRentLedger } from "../lib/finance";
import type { PortfolioRecord } from "../types";

function transactionDate(record: PortfolioRecord) {
  return String(record.paidDate || record.expenseDate || record.issueDate || record.createdAt || "");
}
function transactionAmount(record: PortfolioRecord) {
  if (record.kind === "rentPayment") return Number(record.amountPaidPence || 0);
  if (record.kind === "expense") return -Number(record.amountPence || 0);
  if (record.kind === "tenant") return Number(record.depositPence || 0);
  return 0;
}
function transactionLabel(record: PortfolioRecord) {
  if (record.kind === "rentPayment") return `Rent · ${title(String(record.status))}`;
  if (record.kind === "expense") return String(record.description || title(String(record.category)));
  if (record.kind === "tenant") return `Deposit · ${String(record.firstName)} ${String(record.lastName)}`;
  return `Compliance · ${String(record.title || title(String(record.category)))}`;
}

export function FinancePage() {
  const { records } = usePortfolio();
  const years = records.filter((record) => record.kind === "rentalYear");
  const labels = [...new Set(years.map((year) => String(year.label)).filter(Boolean))].sort().reverse();
  const [selectedYear, setSelectedYear] = useState("current");
  const [selectedProperty, setSelectedProperty] = useState("");
  const selectedYears = selectedYear === "current"
    ? years.filter((year) => year.status === "current")
    : years.filter((year) => year.label === selectedYear);
  const selectedYearIds = new Set(selectedYears.map((year) => year.id));
  const inYear = (record: PortfolioRecord) => selectedYear === "current"
    ? !record.rentalYearId || selectedYearIds.has(String(record.rentalYearId))
    : selectedYearIds.has(String(record.rentalYearId));
  const properties = records.filter((record) => record.kind === "property");
  const reportRecords = records.filter((record) =>
    record.kind === "property" ||
    (record.kind === "rentalYear" ? selectedYearIds.has(record.id) : inYear(record)),
  );
  const currentMonth = new Date().toISOString().slice(0, 7);
  const reportThroughMonth = selectedYear === "current"
    ? currentMonth
    : selectedYears.reduce(
        (latest, year) => String(year.endDate || "").slice(0, 7) > latest
          ? String(year.endDate).slice(0, 7)
          : latest,
        "",
      ) || currentMonth;
  const rentLedger = calculateRentLedger(reportRecords, reportThroughMonth);
  const financial = records.filter((record) => inYear(record) && ["rentPayment", "expense", "tenant", "compliance"].includes(record.kind));
  const payments = financial.filter((record) => record.kind === "rentPayment");
  const expenses = financial.filter((record) => record.kind === "expense");
  const income = payments.reduce((sum, record) => sum + Number(record.amountPaidPence || 0), 0);
  const costs = expenses.reduce((sum, record) => sum + Number(record.amountPence || 0), 0);
  const transactions = [...financial].sort((a, b) => transactionDate(b).localeCompare(transactionDate(a)));
  const propertyTransactions = transactions.filter((record) => record.propertyId === selectedProperty);
  return <div className="page">
    <PageHeader eyebrow="Income & expenditure" title="Finance" description="Read-only finance reporting by property and rental year. Record rent and expenses from the relevant property workspace." />
    <div className="toolbar finance-toolbar"><label className="year-picker"><span>Finance year</span><select value={selectedYear} onChange={(event) => { setSelectedYear(event.target.value); setSelectedProperty(""); }}><option value="current">Current year</option>{labels.map((label) => <option value={label} key={label}>{label}</option>)}</select></label></div>
    <section className="finance-summary">
      <article><span className="up"><ArrowUpRight /></span><div><small>Rent received</small><strong>{money(income)}</strong></div></article>
      <article><span className="down"><ArrowDownRight /></span><div><small>Property costs</small><strong>{money(costs)}</strong></div></article>
      <article><span className="net"><WalletCards /></span><div><small>Net position</small><strong className={income - costs >= 0 ? "positive" : "negative"}>{money(income - costs)}</strong></div></article>
    </section>
    <section className="property-grid finance-property-grid">{properties.map((property) => {
      const rows = transactions.filter((record) => record.propertyId === property.id);
      const propertyIncome = rows.filter((record) => record.kind === "rentPayment").reduce((sum, record) => sum + Number(record.amountPaidPence || 0), 0);
      const propertyCosts = rows.filter((record) => record.kind === "expense").reduce((sum, record) => sum + Number(record.amountPence || 0), 0);
      const propertyRent = rentLedger.byProperty.find((item) => item.propertyId === property.id);
      return <button className={`finance-property-card ${selectedProperty === property.id ? "active" : ""}`} key={property.id} onClick={() => setSelectedProperty(property.id)}><span className="record-icon"><Building2 /></span><div><strong>{String(property.name)}</strong><small>{money(propertyIncome)} income · {money(propertyCosts)} costs</small><span>{money(propertyRent?.outstandingPence)} outstanding of {money(propertyRent?.expectedPence)} expected</span></div><b className={propertyIncome - propertyCosts >= 0 ? "positive" : "negative"}>{money(propertyIncome - propertyCosts)}</b><ChevronRight /></button>;
    })}</section>
    <section className="finance-grid"><FinanceList heading="Recent fifty transactions" records={transactions.slice(0, 50)} /><FinanceList heading={selectedProperty ? `${String(properties.find((property) => property.id === selectedProperty)?.name)} transactions` : "Property details"} records={propertyTransactions} empty={selectedProperty ? "No finance activity for this property and year." : "Select a property card to see every related transaction."} /></section>
  </div>;
}

function FinanceList({ heading, records, empty = "No transactions for this finance year." }: { heading: string; records: PortfolioRecord[]; empty?: string }) {
  return <article className="panel records-panel"><header><div><span className="eyebrow">Finance ledger</span><h2>{heading}</h2></div><CirclePoundSterling /></header>{records.length ? <div className="record-list">{records.map((record) => { const amount = transactionAmount(record); const Icon = record.kind === "expense" ? ReceiptText : record.kind === "compliance" ? ShieldCheck : ArrowUpRight; return <article key={record.id}><span className={`record-icon ${record.kind === "expense" ? "expense" : ""}`}><Icon /></span><div><strong>{transactionLabel(record)}</strong><small>{date(transactionDate(record))} · {String(record.notes || record.description || record.bankReference || "No notes")}</small></div>{amount !== 0 && <b className={amount < 0 ? "negative" : "positive"}>{amount < 0 ? "−" : ""}{money(Math.abs(amount))}</b>}</article>; })}</div> : <Empty title="No finance activity" description={empty} />}</article>;
}
