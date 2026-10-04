/**
 * Monthly-return bars (DECISIONS.md #14): one bar per month, green above zero
 * and red below, around a zero line. Shows at a glance how bumpy a fund's
 * ride has been. Hand-built on react-native-svg in a fixed viewBox.
 */
import { StyleSheet, View } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";
import { shortMonth } from "./LineChart";
import { SVG_FONT_FAMILY } from "./svgFont";

export interface BarPoint {
  /** "YYYY-MM" */
  label: string;
  /** Percent, e.g. 1.25 */
  value: number;
}

interface Props {
  points: BarPoint[];
  height?: number;
}

const VIEW_W = 340;
const PAD_X = 8;
const PAD_T = 8;
const PAD_B = 20;
const UP = "#2e8b57";
const DOWN = "#c0392b";

export function ReturnBars({ points, height = 120 }: Props) {
  const plotW = VIEW_W - PAD_X * 2;
  const plotH = height - PAD_T - PAD_B;
  const maxAbs = Math.max(...points.map((p) => Math.abs(p.value)), 0.01);
  const zeroY = PAD_T + plotH / 2;
  const half = plotH / 2;
  const slot = plotW / points.length;
  const barW = Math.max(slot - 1, 0.8);

  return (
    <View style={[styles.wrap, { aspectRatio: VIEW_W / height }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${height}`}>
        {points.map((p, i) => {
          const h = Math.max((Math.abs(p.value) / maxAbs) * half, 0.5);
          const bx = PAD_X + i * slot + (slot - barW) / 2;
          return <Rect key={p.label} x={bx} y={p.value >= 0 ? zeroY - h : zeroY} width={barW} height={h} fill={p.value >= 0 ? UP : DOWN} />;
        })}
        <Line x1={PAD_X} x2={PAD_X + plotW} y1={zeroY} y2={zeroY} stroke="#999" strokeWidth={1} />
        <SvgText x={PAD_X} y={height - 5} fontSize={10} fontFamily={SVG_FONT_FAMILY} fill="#777" textAnchor="start">
          {shortMonth(points[0].label)}
        </SvgText>
        <SvgText x={PAD_X + plotW} y={height - 5} fontSize={10} fontFamily={SVG_FONT_FAMILY} fill="#777" textAnchor="end">
          {shortMonth(points[points.length - 1].label)}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
});
