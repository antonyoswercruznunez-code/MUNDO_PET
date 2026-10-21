const { wrap } = require('../helpers/response');
const { getDB } = require('../config/database');
const { userScope, hasPermission, hasGlobalScope } = require('../middleware/permisos');
const Crypto = require('../services/CryptoService');
const Audit = require('../services/AuditService');

function allowedTransition(current, next, type) {
  const pickup = { pendiente:['preparando','incidencia'], preparando:['listo','incidencia'], listo:['incidencia'], incidencia:['preparando','cancelado'] };
  const delivery = { pendiente:['preparando','incidencia'], preparando:['listo','incidencia'], listo:['asignado','en_ruta','incidencia'], asignado:['en_ruta','incidencia'], en_ruta:['entregado','incidencia'], incidencia:['preparando','en_ruta','cancelado'] };
  return (type === 'recojo' ? pickup : delivery)[current]?.includes(next) || false;
}

function normalizeCode(value){return String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^(.{4})(.{4})$/,'$1-$2');}
function validCode(value){return /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(value)||/^[A-HJ-NP-Z2-9]{5}$/.test(value);}

async function scopedDelivery(req, conn, id, lock = false) {
  const [[row]] = await conn.query(`
    SELECT pes.*,pw.numero_orden,pw.estado_pago,pw.cliente_snapshot,v.numero AS venta_numero,
           s.nombre AS sucursal_nombre,s.direccion AS sucursal_direccion,pw.direccion_snapshot,pw.facturacion_snapshot
    FROM pedido_entregas_sucursal pes
    JOIN pedidos_web pw ON pw.id=pes.pedido_id
    LEFT JOIN ventas v ON v.id=pes.venta_id
    JOIN sucursales s ON s.id=pes.sucursal_id
    WHERE pes.id=? ${lock ? 'FOR UPDATE' : ''}
  `,[id]);
  if (!row) return null;
  const scope=userScope(req);
  const global=await hasGlobalScope(req,'pedidos_web.aprobar_multisucursal');
  if(!global && Number(scope.sucursalId)!==Number(row.sucursal_id)) return false;
  return row;
}

const RecojoController = {
  list: wrap(async(req,res)=>{
    const db=getDB(); const scope=userScope(req);
    const global=await hasGlobalScope(req,'pedidos_web.aprobar_multisucursal');
    const {estado,tipo,buscar}=req.query;
    let sql=`
      SELECT pes.id,pes.pedido_id,pes.venta_id,pes.sucursal_id,pes.tipo_entrega,pes.estado,
             pes.codigo_generado_at,pes.codigo_usado_at,pes.persona_recibe,pes.documento_recibe,
             pes.observacion,pes.created_at,pw.created_at AS pedido_created_at,pw.numero_orden,pw.total,pw.estado_pago,pw.cliente_snapshot,
             v.numero AS venta_numero,s.nombre AS sucursal_nombre,
             DATE_FORMAT(rf.fecha,'%Y-%m-%d') AS recojo_fecha,TIME_FORMAT(rf.hora_inicio,'%H:%i') AS recojo_hora_inicio,
             TIME_FORMAT(rf.hora_fin,'%H:%i') AS recojo_hora_fin
      FROM pedido_entregas_sucursal pes
      JOIN pedidos_web pw ON pw.id=pes.pedido_id
      LEFT JOIN ventas v ON v.id=pes.venta_id
      JOIN sucursales s ON s.id=pes.sucursal_id
      LEFT JOIN pedido_recojo_reservas prr ON prr.pedido_id=pes.pedido_id AND prr.sucursal_id=pes.sucursal_id
      LEFT JOIN recojo_fechas rf ON rf.id=prr.horario_id
      WHERE pw.estado_pago='aprobado'`;
    const params=[];
    if(!global){if(!scope.sucursalId)return res.json({ok:true,entregas:[]});sql+=' AND pes.sucursal_id=?';params.push(scope.sucursalId);}
    if(estado){sql+=' AND pes.estado=?';params.push(String(estado));}
    if(tipo){sql+=' AND pes.tipo_entrega=?';params.push(String(tipo));}
    if(buscar){const q=`%${String(buscar).slice(0,80)}%`;sql+=' AND (pw.numero_orden LIKE ? OR v.numero LIKE ?)';params.push(q,q);}
    sql+=' ORDER BY pw.created_at DESC,pes.id DESC LIMIT 250';
    const [rows]=await db.query(sql,params);
    rows.forEach(r=>{try{const c=typeof r.cliente_snapshot==='string'?JSON.parse(r.cliente_snapshot):r.cliente_snapshot||{};r.cliente_nombre=c.razon_social||c.nombre_completo||[c.nombre,c.apellido_paterno,c.apellido_materno].filter(Boolean).join(' ');r.cliente_doc=c.numero_doc||'';}catch(_){r.cliente_nombre='Cliente web';r.cliente_doc='';}delete r.cliente_snapshot;});
    res.json({ok:true,entregas:rows});
  }),

  detail: wrap(async(req,res)=>{
    const db=getDB(); const d=await scopedDelivery(req,db,Number(req.params.id),false);
    if(d===false)return res.status(403).json({ok:false,msg:'Entrega fuera de tu sucursal'});
    if(!d)return res.status(404).json({ok:false,msg:'Entrega no encontrada'});
    let client={};try{client=typeof d.cliente_snapshot==='string'?JSON.parse(d.cliente_snapshot):d.cliente_snapshot||{};}catch(_){}
    let address={};try{address=typeof d.direccion_snapshot==='string'?JSON.parse(d.direccion_snapshot):d.direccion_snapshot||{};}catch(_){}
    client.direccion_entrega=address.direccion_completa||address.direccion||[address.direccion,address.numero_lote,address.referencia].filter(Boolean).join(' · ')||client.direccion_entrega||client.direccion||'';
    const [items]=await db.query(`SELECT pi.nombre_snapshot producto,pi.cantidad,pi.precio_unit,pi.subtotal,p.stock_actual
      FROM pedido_items pi LEFT JOIN productos p ON p.id=pi.producto_id
      WHERE pi.pedido_id=? AND pi.sucursal_id=? ORDER BY pi.id`,[d.pedido_id,d.sucursal_id]);
    const [history]=await db.query(`SELECT estado,observacion,persona_recibe,documento_recibe,created_at,updated_at,codigo_usado_at
      FROM pedido_entregas_sucursal WHERE id=?`,[d.id]);
    delete d.cliente_snapshot;
    res.json({ok:true,entrega:d,cliente:client,items,historial:history});
  }),

  updateStatus: wrap(async(req,res)=>{
    const next=String(req.body.estado||'');
    const note=String(req.body.observacion||'').trim().slice(0,500);
    const receiver=String(req.body.persona_recibe||'').trim().slice(0,200);
    const receiverDoc=String(req.body.documento_recibe||'').replace(/\D/g,'').slice(0,20);
    const db=getDB();const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      const d=await scopedDelivery(req,conn,Number(req.params.id),true);
      if(d===false)throw Object.assign(new Error('Entrega fuera de tu sucursal'),{status:403});
      if(!d)throw Object.assign(new Error('Entrega no encontrada'),{status:404});
      if(!allowedTransition(d.estado,next,d.tipo_entrega))throw Object.assign(new Error(`No se puede pasar de ${d.estado} a ${next}`),{status:400});
      if(next==='incidencia'&&note.length<5)throw Object.assign(new Error('Describe la incidencia'),{status:400});
      if(next==='entregado'&&d.tipo_entrega==='delivery'&&receiver.length<2)throw Object.assign(new Error('Registra quién recibió el pedido'),{status:400});
      const user=req.session.usuario.id;
      await conn.query(`UPDATE pedido_entregas_sucursal SET estado=?,observacion=?,persona_recibe=IF(?='entregado',?,persona_recibe),documento_recibe=IF(?='entregado',?,documento_recibe),preparado_por=IF(? IN ('preparando','listo','en_ruta'),?,preparado_por),entregado_por=IF(?='entregado',?,entregado_por),codigo_usado_at=IF(?='entregado' AND tipo_entrega='delivery',NOW(),codigo_usado_at),updated_at=NOW() WHERE id=?`,[next,note,next,receiver,next,receiverDoc,next,user,next,user,next,d.id]);
      if(next==='entregado'){
        const [[left]]=await conn.query("SELECT COUNT(*) total FROM pedido_entregas_sucursal WHERE pedido_id=? AND estado<>'entregado'",[d.pedido_id]);
        if(Number(left.total)===0)await conn.query("UPDATE pedidos_web SET estado_pedido='entregado',updated_at=NOW() WHERE id=?",[d.pedido_id]);
      }
      await conn.commit();
      await Audit.log(req,{accion:'entrega_estado',modulo:'recojo',entidad:'pedido_entregas_sucursal',entidad_id:d.id,datos:{anterior:d.estado,nuevo:next}});
      res.json({ok:true,msg:'Estado actualizado'});
    }catch(e){await conn.rollback();res.status(e.status||400).json({ok:false,msg:e.message});}finally{conn.release();}
  }),

  verifyCode: wrap(async(req,res)=>{
    const code=normalizeCode(req.body.codigo);
    if(!validCode(code))return res.status(400).json({ok:false,msg:'Código inválido'});
    const db=getDB();const hash=Crypto.hash(code);
    const [[row]]=await db.query(`SELECT pes.id,pes.sucursal_id,pes.tipo_entrega,pes.estado,pes.codigo_usado_at,pw.numero_orden,pw.cliente_snapshot,v.numero AS venta_numero,s.nombre AS sucursal_nombre FROM pedido_entregas_sucursal pes JOIN pedidos_web pw ON pw.id=pes.pedido_id LEFT JOIN ventas v ON v.id=pes.venta_id JOIN sucursales s ON s.id=pes.sucursal_id WHERE pes.codigo_recojo_hash=?`,[hash]);
    if(!row)return res.status(404).json({ok:false,msg:'Código no encontrado'});
    const scope=userScope(req);const global=await hasGlobalScope(req,'pedidos_web.aprobar_multisucursal');if(!global&&Number(scope.sucursalId)!==Number(row.sucursal_id))return res.status(403).json({ok:false,msg:'El código pertenece a otra sucursal'});
    let c={};try{c=typeof row.cliente_snapshot==='string'?JSON.parse(row.cliente_snapshot):row.cliente_snapshot||{};}catch(_){}
    delete row.cliente_snapshot;row.cliente_nombre=c.razon_social||c.nombre_completo||[c.nombre,c.apellido_paterno,c.apellido_materno].filter(Boolean).join(' ');row.cliente_doc=c.numero_doc?`${String(c.numero_doc).slice(0,3)}*****${String(c.numero_doc).slice(-2)}`:'';
    res.json({ok:true,entrega:row,puede_entregar:row.tipo_entrega==='recojo'&&row.estado==='listo'&&!row.codigo_usado_at});
  }),

  deliverPickup: wrap(async(req,res)=>{
    const code=normalizeCode(req.body.codigo);const receiver=String(req.body.persona_recibe||'').trim().slice(0,200);const doc=String(req.body.documento_recibe||'').replace(/\D/g,'').slice(0,20);const note=String(req.body.observacion||'').trim().slice(0,500);
    if(!validCode(code))return res.status(400).json({ok:false,msg:'Código inválido'});
    const db=getDB();const conn=await db.getConnection();
    try{await conn.beginTransaction();const [[d]]=await conn.query('SELECT * FROM pedido_entregas_sucursal WHERE codigo_recojo_hash=? FOR UPDATE',[Crypto.hash(code)]);if(!d)throw Object.assign(new Error('Código no encontrado'),{status:404});const scope=userScope(req);const global=await hasGlobalScope(req,'pedidos_web.aprobar_multisucursal');if(!global&&Number(scope.sucursalId)!==Number(d.sucursal_id))throw Object.assign(new Error('El código pertenece a otra sucursal'),{status:403});if(d.tipo_entrega!=='recojo')throw Object.assign(new Error('Este código corresponde a un delivery y no se valida como recojo en tienda'),{status:409});if(d.codigo_usado_at||d.estado==='entregado')throw Object.assign(new Error('Este código ya fue utilizado'),{status:409});if(d.estado!=='listo')throw Object.assign(new Error('El pedido todavía no está listo para entregar'),{status:409});await conn.query("UPDATE pedido_entregas_sucursal SET estado='entregado',codigo_usado_at=NOW(),entregado_por=?,persona_recibe=?,documento_recibe=?,observacion=?,updated_at=NOW() WHERE id=?",[req.session.usuario.id,receiver,doc,note,d.id]);await conn.query("UPDATE pedido_recojo_reservas SET estado='utilizado',updated_at=NOW() WHERE pedido_id=? AND sucursal_id=? AND estado='confirmado'",[d.pedido_id,d.sucursal_id]);const [[left]]=await conn.query("SELECT COUNT(*) total FROM pedido_entregas_sucursal WHERE pedido_id=? AND estado<>'entregado'",[d.pedido_id]);if(Number(left.total)===0)await conn.query("UPDATE pedidos_web SET estado_pedido='entregado',updated_at=NOW() WHERE id=?",[d.pedido_id]);await conn.commit();await Audit.log(req,{accion:'pedido_recojo_entregado',modulo:'recojo',entidad:'pedido_entregas_sucursal',entidad_id:d.id});res.json({ok:true,msg:'Pedido entregado correctamente'});}catch(e){await conn.rollback();res.status(e.status||400).json({ok:false,msg:e.message});}finally{conn.release();}
  }),

  reprogramar: wrap(async(req,res)=>{
    const entregaId=Number(req.params.id);
    const horarioId=Number(req.body.horario_id);
    if(!entregaId||!horarioId)return res.status(400).json({ok:false,msg:'Selecciona un horario válido'});
    const db=getDB();const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      const d=await scopedDelivery(req,conn,entregaId,true);
      if(d===false)throw Object.assign(new Error('Entrega fuera de tu sucursal'),{status:403});
      if(!d)throw Object.assign(new Error('Entrega no encontrada'),{status:404});
      if(d.tipo_entrega!=='recojo')throw Object.assign(new Error('Solo se puede reprogramar el recojo en tienda'),{status:400});
      if(['entregado','cancelado'].includes(d.estado))throw Object.assign(new Error('La entrega ya no puede reprogramarse'),{status:409});
      const [[nuevo]]=await conn.query(`SELECT * FROM recojo_fechas WHERE id=? AND sucursal_id=? AND estado=0 AND fecha>=CURDATE() FOR UPDATE`,[horarioId,d.sucursal_id]);
      if(!nuevo)throw Object.assign(new Error('El horario no existe o no corresponde a la sucursal'),{status:404});
      if(Number(nuevo.cupos_usados)>=Number(nuevo.cupos_total))throw Object.assign(new Error('El horario seleccionado ya no tiene cupos'),{status:409});
      const [[reserva]]=await conn.query(`SELECT * FROM pedido_recojo_reservas WHERE pedido_id=? AND sucursal_id=? AND estado IN ('reservado','confirmado') FOR UPDATE`,[d.pedido_id,d.sucursal_id]);
      if(reserva&&Number(reserva.horario_id)===horarioId)throw Object.assign(new Error('El pedido ya tiene ese horario'),{status:409});
      if(reserva){
        await conn.query(`UPDATE recojo_fechas SET cupos_usados=GREATEST(cupos_usados-1,0) WHERE id=?`,[reserva.horario_id]);
        await conn.query(`UPDATE pedido_recojo_reservas SET horario_id=?,estado='confirmado',updated_at=NOW() WHERE id=?`,[horarioId,reserva.id]);
      }else{
        await conn.query(`INSERT INTO pedido_recojo_reservas(pedido_id,sucursal_id,horario_id,estado,created_at,updated_at) VALUES(?,?,?,'confirmado',NOW(),NOW())`,[d.pedido_id,d.sucursal_id,horarioId]);
      }
      await conn.query(`UPDATE recojo_fechas SET cupos_usados=cupos_usados+1 WHERE id=?`,[horarioId]);
      await conn.commit();
      await Audit.log(req,{accion:'recojo_reprogramado',modulo:'recojo',entidad:'pedido_entregas_sucursal',entidad_id:d.id,datos:{horario_anterior:reserva?.horario_id||null,horario_nuevo:horarioId}});
      res.json({ok:true,msg:'Recojo reprogramado correctamente'});
    }catch(e){await conn.rollback();res.status(e.status||400).json({ok:false,msg:e.message});}finally{conn.release();}
  }),

  horarios: wrap(async(req,res)=>{
    const db=getDB();const scope=userScope(req);const global=await hasGlobalScope(req,'dashboard.ver_global');
    let sql=`SELECT rf.id,rf.sucursal_id,s.nombre sucursal_nombre,DATE_FORMAT(rf.fecha,'%Y-%m-%d') fecha,TIME_FORMAT(rf.hora_inicio,'%H:%i') hora_inicio,TIME_FORMAT(rf.hora_fin,'%H:%i') hora_fin,rf.cupos_total,rf.cupos_usados,rf.estado FROM recojo_fechas rf JOIN sucursales s ON s.id=rf.sucursal_id WHERE 1=1`;const params=[];
    if(!global){if(!scope.sucursalId)return res.json({ok:true,horarios:[]});sql+=' AND rf.sucursal_id=?';params.push(scope.sucursalId);}
    sql+=' ORDER BY rf.fecha DESC,rf.hora_inicio DESC LIMIT 300';
    const [rows]=await db.query(sql,params);res.json({ok:true,horarios:rows});
  }),

  createHorario: wrap(async(req,res)=>{
    const db=getDB();const scope=userScope(req);const global=await hasGlobalScope(req,'dashboard.ver_global');
    const sucursalId=global?Number(req.body.sucursal_id):Number(scope.sucursalId);
    const fecha=String(req.body.fecha||'');const inicio=String(req.body.hora_inicio||'');const fin=String(req.body.hora_fin||'');const cupos=Number(req.body.cupos_total);
    if(!sucursalId||!/^\d{4}-\d{2}-\d{2}$/.test(fecha)||!/^\d{2}:\d{2}$/.test(inicio)||!/^\d{2}:\d{2}$/.test(fin)||inicio>=fin||!Number.isInteger(cupos)||cupos<1||cupos>500)return res.status(400).json({ok:false,msg:'Datos del horario inválidos'});
    const [[clock]]=await db.query("SELECT DATE_FORMAT(CURDATE(),'%Y-%m-%d') hoy");if(fecha<clock.hoy)return res.status(400).json({ok:false,msg:'No se pueden crear horarios en fechas pasadas'});
    const [r]=await db.query('INSERT INTO recojo_fechas (sucursal_id,fecha,hora_inicio,hora_fin,cupos_total,cupos_usados,estado) VALUES (?,?,?,?,?,0,0)',[sucursalId,fecha,inicio,fin,cupos]);
    await Audit.log(req,{accion:'horario_recojo_creado',modulo:'recojo',entidad:'recojo_fechas',entidad_id:r.insertId});res.status(201).json({ok:true,id:r.insertId,msg:'Horario creado'});
  }),


  createSemana: wrap(async(req,res)=>{
    const db=getDB(); const scope=userScope(req); const global=await hasGlobalScope(req,'dashboard.ver_global');
    const sucursalId=global?Number(req.body.sucursal_id):Number(scope.sucursalId);
    const fechaInicio=String(req.body.fecha_inicio||''); const inicio=String(req.body.hora_inicio||''); const fin=String(req.body.hora_fin||'');
    const cupos=Number(req.body.cupos_total); const dias=Array.isArray(req.body.dias)?req.body.dias.map(Number).filter(x=>x>=0&&x<=6):[1,2,3,4,5,6,0];
    if(!sucursalId||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(fechaInicio)||!/^[0-9]{2}:[0-9]{2}$/.test(inicio)||!/^[0-9]{2}:[0-9]{2}$/.test(fin)||inicio>=fin||!Number.isInteger(cupos)||cupos<1||cupos>500||!dias.length)
      return res.status(400).json({ok:false,msg:'Datos de la semana inválidos'});
    const [[clock]]=await db.query("SELECT DATE_FORMAT(CURDATE(),'%Y-%m-%d') hoy");
    if(fechaInicio<clock.hoy)return res.status(400).json({ok:false,msg:'La semana no puede comenzar en una fecha pasada'});
    const start=new Date(`${fechaInicio}T12:00:00Z`); const conn=await db.getConnection(); let creados=0,omitidos=0;
    try{
      await conn.beginTransaction();
      for(let i=0;i<7;i++){
        const d=new Date(start);d.setUTCDate(start.getUTCDate()+i);
        if(!dias.includes(d.getUTCDay()))continue;
        const fecha=d.toISOString().slice(0,10);
        const [[exists]]=await conn.query('SELECT id FROM recojo_fechas WHERE sucursal_id=? AND fecha=? AND hora_inicio=? AND hora_fin=? LIMIT 1',[sucursalId,fecha,inicio,fin]);
        if(exists){omitidos++;continue;}
        await conn.query('INSERT INTO recojo_fechas (sucursal_id,fecha,hora_inicio,hora_fin,cupos_total,cupos_usados,estado) VALUES (?,?,?,?,?,0,0)',[sucursalId,fecha,inicio,fin,cupos]);
        creados++;
      }
      await conn.commit();
      await Audit.log(req,{accion:'semana_recojo_creada',modulo:'recojo',entidad:'recojo_fechas',datos:{sucursal_id:sucursalId,fecha_inicio:fechaInicio,creados,omitidos}});
      res.status(201).json({ok:true,msg:`Semana creada: ${creados} horario(s). ${omitidos} duplicado(s) omitido(s).`,creados,omitidos});
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }),

  updateHorario: wrap(async(req,res)=>{
    const db=getDB();const id=Number(req.params.id);const [[h]]=await db.query('SELECT * FROM recojo_fechas WHERE id=?',[id]);if(!h)return res.status(404).json({ok:false,msg:'Horario no encontrado'});
    const scope=userScope(req);const global=await hasGlobalScope(req,'dashboard.ver_global');if(!global&&Number(h.sucursal_id)!==Number(scope.sucursalId))return res.status(403).json({ok:false,msg:'Horario fuera de tu alcance'});
    const fecha=String(req.body.fecha||h.fecha).slice(0,10);const inicio=String(req.body.hora_inicio||h.hora_inicio).slice(0,5);const fin=String(req.body.hora_fin||h.hora_fin).slice(0,5);const cupos=Number(req.body.cupos_total??h.cupos_total);const estado=Number(req.body.estado??h.estado);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha)||!/^\d{2}:\d{2}$/.test(inicio)||!/^\d{2}:\d{2}$/.test(fin)||inicio>=fin||!Number.isInteger(cupos)||cupos<Number(h.cupos_usados)||cupos>500||![0,1].includes(estado))return res.status(400).json({ok:false,msg:'Datos del horario inválidos'});
    const [[clock]]=await db.query("SELECT DATE_FORMAT(CURDATE(),'%Y-%m-%d') hoy");if(fecha<clock.hoy)return res.status(400).json({ok:false,msg:'No se puede mover un horario a una fecha pasada'});
    await db.query('UPDATE recojo_fechas SET fecha=?,hora_inicio=?,hora_fin=?,cupos_total=?,estado=? WHERE id=?',[fecha,inicio,fin,cupos,estado,id]);await Audit.log(req,{accion:'horario_recojo_actualizado',modulo:'recojo',entidad:'recojo_fechas',entidad_id:id});res.json({ok:true,msg:'Horario actualizado'});
  }),

  deleteHorario: wrap(async(req,res)=>{
    const db=getDB();const id=Number(req.params.id);const [[h]]=await db.query('SELECT * FROM recojo_fechas WHERE id=?',[id]);if(!h)return res.status(404).json({ok:false,msg:'Horario no encontrado'});
    const scope=userScope(req);const global=await hasGlobalScope(req,'dashboard.ver_global');if(!global&&Number(h.sucursal_id)!==Number(scope.sucursalId))return res.status(403).json({ok:false,msg:'Horario fuera de tu alcance'});
    const [[used]]=await db.query("SELECT COUNT(*) n FROM pedido_recojo_reservas WHERE horario_id=? AND estado IN ('reservado','confirmado')",[id]);if(Number(used.n)>0)return res.status(409).json({ok:false,msg:'El horario tiene pedidos reservados. Desactívalo en lugar de eliminarlo.'});
    await db.query('DELETE FROM recojo_fechas WHERE id=?',[id]);await Audit.log(req,{accion:'horario_recojo_eliminado',modulo:'recojo',entidad:'recojo_fechas',entidad_id:id});res.json({ok:true,msg:'Horario eliminado'});
  })
};

module.exports=RecojoController;
