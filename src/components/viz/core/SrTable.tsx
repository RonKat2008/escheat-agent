import type { ReactNode } from "react";

export interface SrTableProps {
  caption: string;
  columns: string[];
  rows: ReactNode[][];
}

/** Visually hidden data table: the accessible twin of a diagram. */
export function SrTable({ caption, columns, rows }: SrTableProps) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((cell, j) => (j === 0 ? (
              <th key={j} scope="row">
                {cell}
              </th>
            ) : (
              <td key={j}>{cell}</td>
            )))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
