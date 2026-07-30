import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSession, logout, type SessionResponse } from "../../lib/api";

export type SessionRefreshResult =
  | { status: "authenticated"; session: SessionResponse }
  | { status: "unauthenticated"; message?: string }
  | { status: "error" };

type AuthState = {
  session: SessionResponse | null;
  hasSessionError: boolean;
  sessionMessage: string | null;
};

type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  hasSessionError: boolean;
  sessionMessage: string | null;
  session: SessionResponse | null;
  refreshSession: () => Promise<SessionRefreshResult>;
  setAuthenticatedSession: (session: SessionResponse) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasSessionError, setHasSessionError] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

  async function refreshSession(): Promise<SessionRefreshResult> {
    setIsLoading(true);
    setHasSessionError(false);
    try {
      const next = await getSession();
      const state = applySessionRefreshSuccess(next);
      setSession(state.session);
      setHasSessionError(state.hasSessionError);
      setSessionMessage(state.sessionMessage);
      return next.authenticated ? { status: "authenticated", session: next } : { status: "unauthenticated", message: next.message };
    } catch {
      setHasSessionError(true);
      return { status: "error" };
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
      hasSessionError,
      sessionMessage,
      session,
      refreshSession,
      setAuthenticatedSession: (nextSession) => {
        setSession(nextSession.authenticated ? nextSession : null);
        setHasSessionError(false);
        setSessionMessage(null);
      },
      signOut: async () => {
        await logout().catch(() => undefined);
        setSession(null);
        setHasSessionError(false);
        setSessionMessage(null);
      },
    }),
    [hasSessionError, isLoading, session, sessionMessage],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function applySessionRefreshSuccess(nextSession: SessionResponse): AuthState {
  return {
    session: nextSession.authenticated ? nextSession : null,
    hasSessionError: false,
    sessionMessage: nextSession.authenticated ? null : nextSession.message || null,
  };
}

export function applySessionRefreshError(previous: AuthState): AuthState {
  return {
    ...previous,
    hasSessionError: true,
  };
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
