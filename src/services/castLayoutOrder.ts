import { CastLayout } from '../types.ts';

/** Default swipe order for cycling through kiosk layouts on touch — used
 * whenever CastSettings.layoutOrder is unset, and as the base list the Cast
 * Designer's enable/reorder checklist starts from. */
export const DEFAULT_LAYOUT_ORDER: CastLayout[] = ['kiosk_touch', 'artwork_focus', 'audiophile_spectrum', 'ambient_clock', 'custom_design'];

/** Effective swipe order: castSettings.layoutOrder when it lists at least one
 * layout, otherwise every layout in DEFAULT_LAYOUT_ORDER — so clearing the
 * list (or disabling every layout in the editor) can never strand the
 * carousel, or the Cast Designer's "start layout" picker, with nothing to
 * choose from. */
export function getEnabledLayoutOrder(layoutOrder: CastLayout[] | undefined): CastLayout[] {
  return layoutOrder && layoutOrder.length ? layoutOrder : DEFAULT_LAYOUT_ORDER;
}
