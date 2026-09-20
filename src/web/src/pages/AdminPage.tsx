import { Shield, ShieldCheck, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { Notice, PageHeader } from "../components/UI";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

export function AdminPage() {
  const { user } = useAuth();
  const [invitations, setInvitations] = useState<Awaited<ReturnType<typeof api.platformInvitations>>>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const load = async () => setInvitations(await api.platformInvitations());
  useEffect(() => { if (user?.isPlatformAdmin) load().catch((reason) => setError(reason.message)); }, [user?.isPlatformAdmin]);
  if (!user?.isPlatformAdmin) return <Navigate to="/app" replace />;
  const invite = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const formElement = event.currentTarget; const email = String(new FormData(formElement).get("email")); setError(""); setMessage(""); setSubmitting(true); try { const result = await api.invitePlatformUser(email); formElement.reset(); setMessage(result.status === "accepted" ? "This Microsoft account already has accepted platform access." : result.existing ? "The pending platform invitation was refreshed and emailed again." : "Platform invitation created and emailed. The user must sign in with that Microsoft account."); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to invite user."); } finally { setSubmitting(false); } };
  const revoke = async (id: string) => { if (!confirm("Revoke this pending platform invitation?")) return; setError(""); try { await api.revokePlatformInvitation(id); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to revoke invitation."); } };
  const setAdmin = async (email: string, enabled: boolean) => { if (!confirm(`${enabled ? "Grant" : "Remove"} super-admin access for ${email}?`)) return; setError(""); try { await api.setPlatformAdmin(email, enabled); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update super-admin access."); } };
  const removeUser = async (id: string, email: string) => { if (!confirm(`Remove ${email} from the platform and revoke all organisation memberships?`)) return; setError(""); try { await api.removePlatformUser(id); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to remove this platform user."); } };
  return <div className="page"><PageHeader eyebrow="Platform administration" title="People and super admins" description="Invite-only Microsoft account access. Super-admin changes are restricted to current super admins." />
    {error && <Notice type="error">{error}</Notice>}{message && <Notice type="success">{message}</Notice>}
    <section className="panel"><header><div><span className="eyebrow">Private platform</span><h2>Add a Microsoft account</h2><p>The account must accept this platform invitation before an owner can add it to an organisation.</p></div><Shield /></header><form className="inline-form" onSubmit={invite}><input name="email" type="email" required placeholder="person@example.com" disabled={submitting} /><button className="button primary" disabled={submitting}><UserPlus />{submitting ? "Creating…" : "Create invitation"}</button></form></section>
    <section className="panel settings-list"><header><div><span className="eyebrow">Access register</span><h2>Platform users and invitations</h2><p>Remove platform users or grant super-admin access to an accepted account.</p></div></header>{invitations.length ? invitations.map((invitation) => <article key={invitation.email}><div><strong>{invitation.email}</strong><span>{invitation.status === "pending" && invitation.expiresAt ? `Expires ${new Date(invitation.expiresAt).toLocaleDateString("en-GB")}` : invitation.status === "accepted" && invitation.acceptedAt ? `Accepted ${new Date(invitation.acceptedAt).toLocaleDateString("en-GB")}` : "Access revoked"}</span></div>{invitation.isPlatformAdmin && <span className="status current">Super admin</span>}<span className={`status ${invitation.status}`}>{invitation.status}</span>{invitation.status === "pending" && <button className="button danger compact" onClick={() => revoke(invitation.id)}><Trash2 />Revoke</button>}{invitation.status === "accepted" && <div className="archive-actions"><button className="button secondary compact" onClick={() => setAdmin(invitation.email, !invitation.isPlatformAdmin)}><ShieldCheck />{invitation.isPlatformAdmin ? "Remove admin" : "Make admin"}</button>{!invitation.isPlatformAdmin && <button className="button danger compact" onClick={() => removeUser(invitation.id, invitation.email)}><UserMinus />Remove user</button>}</div>}</article>) : <p className="muted-copy">No platform access records yet.</p>}</section>
  </div>;
}
