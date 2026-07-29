import { useEffect, useState } from "react";
import { getReferralDashboard, type ReferralDashboard } from "../../lib/api";

export function useReferralDashboard(refreshKey = 0) {
  const [dashboard, setDashboard] = useState<ReferralDashboard | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setDashboard(null);
    setError(false);

    void getReferralDashboard()
      .then((data) => {
        if (!active) return;
        setDashboard(data);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
      });

    return () => {
      active = false;
    };
  }, [refreshKey]);

  return { dashboard, error };
}
