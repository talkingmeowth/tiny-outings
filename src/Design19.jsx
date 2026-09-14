// Design 19: code-native marks; no remote artwork or animation to load.
export function FamilyMark() {
  return <svg className="family-mark" viewBox="0 0 100 82" fill="none" aria-hidden="true">
    <circle cx="34" cy="12" r="8" fill="currentColor" />
    <circle cx="76" cy="29" r="7" className="family-mark-child" />
    <path d="M12 72C-2 28 59 12 57 72M55 72C53 40 96 37 92 72" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
  </svg>;
}

export function Design19Brand() {
  return <span className="design19-brand"><FamilyMark /><span className="design19-wordmark">Tiny<br />Outings</span></span>;
}

export function OutlineIcon({ name }) {
  const paths = {
    start: <path d="M5 5h14v15H5zM8 3v4m8-4v4M5 10h14M9 14h6m-6 3h4" />,
    swipe: <><rect x="6" y="4" width="12" height="16" rx="3" /><path d="m3 10-2 2 2 2m18-4 2 2-2 2M10 11l2 2 2-2" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18m-14 4h2m3 0h2m3 0h1m-11 3h2m3 0h2" /></>,
    map: <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16" />,
    add: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M7 12h10" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    review: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="m8 12 3 3 5-6" /></>,
    search: <><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></>,
    heart: <path d="M12 20 4 12C-3 4 8 0 12 7c4-7 15-3 8 5Z" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  };
  return <svg className="outline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.start}</svg>;
}

export function LondonLandmarks() {
  return <svg className="london-landmarks" viewBox="0 0 340 90" fill="none" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M10 83V30h24v53M13 30V20h18v10M16 20l6-16 6 16M22 4V0" fill="currentColor" />
      <circle cx="22" cy="43" r="8" className="landmark-clock" stroke="none" />
      <path d="M22 38v6h4" className="landmark-clock-hand" />
      <circle cx="81" cy="43" r="28" /><path d="M81 15v56M53 43h56M61 23l40 40m0-40L61 63M81 43 67 83m14-40 14 40M62 83h38" />
      <path d="M60 22 56 18m25-3V9m20 13 5-4m3 25h6m-62 0h-6m13 21-4 4m45-4 5 4" />
    </g>
    <g className="landmark-bus">
      <rect x="123" y="38" width="50" height="38" rx="5" fill="currentColor" />
      <path d="M130 45h7v8h-7zm13 0h7v8h-7zm13 0h9v8h-9zm-26 15h7v8h-7zm13 0h7v8h-7zm13 0h9v13h-9z" className="landmark-cutout" />
      <circle cx="134" cy="78" r="5" className="landmark-wheel" /><circle cx="163" cy="78" r="5" className="landmark-wheel" />
    </g>
    <g stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M186 79h58M194 79V49h8v30m24 0V49h8v30M193 49l5-13 5 13m22 0 5-13 5 13M202 58h24m-24 7q12-18 24 0M185 71l9-12m40 0 10 12" />
      <circle cx="263" cy="32" r="5" fill="currentColor" />
      <path d="M255 60V48a8 8 0 0 1 16 0v12m-11-8v30m6-30v30" strokeWidth="4" strokeLinecap="round" />
      <path d="m280 53 7 0 6 22h33l7-19h-43" />
      <path d="M295 54a18 18 0 0 1 18-18v18Z" className="landmark-clock" stroke="none" />
      <circle cx="299" cy="83" r="4" /><circle cx="323" cy="83" r="4" />
    </g>
  </svg>;
}

export function Design19Welcome({ onComplete }) {
  return <main className="design19-welcome" aria-labelledby="onboarding-title">
    <Design19Brand />
    <h1 id="onboarding-title">Welcome to<br />your London.</h1>
    <div className="design19-intro">
      <p>Activities for babies to older children.</p>
      <p>All parents &amp; carers. Parental leave &amp; beyond.</p>
    </div>
    <LondonLandmarks />
    <ol className="design19-tour">
      <li><span className="tour-icon"><OutlineIcon name="search" /></span><div><strong>Find your next outing</strong><p>Choose an age, area and day.</p></div></li>
      <li><span className="tour-icon"><OutlineIcon name="heart" /></span><div><strong>Swipe your favourites</strong><p>Right to save. Left to skip.</p></div></li>
      <li><span className="tour-icon"><OutlineIcon name="calendar" /></span><div><strong>Make a little plan</strong><p>Explore the map and your week.</p></div></li>
    </ol>
    <button className="design19-explore" type="button" onClick={onComplete}>Let’s explore <OutlineIcon name="arrow" /></button>
  </main>;
}
