export function historyMatches(history, query) {
  const unique = [...new Set([...history].reverse())];
  return unique.filter((text) => text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
}
