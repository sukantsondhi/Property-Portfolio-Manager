import { Building2, LogOut, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { Notice } from "../components/UI";

export function OrganizationSelectPage() {
  const { organizations, selectOrganization, refreshSession, user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const invitedOrganizationId = searchParams.get("organization");
  const requestedNext = searchParams.get("next");
  const safeNext = requestedNext?.startsWith("/app/") ? requestedNext : "/app";
  const open = (organization: (typeof organizations)[number]) => { selectOrganization(organization); navigate(safeNext); };
  useEffect(() => {
    if (!invitedOrganizationId) return;
    const invitedOrganization = organizations.find((item) => item.id === invitedOrganizationId);
    if (invitedOrganization) { selectOrganization(invitedOrganization); navigate(safeNext, { replace: true }); }
  }, [invitedOrganizationId, organizations, navigate, safeNext, selectOrganization]);
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setCreating(true); setError("");
    try { const name = String(new FormData(event.currentTarget).get("name")); const organization = await api.createOrganization(name); await refreshSession(); selectOrganization(organization); navigate("/app"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create organisation."); }
    finally { setCreating(false); }
  };
  return <main className="standalone organization-select"><section className="selection-card">
    <header><span className="brand-mark">PPM</span><div><h1>Property Portfolio Manager</h1><p>Choose the organisation you want to manage.</p></div><a className="button secondary" href="/.auth/logout?post_logout_redirect_uri=/login"><LogOut /> Sign out</a></header>
    <div className="security-note"><ShieldCheck /><div><strong>Signed in as {user?.email}</strong><span>{user?.isPlatformAdmin ? "Super admins can administer every active organisation." : "You will only see organisations where you have an active membership."}</span></div></div>
    {typeof location.state === "object" && location.state && "message" in location.state && <Notice type="success">{String(location.state.message)}</Notice>}
    {invitedOrganizationId && !organizations.some((item) => item.id === invitedOrganizationId) && <Notice type="error">This organisation invitation is unavailable for the signed-in Microsoft account.</Notice>}
    {error && <Notice type="error">{error}</Notice>}
    <div className="organization-grid">{organizations.map((organization) => <button key={organization.id} className="organization-card" onClick={() => open(organization)}><Building2 /><span><strong>{organization.name}</strong><small>{user?.isPlatformAdmin ? "Super admin · owner access" : organization.role}</small></span></button>)}</div>
    <form className="create-organization" onSubmit={create}><label><span>Create a new organisation</span><input name="name" required minLength={2} maxLength={120} placeholder="Organisation or company name" /></label><button className="button primary" disabled={creating}><Plus />{creating ? "Creating…" : "Create organisation"}</button></form>
  </section></main>;
}
