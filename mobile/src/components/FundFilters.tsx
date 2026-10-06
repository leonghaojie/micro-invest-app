/**
 * The search box and asset-class chips above a list of funds (DECISIONS.md #16, #30), with the "Showing x of y"
 * line. State lives in useFundFilter (utils/fundCatalog.ts) so the parent can read the visible funds.
 */
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ASSET_CLASS_LABELS } from "./charts/MixBar";
import type { FundFilter } from "../utils/fundCatalog";

export function FundFilters({ filter, total, note }: { filter: FundFilter; total: number; note?: string }) {
  const { assetClasses, assetFilter, setAssetFilter, search, setSearch, visible } = filter;
  return (
    <View style={styles.wrap}>
      <TextInput
        style={styles.input}
        placeholder={`Search ${total} funds by name or ticker`}
        autoCapitalize="none"
        autoCorrect={false}
        value={search}
        onChangeText={setSearch}
      />
      <View style={styles.row}>
        {[null, ...assetClasses].map((c) => (
          <Pressable key={c ?? "all"} style={[styles.chip, assetFilter === c && styles.chipSelected]} onPress={() => setAssetFilter(c)} accessibilityRole="button">
            <Text style={[styles.chipText, assetFilter === c && styles.chipTextSelected]}>{c === null ? "All" : ASSET_CLASS_LABELS[c] ?? c}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.meta}>
        Showing {visible.length} of {total}
        {note ?? ""}
      </Text>
      {visible.length === 0 && <Text style={styles.meta}>No fund matches. Clear the search or choose another group.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: "#fff" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "#ccc", borderRadius: 16, paddingVertical: 5, paddingHorizontal: 12 },
  chipSelected: { borderColor: "#2e6fdb", backgroundColor: "#eaf1fd" },
  chipText: { color: "#333", fontSize: 13 },
  chipTextSelected: { color: "#2e6fdb", fontWeight: "700" },
  meta: { fontSize: 12, color: "#777" },
});
