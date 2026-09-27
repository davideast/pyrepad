/**
 * CodeMirror 5 remote presence caret widget with a username tooltip.
 */
import { CursorWidgetSeam } from "./types.ts";
import { PresenceWidgetBase } from "./presence-widget-base.ts";

export class PresenceCursorWidget
  extends PresenceWidgetBase
  implements CursorWidgetSeam
{
  constructor(color: string, clientId: string, height: number) {
    super(color, clientId, height, {
      root: "other-client firepad-client-cursor",
      caret: "firepad-client-caret",
      tooltip: "firepad-client-tooltip",
      tooltipVisible: "firepad-tooltip-visible",
      tooltipHidden: "firepad-tooltip-hidden",
    });
  }
}
