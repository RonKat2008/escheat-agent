"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { ItemLifecycle as ItemLifecycleImpl } from "./item-lifecycle-impl";

/**
 * The Lifecycle block pulls the 3D tunnel, the rail and "Why this date?" into the bundle. It only renders inside the
 * item drawer, so it is a separate chunk: the Items table's first load does not pay for it. Still server-rendered, so
 * a deep link to ?item= arrives with the block in the HTML.
 */
export const ItemLifecycle = dynamic<ComponentProps<typeof ItemLifecycleImpl>>(() => import("./item-lifecycle-impl").then((m) => m.ItemLifecycle));
