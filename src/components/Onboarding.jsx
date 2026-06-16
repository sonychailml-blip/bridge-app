import { useState } from "react";

const TOTAL = 4;

export default function Onboarding({ onDone }) {
  const [index, setIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState(null);
  const last = TOTAL - 1;
  const go = (i) => setIndex(Math.max(0, Math.min(last, i)));

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

          {/* SLIDE 4 — reach out */}
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
