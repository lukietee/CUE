import { type ProposedAction, type CueSettings } from '../shared/index.ts';
export function checkPolicy(
  action: ProposedAction,
  settings: CueSettings,
  paused: boolean,
  lastActionAt: number,
  now = Date.now(),
): { allowed: boolean; reason: string } {
  if (paused) return { allowed: false, reason: 'Director is paused' };
  if (action.risk !== 'low' || action.requiresApproval)
    return { allowed: false, reason: 'Explicit approval required' };
  if (!['overlay.show', 'overlay.hide', 'director.suggest', 'highlight.mark'].includes(action.type))
    return { allowed: false, reason: 'Action is not preauthorized' };
  if (action.type.startsWith('overlay.') && !settings.overlays)
    return { allowed: false, reason: 'Automatic overlays are disabled' };
  if (now - lastActionAt < settings.cooldownSec * 1000)
    return { allowed: false, reason: 'Action cooldown is active' };
  const text = String(action.args.text ?? '');
  if (
    text.length > 240 ||
    /https?:|\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:api[_ -]?key|password|secret|token)\s*[:=]|\b\d{1,6}\s+\w+(?:\s+\w+)?\s+(?:street|st|avenue|ave|road|rd|lane|ln)\b/i.test(
      text,
    )
  )
    return { allowed: false, reason: 'Overlay failed privacy validation' };
  return { allowed: true, reason: 'Preauthorized low-risk action' };
}
