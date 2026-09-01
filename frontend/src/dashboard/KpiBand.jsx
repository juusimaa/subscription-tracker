// Four figures across the page, separated by hairlines. Each one answers a
// question the headline total cannot: what is about to leave the account, how
// many charges there are, which is the biggest, and which way the trend went.

function KpiBand({ cells }) {
  return (
    <section aria-label="Key figures" className="kpis">
      {cells.map((cell) => (
        <div className="kpi" key={cell.label}>
          <p className="kpi-figure">{cell.figure}</p>
          <p className="kpi-label">{cell.label}</p>
        </div>
      ))}
    </section>
  );
}

export default KpiBand;
