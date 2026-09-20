import { AlertTriangle, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Notice, PageHeader } from "../components/UI";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

type Members = Awaited<ReturnType<typeof api.members>>;

export function OrganizationPage() {
  const { organization, refreshSession, selectOrganization, user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Members>({ members: [], invitations: [] });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = async () => { if (organization?.role === "owner") setData(await api.members(organization.id)); };
  useEffect(() => { if (organization?.role === "owner") load().catch((reason) => setError(reason.message)); }, [organization?.id, organization?.role]);

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organization) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError(""); setMessage(""); setSubmitting(true);
    try {
      const result = await api.inviteMember(organization.id, String(form.get("email")), String(form.get("role")));
      formElement.reset();
      setMessage(result.status === "accepted"
        ? result.existing
          ? `This user already has accepted access as ${result.role}.`
          : `Access was granted immediately as ${result.role}, and an email was sent.`
        : result.existing
          ? "The existing invitation was refreshed and emailed again."
          : "Access invitation saved and emailed.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to invite user."); }
    finally { setSubmitting(false); }
  };

  const remove = async (id: string) => {
    if (!organization || !confirm("Remove this user's access to this organisation?")) return;
    await api.removeMember(organization.id, id);
    await load();
  };

  const deleteOrganization = async () => {
    if (!organization) return;
    const confirmationName = prompt(`Type "${organization.name}" to permanently delete this organisation and all of its portfolio data.`);
    if (confirmationName === null) return;
    if (confirmationName.trim() !== organization.name) {
      setError("The organisation name did not match. Nothing was deleted.");
      return;
    }
    if (!confirm(`Permanently delete ${organization.name}? Properties, tenant records, finances and document metadata cannot be recovered.`)) return;
    setDeleting(true); setError("");
    try {
      const result = await api.deleteOrganization(organization.id, confirmationName);
      selectOrganization(null);
      await refreshSession();
      navigate("/select-organization", { replace: true, state: { message: `${result.name} was permanently deleted.` } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to delete the organisation."); }
    finally { setDeleting(false); }
  };

  return <div className="page">
    <PageHeader eyebrow="Organisation settings" title={organization?.name ?? "Organisation"} description="Manage who can access this private portfolio." />
    {error && <Notice type="error">{error}</Notice>}
    {message && <Notice type="success">{message}</Notice>}
    <section className="panel role-matrix"><header><div><span className="eyebrow">Access model</span><h2>Roles and capabilities</h2><p>Your current access: {user?.isPlatformAdmin ? "Super admin" : organization?.role === "owner" ? "Owner" : "Editor"}.</p></div><ShieldCheck /></header><div className="role-grid"><article><strong>Editor</strong><span>Add properties and edit organisation portfolio fields.</span></article><article><strong>Owner</strong><span>All editor access, plus members, permanent archive deletion and organisation deletion.</span></article><article><strong>Super admin</strong><span>Owner and editor access across active organisations, plus platform-user and super-admin management.</span></article></div></section>
    {organization?.role !== "owner" ? <Notice><ShieldCheck />Only organisation owners can manage access.</Notice> : <>
      <section className="panel">
        <header><div><span className="eyebrow">Add securely</span><h2>Add a portfolio member</h2><p>A super admin must first add this Microsoft account to the platform. Owners can then grant Editor or Owner access here.</p></div><UserPlus /></header>
        <form className="inline-form" onSubmit={invite}><input name="email" type="email" required placeholder="Microsoft account email" disabled={submitting} /><select name="role" defaultValue="editor" disabled={submitting}><option value="editor">Editor</option><option value="owner">Owner</option></select><button className="button primary" disabled={submitting}>{submitting ? "Inviting…" : "Invite user"}</button></form>
      </section>
      <section className="panel settings-list"><header><div><span className="eyebrow">Accepted access</span><h2>Members</h2></div></header>{data.members.map((member) => <article key={member.id}><div><strong>{member.email}</strong><span>{member.role} · accepted {new Date(member.acceptedAt).toLocaleDateString("en-GB")}</span></div><span className="status accepted">accepted</span><button className="button danger compact" onClick={() => remove(member.id)}><Trash2 />Remove</button></article>)}</section>
      <section className="panel settings-list"><header><div><span className="eyebrow">Invitation register</span><h2>Invitation status</h2><p>One row per invited email that does not currently have active access.</p></div></header>{data.invitations.length ? data.invitations.map((invitation) => <article key={invitation.email}><div><strong>{invitation.email}</strong><span>{invitation.role} · {invitation.status === "pending" && invitation.expiresAt ? `expires ${new Date(invitation.expiresAt).toLocaleDateString("en-GB")}` : invitation.status === "accepted" && invitation.acceptedAt ? `accepted ${new Date(invitation.acceptedAt).toLocaleDateString("en-GB")}` : "access revoked"}</span></div><span className={`status ${invitation.status}`}>{invitation.status}</span></article>) : <p className="muted-copy">No pending or historical organisation invitations.</p>}</section>
      <section className="panel danger-zone"><header><div><span className="eyebrow">Danger zone</span><h2>Delete organisation</h2><p>Permanently removes this organisation, its portfolio records and stored documents for every member.</p></div><AlertTriangle /></header><button className="button danger" disabled={deleting} onClick={deleteOrganization}><Trash2 />{deleting ? "Deleting…" : "Delete organisation"}</button></section>
    </>}
  </div>;
}
