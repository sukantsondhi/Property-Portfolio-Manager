import { Archive, Download, MoreHorizontal, Pencil } from "lucide-react";
import { useState } from "react";
import { usePortfolio } from "../context/PortfolioContext";
import { api } from "../lib/api";
import type { PortfolioRecord } from "../types";

export function RecordMenu({
  record,
  onEdit,
  download = false,
  readOnly = false,
}: {
  record: PortfolioRecord;
  onEdit?: () => void;
  download?: boolean;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { setArchived } = usePortfolio();

  const downloadRecord = async () => {
    setDownloading(true);
    try {
      const { url } = await api.downloadUrl(record.id);
      window.location.assign(url);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Unable to download this document.",
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="record-menu">
      {download && (
        <button
          className="button secondary compact download-action"
          disabled={downloading}
          onClick={() => void downloadRecord()}
        >
          <Download />
          {downloading ? "Preparing…" : "Download"}
        </button>
      )}
      {!readOnly && <button
          className="icon small"
          aria-label="Record actions"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <MoreHorizontal />
        </button>}
      {!readOnly && open && (
        <div className="menu-popover">
          {onEdit && (
            <button
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              <Pencil />
              Edit
            </button>
          )}
          <button
            className="danger"
            onClick={async () => {
              setOpen(false);
              if (
                window.confirm(
                  "Archive this record? You can restore it later.",
                )
              )
                await setArchived(record, true);
            }}
          >
            <Archive />
            Archive
          </button>
        </div>
      )}
    </div>
  );
}
