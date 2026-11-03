// Barrel: no "use client" here; each client component carries its own directive.
export * from "./scales";
export * from "./palette";
export * from "./render-tier";
export { useRenderTier, readMotionPref, setMotionPref, reportLowFps, MOTION_CHANGE_EVENT } from "./useRenderTier";
export { useInViewport } from "./useInViewport";
export { GlowFilter } from "./GlowFilter";
export { FlowParticles, MAX_PARTICLES, type FlowParticlesProps } from "./FlowParticles";
export { VizTooltip, type VizTooltipProps } from "./VizTooltip";
export { SrTable, type SrTableProps } from "./SrTable";
export { Stage3D, type Stage3DProps } from "./Stage3D";
export { LazyCanvas, type LazyCanvasProps, type CanvasSceneProps } from "./LazyCanvas";
export * from "./lifecycle-model";
export { LifecycleRail, type LifecycleRailProps, type LifecycleVariant } from "./LifecycleRail";
export { StageTrack, type StageTrackProps, type StageTrackStage, type StageState } from "./StageTrack";
export { SourceChain, type SourceChainProps, type SourceChainSource } from "./SourceChain";
