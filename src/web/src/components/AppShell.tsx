import { Archive, BarChart3, Building2, CalendarRange, ChevronLeft, LogOut, Menu, Settings, Shield, SwitchCamera, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { initials } from "../lib/format";

const nav = [
  ["/app", "Overview", BarChart3], ["/app/properties", "Properties", Building2], ["/app/history", "History", CalendarRange], ["/app/finance", "Finance", BarChart3], ["/app/archive", "Archive", Archive], ["/app/organization", "Organisation", Settings],
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { user, organization, selectOrganization } = useAuth();
  const accessLabel = user?.isPlatformAdmin ? "Super admin" : organization?.role === "owner" ? "Owner" : "Editor";
  return <div className="shell"><aside className={`sidebar ${open ? "open" : ""}`}>
    <div className="brand"><div className="brand-mark">PPM</div><div><strong>Property Portfolio Manager</strong><span>Private property portfolios</span></div><button className="icon mobile" onClick={() => setOpen(false)} aria-label="Close menu"><X /></button></div>
    <div className="active-organization"><Building2 /><span><small>Organisation</small><strong>{organization?.name}</strong></span></div>
    <nav>{nav.map(([to, label, Icon], index) => <NavLink key={to} to={to} end={index === 0} onClick={() => setOpen(false)}><Icon size={19} /><span>{label}</span></NavLink>)}{user?.isPlatformAdmin && <NavLink to="/app/admin" onClick={() => setOpen(false)}><Shield size={19} /><span>Platform admin</span></NavLink>}</nav>
    <div className="sidebar-bottom"><a href="/select-organization" className="logout" onClick={() => selectOrganization(null)}><SwitchCamera size={18} />Switch organisation</a><div className="user"><span className="avatar">{initials(user?.email || "PPM")}</span><div><strong>{user?.email?.split("@")[0]}</strong><span>{accessLabel}</span></div></div><a href="/.auth/logout?post_logout_redirect_uri=/login" className="logout"><LogOut size={18} />Sign out</a></div>
  </aside>{open && <button className="scrim" onClick={() => setOpen(false)} aria-label="Close menu" />}<main className="main"><header className="mobile-header"><button className="icon" onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></button><div className="mobile-logo"><span>PPM</span>Property Portfolio Manager</div><ChevronLeft className="ghost" /></header>{children}</main></div>;
}
