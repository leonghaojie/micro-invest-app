/**
 * Trajectory chart (DECISIONS.md #9): the peer median and 25th–75th
 * percentile band by months since the plan started, with the user's own
 * line on top. Hand-built on react-native-svg.
 *
 * The server only returns months where at least MIN_GROUP_SIZE peers have a
 * figure, so the band naturally stops where the peer sample thins out.
 *
 * Drawn in a fixed viewBox that scales to the container (no onLayout), so it
 * renders immediately on every platform.
 */
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Path, Polygon, Text as SvgText } from "react-native-svg";
import { SVG_FONT_FAMILY } from "./svgFont";

export interface TrajectoryPoint {
  k: number;
  p25: number;
  p50: number;
  p75: number;
  mine: number | null;
}

interface Props {
  points: TrajectoryPoint[];
  axisFormat: (v: number) => string;
  height?: number;
}

const VIEW_W = 340;
const PAD_L = 44;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 22;

export function BandChart({ points, axisFormat, height = 190 }: Props) {
  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;

  const values = points.flatMap((p) => [p.p25, p.p75, ...(p.mine === null ? [] : [p.mine])]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = (rawMax - rawMin || Math.abs(rawMax) || 1) * 0.08;
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;

  const kMin = points[0].k;
  const kMax = points[points.length - 1].k;
  const x = (k: number) => PAD_L + (kMax === kMin ? plotW / 2 : ((k - kMin) / (kMax - kMin)) * plotW);
  const y = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const upper = points.map((p) => `${x(p.k)},${y(p.p75)}`);
  const lower = [...points].reverse().map((p) => `${x(p.k)},${y(p.p25)}`);
  const medianPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.k)},${y(p.p50)}`).join(" ");

  const mine = points.filter((p) => p.mine !== null);
  const minePath = mine.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.k)},${y(p.mine as number)}`).join(" ");

  const yTicks = [yMin + pad, (yMin + yMax) / 2, yMax - pad];
  const xTicks = [...new Set([kMin, Math.round((kMin + kMax) / 2), kMax])];

  return (
    <View style={[styles.wrap, { aspectRatio: VIEW_W / height }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${height}`}>
        {yTicks.map((t, i) => (
          <Line key={`g${i}`} x1={PAD_L} x2={PAD_L + plotW} y1={y(t)} y2={y(t)} stroke="#eee" strokeWidth={1} />
        ))}
        {yTicks.map((t, i) => (
          <SvgText key={`l${i}`} x={PAD_L - 6} y={y(t) + 3} fontSize={10} fontFamily={SVG_FONT_FAMILY} fill="#777" textAnchor="end">
            {axisFormat(t)}
          </SvgText>
        ))}

        <Polygon points={[...upper, ...lower].join(" ")} fill="#cddcf7" />
        <Path d={medianPath} stroke="#555" strokeWidth={1.5} fill="none" />

        {mine.length > 1 && <Path d={minePath} stroke="#2e6fdb" strokeWidth={2.5} fill="none" />}
        {mine.map((p) => (
          <Circle key={p.k} cx={x(p.k)} cy={y(p.mine as number)} r={mine.length === 1 ? 5 : 3} fill="#2e6fdb" />
        ))}

        {xTicks.map((k) => (
          <SvgText key={`x${k}`} x={x(k)} y={height - 6} fontSize={10} fontFamily={SVG_FONT_FAMILY} fill="#777" textAnchor="middle">
            {`M${k}`}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
});
