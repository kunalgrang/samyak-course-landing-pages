import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSession, logout, type SessionResponse } from "../../lib/api";

type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  session: SessionResponse | null;
  refreshSession: () => Promise<void>;
  setAuthenticatedSession: (session: SessionResponse) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function refreshSession() {
    setIsLoading(true);
    try {
      const next = await getSession();
      setSession(next.authenticated ? next : null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshSession();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: Boolean(session?.authenticated),
      isLoading,
      session,
      refreshSession,
      setAuthenticatedSession: (nextSession) => setSession(nextSession.authenticated ? nextSession : null),
      signOut: async () => {
        await logout().catch(() => undefined);
        setSession(null);
      },
    }),
    [isLoading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
