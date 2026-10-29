/**
 * Condenses one known-benign `next dev` log block: when the replica layout deliberately calls notFound() for a bad
 * portal slug, Next's dev-only "instant" validation prints a multi-line stack for the handled 404. Those blocks
 * (and only those: they must carry the NEXT_HTTP_ERROR_FALLBACK;404 digest) become one line. Everything else,
 * including any other error block, passes through untouched.
 */
export const CONDENSED_LINE = "[e2e] expected: replica 404 for an unknown portal slug (dev instant-validation stack suppressed)";

const BLOCK_START = /^Error: (Route ".*": Could not validate `instant`|An error occurred while attempting to validate instant UI)/;
const BLOCK_BODY = /^(\s|Error:|>|\}$|$)/;

export function createDevLogFilter(write: (line: string) => void) {
  let buf: string[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    if (buf.some((l) => l.includes("NEXT_HTTP_ERROR_FALLBACK;404"))) write(CONDENSED_LINE);
    else buf.forEach(write);
    buf = [];
  };
  return {
    line(l: string) {
      if (buf.length === 0) {
        if (BLOCK_START.test(l)) buf.push(l);
        else write(l);
        return;
      }
      if (!BLOCK_BODY.test(l)) {
        flush();
        write(l);
        return;
      }
      buf.push(l);
      if (l === "}") flush();
    },
    end: flush,
  };
}
