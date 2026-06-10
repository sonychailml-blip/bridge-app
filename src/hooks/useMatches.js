import { useState, useEffect } from "react";

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLng = (lng2-lng1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

export function useMatches(clicked, allUsers, useLocation, savedLocation) {
  const [matches, setMatches] = useState([]);
  const [newMatchDot, setNewMatchDot] = useState(false);
  const [prevMatchCount, setPrevMatchCount] = useState(0);

  useEffect(() => {
    if (clicked.size === 0) { setMatches([]); return; }
    const computed = allUsers
      .filter(u => !u.blocked)
      .map(u => {
        const uc = new Set(u.clicked || []);
        const common = [...clicked].filter(id => uc.has(id));
        let distKm = null;
        if (useLocation && savedLocation && u.location) {
          distKm = getDistanceKm(savedLocation.lat, savedLocation.lng, u.location.lat, u.location.lng);
        }
        return { ...u, common: common.length, commonIds: common, distKm };
      })
      .filter(u => u.common > 0)
      .sort((a, b) => {
        if (useLocation && a.distKm !== null && b.distKm !== null) {
          const scoreA = a.common * 10 - (a.distKm || 0) * 0.01;
          const scoreB = b.common * 10 - (b.distKm || 0) * 0.01;
          return scoreB - scoreA;
        }
        return b.common - a.common;
      });
    setMatches(computed);
    if (computed.length > prevMatchCount && prevMatchCount > 0) {
      setNewMatchDot(true);
    }
    setPrevMatchCount(computed.length);
  }, [clicked, allUsers, useLocation, savedLocation]);

  return { matches, setMatches, newMatchDot, setNewMatchDot };
}
