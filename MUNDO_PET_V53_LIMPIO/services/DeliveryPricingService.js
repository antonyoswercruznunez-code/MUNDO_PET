'use strict';

function norm(value) {
  return String(value || '').trim().toLocaleUpperCase('es-PE')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function clampMoney(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(100000, n)) : 0;
}

function scoreTariff(row, location, branchIds) {
  const sid = Number(row.sucursal_id || 0);
  if (sid && !branchIds.includes(sid)) return -1;
  let score = sid ? 20 : 0;
  const dep = norm(row.departamento);
  const prov = norm(row.provincia);
  const dist = norm(row.distrito);
  if (dep && dep !== norm(location.departamento)) return -1;
  if (prov && prov !== norm(location.provincia)) return -1;
  if (dist && dist !== norm(location.distrito)) return -1;
  if (dep) score += 5;
  if (prov) score += 10;
  if (dist) score += 20;
  return score;
}

function calculateFromTariff(tariff, { subtotal = 0, units = 0 } = {}) {
  const base = clampMoney(tariff?.tarifa_base);
  const perUnit = clampMoney(tariff?.cargo_por_unidad);
  const freeFrom = clampMoney(tariff?.gratis_desde);
  const safeSubtotal = clampMoney(subtotal);
  const safeUnits = Math.max(0, Math.min(100000, Math.floor(Number(units || 0))));
  const extraUnits = Math.max(0, safeUnits - 1);
  const free = freeFrom > 0 && safeSubtotal >= freeFrom;
  const total = free ? 0 : Number((base + extraUnits * perUnit).toFixed(2));
  return {
    total,
    base,
    per_unit: perUnit,
    units: safeUnits,
    included_units: safeUnits > 0 ? 1 : 0,
    extra_units: extraUnits,
    free_from: freeFrom,
    free,
    calculation: free
      ? `Envío gratis: subtotal S/ ${safeSubtotal.toFixed(2)} alcanza S/ ${freeFrom.toFixed(2)}`
      : `S/ ${base.toFixed(2)} + ${extraUnits} × S/ ${perUnit.toFixed(2)} = S/ ${total.toFixed(2)}`,
    description: free
      ? 'El pedido alcanzó el importe mínimo para envío gratuito.'
      : `La tarifa base incluye la primera unidad; se cobraron ${extraUnits} unidades adicionales.`,
    tariff_id: Number(tariff?.id || 0) || null,
    tariff_name: String(tariff?.nombre || 'Tarifa general')
  };
}

async function listTariffs(db, { activeOnly = false } = {}) {
  const [rows] = await db.query(`SELECT dt.*,s.nombre sucursal_nombre
    FROM delivery_tarifas dt LEFT JOIN sucursales s ON s.id=dt.sucursal_id
    ${activeOnly ? 'WHERE dt.activo=1' : ''}
    ORDER BY dt.activo DESC,dt.sucursal_id IS NULL DESC,dt.departamento,dt.provincia,dt.distrito,dt.id`);
  return rows;
}

async function quote(db, { subtotal = 0, units = 0, location = {}, branchIds = [] } = {}) {
  const safeBranchIds = [...new Set((branchIds || []).map(Number).filter(Number.isInteger))];
  const rows = await listTariffs(db, { activeOnly: true });
  let selected = null;
  let selectedScore = -1;
  for (const row of rows) {
    const score = scoreTariff(row, location, safeBranchIds);
    if (score > selectedScore) {
      selected = row;
      selectedScore = score;
    }
  }
  if (!selected) {
    const [cfgRows] = await db.query("SELECT clave,valor FROM configuracion WHERE clave IN ('delivery_costo','delivery_gratis_desde','delivery_cargo_unidad')");
    const cfg = Object.fromEntries(cfgRows.map(r => [r.clave, r.valor]));
    selected = {
      id: null,
      nombre: 'Tarifa general',
      tarifa_base: cfg.delivery_costo || 0,
      cargo_por_unidad: cfg.delivery_cargo_unidad || 0,
      gratis_desde: cfg.delivery_gratis_desde || 0
    };
  }
  return calculateFromTariff(selected, { subtotal, units });
}

module.exports = { norm, scoreTariff, calculateFromTariff, listTariffs, quote };
