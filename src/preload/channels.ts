// Pages reach the main process only through these channel families: `family:name`, plus the one
// channel without a family, `simulate`.
export const ALLOWED_CHANNEL =
  /^(?:simulate$|(?:app|settings|character|watch|triggers|spells|focus|motes|stock|update|logs|overlays|overlay|audio|dialog|game|achievements|inventory|stats|gear|combat|state):[A-Za-z0-9]+$)/

export function channelAllowed(channel: unknown): boolean {
  return typeof channel === 'string' && ALLOWED_CHANNEL.test(channel)
}
