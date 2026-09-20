import { ArrowRight, Bath, BedDouble, Building2, CalendarRange, MapPin, Plus, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PrivateImage } from "../components/PrivateImage";
import { PropertyForm } from "../components/PropertyForm";
import { RecordMenu } from "../components/RecordMenu";
import { Empty, PageHeader } from "../components/UI";
import { usePortfolio } from "../context/PortfolioContext";
import type { PortfolioRecord } from "../types";
export function PropertiesPage() {
  const { records, loading } = usePortfolio();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PortfolioRecord | true>();
  const properties = useMemo(
    () =>
      records.filter(
        (r) =>
          r.kind === "property" &&
          JSON.stringify(r).toLowerCase().includes(query.toLowerCase()),
      ),
    [records, query],
  );
  return (
    <div className="page">
      <PageHeader
        eyebrow="Portfolio"
        title="Properties"
        description="Every property, tenancy and compliance record in one place."
        actions={
          <button className="button primary" onClick={() => setEditing(true)}>
            <Plus />
            Add property
          </button>
        }
      />
      <div className="toolbar">
        <label className="search">
          <Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, address or postcode"
          />
          <span>{properties.length} properties</span>
        </label>
      </div>
      {!loading && !properties.length ? (
        <Empty
          icon={Building2}
          title="Add your first property"
          description="Start the shared portfolio with an address and key details."
          action={
            <button className="button primary" onClick={() => setEditing(true)}>
              <Plus />
              Add property
            </button>
          }
        />
      ) : (
        <section className="property-grid">
          {properties.map((p) => {
            const currentYear = records.find((record) => record.kind === "rentalYear" && record.propertyId === p.id && record.status === "current");
            const tenantCount = records.filter((record) => record.kind === "tenant" && record.propertyId === p.id && (!currentYear || record.rentalYearId === currentYear.id)).length;
            return <article className="property-card" key={p.id}>
              <div className={`property-cover ${p.imageDocumentId ? "has-image" : ""}`}>
                <PrivateImage documentId={String(p.imageDocumentId || "") || undefined} alt={`${String(p.name)} property`} />
                <span>{String(p.propertyType || "Property")}</span>
                <RecordMenu record={p} onEdit={() => setEditing(p)} />
                <Building2 />
              </div>
              <div className="property-body">
                <span className={`status ${p.status}`}>{String(p.status)}</span>
                <h2>
                  <Link to={`/app/properties/${p.id}`}>{String(p.name)}</Link>
                </h2>
                <p>
                  <MapPin />
                  {String(p.addressLine1)}, {String(p.city)},{" "}
                  {String(p.postcode)}
                </p>
                <div className="property-meta">
                  <span>
                    <BedDouble />
                    {String(p.bedrooms)} beds
                  </span>
                  <span>
                    <Bath />
                    {String(p.bathrooms)} baths
                  </span>
                  <span>
                    <CalendarRange />
                    {String(currentYear?.label || new Date().getFullYear())}
                  </span>
                  <span>
                    <Users />
                    {tenantCount} tenants
                  </span>
                </div>
                <Link className="card-link open-property" to={`/app/properties/${p.id}`}>
                  <span>Open property</span><ArrowRight />
                </Link>
              </div>
            </article>;
          })}
        </section>
      )}
      {editing && (
        <PropertyForm
          record={editing === true ? undefined : editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}
