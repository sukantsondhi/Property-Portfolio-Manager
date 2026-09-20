import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Empty, Notice, PageHeader } from "../components/UI";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { usePortfolio } from "../context/PortfolioContext";
import { date, money, title } from "../lib/format";
import { recordKinds, type PortfolioRecord } from "../types";

const hiddenFields = new Set(["organizationId", "_etag", "blobName"]);

function recordName(record: PortfolioRecord) {
  const personName = `${String(record.firstName || "")} ${String(record.lastName || "")}`.trim();
  return String(
    record.name ||
      record.title ||
      record.fileName ||
      record.description ||
      personName ||
      title(record.kind),
  );
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

async function listAllArchived(kind: (typeof recordKinds)[number]) {
  const items: PortfolioRecord[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await api.list(kind, true, continuationToken);
    items.push(...page.items);
    continuationToken = page.continuationToken;
  } while (continuationToken);
  return items;
}

export function ArchivePage() {
  const organization = useAuth()?.organization;
  const activeRecords = usePortfolio()?.records ?? [];
  const [records, setRecords] = useState<PortfolioRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await Promise.all(
        recordKinds.map(listAllArchived),
      );
      setRecords(
        all
          .flat()
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the archive.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (record: PortfolioRecord) => {
    const name = recordName(record);
    if (!window.confirm(`Restore "${name}"? It will return to the active portfolio views.`)) return;
    setBusyId(record.id);
    setError("");
    try {
      await api.status(record, "restore");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to restore this record.");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (record: PortfolioRecord) => {
    const name = recordName(record);
    const relatedWarning =
      record.kind === "property"
        ? " All tenants, tenancies, payments, expenses, compliance records, rental years and documents linked to this property will also be deleted."
        : record.kind === "tenant"
          ? " Records linked only to this tenant will also be deleted."
          : "";
    if (
      !window.confirm(
        `Permanently delete "${name}"?${relatedWarning} This cannot be undone.`,
      )
    )
      return;
    setBusyId(record.id);
    setError("");
    try {
      const result = await api.permanentDelete(record);
      await load();
      if (result.blobCleanupFailures)
        setError(
          "The record was deleted, but one or more private document files require administrator cleanup.",
        );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete this record.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Recoverable records"
        title="Archive"
        description="Restore archived records or permanently delete records you no longer need. Permanent deletion cannot be undone."
      />
      {error && <Notice type="error">{error}</Notice>}
      {!loading && !records.length ? (
        <Empty
          icon={Archive}
          title="The archive is empty"
          description="Records you archive will remain safely available here."
        />
      ) : (
        <section className="panel records-panel">
          <div className="record-list">
            {records.map((record) => {
              const busy = busyId === record.id;
              const property = [...activeRecords, ...records].find(
                (candidate) =>
                  candidate.kind === "property" && candidate.id === record.propertyId,
              );
              const detail = record.kind === "tenant"
                ? [String(record.email || "No email"), record.university ? String(record.university) : "", record.monthlyRentPence ? `${money(record.monthlyRentPence)} monthly rent` : "Rent not set"].filter(Boolean).join(" · ")
                : record.kind === "property"
                  ? `${String(record.addressLine1 || "")} ${String(record.city || "")} ${String(record.postcode || "")} · ${String(record.bedrooms || 0)} bedrooms`
                  : String(record.notes || record.description || record.category || "No additional details");
              return (
                <article key={record.id}>
                  <span className="record-icon">
                    <Archive />
                  </span>
                  <div>
                    <strong>{recordName(record)}</strong>
                    <small>
                      {title(record.kind)} · {property ? `${String(property.name)} · ` : ""}Archived {date(record.updatedAt)}
                    </small>
                    <small>{detail}</small>
                    <details className="archive-record-details">
                      <summary>All archived details</summary>
                      <dl className="history-record-details">
                        {Object.entries(record)
                          .filter(([key]) => !hiddenFields.has(key))
                          .map(([key, value]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd>{fieldValue(key, value)}</dd></div>)}
                      </dl>
                    </details>
                  </div>
                  <div className="archive-actions">
                    <button
                      className="button secondary compact"
                      disabled={!!busyId}
                      onClick={() => void restore(record)}
                    >
                      <RotateCcw />
                      {busy ? "Working…" : "Restore"}
                    </button>
                    {organization?.role === "owner" && <button
                      className="button danger compact"
                      disabled={!!busyId}
                      onClick={() => void remove(record)}
                    >
                      <Trash2 />
                      Delete
                    </button>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
