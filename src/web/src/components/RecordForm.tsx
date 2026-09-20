import { useState, type FormEvent } from "react";
import { usePortfolio } from "../context/PortfolioContext";
import { title } from "../lib/format";
import type { PortfolioRecord, RecordKind } from "../types";
import { Modal, Notice } from "./UI";

export type Field = { name: string; label?: string; type?: "text" | "email" | "number" | "money" | "date" | "select" | "textarea" | "checkbox"; required?: boolean; options?: { label: string; value: string }[]; placeholder?: string; wide?: boolean };

export function RecordForm({ kind, fields, record, onClose, defaults = {} }: { kind: RecordKind; fields: Field[]; record?: PortfolioRecord; onClose: () => void; defaults?: Record<string, unknown> }) {
  const { save } = usePortfolio();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const data: Record<string, unknown> = { ...defaults };
    for (const field of fields) {
      if (field.name.startsWith("reminderOffset")) continue;
      const raw = form.get(field.name);
      if (field.name === "tenantIds") data[field.name] = raw ? [String(raw)] : [];
      else if (field.type === "checkbox") data[field.name] = raw === "on";
      else if (field.type === "number") data[field.name] = Number(raw || 0);
      else if (field.type === "money") data[field.name] = Math.round(Number(raw || 0) * 100);
      else data[field.name] = String(raw ?? "");
    }
    if (fields.some((field) => field.name === "reminderOffset1")) data.reminderOffsetsDays = [1, 2, 3].map((index) => String(form.get(`reminderOffset${index}`) ?? "").trim()).filter(Boolean).map(Number);
    try { await save(kind, data, record); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save record."); }
    finally { setBusy(false); }
  };
  return <Modal title={`${record ? "Edit" : "Add"} ${title(kind)}`} onClose={onClose}><form onSubmit={submit} className="record-form">{error && <Notice type="error">{error}</Notice>}<div className="form-grid">{fields.map((field) => {
    const reminderIndex = field.name.startsWith("reminderOffset") ? Number(field.name.slice(-1)) - 1 : -1;
    const offsets = Array.isArray(record?.reminderOffsetsDays) ? record.reminderOffsetsDays : Array.isArray(defaults.reminderOffsetsDays) ? defaults.reminderOffsetsDays : [];
    const existing = reminderIndex >= 0 ? offsets[reminderIndex] ?? "" : record?.[field.name] ?? defaults[field.name] ?? "";
    const normalized = field.name === "tenantIds" && Array.isArray(existing) ? existing[0] : existing;
    const value = field.type === "money" ? Number(normalized) / 100 : normalized;
    return <label key={field.name} className={field.wide ? "wide" : ""}><span>{field.label || title(field.name)}{field.required && <b> *</b>}</span>{field.type === "select" ? <select name={field.name} defaultValue={String(value)} required={field.required}>{(field.placeholder || !field.required) && <option value="" disabled={field.required}>{field.placeholder || "Select…"}</option>}{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === "textarea" ? <textarea name={field.name} defaultValue={String(value)} rows={4} required={field.required} placeholder={field.placeholder} /> : field.type === "checkbox" ? <input name={field.name} type="checkbox" defaultChecked={Boolean(existing)} /> : <input name={field.name} type={field.type === "money" || field.type === "number" ? "number" : field.type || "text"} min={field.name.startsWith("reminderOffset") ? 0 : undefined} max={field.name.startsWith("reminderOffset") ? 365 : undefined} step={field.type === "money" ? "0.01" : undefined} defaultValue={String(value)} required={field.required} placeholder={field.placeholder} />}</label>;
  })}</div><footer><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Saving…" : "Save record"}</button></footer></form></Modal>;
}
