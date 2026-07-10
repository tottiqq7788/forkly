type BarPoint = { key: string; label: string; value: number; color?: string };

export function ActivityBarChart({
  series,
  ariaLabel,
}: {
  series: { date: string; count: number }[];
  ariaLabel: string;
}) {
  const max = Math.max(1, ...series.map((d) => d.count));
  const width = 640;
  const height = 180;
  const padL = 28;
  const padR = 8;
  const padT = 12;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const gap = series.length > 20 ? 1 : 2;
  const barW = Math.max(2, (innerW - gap * (series.length - 1)) / series.length);

  const tickIdx = [0, Math.floor((series.length - 1) / 2), series.length - 1].filter(
    (v, i, a) => a.indexOf(v) === i,
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      role="img"
      aria-label={ariaLabel}
    >
      {[0.25, 0.5, 0.75, 1].map((f) => {
        const y = padT + innerH * (1 - f);
        return (
          <line
            key={f}
            x1={padL}
            x2={width - padR}
            y1={y}
            y2={y}
            stroke="var(--color-border)"
            strokeWidth={1}
          />
        );
      })}
      {series.map((d, i) => {
        const h = (d.count / max) * innerH;
        const x = padL + i * (barW + gap);
        const y = padT + innerH - h;
        return (
          <rect
            key={d.date}
            x={x}
            y={y}
            width={barW}
            height={Math.max(d.count > 0 ? 2 : 0, h)}
            rx={1.5}
            fill="var(--color-accent-muted)"
          >
            <title>
              {d.date}: {d.count}
            </title>
          </rect>
        );
      })}
      {tickIdx.map((i) => {
        const d = series[i];
        if (!d) return null;
        const x = padL + i * (barW + gap) + barW / 2;
        return (
          <text
            key={d.date}
            x={x}
            y={height - 8}
            textAnchor="middle"
            className="fill-[var(--color-text-tertiary)]"
            style={{ fontSize: 10 }}
          >
            {d.date.slice(5)}
          </text>
        );
      })}
      <text
        x={padL - 6}
        y={padT + 4}
        textAnchor="end"
        className="fill-[var(--color-text-tertiary)]"
        style={{ fontSize: 10 }}
      >
        {max}
      </text>
    </svg>
  );
}

export function SegmentBar({
  segments,
  ariaLabel,
}: {
  segments: BarPoint[];
  ariaLabel: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div className="space-y-3" role="img" aria-label={ariaLabel}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--color-canvas-subtle)]">
        {total === 0 ? (
          <div className="h-full w-full bg-[var(--color-border)]" />
        ) : (
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <div
                key={s.key}
                className="h-full"
                style={{
                  width: `${(s.value / total) * 100}%`,
                  background: s.color || "var(--color-accent-muted)",
                }}
                title={`${s.label}: ${s.value}`}
              />
            ))
        )}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-2 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: s.color || "var(--color-accent-muted)" }}
            />
            <span className="truncate text-[var(--color-text-secondary)]">{s.label}</span>
            <span className="ml-auto tabular-nums text-[var(--color-text)]">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HorizontalBars({
  items,
  ariaLabel,
}: {
  items: BarPoint[];
  ariaLabel: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5" role="img" aria-label={ariaLabel}>
      {items.map((item) => (
        <li key={item.key} className="grid grid-cols-[88px_1fr_36px] items-center gap-2 text-xs">
          <span className="truncate text-[var(--color-text-secondary)]">{item.label}</span>
          <div className="h-2 rounded-full bg-[var(--color-canvas-subtle)] overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(item.value / max) * 100}%`,
                background: item.color || "var(--color-accent-muted)",
              }}
            />
          </div>
          <span className="text-right tabular-nums text-[var(--color-text)]">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}
