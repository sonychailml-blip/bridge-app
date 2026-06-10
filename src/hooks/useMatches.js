import { useState, useEffect } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";

export function useMatches(user, clicked, useLocation, savedLocation) {
  const [matches, setMatches] = useState([]);
  const [newMatchDot, setNewMatchDot] = useState(false);
  const [prevMatchCount, setPrevMatchCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user || clicked.size === 0) { setMatches([]); return; }

    const fetchMatches = async () => {
      setLoading(true);
      try {
        const functions = getFunctions(undefined, "europe-west1");
        const getMatches = httpsCallable(functions, "getMatches");
        const result = await getMatches({ useLocation });
        console.log("getMatches result:", JSON.stringify(result.data));
        const computed = result.data.matches;
        setMatches(computed);
        if (computed.length > prevMatchCount && prevMatchCount > 0) {
          setNewMatchDot(true);
        }
        setPrevMatchCount(computed.length);
      } catch (e) {
        console.error("getMatches error:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchMatches();
  }, [clicked, useLocation, savedLocation, user]);

  return { matches, setMatches, newMatchDot, setNewMatchDot, loading };
}
