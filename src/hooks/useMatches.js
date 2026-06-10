import { useState, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";

export function useMatches(user, useLocation) {
  const [matches, setMatches] = useState([]);
  const [newMatchDot, setNewMatchDot] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchMatches = useCallback(async () => {
    console.log("fetchMatches called, user:", user?.uid);
    if (!user) return;
    setLoading(true);
    try {
      const functions = getFunctions(undefined, "europe-west1");
      const getMatchesFn = httpsCallable(functions, "getMatches");
      const result = await getMatchesFn({ useLocation });
      console.log("getMatches result:", JSON.stringify(result.data));
      const computed = result.data.matches || [];
      setMatches(prev => {
        if (computed.length > prev.length && prev.length > 0) setNewMatchDot(true);
        return computed;
      });
    } catch (e) {
      console.error("getMatches error:", e);
    } finally {
      setLoading(false);
    }
  }, [user, useLocation]);

  return { matches, setMatches, newMatchDot, setNewMatchDot, loading, fetchMatches };
}
