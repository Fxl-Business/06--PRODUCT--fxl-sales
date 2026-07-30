-- Serviço base value: a Serviço may carry its own value, as a DEFAULT.
--
-- 0013 added sales_ops_products_service_no_fixed_value_check to encode "a Serviço
-- has no own value". That premise is gone: every number in the product dialog is
-- a default a proposta may override, and a Serviço's value is no different. A
-- Serviço that genuinely has no base value stores 0, which is exactly what every
-- existing row already stores, so this migration needs no backfill and no data
-- moves.
--
-- Deliberately NOT touched: sales_ops_products_kind_open_price_check. It asserts
-- (kind = 'service') = open_price - "this row is a Serviço" - and a Serviço with
-- a base value is still a Serviço. open_price never meant "has no own value";
-- that was only ever this constraint.
--
-- Drop-only, so the down path is the original ADD CONSTRAINT from 0013. It can
-- only be replayed against a database whose serviços are all still at zero.

ALTER TABLE "sales_ops_products" DROP CONSTRAINT "sales_ops_products_service_no_fixed_value_check";
