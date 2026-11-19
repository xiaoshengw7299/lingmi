const EDGE_MIN_CURVE = 48

/** 连线：从 (x1,y1) 到 (x2,y2) 的水平三次贝塞尔曲线，编辑器和只读预览共用 */
export function curve(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(EDGE_MIN_CURVE, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}
