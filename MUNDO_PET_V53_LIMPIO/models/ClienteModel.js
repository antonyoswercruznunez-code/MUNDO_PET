const { getDB } = require('../config/database');
const { getTableColumns } = require('../helpers/dbSchema');
const Crypto = require('../services/CryptoService');

const secureFields = ['direccion','distrito','provincia','departamento'];
function decryptSafe(value) { try { return Crypto.decrypt(value); } catch (_) { return ''; } }
function reveal(row) {
  if (!row) return row;
  const result = {...row};
  for (const field of secureFields) {
    const encrypted = result[`${field}_enc`];
    if (encrypted) result[field] = decryptSafe(encrypted) || result[field] || '';
    delete result[`${field}_enc`];
  }
  return result;
}
function encrypted(data={}) {
  return Object.fromEntries(secureFields.map(field => [`${field}_enc`, Crypto.encrypt(data[field] || '')]));
}
function push(columns, names, values, field, value) {
  if (!columns.has(field)) return;
  names.push(`\`${field}\``);
  values.push(value);
}

const ClienteModel = {
  getAll: async (sid) => {
    const db = getDB();
    const columns = await getTableColumns(db, 'clientes');
    const baseFields = [
      'id','tipo_doc','numero_doc','nombre','apellido_paterno','apellido_materno','razon_social','telefono','email',
      'direccion','distrito','provincia','departamento','tipo_cliente','es_general','activo','origen_api',
      'sucursal_registro_id','created_at'
    ].filter(x => columns.has(x));
    const encryptedFields = secureFields.map(x => `${x}_enc`).filter(x => columns.has(x));
    const selected=[...baseFields,...encryptedFields];
    if (!selected.length) throw new Error('La tabla clientes no tiene columnas compatibles');
    let sql = `SELECT ${selected.map(x=>`c.\`${x}\``).join(',')} FROM clientes c WHERE 1=1`;
    const params = [];
    if (columns.has('activo')) sql += ' AND c.activo != 2';
    if (sid && columns.has('sucursal_registro_id')) {
      const clauses=['c.sucursal_registro_id=?']; params.push(sid);
      if(columns.has('es_general')) clauses.unshift('c.es_general=1');
      clauses.push(`EXISTS(SELECT 1 FROM ventas v WHERE v.cliente_id=c.id AND v.sucursal_id=? AND COALESCE(v.estado_venta,'registrada')!='eliminada')`); params.push(sid);
      sql += ` AND (${clauses.join(' OR ')})`;
    }
    const order=[]; if(columns.has('es_general'))order.push('c.es_general DESC'); if(columns.has('nombre'))order.push('c.nombre ASC'); else order.push('c.id DESC');
    sql += ` ORDER BY ${order.join(',')}`;
    const [rows] = await db.query(sql,params);
    return rows.map(reveal);
  },
  getByDoc: async numero_doc => {
    const [[row]] = await getDB().query('SELECT * FROM clientes WHERE numero_doc=? LIMIT 1',[numero_doc]);
    return reveal(row || null);
  },
  getById: async id => {
    const [[row]] = await getDB().query('SELECT * FROM clientes WHERE id=? LIMIT 1',[id]);
    return reveal(row || null);
  },
  existeActivo: async numero_doc => {
    const [[row]] = await getDB().query('SELECT id FROM clientes WHERE numero_doc=? AND activo!=2',[numero_doc]);
    return row || null;
  },
  crear: async data => {
    const db = getDB();
    const columns = await getTableColumns(db, 'clientes');
    const enc = encrypted(data);
    const names = [], values = [];
    for (const [field,value] of [
      ['tipo_doc',data.tipo_doc],['numero_doc',data.numero_doc],['nombre',data.nombre],['razon_social',data.razon_social],
      ['apellido_paterno',data.apellido_paterno],['apellido_materno',data.apellido_materno],['telefono',data.telefono],
      ['email',data.email],['direccion',data.direccion],['distrito',data.distrito],['provincia',data.provincia],
      ['departamento',data.departamento],['direccion_enc',enc.direccion_enc],['distrito_enc',enc.distrito_enc],
      ['provincia_enc',enc.provincia_enc],['departamento_enc',enc.departamento_enc],['tipo_cliente',data.tipo_cliente||'minorista'],
      ['sucursal_registro_id',data.sucursal_id],['usuario_registro_id',data.usuario_id],['origen_api',data.origen_api?1:0],['activo',1]
    ]) push(columns,names,values,field,value ?? '');
    const [r] = await db.query(`INSERT INTO clientes (${names.join(',')}) VALUES (${names.map(()=>'?').join(',')})`,values);
    return r.insertId;
  },
  reactivar: async (numero_doc,telefono,email) => {
    const db=getDB(), columns=await getTableColumns(db,'clientes'); const sets=[],params=[];
    if(columns.has('activo'))sets.push('activo=1'); if(columns.has('telefono')){sets.push('telefono=?');params.push(telefono);} if(columns.has('email')){sets.push('email=?');params.push(email);}
    if(!sets.length)return; params.push(numero_doc); return db.query(`UPDATE clientes SET ${sets.join(',')} WHERE numero_doc=?`,params);
  },
  editar: async (id,telefono,email,activo) => {
    const db=getDB(), columns=await getTableColumns(db,'clientes'); const sets=[],params=[];
    if(columns.has('telefono')){sets.push('telefono=?');params.push(telefono);} if(columns.has('email')){sets.push('email=?');params.push(email);} if(columns.has('activo')){sets.push('activo=?');params.push(activo);}
    if(!sets.length)return; params.push(id); return db.query(`UPDATE clientes SET ${sets.join(',')} WHERE id=?`,params);
  },
  eliminar: async id => {
    const db=getDB(), columns=await getTableColumns(db,'clientes');
    return columns.has('activo') ? db.query('UPDATE clientes SET activo=2 WHERE id=?',[id]) : db.query('DELETE FROM clientes WHERE id=?',[id]);
  },
  reveal,
  encrypted
};
module.exports=ClienteModel;
