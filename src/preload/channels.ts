import { isInvokeChannel, isPushChannel, isSendChannel } from '../shared/ipc'

// Pages reach the main process only through the channels the contract in shared/ipc.ts names, each
// used the one way it is declared: invoked, sent, or listened to.

export type ChannelUse = 'invoke' | 'send' | 'on'

export function channelAllowed(channel: unknown, use: ChannelUse): boolean {
  return use === 'invoke' ? isInvokeChannel(channel) : use === 'send' ? isSendChannel(channel) : isPushChannel(channel)
}
