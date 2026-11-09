import { NavHold } from "@/components/shell/NavHold";
import { AskSkeleton } from "./skeleton";

export default function Loading() {
  return (
    <NavHold>
      <AskSkeleton />
    </NavHold>
  );
}
