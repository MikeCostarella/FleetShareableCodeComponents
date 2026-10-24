/**
 * Footer strip showing the Costarella Innovations, LLC copyright (year
 * auto-updates) and when this build was produced — injected at build time via
 * the __BUILD_TIME__ define in vite.config.ts — including the time zone.
 */
export default function BuildStamp() {
  // __BUILD_TIME__ is an ISO string; format it for display, falling back to
  // the raw value if the date can't be parsed for any reason.
  let built = __BUILD_TIME__;
  try {
    built = new Date(__BUILD_TIME__).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    /* keep raw ISO string */
  }

  // Auto-updating copyright year so the notice never goes stale.
  const year = new Date().getFullYear();

  return (
    <div id="footer">
      <span id="copyright">
        &copy; {year} Costarella Innovations, LLC. All rights reserved.
      </span>
      <span id="build-time">Build: {built}</span>
    </div>
  );
}
