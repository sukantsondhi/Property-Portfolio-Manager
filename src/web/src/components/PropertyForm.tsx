import { useMemo, useState, type FormEvent } from "react";
import { usePortfolio } from "../context/PortfolioContext";
import { api } from "../lib/api";
import { money } from "../lib/format";
import type { PortfolioRecord } from "../types";
import { Modal, Notice } from "./UI";

function tenancyMonths(start: string, end: string) {
  if (!start || !end || end < start) return 0;
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  return Math.max(
    1,
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
      to.getUTCMonth() -
      from.getUTCMonth() +
      1,
  );
}

export function PropertyForm({
  record,
  rentalYear,
  onClose,
  onDone,
}: {
  record?: PortfolioRecord;
  rentalYear?: PortfolioRecord;
  onClose: () => void;
  onDone?: () => Promise<void>;
}) {
  const { save, records, setArchived } = usePortfolio();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedRecord, setSavedRecord] = useState<PortfolioRecord>();
  const [savedRentalYear, setSavedRentalYear] = useState(rentalYear);
  const [startDate, setStartDate] = useState(String(record?.tenancyStartDate ?? ""));
  const [endDate, setEndDate] = useState(String(record?.tenancyEndDate ?? ""));
  const [frequency, setFrequency] = useState(String(record?.rentInputFrequency ?? "yearly"));
  const [amount, setAmount] = useState(() => {
    const pence = frequency === "monthly"
      ? Number(record?.monthlyRentPence || 0)
      : Number(record?.annualRentPence || 0);
    return pence ? (pence / 100).toFixed(2) : "";
  });
  const months = tenancyMonths(startDate, endDate);
  const preview = useMemo(() => {
    const pence = Math.round(Number(amount || 0) * 100);
    if (!pence || !months) return null;
    return frequency === "monthly"
      ? { monthly: pence, yearly: pence * months }
      : { monthly: Math.round(pence / months), yearly: pence };
  }, [amount, frequency, months]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const rentPence = Math.round(Number(form.get("rentAmount") || 0) * 100);
    const duration = tenancyMonths(startDate, endDate);
    if (!duration) {
      setError("Enter a valid tenancy start and end date.");
      setBusy(false);
      return;
    }
    const data: Record<string, unknown> = {
      name: String(form.get("name")),
      propertyType: String(form.get("propertyType")),
      addressLine1: String(form.get("addressLine1")),
      addressLine2: String(form.get("addressLine2")),
      city: String(form.get("city")),
      postcode: String(form.get("postcode")),
      status: String(form.get("status")),
      bedrooms: Number(form.get("bedrooms") || 0),
      bathrooms: Number(form.get("bathrooms") || 0),
      acquisitionDate: String(form.get("acquisitionDate")),
      purchasePricePence: Math.round(Number(form.get("purchasePrice") || 0) * 100),
      rentInputFrequency: frequency,
      monthlyRentPence: frequency === "monthly" ? rentPence : Math.round(rentPence / duration),
      annualRentPence: frequency === "monthly" ? rentPence * duration : rentPence,
      tenancyStartDate: startDate,
      tenancyEndDate: endDate,
      rentCollectionDay: Number(form.get("rentCollectionDay")),
      imageDocumentId: String(record?.imageDocumentId || ""),
      amenities: Array.isArray(record?.amenities) ? record.amenities : [],
      notes: String(form.get("notes")),
    };
    try {
      let property = record;
      let savedYear = savedRentalYear;
      if (savedRentalYear && record) {
        savedYear = await api.updateRestoredYearProperty(record.id, savedRentalYear, data);
        setSavedRentalYear(savedYear);
      }
      else {
        property = await save("property", data, savedRecord ?? record);
        setSavedRecord(property);
      }
      const picture = form.get("picture");
      if (picture instanceof File && picture.size) {
        if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(picture.type))
          throw new Error("Use a JPG, PNG or WebP property picture.");
        const document = await api.uploadDocument(picture, {
          propertyId: property!.id,
          ...(rentalYear ? { rentalYearId: rentalYear.id } : {}),
          category: "property_image",
        });
        if (rentalYear && savedYear) {
          savedYear = await api.updateRestoredYearProperty(record!.id, savedYear, { ...data, imageDocumentId: document.id });
          setSavedRentalYear(savedYear);
        }
        else property = await save("property", { imageDocumentId: document.id }, property);
        const previousImage = records.find(
          (item) => item.kind === "document" && item.id === record?.imageDocumentId,
        );
        if (previousImage && (!rentalYear ? !previousImage.rentalYearId : previousImage.rentalYearId === rentalYear.id) && previousImage.id !== document.id)
          await setArchived(previousImage, true);
        if (property) setSavedRecord(property);
      }
      await onDone?.();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the property.");
    } finally {
      setBusy(false);
    }
  };

  const value = (name: string) => String(record?.[name] ?? "");
  return (
    <Modal title={`${record ? "Edit" : "Add"} property`} onClose={onClose}>
      <form className="record-form" onSubmit={submit}>
        {error && <Notice type="error">{error}</Notice>}
        <div className="form-grid">
          <label><span>Property name <b>*</b></span><input name="name" required maxLength={120} defaultValue={value("name")} /></label>
          <label><span>Property type <b>*</b></span><select name="propertyType" required defaultValue={value("propertyType") || "house"}><option value="house">House</option><option value="flat">Flat</option><option value="hmo">HMO</option><option value="other">Other</option></select></label>
          <label className="wide"><span>Address line 1 <b>*</b></span><input name="addressLine1" required defaultValue={value("addressLine1")} /></label>
          <label className="wide"><span>Address line 2</span><input name="addressLine2" defaultValue={value("addressLine2")} /></label>
          <label><span>City <b>*</b></span><input name="city" required defaultValue={value("city")} /></label>
          <label><span>Postcode <b>*</b></span><input name="postcode" required defaultValue={value("postcode")} /></label>
          <label><span>Status <b>*</b></span><select name="status" required defaultValue={value("status") || "active"}><option value="active">Active</option><option value="vacant">Vacant</option><option value="maintenance">Maintenance</option></select></label>
          <label><span>Bedrooms <b>*</b></span><input name="bedrooms" type="number" min="0" required defaultValue={value("bedrooms") || "0"} /></label>
          <label><span>Bathrooms <b>*</b></span><input name="bathrooms" type="number" min="0" required defaultValue={value("bathrooms") || "0"} /></label>
          <label><span>Acquisition date</span><input name="acquisitionDate" type="date" defaultValue={value("acquisitionDate")} /></label>
          <label><span>Purchase price</span><input name="purchasePrice" type="number" min="0" step="0.01" defaultValue={record?.purchasePricePence ? (Number(record.purchasePricePence) / 100).toFixed(2) : ""} /></label>
          <label><span>Tenancy start <b>*</b></span><input name="tenancyStartDate" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label><span>Tenancy end <b>*</b></span><input name="tenancyEndDate" type="date" required value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} /></label>
          <label><span>Monthly rent collection date <b>*</b></span><select name="rentCollectionDay" required defaultValue={value("rentCollectionDay")}><option value="" disabled>Select a day…</option>{Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day}{day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th"} of every month</option>)}</select><small>Rent-status emails start on this date. Shorter months use their final day.</small></label>
          <label><span>Rent entered as <b>*</b></span><select name="rentInputFrequency" required value={frequency} onChange={(event) => setFrequency(event.target.value)}><option value="monthly">Monthly rent</option><option value="yearly">Yearly / tenancy rent</option></select></label>
          <label><span>Rent amount <b>*</b></span><input name="rentAmount" type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          {preview && <div className="wide rent-preview"><span>{months} tenancy month{months === 1 ? "" : "s"}</span><strong>{money(preview.monthly)} monthly · {money(preview.yearly)} total</strong></div>}
          <label className="wide"><span>Property picture</span><input name="picture" type="file" accept="image/jpeg,image/png,image/webp" /><small>{record?.imageDocumentId ? "Choose a file only to replace the current picture." : "Optional JPG, PNG or WebP. Stored privately."}</small></label>
          <label className="wide"><span>Notes</span><textarea name="notes" rows={4} defaultValue={value("notes")} /></label>
        </div>
        <footer><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Saving…" : "Save property"}</button></footer>
      </form>
    </Modal>
  );
}
