import { useEffect, useState } from "react";
import { getStudentHome, type StudentHome } from "../../lib/api";

export function useStudentHome(refreshKey = 0) {
  const [home, setHome] = useState<StudentHome | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setHome(null);
    setError(false);

    void getStudentHome()
      .then((data) => {
        if (!active) return;
        setHome(data);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
      });

    return () => {
      active = false;
    };
  }, [refreshKey]);

  return { home, error };
}
