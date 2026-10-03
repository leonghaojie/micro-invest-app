/**
 * Histogram of peer values (DECISIONS.md #9), hand-built on react-native-svg.
 *
 * Bins arrive from the server already privacy-safe (any bin of 1–2 people is
 * merged into a neighbour), so they can have UNEQUAL widths. Bar height is
 * therefore *density* (people per unit of value), not raw count — otherwise a
 * merged, wider bin would look misleadingly tall.
 *
 * Marked on the axis: the 25th / median / 75th percentiles (dashed), and the
 * user's own value ("You"). Values beyond the 5th–95th percentile are grouped
 * into the end bins on the server, so the axis ends are labelled ≤ and ≥.
 *
 * Drawn in a fixed viewBox that scales to the container, rather than
 * measuring the container with onLayout: it renders immediately on every
 * platform (no blank first frame, no dependence on layout events).
 */
import { StyleSheet, View } from "react-native";
import Svg, { Line, Polygon, Rect, Text as SvgText } from "react-native-svg";
import { SVG_FONT_FAMILY } from "./svgFont";

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

interface Props {
  bins: HistogramBin[];
  p25: number;
  p50: number;
  p75: number;
  mine: number | null;
  axisFormat: (v: number) => string;
  height?: number;
}

const VIEW_W = 340;
const PAD_X = 8;
const PAD_TOP = 18; // room for the "You" label
const AXIS_H = 18;

export function Histogram({ bins, p25, p50, p75, mine, axisFormat, height = 170 }: Props) {
  const lo = bins[0].from;
  const hi = bins[bins.length - 1].to;
  const span = hi - lo || 1;
  const plotW = VIEW_W - PAD_X * 2;
  const plotH = height - PAD_TOP - AXIS_H;
  const baseY = PAD_TOP + plotH;

  const x = (v: number) => PAD_X + ((Math.min(hi, Math.max(lo, v)) - lo) / span) * plotW;

  const densities = bins.map((b) => b.count / Math.max(b.to - b.from, 1e-9));
  const maxDensity = Math.max(...densities, 1e-9);

  const mineX = mine === null ? null : x(mine);
  const mineClamped = mine !== null && (mine < lo || mine > hi);

  // Keep the "You" label inside the chart: near an edge, grow the text inward
  // from the marker instead of centring it (which would clip it).
  const EDGE = 60;
  const youAnchor: "start" | "middle" | "end" = mineX === null ? "middle" : mineX < EDGE ? "start" : mineX > VIEW_W - EDGE ? "end" : "middle";
  const youLabelX = mineX === null ? 0 : youAnchor === "start" ? Math.max(mineX - 5, 2) : youAnchor === "end" ? Math.min(mineX + 5, VIEW_W - 2) : mineX;

  return (
    <View style={[styles.wrap, { aspectRatio: VIEW_W / height }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${height}`}>
        {bins.map((b, i) => {
          const barH = (densities[i] / maxDensity) * plotH;
          const bx = x(b.from);
          const bw = Math.max(x(b.to) - bx - 1.5, 1);
          return <Rect key={i} x={bx} y={baseY - barH} width={bw} height={barH} rx={2} fill="#9db8ec" />;
        })}

        {[p25, p50, p75].map((p, i) => (
          <Line
            key={i}
            x1={x(p)}
            x2={x(p)}
            y1={PAD_TOP}
            y2={baseY}
            stroke="#555"
            strokeWidth={i === 1 ? 1.5 : 1}
            strokeDasharray={i === 1 ? undefined : "3,3"}
          />
        ))}
        <SvgText x={x(p50)} y={PAD_TOP - 5} fontSize={10} fontFamily={SVG_FONT_FAMILY} fill="#555" textAnchor="middle">
          median
        </SvgText>

        {mineX !== null && (
          <>
            <Line x1={mineX} x2={mineX} y1={PAD_TOP} y2={baseY} stroke="#2e6fdb" strokeWidth={2.5} />
            <Polygon points={`${mineX - 5},${PAD_TOP - 2} ${mineX + 5},${PAD_TOP - 2} ${mineX},${PAD_TOP + 6}`} fill="#2e6fdb" />
            <SvgText
              x={youLabelX}
              y={PAD_TOP - 6}
              fontSize={11}
              fontWeight="bold"
              fontFamily={SVG_FONT_FAMILY}
              fill="#2e6fdb"
              textAnchor={youAnchor}
            >
              {mineClamped ? "You (off scale)" : "You"}
            </SvgText>
          </>
        )}

        <Line x1={PAD_X} x2={PAD_X + plotW} y1={baseY} y2={baseY} stroke="#ccc" strokeWidth={1} />
        <SvgText x={PAD_X} y={height - 4} fontSize={10} fontFamily={SVG_FONT_FAMILY} fill="#777" textAnchor="start">
          {`≤ ${axisFormat(lo)}`}
        </SvgText>
        <SvgText x={PAD_X + plotW} y={height - 4} fontSize={10} fontFamily={SVG_FONT_FAMILY} fill="#777" textAnchor="end">
          {`≥ ${axisFormat(hi)}`}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
});
