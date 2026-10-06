/**
 * The Dashboard's growth chart (DECISIONS.md #25): the value of what the user holds at each
 * month-end against the money they have put in (bought minus sold). The gap between the two
 * lines is their profit or loss, so the chart shows how the investments did and not just how
 * much was bought. The area between the lines is green while value is above what was put in
 * and red while it is below. A strip underneath shows that profit or loss month by month, so a
 * gap that is small next to the total is still easy to see. Tap a month to read its figures.
 *
 * Hand-built on react-native-svg in a fixed viewBox that scales to the container, as the
 * other charts are.
 */
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Path, Polygon, Rect, Text as SvgText } from "react-native-svg";
import { formatCompactCurrency } from "../../utils/peerFormat";
import { SVG_FONT_FAMILY } from "./svgFont";

export interface GrowthPoint {
  monthDate: string;
  portfolioValue: number;
  /** Money put in so far: bought minus sold. */
  invested: number;
}

interface Props {
  points: GrowthPoint[];
  selected: number;
  onSelect: (index: number) => void;
}

const VIEW_W = 340;
const PAD_L = 46;
const PAD_R = 12;
const PAD_T = 12;
const MAIN_H = 140; // the value and invested lines
const STRIP_GAP = 30; // room for the strip's title between the two
const STRIP_H = 54; // the profit or loss bars
const PAD_B = 22;
const X_INSET = 14; // keeps the first and last bars inside the plot
const VIEW_H = PAD_T + MAIN_H + STRIP_GAP + STRIP_H + PAD_B;
const VALUE_COLOR = "#2e6fdb";
const INVESTED_COLOR = "#777";
const GAIN_FILL = "#d6f2e1";
const LOSS_FILL = "#f9d9d9";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03-01" -> "Mar 2026". */
export function monthLabel(monthDate: string): string {
  const [y, m] = monthDate.slice(0, 7).split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function ValueVsInvestedChart({ points, selected, onSelect }: Props) {
  const height = VIEW_H;
  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = MAIN_H;
  const stripTop = PAD_T + MAIN_H + STRIP_GAP;
  const n = points.length;

  const all = points.flatMap((p) => [p.portfolioValue, p.invested]);
  const rawMin = Math.min(...all, 0);
  const rawMax = Math.max(...all, 1);
  const pad = (rawMax - rawMin) * 0.08;
  const yMin = rawMin === 0 ? 0 : rawMin - pad;
  const yMax = rawMax + pad;

  const x = (i: number) => PAD_L + X_INSET + (n === 1 ? (plotW - 2 * X_INSET) / 2 : (i / (n - 1)) * (plotW - 2 * X_INSET));
  const y = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const valuePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.portfolioValue)}`).join(" ");
  const investedPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.invested)}`).join(" ");

  // Green where value is above what was put in, red where below: split the area at each crossing.
  const areas: { fill: string; pts: string }[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const da = a.portfolioValue - a.invested;
    const db = b.portfolioValue - b.invested;
    if (da === 0 && db === 0) continue;
    const seg = (x0: number, v0: number, i0: number, x1: number, v1: number, i1: number, fill: string) =>
      areas.push({ fill, pts: `${x0},${y(v0)} ${x1},${y(v1)} ${x1},${y(i1)} ${x0},${y(i0)}` });
    if (da * db >= 0) {
      seg(x(i), a.portfolioValue, a.invested, x(i + 1), b.portfolioValue, b.invested, da + db >= 0 ? GAIN_FILL : LOSS_FILL);
    } else {
      // The lines cross inside this month: split there.
      const t = da / (da - db);
      const xc = x(i) + t * (x(i + 1) - x(i));
      const vc = a.portfolioValue + t * (b.portfolioValue - a.portfolioValue);
      const ic = a.invested + t * (b.invested - a.invested);
      seg(x(i), a.portfolioValue, a.invested, xc, vc, ic, da >= 0 ? GAIN_FILL : LOSS_FILL);
      seg(xc, vc, ic, x(i + 1), b.portfolioValue, b.invested, db >= 0 ? GAIN_FILL : LOSS_FILL);
    }
  }

  // Profit or loss per month, on a scale symmetric around zero.
  const profits = points.map((p) => p.portfolioValue - p.invested);
  const maxAbs = Math.max(...profits.map(Math.abs), 1);
  const yProfit = (v: number) => stripTop + STRIP_H / 2 - (v / maxAbs) * (STRIP_H / 2 - 2);
  const barW = Math.min(22, (n > 1 ? (plotW - 2 * X_INSET) / (n - 1) : plotW) * 0.55);

  const yTicks = [yMin, (yMin + yMax) / 2, yMax - pad];
  const xTicks = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  const sel = Number.isFinite(selected) ? Math.min(Math.max(selected, 0), n - 1) : n - 1;
  const step = n > 1 ? (plotW - 2 * X_INSET) / (n - 1) : plotW;

  return (
    <View accessibilityLabel="Value against money invested. Tap a month to see its figures." style={[styles.wrap, { aspectRatio: VIEW_W / height }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${height}`}>
          {yTicks.map((t, i) => (
            <Line key={`g${i}`} x1={PAD_L} x2={PAD_L + plotW} y1={y(t)} y2={y(t)} stroke="#eee" strokeWidth={1} />
          ))}
          {yTicks.map((t, i) => (
            <SvgText key={`l${i}`} x={PAD_L - 6} y={y(t) + 3} fontSize={10} fontFamily={SVG_FONT_FAMILY} fill="#777" textAnchor="end">
              {formatCompactCurrency(t)}
            </SvgText>
          ))}

          {areas.map((a, i) => (
            <Polygon key={`a${i}`} points={a.pts} fill={a.fill} />
          ))}
          {n > 1 && <Path d={investedPath} stroke={INVESTED_COLOR} strokeWidth={1.75} strokeDasharray="5,4" fill="none" />}
          {n > 1 && <Path d={valuePath} stroke={VALUE_COLOR} strokeWidth={2.5} fill="none" />}

          <SvgText x={PAD_L} y={stripTop - 10} fontSize={10} fontFamily={SVG_FONT_FAMILY} fill="#555" fontWeight="bold">
            Profit or loss each month
          </SvgText>
          <Line x1={PAD_L} x2={PAD_L + plotW} y1={yProfit(0)} y2={yProfit(0)} stroke="#ccc" strokeWidth={1} />
          <SvgText x={PAD_L - 6} y={yProfit(0) + 3} fontSize={10} fontFamily={SVG_FONT_FAMILY} fill="#777" textAnchor="end">
            $0
          </SvgText>
          {profits.map((v, i) => (
            <Rect
              key={`b${i}`}
              x={x(i) - barW / 2}
              y={v >= 0 ? yProfit(v) : yProfit(0)}
              width={barW}
              height={Math.max(1.5, Math.abs(yProfit(v) - yProfit(0)))}
              fill={v >= 0 ? "#2e9e5b" : "#d64545"}
              opacity={i === sel ? 1 : 0.55}
            />
          ))}

          <Line x1={x(sel)} x2={x(sel)} y1={PAD_T} y2={PAD_T + plotH} stroke="#bbb" strokeWidth={1} />
          <Circle cx={x(sel)} cy={y(points[sel].invested)} r={3.5} fill={INVESTED_COLOR} />
          <Circle cx={x(sel)} cy={y(points[sel].portfolioValue)} r={4.5} fill={VALUE_COLOR} />

          {xTicks.map((i) => (
            <SvgText key={`x${i}`} x={x(i)} y={height - 6} fontSize={10} fontFamily={SVG_FONT_FAMILY} fill="#777" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
              {monthLabel(points[i].monthDate)}
            </SvgText>
          ))}
        </Svg>
      </View>
      {/* One tap target per month, laid over the chart: no touch coordinates needed, so it behaves the same on every platform. */}
      {points.map((p, i) => (
        <Pressable
          key={p.monthDate}
          onPress={() => onSelect(i)}
          accessibilityRole="button"
          accessibilityLabel={`${monthLabel(p.monthDate)}: show figures`}
          style={[styles.tap, { left: `${((x(i) - step / 2) / VIEW_W) * 100}%`, width: `${(step / VIEW_W) * 100}%` }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  tap: { position: "absolute", top: 0, bottom: 0 },
});
