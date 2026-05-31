/**
 * Brand logo for "גבריאל לוטן מהנדסים — קו מדידה".
 *
 * The mark is a faithful SVG recreation of the concentric-arc survey
 * pin (bullseye center + sweeping teal arcs converging to a point).
 * To use the exact original raster instead, drop the file at
 * public/logo.png and swap <LogoMark/> for <img src="/logo.png" .../>.
 */

export function LogoMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" aria-hidden>
      <defs>
        <linearGradient id="kavTeal" x1="20" y1="10" x2="80" y2="95" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2a7f99" />
          <stop offset="0.5" stopColor="#34a7c4" />
          <stop offset="1" stopColor="#6fdcec" />
        </linearGradient>
      </defs>
      {/* Outer sweeping arcs forming the pin's right shoulder, converging to the bottom tip */}
      <path
        d="M50 6
           C74 6 92 24 92 48
           C92 70 66 88 50 96"
        stroke="url(#kavTeal)"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M50 18
           C66 18 80 30 80 47
           C80 64 60 78 50 84"
        stroke="url(#kavTeal)"
        strokeWidth="6"
        strokeLinecap="round"
        opacity="0.92"
      />
      <path
        d="M50 30
           C59 30 68 37 68 47
           C68 58 56 67 50 71"
        stroke="url(#kavTeal)"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.85"
      />
      {/* Bullseye center */}
      <circle cx="50" cy="47" r="9" stroke="url(#kavTeal)" strokeWidth="4.5" />
      <circle cx="50" cy="47" r="2.6" fill="#2a7f99" />
    </svg>
  );
}

export function LogoFull({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3" dir="rtl">
      <LogoMark className={compact ? "h-9 w-9" : "h-12 w-12"} />
      <div className="leading-tight">
        <div
          className={`font-extrabold tracking-tight text-[#16243f] ${
            compact ? "text-base" : "text-xl"
          }`}
        >
          גבריאל לוטן מהנדסים
        </div>
        <div
          className={`font-medium tracking-[0.35em] text-[#34a7c4] ${
            compact ? "text-[10px]" : "text-xs"
          }`}
        >
          קו מדידה
        </div>
      </div>
    </div>
  );
}
