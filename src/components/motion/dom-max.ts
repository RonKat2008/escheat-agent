/**
 * Lazy feature bundle for pages that need layoutId / drag (approvals list, items drawer). Load it through a second
 * LazyMotion boundary: <LazyMotion features={loadDomMax} strict>. Everything else uses domAnimation.
 */
import { domMax } from "motion/react";

export default domMax;
