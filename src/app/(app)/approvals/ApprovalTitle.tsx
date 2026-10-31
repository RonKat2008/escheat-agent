import { Fragment } from "react";

/**
 * "Mail due-diligence letter · Ravenhill Cabinetry". The separator is glued to the text before it with a
 * no-break space, so a wrap always happens after the dot and the second line starts with the payee, never "·".
 */
export function ApprovalTitle({ title }: { title: string }) {
  const parts = title.split(" · ").filter(Boolean);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 ? (
            <>
              {" "}
              <span className="font-normal text-fg-3">·</span>{" "}
            </>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}
