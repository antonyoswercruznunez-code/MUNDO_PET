const { wrap } = require('../helpers/response');
const { getDB } = require('../config/database');
const { userScope } = require('../middleware/permisos');

function hoyPeru() {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-CA', { timeZone:'America/Lima', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date())) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function validarFecha(value, label) {
  if (!value) return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw Object.assign(new Error(`${label} no es válida`), { status:400 });
  if (text > hoyPeru()) throw Object.assign(new Error(`${label} no puede ser futura`), { status:400 });
  return text;
}

const ComprobanteController = {
  list: wrap(async (req, res) => {
    const db = getDB();
    const scope = userScope(req);
    const desde = validarFecha(req.query.desde, 'La fecha desde');
    const hasta = validarFecha(req.query.hasta, 'La fecha hasta');
    if (desde && hasta && desde > hasta) return res.status(400).json({ok:false,msg:'La fecha desde no puede ser posterior a la fecha hasta'});
    let sql = `
      SELECT c.id,c.venta_id,c.tipo,c.serie,c.numero,c.numero_full,c.total,c.estado_sunat,
             DATE_FORMAT(c.emitido_at,'%Y-%m-%dT%H:%i:%s') AS emitido_at,
             DATE_FORMAT(c.aceptado_at,'%Y-%m-%dT%H:%i:%s') AS aceptado_at,
             c.cdr_codigo,c.cdr_mensaje,
             v.numero AS venta_numero,v.sucursal_id,s.nombre AS sucursal_nombre,
             COALESCE(NULLIF(cl.razon_social,''),TRIM(CONCAT_WS(' ',cl.nombre,cl.apellido_paterno,cl.apellido_materno)),'Cliente General') AS cliente_nombre
      FROM comprobantes c
      JOIN ventas v ON v.id=c.venta_id
      LEFT JOIN clientes cl ON cl.id=v.cliente_id
      LEFT JOIN sucursales s ON s.id=v.sucursal_id
      WHERE 1=1
    `;
    const params=[];
    if(!scope.isGlobal&&scope.sucursalId){sql+=' AND v.sucursal_id=?';params.push(scope.sucursalId);}
    if(req.query.estado){sql+=' AND c.estado_sunat=?';params.push(String(req.query.estado).slice(0,30));}
    if(desde){sql+=' AND DATE(c.emitido_at)>=?';params.push(desde);}
    if(hasta){sql+=' AND DATE(c.emitido_at)<=?';params.push(hasta);}
    sql+=' ORDER BY c.emitido_at DESC,c.id DESC LIMIT 300';
    const [rows]=await db.query(sql,params);
    res.json({ok:true,comprobantes:rows,hoy:hoyPeru()});
  })
};
module.exports=ComprobanteController;
