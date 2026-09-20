import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function PrivateImage({ documentId, alt }: { documentId?: string; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    if (!documentId) {
      setUrl("");
      return;
    }
    api.viewUrl(documentId)
      .then((result) => { if (active) setUrl(result.url); })
      .catch(() => { if (active) setUrl(""); });
    return () => { active = false; };
  }, [documentId]);
  return url ? <img className="private-image" src={url} alt={alt} /> : null;
}
