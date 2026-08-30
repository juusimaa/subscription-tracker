// The little brand tile shown beside a known service, in the name dropdown
// and in the table. Its own file because Vite's fast refresh only works on
// modules that export components and nothing else -- keeping it next to the
// SERVICES data would silently cost hot-reloading on every edit to either.

// One generic tile for every service: a rounded square in the brand colour
// with the monogram centred on it. Longer marks get a smaller font so "HBO"
// fits the same box as "N".
function ServiceIcon({ service, size = 20 }) {
  const fontSize = [14, 11, 8][Math.min(service.mark.length, 3) - 1];
  return (
    <svg
      className="service-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      // The name is always rendered as text beside this, so announcing the
      // icon too would just make a screen reader say it twice.
      aria-hidden="true"
    >
      <rect width="24" height="24" rx="6" fill={service.color} />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="system-ui, sans-serif"
        fontSize={fontSize}
        fontWeight="700"
        fill="#fff"
      >
        {service.mark}
      </text>
    </svg>
  );
}

export default ServiceIcon;
