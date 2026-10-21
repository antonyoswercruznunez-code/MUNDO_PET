const { wrap }       = require('../helpers/response');
const SucursalModel  = require('../models/SucursalModel');

const SucursalController = {

  // GET /sucursales → lista de sucursales activas (para pestañas y selectores)
  list: wrap(async (req, res) => {
    const sucursales = await SucursalModel.getActivas();
    res.json({ ok: true, sucursales });
  }),

  update: wrap(async (req,res) => {
    if (!req.session?.usuario?.es_global) return res.status(403).json({ok:false,msg:'Solo el administrador global puede editar sucursales.'});
    const id=Number(req.params.id);
    const direccion=String(req.body.direccion||'').trim().slice(0,500);
    const telefono=String(req.body.telefono||'').replace(/[^0-9+ -]/g,'').trim().slice(0,30);
    if(!id||!direccion)return res.status(400).json({ok:false,msg:'La dirección es obligatoria.'});
    const actual=await SucursalModel.getById(id);
    if(!actual)return res.status(404).json({ok:false,msg:'Sucursal no encontrada.'});
    await SucursalModel.updateDatos(id,{direccion,telefono});
    res.json({ok:true,msg:'Sucursal actualizada.'});
  })

};

module.exports = SucursalController;