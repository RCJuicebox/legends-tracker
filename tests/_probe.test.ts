import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { IconSource } from '../src/main/icons'
it('probe', async () => {
  const src = new IconSource(() => 'E:/Daybreak Game Company/Installed Games/EverQuest Legends')
  for (const n of [971, 616, 658]) { const png = await src.itemPng(n); writeFileSync(`C:/Users/Dan/AppData/Local/Temp/claude/E--Claude-Projects-EQL/a0c02f52-60a9-4a20-81c6-e3d59e23abfc/scratchpad/icon${n}.png`, png!); console.log(n, png?.length) }
})
