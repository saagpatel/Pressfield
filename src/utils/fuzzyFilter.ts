// Case-insensitive subsequence filter for the Cmd+O document palette: a query
// matches a name when its characters appear in order (not necessarily adjacent).
// Input order is preserved, so the most-recently-updated documents stay on top.

function isSubsequence(needle: string, haystack: string): boolean {
	let i = 0;
	for (const ch of haystack) {
		if (i < needle.length && ch === needle[i]) i++;
	}
	return i === needle.length;
}

export function fuzzyFilter<T extends { name: string }>(
	items: T[],
	query: string,
): T[] {
	const q = query.trim().toLowerCase();
	if (q === "") return items;
	return items.filter((item) => isSubsequence(q, item.name.toLowerCase()));
}
