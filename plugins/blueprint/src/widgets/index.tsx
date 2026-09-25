import React from "react";
import { useBlueprintState } from "../widget-sdk";
export function Question({
  id,
  title,
  options,
  version = 1,
}: {
  id: string;
  title: string;
  options?: string[];
  version?: number;
}) {
  const [value, setValue, confirmed] = useBlueprintState<string>(id, "", {
    type: "question",
    title,
    options: options ?? [],
    version,
  });
  return (
    <section data-block-id={id} className="widget">
      <label htmlFor={id}>
        <strong>{title}</strong>
      </label>
      {options && (
        <div className="options">
          {options.map((option) => (
            <button
              key={option}
              aria-pressed={value === option}
              onClick={() => setValue(option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      <textarea
        id={id}
        aria-label={title}
        value={value}
        placeholder="Ответ или свой вариант"
        onChange={(e) => setValue(e.target.value)}
      />
      {!confirmed && (
        <button onClick={() => setValue(value)}>
          Вопрос изменился — подтвердить ответ
        </button>
      )}
    </section>
  );
}
export function Comparison({
  id,
  columns,
  rows,
}: {
  id: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <section data-block-id={id} className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
export function Checklist({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: string[];
}) {
  const [selected, setSelected, confirmed] = useBlueprintState(
    id,
    [] as string[],
    { type: "checklist", title, items },
  );
  return (
    <section data-block-id={id} className="widget">
      <strong>{title}</strong>
      {items.map((item) => (
        <label key={item} className="check">
          <input
            type="checkbox"
            checked={selected.includes(item)}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? [...selected, item]
                  : selected.filter((v) => v !== item),
              )
            }
          />
          {item}
        </label>
      ))}
      {!confirmed && (
        <button onClick={() => setSelected(selected)}>
          Подтвердить изменённый список
        </button>
      )}
    </section>
  );
}
export function Diagram({
  id,
  nodes,
  edges = [],
}: {
  id: string;
  nodes: { id: string; label: string }[];
  edges?: [string, string][];
}) {
  return (
    <figure data-block-id={id} className="diagram">
      <svg
        viewBox={`0 0 640 ${Math.max(100, nodes.length * 90)}`}
        role="img"
        aria-label={nodes.map((n) => n.label).join(", ")}
      >
        {edges.map(([a, b], i) => {
          const ai = nodes.findIndex((n) => n.id === a),
            bi = nodes.findIndex((n) => n.id === b);
          return ai < 0 || bi < 0 ? null : (
            <path
              key={i}
              d={`M 320 ${ai * 90 + 55} L 320 ${bi * 90 + 15}`}
              stroke="currentColor"
            />
          );
        })}
        {nodes.map((n, i) => (
          <g key={n.id}>
            <rect
              x="120"
              y={i * 90 + 15}
              width="400"
              height="40"
              rx="8"
              fill="var(--surface)"
              stroke="currentColor"
            />
            <text
              x="320"
              y={i * 90 + 41}
              textAnchor="middle"
              fill="currentColor"
            >
              {n.label}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
export function Image({
  id,
  src,
  alt,
}: {
  id: string;
  src: string;
  alt: string;
}) {
  return (
    <figure data-block-id={id}>
      <img src={src} alt={alt} />
      <figcaption>{alt}</figcaption>
    </figure>
  );
}
export function Custom({
  id,
  children,
  size = "compact",
}: {
  id: string;
  size?: "compact" | "standard" | "wide";
  children: React.ReactNode;
}) {
  return <section data-block-id={id} className="custom" data-size={size}>{children}</section>;
}
