import { AuthProvider } from "../features/auth/AuthContext";
import { Router } from "../routes/Router";

export function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
