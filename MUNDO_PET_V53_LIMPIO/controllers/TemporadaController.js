const { wrap } = require('../helpers/response');
const Model = require('../models/TemporadaModel');
const Audit = require('../services/AuditService');
const { userScope } = require('../middleware/permisos');

function peruDate() {
  const parts = {};
  for (const item of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date())) parts[item.type] = item.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function validIsoDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y,m,d] = text.split('-').map(Number);
  const dt = new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m-1 && dt.getUTCDate() === d;
}

function validate(body, current = null) {
  const nombre = String(body.nombre || '').trim().slice(0,100);
  const inicio = String(body.fecha_inicio || '');
  const fin = String(body.fecha_fin || '');
  const today = peruDate();

  if (nombre.length < 3) return { error: 'El nombre debe tener al menos 3 caracteres' };
  if (!validIsoDate(inicio) || !validIsoDate(fin)) return { error: 'Ingresa fechas válidas' };
  if (fin < inicio) return { error: 'La fecha final no puede ser anterior al inicio' };

  // Al editar una campaña antigua se permite conservar exactamente sus fechas,
  // pero nunca reemplazarlas por otra fecha pasada.
  if (inicio < today && inicio !== current?.fecha_inicio) {
    return { error: 'La fecha de inicio no puede estar en el pasado' };
  }
  if (fin < today && fin !== current?.fecha_fin) {
    return { error: 'La fecha final no puede estar en el pasado' };
  }

  return {
    nombre,
    fecha_inicio: inicio,
    fecha_fin: fin,
    estado: Number(body.estado) === 1 ? 1 : 0
  };
}

const TemporadaController = {
  list: wrap(async (req,res) => {
    res.json({ok:true,temporadas:await Model.list()});
  }),

  create: wrap(async (req,res) => {
    const data = validate(req.body);
    if (data.error) return res.status(400).json({ok:false,msg:data.error});
    const id = await Model.create(data);
    await Audit.log(req,{accion:'temporada_creada',modulo:'temporadas',entidad:'temporadas',entidad_id:id});
    res.status(201).json({ok:true,id,msg:'Temporada creada'});
  }),

  update: wrap(async (req,res) => {
    const id = Number(req.params.id);
    const current = await Model.getById(id);
    if (!current) return res.status(404).json({ok:false,msg:'Temporada no encontrada'});
    const today=peruDate();
    const active=Number(current.estado)===0 && today>=current.fecha_inicio && today<=current.fecha_fin;
    if(active && !userScope(req).isGlobal) return res.status(403).json({ok:false,msg:'Solo el administrador global puede editar una temporada vigente'});
    const data = validate(req.body,current);
    if (data.error) return res.status(400).json({ok:false,msg:data.error});
    await Model.update(id,data);
    await Audit.log(req,{accion:'temporada_actualizada',modulo:'temporadas',entidad:'temporadas',entidad_id:id});
    res.json({ok:true,msg:'Temporada actualizada'});
  }),

  remove: wrap(async (req,res) => {
    const id = Number(req.params.id);
    const current=await Model.getById(id);
    if(!current) return res.status(404).json({ok:false,msg:'Temporada no encontrada'});
    const today=peruDate();
    if(Number(current.estado)===0 && today>=current.fecha_inicio && today<=current.fecha_fin){
      return res.status(409).json({ok:false,msg:'Una temporada vigente no se puede eliminar. El administrador global debe editarla o desactivarla primero.'});
    }
    if (!(await Model.remove(id))) return res.status(404).json({ok:false,msg:'Temporada no encontrada'});
    await Audit.log(req,{accion:'temporada_eliminada',modulo:'temporadas',entidad:'temporadas',entidad_id:id});
    res.json({ok:true,msg:'Temporada eliminada'});
  }),

  addDiscount: wrap(async (req,res) => {
    const temporada_id = Number(req.params.id);
    const producto_id = Number(req.body.producto_id) || null;
    const tipo_descuento = String(req.body.tipo_descuento || 'porcentaje').toLowerCase();
    const valor = Number(req.body.valor ?? req.body.porcentaje);

    const temporada = await Model.getById(temporada_id);
    if (!temporada) return res.status(404).json({ok:false,msg:'Temporada no encontrada'});
    if (!producto_id) return res.status(400).json({ok:false,msg:'Selecciona un producto'});
    if (!['porcentaje','monto'].includes(tipo_descuento)) return res.status(400).json({ok:false,msg:'Tipo de descuento inválido'});
    if (!Number.isFinite(valor) || valor <= 0) return res.status(400).json({ok:false,msg:'El descuento debe ser mayor a cero'});
    const product=await Model.targetExists({producto_id});
    if(!product) return res.status(404).json({ok:false,msg:'Producto no encontrado'});
    if(tipo_descuento==='porcentaje' && valor>100) return res.status(400).json({ok:false,msg:'El porcentaje no puede superar 100%'});
    if(tipo_descuento==='monto' && valor>=Number(product.precio_venta||0)) return res.status(400).json({ok:false,msg:'El descuento en soles debe ser menor al precio de venta'});

    const payload={temporada_id,producto_id,tipo_descuento,porcentaje:tipo_descuento==='porcentaje'?valor:0,monto:tipo_descuento==='monto'?valor:0};
    const result = await Model.createDiscount(payload);
    if(result.duplicate) return res.status(409).json({ok:false,msg:'Este producto ya tiene un descuento en la temporada'});
    await Audit.log(req,{accion:'descuento_temporada_creado',modulo:'temporadas',entidad:'temporada_descuentos',entidad_id:result.id,datos:payload});
    res.status(201).json({ok:true,id:result.id,msg:'Descuento agregado al producto'});
  }),

  removeDiscount: wrap(async (req,res) => {
    const temporadaId = Number(req.params.id);
    const descuentoId = Number(req.params.descuentoId);
    if (!(await Model.removeDiscount(descuentoId,temporadaId))) {
      return res.status(404).json({ok:false,msg:'Descuento no encontrado'});
    }
    await Audit.log(req,{accion:'descuento_temporada_eliminado',modulo:'temporadas',entidad:'temporada_descuentos',entidad_id:descuentoId});
    res.json({ok:true,msg:'Descuento eliminado'});
  })
};

module.exports = TemporadaController;
