import { FileUp, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { Modal, Notice } from "./UI";

export function DocumentUpload({
  propertyId,
  tenantId,
  rentalYearId,
  onClose,
  onDone,
  defaultCategory = "other",
  imagesOnly = false,
}: {
  propertyId?: string;
  tenantId?: string;
  rentalYearId?: string;
  onClose: () => void;
  onDone: () => Promise<void>;
  defaultCategory?: string;
  imagesOnly?: boolean;
}) {
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await api.uploadDocument(file, {
        propertyId,
        tenantId,
        rentalYearId,
        category: String(new FormData(event.currentTarget).get("category")),
      });
      await onDone();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to upload the file.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={imagesOnly ? "Upload property picture" : "Upload document"} onClose={onClose}>
      <form className="record-form" onSubmit={submit}>
        <Notice><ShieldCheck />Files stay in private Blob Storage. Access requires current organisation membership.</Notice>
        {error && <Notice type="error">{error}</Notice>}
        <div className="form-grid">
          {!imagesOnly && (
            <label>
              <span>Category <b>*</b></span>
              <select name="category" defaultValue={defaultCategory} required>
                <option value="compliance">Compliance</option>
                <option value="tenancy">Tenancy</option>
                <option value="finance">Finance</option>
                <option value="identity">Identity</option>
                <option value="other">Other</option>
              </select>
            </label>
          )}
          {imagesOnly && <input type="hidden" name="category" value="property_image" />}
          <label className="wide">
            <span>{imagesOnly ? "Picture" : "File"} <b>*</b></span>
            <input
              type="file"
              required
              accept={imagesOnly ? "image/jpeg,image/png,image/webp" : ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"}
              onChange={(event) => setFile(event.target.files?.[0])}
            />
            <small>{imagesOnly ? "JPG, PNG or WebP, up to 25 MB." : "PDF, image, DOCX or XLSX, up to 25 MB."}</small>
          </label>
        </div>
        <footer>
          <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={busy || !file}>
            <FileUp />{busy ? "Uploading…" : "Upload securely"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
