/**
 * Line chart with drag-to-read (DECISIONS.md #14): a fund's growth of 100
 * over a range. Hand-built on react-native-svg like the other charts, drawn in
 * a fixed viewBox that scales to the container (no onLayout, so it renders on
 * the first frame on every platform).
 *
 * Dragging a finger (or the mouse) horizontally across the chart moves a marker
 * and reports the nearest point through `onActiveChange`; releasing clears it.
 * Only a mostly-horizontal drag claims the gesture, so scrolling the page
 * vertically over the chart still works.
 */
import { useMemo, useRef } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import { SVG_FONT_FAMILY } from "./svgFont";

export interface LinePoint {
  /** "YYYY-MM" */
  label: string;
  value: number;
}

interface Props {
  points: LinePoint[];
  /** Index of the point being read, or null. Controlled by the parent. */
  activeIndex: number | null;
  onActiveChange: (index: number | null) => void;
  /** A horizontal reference line (e.g. 100, the starting level). */
  baseline?: number;
  axisFormat: (v: number) => string;
  height?: number;
}

const VIEW_W = 340;
const PAD_L = 44;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 22;
const LINE = "#2e6fdb";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2019-03" -> "Mar 19" */
export function shortMonth(label: string): string {
  const [y, m] = label.split("-");
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

export function LineChart({ points, activeIndex, onActiveChange, baseline, axisFormat, height = 200 }: Props) {
  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;

  const values = points.map((p) => p.value);
  const lo = Math.min(...values, ...(baseline === undefined ? [] : [baseline]));
  const hi = Math.max(...values, ...(baseline === undefined ? [] : [baseline]));
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
  const yMin = lo - pad;
  const yMax = hi + pad;

  const last = points.length - 1;
  const x = (i: number) => PAD_L + (last === 0 ? plotW / 2 : (i / last) * plotW);
  const y = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const yTicks = [lo, (lo + hi) / 2, hi];
  const xTicks = [...new Set([0, Math.round(last / 2), last])];

  // Touch handling: measure the view when a drag starts, then map the finger's
  // page x to the nearest point. Refs, not state, so dragging doesn't re-measure.
  const boxRef = useRef<View>(null);
  const box = useRef({ left: 0, width: 1 });
  const lastIndex = useRef<number | null>(null);
  const count = points.length;

  const responder = useMemo(() => {
    const indexAt = (pageX: number) => {
      const viewX = ((pageX - box.current.left) / box.current.width) * VIEW_W;
      const frac = (viewX - PAD_L) / plotW;
      return Math.min(count - 1, Math.max(0, Math.round(frac * (count - 1))));
    };
    const update = (pageX: number) => {
      const i = indexAt(pageX);
      if (i !== lastIndex.current) {
        lastIndex.current = i;
        onActiveChange(i);
      }
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e, g) => {
        boxRef.current?.measureInWindow((left, _top, width) => {
          box.current = { left, width: width || 1 };
          update(g.x0 || e.nativeEvent.pageX);
        });
      },
      onPanResponderMove: (_e, g) => update(g.moveX),
      onPanResponderRelease: () => {
        lastIndex.current = null;
        onActiveChange(null);
      },
      onPanResponderTerminate: () => {
        lastIndex.current = null;
        onActiveChange(null);
      },
    });
  }, [count, plotW, onActiveChange]);

  const active = activeIndex !== null && activeIndex >= 0 && activeIndex < points.length ? activeIndex : null;

  return (
    <View ref={boxRef} style={[styles.wrap, { aspectRatio: VIEW_W / height }]} {...responder.panHandlers}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${height}`}>
        {yTicks.map((t, i) => (
          <Line key={`g${i}`} x1={PAD_L} x2={PAD_L + plotW} y1={y(t)} y2={y(t)} stroke="#eee" strokeWidth={1} />
        ))}
        {yTicks.map((t, i) => (
          <SvgText key={`l${i}`} x={PAD_L - 6} y={y(t) + 3} fontSize={10} fontFamily={SVG_FONT_FAMILY} fill="#777" textAnchor="end">
            {axisFormat(t)}
          </SvgText>
        ))}

        {baseline !== undefined && (
          <Line x1={PAD_L} x2={PAD_L + plotW} y1={y(baseline)} y2={y(baseline)} stroke="#999" strokeWidth={1} strokeDasharray="4,3" />
        )}

        <Path d={path} stroke={LINE} strokeWidth={2} fill="none" strokeLinejoin="round" />

        {active !== null && (
          <>
            <Line x1={x(active)} x2={x(active)} y1={PAD_T} y2={PAD_T + plotH} stroke="#555" strokeWidth={1} />
            <Circle cx={x(active)} cy={y(points[active].value)} r={4.5} fill="#fff" stroke={LINE} strokeWidth={2} />
          </>
        )}

        {xTicks.map((i) => (
          <SvgText
            key={`x${i}`}
            x={x(i)}
            y={height - 6}
            fontSize={10}
            fontFamily={SVG_FONT_FAMILY}
            fill="#777"
            textAnchor={i === 0 && last > 0 ? "start" : i === last && last > 0 ? "end" : "middle"}
          >
            {shortMonth(points[i].label)}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  // userSelect: dragging across the chart must not highlight the axis labels (web).
  wrap: { width: "100%", userSelect: "none" },
});
