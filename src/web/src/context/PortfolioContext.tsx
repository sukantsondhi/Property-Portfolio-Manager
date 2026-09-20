import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import {
  recordKinds,
  type PortfolioRecord,
  type RecordKind,
} from "../types";

type Ctx = {
  records: PortfolioRecord[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  save: (
    kind: RecordKind,
    data: Record<string, unknown>,
    existing?: PortfolioRecord,
  ) => Promise<PortfolioRecord>;
  saveRentAdvance: (data: {
    propertyId: string;
    tenantId: string;
    tenancyId?: string;
    rentalYearId?: string;
    paidDate: string;
    additionalMonths: number;
    method: string;
    rentFrequency: string;
    bankReference: string;
    notes: string;
  }) => Promise<{
    payments: PortfolioRecord[];
    coveredFrom: string;
    coveredTo: string;
    totalPaidPence: number;
  }>;
  updateRentAdvance: (
    record: PortfolioRecord,
    data: {
      paidDate: string;
      method: string;
      rentFrequency: string;
      bankReference: string;
      notes: string;
    },
  ) => Promise<PortfolioRecord[]>;
  setArchived: (
    record: PortfolioRecord,
    archive: boolean,
  ) => Promise<void>;
};

const PortfolioContext = createContext<Ctx>(null!);

async function listAll(kind: RecordKind) {
  const items: PortfolioRecord[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await api.list(kind, false, continuationToken);
    items.push(...page.items);
    continuationToken = page.continuationToken;
  } while (continuationToken);
  return items;
}

function visibleRecords(records: PortfolioRecord[]) {
  const propertyIds = new Set(
    records
      .filter((record) => record.kind === "property")
      .map((record) => record.id),
  );
  const tenantIds = new Set(
    records
      .filter(
        (record) =>
          record.kind === "tenant" &&
          propertyIds.has(String(record.propertyId ?? "")),
      )
      .map((record) => record.id),
  );
  return records.filter(
    (record) =>
      record.kind === "property" ||
      (!record.propertyId && !record.tenantId) ||
      (!!record.propertyId &&
        propertyIds.has(String(record.propertyId))) ||
      (!!record.tenantId && tenantIds.has(String(record.tenantId))),
  );
}

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<PortfolioRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await Promise.all(recordKinds.map(listAll));
      setRecords(visibleRecords(result.flat()));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load portfolio.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (
    kind: RecordKind,
    data: Record<string, unknown>,
    existing?: PortfolioRecord,
  ) => {
    const updated = existing
      ? await api.update(existing, data)
      : await api.create(kind, data);
    setRecords((current) => [
      ...current.filter((record) => record.id !== updated.id),
      updated,
    ]);
    return updated;
  };

  const saveRentAdvance: Ctx["saveRentAdvance"] = async (data) => {
    const result = await api.recordRentAdvance(data);
    const paymentIds = new Set(result.payments.map((payment) => payment.id));
    setRecords((current) => [
      ...current.filter((record) => !paymentIds.has(record.id)),
      ...result.payments,
    ]);
    return result;
  };

  const updateRentAdvance: Ctx["updateRentAdvance"] = async (record, data) => {
    const result = await api.updateRentAdvance(record, data);
    const paymentIds = new Set(result.payments.map((payment) => payment.id));
    setRecords((current) => [
      ...current.filter((payment) => !paymentIds.has(payment.id)),
      ...result.payments,
    ]);
    return result.payments;
  };

  const setArchived = async (
    record: PortfolioRecord,
    archive: boolean,
  ) => {
    await api.status(record, archive ? "archive" : "restore");
    if (record.advancePaymentId) await refresh();
    else
      setRecords((current) =>
        current.filter((currentRecord) => currentRecord.id !== record.id),
      );
  };

  return (
    <PortfolioContext.Provider
      value={{
        records,
        loading,
        error,
        refresh,
        save,
        saveRentAdvance,
        updateRentAdvance,
        setArchived,
      }}
    >
      {children}
    </PortfolioContext.Provider>
  );
}

export const usePortfolio = () => useContext(PortfolioContext);
