import Decimal from "decimal.js";
export const D = Decimal.clone({ precision: 40 });
export const floor = (value: Decimal.Value, step: Decimal.Value) =>
  new D(value).div(step).floor().mul(step);
export const ceil = (value: Decimal.Value, step: Decimal.Value) =>
  new D(value).div(step).ceil().mul(step);
export const lossLimit = (equity: string, baseline: string, limit: string) =>
  new D(equity).lte(new D(baseline).mul(new D(1).minus(limit)));
export function sizeEntry(x: {
  equity: string;
  cash: string;
  buyingPower: string;
  ask: number;
  bid: number;
  displayed: number;
  atr: number;
  qtyStep: string;
  priceStep: string;
  minimum: string;
}) {
  const equity = new D(x.equity),
    ask = new D(x.ask),
    bid = new D(x.bid),
    step = new D(x.priceStep);
  if (
    equity.lte(0) ||
    ask.lt(bid) ||
    bid.lte(0) ||
    ask.minus(bid).div(ask).gt(".003") ||
    x.atr <= 0 ||
    step.lte(0) ||
    new D(x.qtyStep).lte(0) ||
    new D(x.minimum).lte(0)
  )
    return null;
  const limit = ceil(ask, step),
    stop = floor(limit.minus(new D(x.atr).mul(2)), step);
  if (stop.lte(0) || stop.gte(bid)) return null;
  const distance = limit.minus(stop),
    target = ceil(limit.plus(distance.mul(2)), step);
  const qty = floor(
    D.min(
      equity.mul(".005").div(distance),
      equity.mul(".10").div(limit),
      new D(x.cash).div(limit),
      new D(x.buyingPower).div(limit),
      new D(x.displayed).mul(".1"),
    ),
    x.qtyStep,
  );
  if (
    qty.lte(0) ||
    qty.lt(x.minimum) ||
    qty.decimalPlaces() > 12 ||
    limit.decimalPlaces() > 12
  )
    return null;
  return {
    quantity: qty.toFixed(),
    limitPrice: limit.toFixed(),
    stop: stop.toFixed(),
    target: target.toFixed(),
  };
}
