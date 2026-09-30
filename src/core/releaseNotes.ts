// What a release says, for the in-app update notice.

/** A release's notes as plain text: GitHub hands them over as HTML, or as a list per version. */
export function notesText(notes: string | { version: string; note: string | null }[] | null | undefined): string | undefined {
  const text = Array.isArray(notes) ? notes.map((n) => n.note ?? '').join('\n\n') : (notes ?? '')
  const plain = text
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return plain || undefined
}
