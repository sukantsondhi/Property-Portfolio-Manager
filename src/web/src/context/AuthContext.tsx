import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setApiOrganization } from "../lib/api";
import type { Organization, User } from "../types";

type AuthState = {
  user: User | null;
  organizations: Organization[];
  organization: Organization | null;
  loading: boolean;
  denied: boolean;
  selectOrganization: (organization: Organization | null) => void;
  refreshSession: () => Promise<void>;
};
const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const selectOrganization = useCallback((value: Organization | null) => {
    setOrganization(value);
    setApiOrganization(value?.id ?? "");
    if (value) localStorage.setItem("ppm.organizationId", value.id);
    else localStorage.removeItem("ppm.organizationId");
  }, []);

  const refreshSession = useCallback(async () => {
    const session = await api.me();
    setUser(session.user);
    setOrganizations(session.organizations);
    const stored = localStorage.getItem("ppm.organizationId");
    const selected = session.organizations.find((item) => item.id === stored) ?? null;
    selectOrganization(selected);
  }, [selectOrganization]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      refreshSession()
        .catch(() => {
          setUser({ userId: "local-developer", email: "developer@localhost", roles: ["authenticated"], isPlatformAdmin: true });
          setOrganizations([]);
        })
        .finally(() => setLoading(false));
      return;
    }
    refreshSession().catch((error) => { if (error?.status === 403) setDenied(true); }).finally(() => setLoading(false));
  }, [refreshSession]);

  return <AuthContext.Provider value={{ user, organizations, organization, loading, denied, selectOrganization, refreshSession }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
