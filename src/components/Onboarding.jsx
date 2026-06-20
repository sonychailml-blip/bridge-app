import { useState, useEffect } from "react";

const TOTAL = 5;

export default function Onboarding({ onDone }) {
  const [index, setIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState(null);
  const last = TOTAL - 1;
  const go = (i) => setIndex(Math.max(0, Math.min(last, i)));

  // навигация стрелками на клавиатуре (desktop)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight") setIndex((i) => Math.min(last, i + 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  const onTouchStart = (e) => setTouchStartX(e.touches[0].clientX);
  const onTouchEnd = (e) => {
    if (touchStartX == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (dx < -40) go(index + 1);
    else if (dx > 40) go(index - 1);
    setTouchStartX(null);
  };

  return (
    <div className="onb-overlay">
      {index < last && (
        <button className="onb-skip" onClick={onDone}>skip</button>
      )}

      {index > 0 && (
        <button className="onb-arrow left" onClick={() => go(index - 1)} aria-label="Previous">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" fill="none"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {index < last && (
        <button className="onb-arrow right" onClick={() => go(index + 1)} aria-label="Next">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" fill="none"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      <div className="onb-viewport" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="onb-track" style={{ transform: `translateX(-${index * 100}%)` }}>

          {/* SLIDE 1 — intro */}
          <div className="onb-slide">
            <div className="onb-h">H</div>
            <div className="onb-text">
              Welcome to H.<br />
              Find people through what you believe — not how you look.
            </div>
          </div>

          {/* SLIDE 2 — statements */}
          <div className="onb-slide">
            <div className="onb-graphic onb-stmts">
              {[70, 90, 55].map((w, i) => (
                <div key={i} className="onb-stmt-row">
                  <div className="onb-stmt-line" style={{ width: w + "%" }} />
                  <div className={"onb-stmt-dot" + (i === 1 ? " on" : "")} />
                </div>
              ))}
            </div>
            <div className="onb-text">
              Write statements about yourself.<br />
              Agree with the ones that resonate.
            </div>
          </div>

          {/* SLIDE 3 — overlap (Venn) */}
          <div className="onb-slide">
            <div className="onb-graphic onb-venn">
              <div className="onb-venn-circle" />
              <div className="onb-venn-circle right" />
            </div>
            <div className="onb-text">
              When your agreements overlap with someone’s, you’ve found a connection.
            </div>
          </div>

          {/* SLIDE 4 — profile */}
          <div className="onb-slide">
            <div className="onb-graphic">
              <svg width="58" height="58" viewBox="0 0 58 58" fill="none">
                <circle cx="29" cy="29" r="28" stroke="#111" strokeWidth="1.5" />
                <circle cx="29" cy="24" r="7" stroke="#111" strokeWidth="1.5" />
                <path d="M17 41a12 12 0 0 1 24 0" stroke="#111" strokeWidth="1.5"
                  strokeLinecap="round" />
              </svg>
            </div>
            <div className="onb-text">
              Tap your name, top right.<br />
              That’s your profile — set age and city filters, and find the statements you’ve written.
            </div>
          </div>

          {/* SLIDE 5 — reach out */}
          <div className="onb-slide">
            <div className="onb-graphic">
              <svg width="58" height="58" viewBox="0 0 58 58" fill="none">
                <circle cx="29" cy="29" r="28" stroke="#111" strokeWidth="1.5" />
                <path d="M20 29.5l6 6 12-13" stroke="#111" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="onb-text">Reach out, and take it from there.</div>
            <button className="onb-btn" onClick={onDone}>Got it</button>
          </div>

        </div>
      </div>

      <div className="onb-dots">
        {Array.from({ length: TOTAL }).map((_, i) => (
          <div key={i} className={"onb-pdot" + (i === index ? " on" : "")}
            onClick={() => go(i)} />
        ))}
      </div>
    </div>
  );
}
