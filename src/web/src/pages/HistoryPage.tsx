import {
  Building2,
  CalendarRange,
  FileText,
  ReceiptText,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, PageHeader } from "../components/UI";
import { RecordMenu } from "../components/RecordMenu";
import { PrivateImage } from "../components/PrivateImage";
import { usePortfolio } from "../context/PortfolioContext";
import { date, money } from "../lib/format";
import type { PortfolioRecord } from "../types";

export function HistoryPage() {
  const { records } = usePortfolio();
  const properties = records.filter((record) => record.kind === "property");
  const closedYears = records.filter(
    (record) => record.kind === "rentalYear" && record.status === "closed",
  );
  const [selected, setSelected] = useState<Record<string, string>>({});
  const cards = useMemo(
    () =>
      properties
        .map((property) => ({
          property,
          years: closedYears
            .filter((year) => year.propertyId === property.id)
            .sort((a, b) =>
              String(b.startDate).localeCompare(String(a.startDate)),
            ),
        }))
        .filter((card) => card.years.length),
    [properties, closedYears],
  );

  return (
    <div className="page">
      <PageHeader
        eyebrow="Closed rental years"
        title="History"
        description="Each property's previous tenants, agreements, finances and documents, grouped by rental year."
      />
      {!cards.length ? (
        <Empty
          icon={CalendarRange}
          title="No rental-year history yet"
          description="Start a new rental year from a property to move the outgoing tenancy records here."
        />
      ) : (
        <section className="property-grid history-grid">
          {cards.map(({ property, years }) => {
            const year =
              years.find((item) => item.id === selected[property.id]) ??
              years[0];
            const historicalProperty = year.propertySnapshot && typeof year.propertySnapshot === "object"
              ? year.propertySnapshot as PortfolioRecord
              : property;
            const yearRecords = records.filter(
              (record) => record.rentalYearId === year.id,
            );
            const tenants = yearRecords.filter(
              (record) => record.kind === "tenant",
            );
            const tenancies = yearRecords.filter(
              (record) => record.kind === "tenancy",
            );
            const payments = yearRecords.filter(
              (record) => record.kind === "rentPayment",
            );
            const expenses = yearRecords.filter(
              (record) => record.kind === "expense",
            );
            const documents = yearRecords.filter(
              (record) => record.kind === "document",
            );
            return (
              <article className="property-card history-card" key={property.id}>
                <div className={`property-cover ${historicalProperty.imageDocumentId ? "has-image" : ""}`}>
                  <PrivateImage documentId={String(historicalProperty.imageDocumentId || "") || undefined} alt={`${String(historicalProperty.name)} historical property`} />
                  <span>History</span>
                  <Building2 />
                </div>
                <div className="property-body">
                  <div className="history-title">
                    <h2>{String(historicalProperty.name)}</h2>
                    <span className="status current">{String(year.label)}</span>
                  </div>
                  <p>
                    {String(historicalProperty.addressLine1)}, {String(historicalProperty.city)},{" "}
                    {String(historicalProperty.postcode)}
                  </p>
                  <label className="year-picker">
                    <span>Rental year</span>
                    <select
                      value={year.id}
                      onChange={(event) =>
                        setSelected((value) => ({
                          ...value,
                          [property.id]: event.target.value,
                        }))
                      }
                    >
                      {years.map((item) => (
                        <option key={item.id} value={item.id}>
                          {String(item.label)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="history-period">
                    <CalendarRange />
                    <span>
                      {date(year.startDate)} — {date(year.endDate)}
                    </span>
                  </div>
                  <div className="history-summary">
                    <span>
                      <ReceiptText />
                      {Number(year.annualRentPence) > 0
                        ? `${money(year.annualRentPence)} expected rent`
                        : "Expected rent not recorded"}
                    </span>
                    <span>
                      <Users />
                      {tenants.length} tenants
                    </span>
                    <span>
                      <FileText />
                      {documents.length} documents
                    </span>
                    <span>
                      <ReceiptText />
                      {money(
                        payments.reduce(
                          (sum, item) =>
                            sum + Number(item.amountPaidPence || 0),
                          0,
                        ) -
                          expenses.reduce(
                            (sum, item) => sum + Number(item.amountPence || 0),
                            0,
                          ),
                      )}{" "}
                      net
                    </span>
                  </div>
                  <div className="history-details">
                    <strong>
                      {tenancies.length} tenancy agreement
                      {tenancies.length === 1 ? "" : "s"}
                    </strong>
                    {tenants.map((tenant) => (
                      <small key={tenant.id}>
                        {String(tenant.firstName)} {String(tenant.lastName)}
                      </small>
                    ))}
                  </div>
                  <Link className="card-link open-property" to={`/app/history/${property.id}/${year.id}`}>Open read-only history</Link>
                  {documents.length > 0 && (
                    <div className="record-list history-documents">
                      {documents.map((document) => (
                        <article key={document.id}>
                          <span className="record-icon">
                            <FileText />
                          </span>
                          <div>
                            <strong>{String(document.fileName)}</strong>
                            <small>{String(document.category)}</small>
                          </div>
                          <RecordMenu record={document} download readOnly />
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
