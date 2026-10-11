-- MUNDO PET V53 - BASE LIMPIA PARA INSTALACION NUEVA
-- Compatible con MariaDB 10.4 o superior.
-- No contiene ventas, pedidos, clientes, inventario, auditorias ni comprobantes de prueba.
-- Importar sobre una base vacia llamada gas_sistema.

CREATE DATABASE IF NOT EXISTS `gas_sistema`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `gas_sistema`;

SET NAMES utf8mb4;
SET time_zone = '-05:00';
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';
SET FOREIGN_KEY_CHECKS = 0;
CREATE TABLE `almacenes` (
  `id` int(11) NOT NULL,
  `sucursal_id` int(11) DEFAULT NULL,
  `nombre` varchar(100) NOT NULL,
  `tipo` enum('central','sucursal','deposito') NOT NULL DEFAULT 'sucursal',
  `estado` tinyint(4) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `app_sessions` (
  `session_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` int(11) UNSIGNED NOT NULL,
  `data` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `auditoria` (
  `id` int(11) NOT NULL,
  `usuario_id` int(11) DEFAULT NULL,
  `usuario_nombre` varchar(100) DEFAULT '',
  `accion` varchar(50) NOT NULL,
  `modulo` varchar(50) NOT NULL,
  `descripcion` text DEFAULT '',
  `ip` varchar(45) DEFAULT '',
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `auditoria_eventos` (
  `id` bigint(20) NOT NULL,
  `usuario_id` int(11) DEFAULT NULL,
  `cliente_web_id` int(11) DEFAULT NULL,
  `accion` varchar(80) NOT NULL,
  `modulo` varchar(60) NOT NULL,
  `entidad` varchar(80) NOT NULL DEFAULT '',
  `entidad_id` varchar(80) NOT NULL DEFAULT '',
  `descripcion` varchar(500) NOT NULL DEFAULT '',
  `datos_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`datos_json`)),
  `ip` varchar(45) NOT NULL DEFAULT '',
  `user_agent` varchar(500) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cajas` (
  `id` int(11) NOT NULL,
  `sucursal_id` int(11) NOT NULL,
  `usuario_id` int(11) NOT NULL,
  `fecha_apertura` datetime DEFAULT current_timestamp(),
  `fecha_cierre` datetime DEFAULT NULL,
  `monto_inicial` decimal(10,2) DEFAULT 0.00,
  `monto_final` decimal(10,2) DEFAULT NULL,
  `total_ventas` decimal(10,2) DEFAULT 0.00,
  `total_ingresos` decimal(10,2) DEFAULT 0.00,
  `total_egresos` decimal(10,2) DEFAULT 0.00,
  `estado` varchar(30) NOT NULL DEFAULT 'abierta',
  `observacion` text DEFAULT NULL,
  `usuario_apertura_id` int(11) DEFAULT NULL,
  `usuario_cierre_id` int(11) DEFAULT NULL,
  `monto_esperado` decimal(10,2) DEFAULT NULL,
  `monto_real` decimal(10,2) DEFAULT NULL,
  `diferencia` decimal(10,2) DEFAULT NULL,
  `fecha_cierre_programada` datetime DEFAULT NULL,
  `fecha_bloqueo_automatico` datetime DEFAULT NULL,
  `fecha_cierre_automatico` datetime DEFAULT NULL,
  `apertura_automatica` tinyint(4) NOT NULL DEFAULT 0,
  `cierre_automatico_pendiente` tinyint(4) NOT NULL DEFAULT 0,
  `observacion_apertura` text DEFAULT '',
  `observacion_cierre` text DEFAULT '',
  `caja_fisica_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `cajas_fisicas` (
  `id` int(11) NOT NULL,
  `sucursal_id` int(11) NOT NULL,
  `codigo` varchar(30) NOT NULL,
  `monto_inicial` decimal(10,2) NOT NULL DEFAULT 0.00,
  `activo` tinyint(4) NOT NULL DEFAULT 1,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_by` int(11) DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `hora_apertura` time NOT NULL DEFAULT '08:00:00',
  `hora_cierre` time NOT NULL DEFAULT '22:00:00',
  `configurada` tinyint(4) NOT NULL DEFAULT 0,
  `orden` tinyint(3) UNSIGNED NOT NULL DEFAULT 1,
  `monto_inicial_predeterminado` decimal(10,2) NOT NULL DEFAULT 0.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `caja_movimientos` (
  `id` int(11) NOT NULL,
  `sesion_id` int(11) NOT NULL,
  `sucursal_id` int(11) NOT NULL DEFAULT 1,
  `tipo` enum('ingreso','egreso') NOT NULL,
  `concepto` varchar(200) NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `venta_id` int(11) DEFAULT NULL,
  `usuario_id` int(11) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `caja_sesiones` (
  `id` int(11) NOT NULL,
  `sucursal_id` int(11) NOT NULL,
  `usuario_id` int(11) NOT NULL,
  `abierta_at` datetime NOT NULL DEFAULT current_timestamp(),
  `cerrada_at` datetime DEFAULT NULL,
  `monto_inicial` decimal(10,2) NOT NULL DEFAULT 0.00,
  `monto_final` decimal(10,2) DEFAULT NULL,
  `total_ventas` decimal(10,2) NOT NULL DEFAULT 0.00,
  `total_ingresos` decimal(10,2) NOT NULL DEFAULT 0.00,
  `total_egresos` decimal(10,2) NOT NULL DEFAULT 0.00,
  `estado` enum('abierta','cerrada','conciliada','pendiente_arqueo','pendiente_revision','observada') NOT NULL DEFAULT 'abierta',
  `observacion` text DEFAULT '',
  `numero_caja` int(10) UNSIGNED DEFAULT NULL COMMENT 'Correlativo secuencial por sucursal',
  `conciliada_at` datetime DEFAULT NULL COMMENT 'Cuándo se marcó como conciliada',
  `conciliada_por` int(11) DEFAULT NULL COMMENT 'FK usuarios.id - quién concilió',
  `revertida_at` datetime DEFAULT NULL COMMENT 'Cuándo se revirtió',
  `revertida_por` int(11) DEFAULT NULL COMMENT 'FK usuarios.id - quién revirtió',
  `caja_fisica_id` int(11) DEFAULT NULL,
  `bloqueada_at` datetime DEFAULT NULL,
  `arqueado_por` int(11) DEFAULT NULL,
  `arqueo_at` datetime DEFAULT NULL,
  `revisada_por` int(11) DEFAULT NULL,
  `revisada_at` datetime DEFAULT NULL,
  `observacion_revision` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `categorias` (
  `id` int(11) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `descripcion` text DEFAULT '',
  `icono` varchar(50) DEFAULT 'ti-tag',
  `color` varchar(20) DEFAULT '#e53e3e',
  `estado` tinyint(4) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `clientes` (
  `id` int(11) NOT NULL,
  `tipo_doc` enum('dni','ruc') NOT NULL DEFAULT 'dni',
  `numero_doc` varchar(20) NOT NULL,
  `nombre` varchar(200) NOT NULL DEFAULT '',
  `razon_social` varchar(200) DEFAULT '',
  `direccion` text DEFAULT '',
  `telefono` varchar(30) DEFAULT '',
  `email` varchar(100) DEFAULT '',
  `tipo_cliente` enum('minorista','mayorista','distribuidor') NOT NULL DEFAULT 'minorista',
  `sucursal_registro_id` int(11) DEFAULT NULL,
  `usuario_registro_id` int(11) DEFAULT NULL,
  `origen_api` tinyint(4) NOT NULL DEFAULT 0,
  `activo` tinyint(4) NOT NULL DEFAULT 1,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `limite_credito` decimal(10,2) DEFAULT 0.00,
  `dias_credito` int(11) DEFAULT 0,
  `es_general` tinyint(4) DEFAULT 0,
  `apellido_paterno` varchar(100) DEFAULT '',
  `apellido_materno` varchar(100) DEFAULT '',
  `distrito` varchar(100) DEFAULT '',
  `provincia` varchar(100) DEFAULT '',
  `departamento` varchar(100) DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `clientes_web` (
  `id` int(11) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password` varchar(255) DEFAULT NULL,
  `google_id` varchar(100) DEFAULT NULL,
  `avatar` varchar(500) DEFAULT NULL,
  `telefono` varchar(30) DEFAULT NULL,
  `email_verificado` tinyint(4) NOT NULL DEFAULT 0,
  `proveedor` enum('local','google') NOT NULL DEFAULT 'local',
  `cliente_id` int(11) DEFAULT NULL,
  `activo` tinyint(4) NOT NULL DEFAULT 1,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `compras` (
  `id` int(11) NOT NULL,
  `numero` varchar(30) NOT NULL,
  `proveedor_id` int(11) NOT NULL,
  `sucursal_id` int(11) NOT NULL DEFAULT 1,
  `usuario_id` int(11) NOT NULL,
  `subtotal` decimal(10,2) DEFAULT 0.00,
  `igv` decimal(10,2) DEFAULT 0.00,
  `total` decimal(10,2) DEFAULT 0.00,
  `estado` enum('pendiente','recibida','anulada') DEFAULT 'pendiente',
  `observacion` text DEFAULT '',
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `compra_items` (
  `id` int(11) NOT NULL,
  `compra_id` int(11) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `cantidad` int(11) NOT NULL,
  `precio_unit` decimal(10,2) NOT NULL,
  `subtotal` decimal(10,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `comprobantes` (
  `id` int(11) NOT NULL,
  `venta_id` int(11) NOT NULL,
  `tipo` enum('boleta','factura','nota_credito','nota_debito') NOT NULL,
  `serie` varchar(10) NOT NULL,
  `numero` int(11) NOT NULL,
  `numero_full` varchar(20) NOT NULL,
  `hash_cpe` varchar(100) DEFAULT NULL COMMENT 'Hash del XML que devuelve MiAPI',
  `op_tributaria` varchar(20) DEFAULT 'Gravada (0101)',
  `subtotal` decimal(10,2) DEFAULT 0.00,
  `igv` decimal(10,2) DEFAULT 0.00,
  `total` decimal(10,2) DEFAULT 0.00,
  `xml_path` varchar(255) DEFAULT NULL,
  `xml_sin_firmar_path` varchar(500) DEFAULT NULL,
  `pdf_a4_path` varchar(255) DEFAULT NULL,
  `pdf_ticket_path` varchar(255) DEFAULT NULL,
  `cdr_path` varchar(255) DEFAULT NULL,
  `cdr_estado` varchar(20) DEFAULT NULL,
  `cdr_codigo` varchar(10) DEFAULT NULL COMMENT 'Código de respuesta SUNAT (0=ok)',
  `cdr_mensaje` varchar(500) DEFAULT NULL COMMENT 'Mensaje de SUNAT',
  `motivo_anula` varchar(255) DEFAULT NULL COMMENT 'Motivo si es NC/ND o baja',
  `comprobante_ref` varchar(20) DEFAULT NULL COMMENT 'Documento original al que refiere NC/ND',
  `estado_sunat` varchar(20) DEFAULT NULL,
  `sunat_response` text DEFAULT NULL,
  `emitido_at` datetime DEFAULT NULL,
  `enviado_at` datetime DEFAULT NULL,
  `aceptado_at` datetime DEFAULT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `comunicaciones_baja` (
  `id` int(11) NOT NULL,
  `tipo` varchar(5) NOT NULL DEFAULT 'RA' COMMENT 'RA=baja de facturas',
  `identificador` varchar(20) NOT NULL,
  `correlativo` int(11) NOT NULL DEFAULT 1,
  `fecha_referencia` date NOT NULL COMMENT 'Fecha del comprobante a dar de baja',
  `fecha_envio` date NOT NULL,
  `ticket` varchar(100) DEFAULT NULL,
  `estado_sunat` enum('pendiente','enviado','aceptado','rechazado') DEFAULT 'pendiente',
  `cdr_mensaje` varchar(500) DEFAULT NULL,
  `sucursal_id` int(11) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `comunicacion_baja_items` (
  `id` int(11) NOT NULL,
  `baja_id` int(11) NOT NULL,
  `comprobante_id` int(11) DEFAULT NULL,
  `tipo_doc` varchar(2) NOT NULL COMMENT '01=factura',
  `serie` varchar(10) NOT NULL,
  `correlativo` varchar(20) NOT NULL,
  `motivo` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `configuracion` (
  `clave` varchar(100) NOT NULL,
  `valor` text NOT NULL DEFAULT '',
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `grupo` varchar(50) NOT NULL DEFAULT 'general'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `correlativos_comprobante` (
  `serie` varchar(10) NOT NULL,
  `ultimo_numero` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `cotizaciones` (
  `id` int(11) NOT NULL,
  `cliente_id` int(11) DEFAULT NULL,
  `sucursal_id` int(11) NOT NULL DEFAULT 1,
  `vendedor_id` int(11) NOT NULL,
  `subtotal` decimal(10,2) NOT NULL DEFAULT 0.00,
  `descuento` decimal(10,2) NOT NULL DEFAULT 0.00,
  `igv` decimal(10,2) NOT NULL DEFAULT 0.00,
  `total` decimal(10,2) NOT NULL DEFAULT 0.00,
  `observacion` text DEFAULT '',
  `estado` varchar(20) NOT NULL DEFAULT 'vigente',
  `vence_at` date DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cotizacion_items` (
  `id` int(11) NOT NULL,
  `cotizacion_id` int(11) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `presentacion_id` int(11) DEFAULT NULL,
  `cantidad` int(11) NOT NULL,
  `precio_unit` decimal(10,2) NOT NULL,
  `subtotal` decimal(10,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `creditos` (
  `id` int(11) NOT NULL,
  `venta_id` int(11) NOT NULL,
  `total` decimal(10,2) NOT NULL,
  `pagado` decimal(10,2) NOT NULL DEFAULT 0.00,
  `saldo` decimal(10,2) NOT NULL,
  `estado` tinyint(4) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `crm_cliente_etiquetas` (
  `cliente_id` int(11) NOT NULL,
  `etiqueta_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `crm_etiquetas` (
  `id` int(11) NOT NULL,
  `nombre` varchar(80) NOT NULL,
  `color` varchar(20) NOT NULL DEFAULT '#0EA5E9',
  `sucursal_id` int(11) DEFAULT NULL,
  `estado` tinyint(4) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `crm_interacciones` (
  `id` bigint(20) NOT NULL,
  `cliente_id` int(11) NOT NULL,
  `tipo` enum('llamada','whatsapp','correo','visita','nota') NOT NULL DEFAULT 'nota',
  `asunto` varchar(180) NOT NULL,
  `detalle` text NOT NULL,
  `resultado` varchar(180) NOT NULL DEFAULT '',
  `proximo_contacto_at` datetime DEFAULT NULL,
  `usuario_id` int(11) NOT NULL,
  `sucursal_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `crm_tareas` (
  `id` bigint(20) NOT NULL,
  `cliente_id` int(11) DEFAULT NULL,
  `titulo` varchar(180) NOT NULL,
  `descripcion` text NOT NULL,
  `prioridad` enum('baja','media','alta') NOT NULL DEFAULT 'media',
  `estado` enum('pendiente','completada','cancelada') NOT NULL DEFAULT 'pendiente',
  `vence_at` datetime DEFAULT NULL,
  `asignado_a` int(11) NOT NULL,
  `creado_por` int(11) NOT NULL,
  `sucursal_id` int(11) DEFAULT NULL,
  `completado_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cuentas_por_cobrar` (
  `id` int(11) NOT NULL,
  `venta_id` int(11) NOT NULL,
  `cliente_id` int(11) NOT NULL,
  `sucursal_id` int(11) NOT NULL DEFAULT 1,
  `monto_total` decimal(10,2) NOT NULL,
  `monto_pagado` decimal(10,2) DEFAULT 0.00,
  `monto_pendiente` decimal(10,2) NOT NULL,
  `fecha_vencimiento` date DEFAULT NULL,
  `estado` enum('pendiente','parcial','pagado','vencido') DEFAULT 'pendiente',
  `observacion` text DEFAULT '',
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cuotas` (
  `id` int(11) NOT NULL,
  `credito_id` int(11) NOT NULL,
  `nro_cuota` int(11) NOT NULL,
  `fecha_vence` date NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `pagado` decimal(10,2) NOT NULL DEFAULT 0.00,
  `estado` tinyint(4) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `despachos_web` (
  `id` int(11) NOT NULL,
  `pedido_web_id` int(11) NOT NULL,
  `venta_id` int(11) NOT NULL,
  `sucursal_id` int(11) NOT NULL,
  `modalidad` enum('recojo','delivery') NOT NULL DEFAULT 'recojo',
  `estado` varchar(35) NOT NULL DEFAULT 'pendiente_verificacion',
  `codigo_entrega` varchar(30) NOT NULL,
  `contacto_nombre` varchar(200) DEFAULT '',
  `telefono` varchar(30) DEFAULT '',
  `direccion` text DEFAULT '',
  `responsable_reparto` varchar(150) DEFAULT '',
  `usuario_preparacion_id` int(11) DEFAULT NULL,
  `usuario_salida_id` int(11) DEFAULT NULL,
  `usuario_entrega_id` int(11) DEFAULT NULL,
  `fecha_preparacion` datetime DEFAULT NULL,
  `fecha_listo` datetime DEFAULT NULL,
  `fecha_en_camino` datetime DEFAULT NULL,
  `fecha_entregado` datetime DEFAULT NULL,
  `observacion` text DEFAULT '',
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `detalle_cotizaciones` (
  `id` int(11) NOT NULL,
  `cotizacion_id` int(11) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `presentacion_id` int(11) DEFAULT NULL,
  `cantidad` int(11) NOT NULL,
  `precio_unit` decimal(10,2) NOT NULL,
  `subtotal` decimal(10,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `detalle_pedidos_web` (
  `id` int(11) NOT NULL,
  `pedido_id` int(11) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `presentacion_id` int(11) DEFAULT NULL,
  `cantidad` int(11) NOT NULL,
  `precio_unit` decimal(10,2) NOT NULL,
  `subtotal` decimal(10,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `direcciones_web` (
  `id` int(11) NOT NULL,
  `cliente_web_id` int(11) NOT NULL,
  `alias` varchar(50) DEFAULT NULL,
  `direccion` text NOT NULL,
  `referencia` varchar(200) DEFAULT NULL,
  `distrito` varchar(100) DEFAULT NULL,
  `provincia` varchar(100) DEFAULT NULL,
  `departamento` varchar(100) DEFAULT NULL,
  `lat` decimal(10,7) DEFAULT NULL,
  `lng` decimal(10,7) DEFAULT NULL,
  `es_principal` tinyint(4) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `documentos_publicos` (
  `id` bigint(20) NOT NULL,
  `tipo` enum('venta','cotizacion','comprobante') NOT NULL,
  `entidad_id` int(11) NOT NULL,
  `token_hash` char(64) NOT NULL,
  `archivo_relativo` varchar(500) NOT NULL,
  `expires_at` datetime DEFAULT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_access_at` datetime DEFAULT NULL,
  `access_count` int(11) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `inventario` (
  `id` int(11) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `presentacion_id` int(11) NOT NULL,
  `almacen_id` int(11) NOT NULL,
  `stock` int(11) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `inventario_movimientos` (
  `id` int(11) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `presentacion_id` int(11) DEFAULT NULL,
  `sucursal_id` int(11) DEFAULT NULL,
  `almacen_id` int(11) DEFAULT NULL,
  `tipo` enum('SALIDA_VENTA','REPOSICION','AJUSTE_MANUAL','DEVOLUCION','ENTRADA','SALIDA','AJUSTE_ENTRADA','AJUSTE_SALIDA','INGRESO_INICIAL','TRANSFERENCIA_SALIDA','TRANSFERENCIA_ENTRADA','ANULACION') NOT NULL,
  `cantidad` int(11) NOT NULL,
  `stock_antes` int(11) NOT NULL DEFAULT 0,
  `stock_despues` int(11) NOT NULL DEFAULT 0,
  `venta_id` int(11) DEFAULT NULL,
  `referencia` varchar(255) DEFAULT '',
  `precio_unit` decimal(10,2) DEFAULT 0.00,
  `usuario_id` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `inventario_transferencias` (
  `id` bigint(20) NOT NULL,
  `codigo` varchar(40) NOT NULL,
  `sucursal_origen_id` int(11) NOT NULL,
  `sucursal_destino_id` int(11) NOT NULL,
  `estado` enum('borrador','enviada','recibida','cancelada') NOT NULL DEFAULT 'borrador',
  `motivo` varchar(300) NOT NULL,
  `creado_por` int(11) NOT NULL,
  `enviado_por` int(11) DEFAULT NULL,
  `recibido_por` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `enviado_at` datetime DEFAULT NULL,
  `recibido_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `inventario_transferencia_items` (
  `id` bigint(20) NOT NULL,
  `transferencia_id` bigint(20) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `producto_destino_id` int(11) NOT NULL,
  `cantidad` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `login_intentos` (
  `id` bigint(20) NOT NULL,
  `usuario_id` int(11) DEFAULT NULL,
  `identificador` varchar(150) NOT NULL,
  `ip` varchar(45) NOT NULL DEFAULT '',
  `user_agent` varchar(500) NOT NULL DEFAULT '',
  `exitoso` tinyint(4) NOT NULL DEFAULT 0,
  `motivo` varchar(100) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `logos_temporada` (
  `id` int(11) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `temporada` varchar(50) NOT NULL,
  `ruta` varchar(500) NOT NULL,
  `activo` tinyint(4) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `tipo` varchar(30) DEFAULT 'admin'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `metodos_pago` (
  `id` int(11) NOT NULL,
  `nombre` varchar(50) NOT NULL,
  `estado` tinyint(4) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `opciones` (
  `id` int(11) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `icono` varchar(50) DEFAULT '',
  `ruta` varchar(150) NOT NULL,
  `orden` int(11) DEFAULT 1,
  `padre_id` int(11) DEFAULT NULL,
  `estado` tinyint(4) NOT NULL DEFAULT 0,
  `activo` tinyint(4) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `pagos` (
  `id` int(11) NOT NULL,
  `venta_id` int(11) NOT NULL,
  `metodo` varchar(30) DEFAULT 'efectivo',
  `metodo_pago_id` int(11) NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `referencia` varchar(100) DEFAULT '',
  `estado_conciliacion` varchar(12) DEFAULT NULL,
  `conciliado_por` int(11) DEFAULT NULL,
  `conciliado_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pagos_credito` (
  `id` int(11) NOT NULL,
  `cuenta_id` int(11) NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `metodo` enum('efectivo','yape','plin','transferencia') DEFAULT 'efectivo',
  `referencia` varchar(100) DEFAULT '',
  `usuario_id` int(11) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pagos_operaciones_unicas` (
  `id` bigint(20) NOT NULL,
  `metodo` varchar(30) NOT NULL,
  `referencia` varchar(100) NOT NULL,
  `pago_id` int(11) DEFAULT NULL,
  `venta_id` int(11) DEFAULT NULL,
  `pedido_web_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pagos_verificacion` (
  `id` int(11) NOT NULL,
  `venta_id` int(11) NOT NULL,
  `numero_orden` varchar(50) DEFAULT '',
  `sucursal_id` int(11) NOT NULL DEFAULT 1,
  `metodo` enum('yape','plin','transferencia','efectivo') NOT NULL DEFAULT 'efectivo',
  `monto` decimal(10,2) NOT NULL DEFAULT 0.00,
  `numero_operacion` varchar(100) DEFAULT '',
  `imagen_voucher` varchar(500) DEFAULT '',
  `comprobante_admin` varchar(500) DEFAULT '',
  `estado` enum('pendiente','aprobado','rechazado') NOT NULL DEFAULT 'pendiente',
  `estado_pedido` enum('pendiente','preparando','despachado','entregado','cancelado') NOT NULL DEFAULT 'pendiente',
  `verificado_por` int(11) DEFAULT NULL,
  `verificado_at` datetime DEFAULT NULL,
  `notas` text DEFAULT '',
  `created_at` datetime DEFAULT current_timestamp(),
  `pedido_web_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `password_reset_tokens` (
  `id` bigint(20) NOT NULL,
  `usuario_id` int(11) NOT NULL,
  `token_hash` char(64) NOT NULL,
  `intentos` int(11) NOT NULL DEFAULT 0,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pedidos_web` (
  `id` int(11) NOT NULL,
  `numero_orden` varchar(50) NOT NULL,
  `cliente_id` int(11) DEFAULT NULL,
  `cliente_web_id` int(11) DEFAULT NULL,
  `tipo_entrega` enum('delivery','recojo') NOT NULL DEFAULT 'delivery',
  `recojo_fecha_id` int(11) DEFAULT NULL,
  `direccion_entrega` text DEFAULT '',
  `subtotal` decimal(10,2) NOT NULL DEFAULT 0.00,
  `igv` decimal(10,2) NOT NULL DEFAULT 0.00,
  `total` decimal(10,2) NOT NULL DEFAULT 0.00,
  `metodo_pago` varchar(30) DEFAULT 'yape',
  `codigo_operacion` varchar(100) DEFAULT '',
  `comprobante_cliente` varchar(500) DEFAULT '',
  `comprobante_admin` varchar(500) DEFAULT '',
  `notas_admin` text DEFAULT '',
  `estado_pago` varchar(20) NOT NULL DEFAULT 'pendiente',
  `estado_pedido` enum('pendiente','preparando','despachado','entregado','cancelado') NOT NULL DEFAULT 'pendiente',
  `verificado_by` int(11) DEFAULT NULL,
  `verificado_at` datetime DEFAULT NULL,
  `venta_id` int(11) DEFAULT NULL,
  `sucursal_id` int(11) DEFAULT NULL,
  `estado` tinyint(4) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `codigo` varchar(30) DEFAULT NULL,
  `cliente_nombre` varchar(200) NOT NULL DEFAULT 'Cliente web',
  `cliente_doc` varchar(20) DEFAULT '',
  `telefono` varchar(30) DEFAULT '',
  `direccion` text DEFAULT '',
  `numero_operacion` varchar(100) NOT NULL DEFAULT '',
  `imagen_voucher` varchar(500) DEFAULT '',
  `stock_liberado` tinyint(4) NOT NULL DEFAULT 0,
  `updated_at` datetime DEFAULT NULL,
  `cliente_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`cliente_snapshot`)),
  `direccion_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`direccion_snapshot`)),
  `facturacion_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`facturacion_snapshot`)),
  `es_multisucursal` tinyint(4) NOT NULL DEFAULT 0,
  `processed_by` int(11) DEFAULT NULL,
  `processed_at` datetime DEFAULT NULL,
  `reserva_expires_at` datetime DEFAULT NULL,
  `version` int(11) NOT NULL DEFAULT 1,
  `rechazo_motivo` varchar(500) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pedido_entregas_sucursal` (
  `id` bigint(20) NOT NULL,
  `pedido_id` int(11) NOT NULL,
  `venta_id` int(11) DEFAULT NULL,
  `sucursal_id` int(11) NOT NULL,
  `tipo_entrega` enum('delivery','recojo') NOT NULL,
  `estado` enum('pendiente','preparando','listo','asignado','en_ruta','entregado','incidencia','cancelado') NOT NULL DEFAULT 'pendiente',
  `codigo_recojo_hash` char(64) DEFAULT NULL,
  `codigo_recojo_enc` text DEFAULT NULL,
  `codigo_generado_at` datetime DEFAULT NULL,
  `codigo_usado_at` datetime DEFAULT NULL,
  `preparado_por` int(11) DEFAULT NULL,
  `entregado_por` int(11) DEFAULT NULL,
  `persona_recibe` varchar(200) NOT NULL DEFAULT '',
  `documento_recibe` varchar(20) NOT NULL DEFAULT '',
  `observacion` varchar(500) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pedido_items` (
  `id` int(11) NOT NULL,
  `pedido_id` int(11) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `presentacion_id` int(11) DEFAULT NULL,
  `cantidad` int(11) NOT NULL,
  `precio_unit` decimal(10,2) NOT NULL,
  `subtotal` decimal(10,2) NOT NULL,
  `sucursal_id` int(11) DEFAULT NULL,
  `costo_unitario_snapshot` decimal(10,2) NOT NULL DEFAULT 0.00,
  `nombre_snapshot` varchar(200) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `pedido_recojo_reservas` (
  `id` bigint(20) NOT NULL,
  `pedido_id` int(11) NOT NULL,
  `sucursal_id` int(11) NOT NULL,
  `horario_id` int(11) NOT NULL,
  `estado` enum('reservado','confirmado','liberado','utilizado') NOT NULL DEFAULT 'reservado',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `perfiles` (
  `id` int(11) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `descripcion` text DEFAULT '',
  `estado` tinyint(4) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `es_global` tinyint(4) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `perfil_opciones` (
  `perfil_id` int(11) NOT NULL,
  `opcion_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `perfil_permisos` (
  `perfil_id` int(11) NOT NULL,
  `opcion_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `perfil_permisos_accion` (
  `perfil_id` int(11) NOT NULL,
  `permiso_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `permisos_accion` (
  `id` int(11) NOT NULL,
  `slug` varchar(120) NOT NULL,
  `modulo` varchar(60) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `descripcion` varchar(255) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `precios_volumen` (
  `id` int(11) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `cantidad_desde` int(11) NOT NULL,
  `precio_unit` decimal(10,2) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `presentaciones` (
  `id` int(11) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `catalogo_id` int(11) DEFAULT NULL,
  `nombre` varchar(100) NOT NULL,
  `precio_costo` decimal(10,2) NOT NULL DEFAULT 0.00,
  `precio_venta` decimal(10,2) NOT NULL DEFAULT 0.00,
  `es_principal` tinyint(4) NOT NULL DEFAULT 0,
  `estado` tinyint(4) NOT NULL DEFAULT 0,
  `stock` int(11) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `presentaciones_catalogo` (
  `id` int(11) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `descripcion` text DEFAULT '',
  `estado` tinyint(4) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `productos` (
  `id` int(11) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `descripcion` text DEFAULT '',
  `marca` varchar(100) DEFAULT '',
  `modelo` varchar(100) DEFAULT '',
  `sku` varchar(100) DEFAULT NULL,
  `codigo_barras` varchar(100) DEFAULT '',
  `precio_costo` decimal(10,2) DEFAULT 0.00,
  `precio_venta` decimal(10,2) NOT NULL DEFAULT 0.00,
  `porcentaje_oferta` decimal(5,2) DEFAULT 0.00,
  `peso_kg` decimal(6,2) DEFAULT NULL,
  `dimensiones` varchar(50) DEFAULT NULL,
  `garantia_meses` int(11) DEFAULT 0,
  `atributo_extra` varchar(100) DEFAULT NULL,
  `stock_minimo` int(11) DEFAULT 0,
  `stock_maximo` int(11) DEFAULT 0,
  `imagen` varchar(255) DEFAULT '',
  `sucursal_id` int(11) DEFAULT NULL,
  `estado` tinyint(4) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `stock_actual` int(11) NOT NULL DEFAULT 0,
  `valoracion` decimal(3,1) DEFAULT 0.0,
  `categoria_id` int(11) DEFAULT NULL,
  `unidad` varchar(30) DEFAULT 'unidad'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `producto_imagenes` (
  `id` int(11) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `ruta` varchar(500) NOT NULL,
  `es_portada` tinyint(4) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `orden` int(11) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `proveedores` (
  `id` int(11) NOT NULL,
  `razon_social` varchar(200) NOT NULL,
  `ruc` varchar(20) DEFAULT '',
  `contacto` varchar(100) DEFAULT '',
  `telefono` varchar(30) DEFAULT '',
  `email` varchar(100) DEFAULT '',
  `direccion` text DEFAULT '',
  `estado` tinyint(4) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `recojo_fechas` (
  `id` int(11) NOT NULL,
  `fecha` date NOT NULL,
  `hora_inicio` time NOT NULL,
  `hora_fin` time NOT NULL,
  `cupos_total` int(11) NOT NULL DEFAULT 10,
  `cupos_usados` int(11) NOT NULL DEFAULT 0,
  `estado` tinyint(4) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `sucursal_id` int(11) DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `repartidores` (
  `id` int(11) NOT NULL,
  `usuario_id` int(11) DEFAULT NULL,
  `sucursal_id` int(11) DEFAULT NULL,
  `nombres` varchar(160) NOT NULL,
  `documento` varchar(20) NOT NULL DEFAULT '',
  `telefono` varchar(30) NOT NULL DEFAULT '',
  `licencia` varchar(40) NOT NULL DEFAULT '',
  `categoria_licencia` varchar(20) NOT NULL DEFAULT '',
  `licencia_vencimiento` date DEFAULT NULL,
  `contacto_emergencia` varchar(160) NOT NULL DEFAULT '',
  `telefono_emergencia` varchar(30) NOT NULL DEFAULT '',
  `estado` tinyint(4) NOT NULL DEFAULT 1 COMMENT '1 activo, 0 inactivo, 2 eliminado',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `reservas_web` (
  `id` bigint(20) NOT NULL,
  `pedido_id` int(11) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `sucursal_id` int(11) NOT NULL,
  `cantidad` int(11) NOT NULL,
  `estado` enum('activa','consumida','liberada','vencida') NOT NULL DEFAULT 'activa',
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `resumenes_boletas` (
  `id` int(11) NOT NULL,
  `tipo` varchar(5) NOT NULL DEFAULT 'RC' COMMENT 'RC=resumen boletas',
  `identificador` varchar(20) NOT NULL COMMENT 'Ej: 20240101 (fecha) o correlativo',
  `correlativo` int(11) NOT NULL DEFAULT 1,
  `fecha_referencia` date NOT NULL COMMENT 'Fecha de las boletas resumidas',
  `fecha_envio` date NOT NULL,
  `ticket` varchar(100) DEFAULT NULL COMMENT 'Ticket que devuelve SUNAT',
  `estado_sunat` enum('pendiente','enviado','aceptado','rechazado') DEFAULT 'pendiente',
  `cdr_mensaje` varchar(500) DEFAULT NULL,
  `total_boletas` int(11) NOT NULL DEFAULT 0,
  `monto_total` decimal(10,2) NOT NULL DEFAULT 0.00,
  `sucursal_id` int(11) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `resumen_boletas_items` (
  `id` int(11) NOT NULL,
  `resumen_id` int(11) NOT NULL,
  `comprobante_id` int(11) DEFAULT NULL,
  `serie` varchar(10) NOT NULL,
  `correlativo` varchar(20) NOT NULL,
  `importe_total` decimal(10,2) NOT NULL DEFAULT 0.00,
  `op_gravadas` decimal(10,2) NOT NULL DEFAULT 0.00,
  `igv_total` decimal(10,2) NOT NULL DEFAULT 0.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rutas_reparto` (
  `id` int(11) NOT NULL,
  `codigo` varchar(40) NOT NULL,
  `fecha` date NOT NULL,
  `sucursal_id` int(11) NOT NULL,
  `repartidor_id` int(11) NOT NULL,
  `vehiculo_id` int(11) NOT NULL,
  `estado` enum('planificada','cargada','en_ruta','completada','cancelada') NOT NULL DEFAULT 'planificada',
  `hora_salida_programada` time DEFAULT NULL,
  `hora_salida_real` datetime DEFAULT NULL,
  `hora_retorno` datetime DEFAULT NULL,
  `km_inicial` decimal(12,2) NOT NULL DEFAULT 0.00,
  `km_final` decimal(12,2) NOT NULL DEFAULT 0.00,
  `observaciones` varchar(500) NOT NULL DEFAULT '',
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ruta_reparto_pedidos` (
  `id` int(11) NOT NULL,
  `ruta_id` int(11) NOT NULL,
  `pedido_web_id` int(11) DEFAULT NULL,
  `venta_id` int(11) DEFAULT NULL,
  `orden` int(11) NOT NULL DEFAULT 1,
  `cliente_nombre` varchar(200) NOT NULL DEFAULT '',
  `telefono` varchar(30) NOT NULL DEFAULT '',
  `direccion` varchar(500) NOT NULL DEFAULT '',
  `monto_cobrar` decimal(12,2) NOT NULL DEFAULT 0.00,
  `peso_estimado_kg` decimal(12,2) NOT NULL DEFAULT 0.00,
  `monto_cobrado` decimal(12,2) NOT NULL DEFAULT 0.00,
  `metodo_cobro` varchar(30) NOT NULL DEFAULT '',
  `estado` enum('pendiente','en_camino','entregado','no_entregado') NOT NULL DEFAULT 'pendiente',
  `receptor_nombre` varchar(160) NOT NULL DEFAULT '',
  `receptor_documento` varchar(20) NOT NULL DEFAULT '',
  `observacion_entrega` varchar(500) NOT NULL DEFAULT '',
  `entregado_at` datetime DEFAULT NULL,
  `updated_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `series_comprobante` (
  `id` int(11) NOT NULL,
  `tipo` enum('nota_venta','boleta','factura','nota_credito','nota_debito') NOT NULL,
  `serie` varchar(10) NOT NULL,
  `ultimo_numero` int(11) NOT NULL DEFAULT 0,
  `estado` tinyint(4) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sucursales` (
  `id` int(11) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `direccion` text DEFAULT '',
  `estado` tinyint(4) NOT NULL DEFAULT 0,
  `telefono` varchar(30) DEFAULT '',
  `created_at` datetime DEFAULT current_timestamp(),
  `monto_inicial_caja` decimal(10,2) NOT NULL DEFAULT 100.00,
  `hora_apertura_caja` time NOT NULL DEFAULT '08:00:00',
  `hora_cierre_caja` time NOT NULL DEFAULT '22:00:00',
  `caja_configurada` tinyint(4) NOT NULL DEFAULT 0,
  `max_cajas` smallint(5) UNSIGNED NOT NULL DEFAULT 5
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `temporadas` (
  `id` int(11) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date NOT NULL,
  `estado` tinyint(4) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `temporada_descuentos` (
  `id` int(11) NOT NULL,
  `temporada_id` int(11) NOT NULL,
  `producto_id` int(11) DEFAULT NULL,
  `categoria_id` int(11) DEFAULT NULL,
  `porcentaje` decimal(5,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `tienda_imagenes` (
  `id` int(11) NOT NULL,
  `tipo` enum('logo','slider') NOT NULL,
  `nombre` varchar(255) NOT NULL DEFAULT '',
  `ruta` varchar(500) NOT NULL,
  `orden` int(11) NOT NULL DEFAULT 0,
  `estado` tinyint(4) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `usuarios` (
  `id` int(11) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `username` varchar(50) NOT NULL,
  `email` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `perfil_id` int(11) NOT NULL,
  `sucursal_id` int(11) DEFAULT NULL,
  `estado` tinyint(4) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `es_global` tinyint(4) NOT NULL DEFAULT 0,
  `puede_operar_caja` tinyint(4) NOT NULL DEFAULT 0,
  `pin_cajero_hash` varchar(255) DEFAULT NULL,
  `login_fail_count` int(11) NOT NULL DEFAULT 0,
  `locked_until` datetime DEFAULT NULL,
  `session_version` int(11) NOT NULL DEFAULT 1,
  `last_login_at` datetime DEFAULT NULL,
  `password_changed_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `usuario_caja_accesos` (
  `id` int(11) NOT NULL,
  `usuario_id` int(11) NOT NULL,
  `caja_id` int(11) NOT NULL,
  `activo` tinyint(4) NOT NULL DEFAULT 1,
  `asignado_por` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `vehiculos` (
  `id` int(11) NOT NULL,
  `sucursal_id` int(11) DEFAULT NULL,
  `placa` varchar(15) NOT NULL,
  `tipo` varchar(30) NOT NULL DEFAULT 'camion',
  `marca` varchar(60) NOT NULL DEFAULT '',
  `modelo` varchar(60) NOT NULL DEFAULT '',
  `anio` smallint(6) DEFAULT NULL,
  `capacidad_kg` decimal(12,2) NOT NULL DEFAULT 0.00,
  `capacidad_m3` decimal(10,2) NOT NULL DEFAULT 0.00,
  `soat_vencimiento` date DEFAULT NULL,
  `revision_vencimiento` date DEFAULT NULL,
  `estado_operativo` enum('disponible','en_ruta','mantenimiento','inactivo') NOT NULL DEFAULT 'disponible',
  `observaciones` varchar(500) NOT NULL DEFAULT '',
  `estado` tinyint(4) NOT NULL DEFAULT 1 COMMENT '1 activo, 0 inactivo, 2 eliminado',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `ventas` (
  `id` int(11) NOT NULL,
  `numero` varchar(20) NOT NULL,
  `serie` varchar(10) NOT NULL DEFAULT 'V001',
  `tipo_comprobante` enum('nota','boleta','factura','nota_venta','cotizacion') NOT NULL DEFAULT 'nota',
  `tipo_entrega` enum('presencial','delivery','recojo') NOT NULL DEFAULT 'presencial',
  `tipo_venta` enum('contado','credito') NOT NULL DEFAULT 'contado',
  `cliente_id` int(11) DEFAULT NULL,
  `vendedor_id` int(11) NOT NULL,
  `updated_by` int(11) DEFAULT NULL,
  `sucursal_id` int(11) NOT NULL DEFAULT 1,
  `subtotal` decimal(10,2) NOT NULL DEFAULT 0.00,
  `igv` decimal(10,2) NOT NULL DEFAULT 0.00,
  `total` decimal(10,2) NOT NULL DEFAULT 0.00,
  `igv_porcentaje` decimal(5,2) NOT NULL DEFAULT 18.00,
  `estado` enum('pendiente_pago','pagado','aprobado','rechazado','anulada','pendiente','pagada') NOT NULL DEFAULT 'pendiente_pago',
  `estado_venta` enum('registrada','anulada') NOT NULL DEFAULT 'registrada',
  `estado_sunat` enum('sin_emitir','emitido','aceptado','rechazado') NOT NULL DEFAULT 'sin_emitir',
  `metodo_pago` enum('efectivo','yape','plin','transferencia','izipay','credito') DEFAULT 'efectivo',
  `observacion` text DEFAULT '',
  `cotizacion_id` int(11) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `descuento` decimal(10,2) NOT NULL DEFAULT 0.00,
  `caja_id` int(11) DEFAULT NULL,
  `canal` varchar(20) NOT NULL DEFAULT 'pos',
  `cliente_web_nombre` varchar(200) DEFAULT '',
  `cliente_web_doc` varchar(20) DEFAULT '',
  `pedido_web_id` int(11) DEFAULT NULL,
  `es_multisucursal` tinyint(4) NOT NULL DEFAULT 0,
  `cliente_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`cliente_snapshot`)),
  `direccion_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`direccion_snapshot`)),
  `facturacion_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`facturacion_snapshot`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `venta_items` (
  `id` int(11) NOT NULL,
  `venta_id` int(11) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `presentacion_id` int(11) DEFAULT NULL,
  `cantidad` int(11) NOT NULL,
  `precio_unit` decimal(10,2) NOT NULL,
  `descuento` decimal(10,2) NOT NULL DEFAULT 0.00,
  `subtotal` decimal(10,2) NOT NULL,
  `descuento_unit` decimal(10,2) DEFAULT 0.00,
  `sucursal_id` int(11) DEFAULT NULL,
  `costo_unitario` decimal(10,2) NOT NULL DEFAULT 0.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `almacenes`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `app_sessions`
  ADD PRIMARY KEY (`session_id`);

ALTER TABLE `auditoria`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_usuario` (`usuario_id`),
  ADD KEY `idx_modulo` (`modulo`),
  ADD KEY `idx_fecha` (`created_at`);

ALTER TABLE `auditoria_eventos`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_auditoria_usuario_fecha` (`usuario_id`,`created_at`),
  ADD KEY `idx_auditoria_modulo_fecha` (`modulo`,`created_at`),
  ADD KEY `idx_auditoria_entidad` (`entidad`,`entidad_id`);

ALTER TABLE `cajas`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_caja_estado` (`estado`),
  ADD KEY `idx_caja_sucursal` (`sucursal_id`),
  ADD KEY `idx_caja_sesion_fisica` (`caja_fisica_id`,`estado`),
  ADD KEY `idx_caja_sesion_usuario` (`usuario_apertura_id`,`estado`),
  ADD KEY `idx_caja_cierre_programado` (`fecha_cierre_programada`);

ALTER TABLE `cajas_fisicas`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_caja_fisica_sucursal_codigo` (`sucursal_id`,`codigo`),
  ADD KEY `idx_caja_fisica_sucursal_activo` (`sucursal_id`,`activo`),
  ADD KEY `idx_caja_fisica_sucursal` (`sucursal_id`,`activo`);

ALTER TABLE `caja_movimientos`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_sesion` (`sesion_id`);

ALTER TABLE `caja_sesiones`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_sucursal` (`sucursal_id`),
  ADD KEY `conciliada_por` (`conciliada_por`),
  ADD KEY `revertida_por` (`revertida_por`),
  ADD KEY `idx_caja_usuario` (`usuario_id`,`estado`),
  ADD KEY `idx_caja_sucursal` (`sucursal_id`,`abierta_at`),
  ADD KEY `idx_caja_numero` (`numero_caja`,`sucursal_id`),
  ADD KEY `idx_caja_sesion_usuario_estado` (`usuario_id`,`estado`),
  ADD KEY `idx_caja_sesion_fisica_estado` (`caja_fisica_id`,`estado`),
  ADD KEY `idx_caja_sesion_estado_arqueo` (`estado`,`bloqueada_at`);

ALTER TABLE `categorias`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `clientes`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `numero_doc` (`numero_doc`);

ALTER TABLE `clientes_web`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_email` (`email`),
  ADD UNIQUE KEY `uq_google` (`google_id`),
  ADD KEY `idx_cliente` (`cliente_id`);

ALTER TABLE `compras`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `compra_items`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_compra` (`compra_id`);

ALTER TABLE `comprobantes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_comprobante_venta` (`venta_id`,`tipo`),
  ADD UNIQUE KEY `uq_serie_numero` (`tipo`,`serie`,`numero`);

ALTER TABLE `comunicaciones_baja`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `comunicacion_baja_items`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_baja` (`baja_id`);

ALTER TABLE `configuracion`
  ADD PRIMARY KEY (`clave`);

ALTER TABLE `correlativos_comprobante`
  ADD PRIMARY KEY (`serie`);

ALTER TABLE `cotizaciones`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `cotizacion_items`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `creditos`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_venta` (`venta_id`);

ALTER TABLE `crm_cliente_etiquetas`
  ADD PRIMARY KEY (`cliente_id`,`etiqueta_id`);

ALTER TABLE `crm_etiquetas`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_crm_etiqueta_sucursal` (`nombre`,`sucursal_id`);

ALTER TABLE `crm_interacciones`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_crm_interaccion_cliente` (`cliente_id`,`created_at`),
  ADD KEY `idx_crm_interaccion_proximo` (`proximo_contacto_at`);

ALTER TABLE `crm_tareas`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_crm_tarea_asignado` (`asignado_a`,`estado`,`vence_at`),
  ADD KEY `idx_crm_tarea_cliente` (`cliente_id`);

ALTER TABLE `cuentas_por_cobrar`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_cliente` (`cliente_id`),
  ADD KEY `idx_venta` (`venta_id`);

ALTER TABLE `cuotas`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_credito` (`credito_id`);

ALTER TABLE `despachos_web`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `venta_id` (`venta_id`),
  ADD UNIQUE KEY `idx_despacho_venta` (`venta_id`),
  ADD KEY `idx_despacho_sucursal` (`sucursal_id`),
  ADD KEY `idx_despacho_estado` (`estado`),
  ADD KEY `idx_despacho_pedido` (`pedido_web_id`),
  ADD KEY `idx_despacho_estado_v24` (`estado`),
  ADD KEY `idx_despacho_sucursal_v24` (`sucursal_id`);

ALTER TABLE `detalle_cotizaciones`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_cotizacion` (`cotizacion_id`);

ALTER TABLE `detalle_pedidos_web`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_pedido` (`pedido_id`);

ALTER TABLE `direcciones_web`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_clienteweb` (`cliente_web_id`);

ALTER TABLE `documentos_publicos`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_documento_token` (`token_hash`),
  ADD KEY `idx_documento_entidad` (`tipo`,`entidad_id`);

ALTER TABLE `inventario`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_pres_almacen` (`presentacion_id`,`almacen_id`);

ALTER TABLE `inventario_movimientos`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_prod` (`producto_id`),
  ADD KEY `idx_suc` (`sucursal_id`);

ALTER TABLE `inventario_transferencias`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_transferencia_codigo` (`codigo`),
  ADD KEY `idx_transferencia_origen` (`sucursal_origen_id`,`estado`),
  ADD KEY `idx_transferencia_destino` (`sucursal_destino_id`,`estado`);

ALTER TABLE `inventario_transferencia_items`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_transferencia_producto` (`transferencia_id`,`producto_id`);

ALTER TABLE `login_intentos`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_login_identificador_fecha` (`identificador`,`created_at`),
  ADD KEY `idx_login_ip_fecha` (`ip`,`created_at`),
  ADD KEY `idx_login_usuario_fecha` (`usuario_id`,`created_at`);

ALTER TABLE `logos_temporada`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `metodos_pago`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `opciones`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `slug` (`slug`);

ALTER TABLE `pagos`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_venta` (`venta_id`);

ALTER TABLE `pagos_credito`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_cuenta` (`cuenta_id`);

ALTER TABLE `pagos_operaciones_unicas`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_pago_operacion_referencia` (`referencia`),
  ADD KEY `idx_pago_operacion_venta` (`venta_id`),
  ADD KEY `idx_pago_operacion_pedido_web` (`pedido_web_id`);

ALTER TABLE `pagos_verificacion`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_venta` (`venta_id`),
  ADD KEY `idx_suc` (`sucursal_id`),
  ADD KEY `idx_pago_fecha` (`created_at`),
  ADD KEY `idx_pagos_pedido_web` (`pedido_web_id`);

ALTER TABLE `password_reset_tokens`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_password_reset_hash` (`token_hash`),
  ADD KEY `idx_password_reset_usuario` (`usuario_id`,`expires_at`);

ALTER TABLE `pedidos_web`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `idx_pedido_codigo` (`codigo`),
  ADD KEY `idx_pw_clienteweb` (`cliente_web_id`);

ALTER TABLE `pedido_entregas_sucursal`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_entrega_pedido_sucursal` (`pedido_id`,`sucursal_id`),
  ADD UNIQUE KEY `uq_codigo_recojo_hash` (`codigo_recojo_hash`),
  ADD KEY `idx_entrega_sucursal_estado` (`sucursal_id`,`estado`);

ALTER TABLE `pedido_items`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `pedido_recojo_reservas`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_recojo_pedido_sucursal` (`pedido_id`,`sucursal_id`),
  ADD KEY `idx_recojo_horario_estado` (`horario_id`,`estado`);

ALTER TABLE `perfiles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `nombre` (`nombre`);

ALTER TABLE `perfil_opciones`
  ADD PRIMARY KEY (`perfil_id`,`opcion_id`);

ALTER TABLE `perfil_permisos`
  ADD PRIMARY KEY (`perfil_id`,`opcion_id`);

ALTER TABLE `perfil_permisos_accion`
  ADD PRIMARY KEY (`perfil_id`,`permiso_id`),
  ADD KEY `idx_ppa_permiso` (`permiso_id`);

ALTER TABLE `permisos_accion`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_permiso_accion_slug` (`slug`),
  ADD KEY `idx_permiso_modulo` (`modulo`);

ALTER TABLE `precios_volumen`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_producto` (`producto_id`);

ALTER TABLE `presentaciones`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_producto` (`producto_id`);

ALTER TABLE `presentaciones_catalogo`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `productos`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `producto_imagenes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_producto` (`producto_id`);

ALTER TABLE `proveedores`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `recojo_fechas`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_recojo_sucursal_fecha` (`sucursal_id`,`fecha`,`estado`);

ALTER TABLE `repartidores`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_repartidor_usuario` (`usuario_id`),
  ADD KEY `idx_repartidor_sucursal_estado` (`sucursal_id`,`estado`),
  ADD KEY `idx_repartidor_documento` (`documento`);

ALTER TABLE `reservas_web`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_reserva_pedido_producto_sucursal` (`pedido_id`,`producto_id`,`sucursal_id`),
  ADD KEY `idx_reserva_producto_estado` (`producto_id`,`sucursal_id`,`estado`,`expires_at`);

ALTER TABLE `resumenes_boletas`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_fecha` (`fecha_referencia`);

ALTER TABLE `resumen_boletas_items`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_resumen` (`resumen_id`);

ALTER TABLE `rutas_reparto`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_ruta_codigo` (`codigo`),
  ADD KEY `idx_ruta_fecha_sucursal` (`fecha`,`sucursal_id`),
  ADD KEY `idx_ruta_repartidor` (`repartidor_id`,`fecha`,`estado`),
  ADD KEY `idx_ruta_vehiculo` (`vehiculo_id`,`fecha`,`estado`);

ALTER TABLE `ruta_reparto_pedidos`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_ruta_pedido_web` (`pedido_web_id`),
  ADD KEY `idx_ruta_venta` (`venta_id`),
  ADD KEY `idx_ruta_detalle` (`ruta_id`,`orden`),
  ADD KEY `idx_entrega_estado` (`estado`,`entregado_at`);

ALTER TABLE `series_comprobante`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_tipo_serie` (`tipo`,`serie`);

ALTER TABLE `sucursales`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `temporadas`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `temporada_descuentos`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_temporada` (`temporada_id`);

ALTER TABLE `tienda_imagenes`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `usuarios`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `username` (`username`),
  ADD UNIQUE KEY `email` (`email`);

ALTER TABLE `usuario_caja_accesos`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_usuario_caja_acceso` (`usuario_id`,`caja_id`),
  ADD KEY `idx_acceso_caja_activo` (`caja_id`,`activo`),
  ADD KEY `idx_acceso_usuario_activo` (`usuario_id`,`activo`);

ALTER TABLE `vehiculos`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_vehiculo_placa` (`placa`),
  ADD KEY `idx_vehiculo_sucursal_estado` (`sucursal_id`,`estado_operativo`,`estado`);

ALTER TABLE `ventas`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `numero` (`numero`),
  ADD KEY `idx_ventas_fechas` (`created_at`),
  ADD KEY `idx_ventas_canal` (`canal`),
  ADD KEY `idx_ventas_caja` (`caja_id`),
  ADD KEY `idx_ventas_pedido_web` (`pedido_web_id`);

ALTER TABLE `venta_items`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_venta` (`venta_id`),
  ADD KEY `idx_prod` (`producto_id`);

ALTER TABLE `almacenes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `auditoria`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `auditoria_eventos`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

ALTER TABLE `cajas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `cajas_fisicas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `caja_movimientos`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `caja_sesiones`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `categorias`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `clientes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `clientes_web`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `compras`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `compra_items`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `comprobantes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `comunicaciones_baja`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `comunicacion_baja_items`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `cotizaciones`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `cotizacion_items`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `creditos`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `crm_etiquetas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `crm_interacciones`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

ALTER TABLE `crm_tareas`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

ALTER TABLE `cuentas_por_cobrar`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `cuotas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `despachos_web`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `detalle_cotizaciones`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `detalle_pedidos_web`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `direcciones_web`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `documentos_publicos`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

ALTER TABLE `inventario`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `inventario_movimientos`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `inventario_transferencias`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

ALTER TABLE `inventario_transferencia_items`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

ALTER TABLE `login_intentos`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

ALTER TABLE `logos_temporada`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `metodos_pago`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `opciones`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `pagos`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `pagos_credito`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `pagos_operaciones_unicas`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

ALTER TABLE `pagos_verificacion`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `password_reset_tokens`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

ALTER TABLE `pedidos_web`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `pedido_entregas_sucursal`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

ALTER TABLE `pedido_items`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `pedido_recojo_reservas`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

ALTER TABLE `perfiles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `permisos_accion`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `precios_volumen`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `presentaciones`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `presentaciones_catalogo`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `productos`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `producto_imagenes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `proveedores`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `recojo_fechas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `repartidores`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `reservas_web`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

ALTER TABLE `resumenes_boletas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `resumen_boletas_items`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `rutas_reparto`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `ruta_reparto_pedidos`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `series_comprobante`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `sucursales`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `temporadas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `temporada_descuentos`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `tienda_imagenes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `usuarios`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `usuario_caja_accesos`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `vehiculos`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `ventas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `venta_items`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `caja_sesiones`
  ADD CONSTRAINT `caja_sesiones_ibfk_1` FOREIGN KEY (`conciliada_por`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `caja_sesiones_ibfk_2` FOREIGN KEY (`revertida_por`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL;

ALTER TABLE `clientes_web`
  ADD CONSTRAINT `fk_clienteweb_cliente` FOREIGN KEY (`cliente_id`) REFERENCES `clientes` (`id`) ON DELETE SET NULL;

ALTER TABLE `direcciones_web`
  ADD CONSTRAINT `fk_dir_clienteweb` FOREIGN KEY (`cliente_web_id`) REFERENCES `clientes_web` (`id`) ON DELETE CASCADE;

ALTER TABLE `precios_volumen`
  ADD CONSTRAINT `fk_pv_producto` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE CASCADE;

ALTER TABLE `ruta_reparto_pedidos`
  ADD CONSTRAINT `fk_ruta_detalle_ruta` FOREIGN KEY (`ruta_id`) REFERENCES `rutas_reparto` (`id`) ON DELETE CASCADE;

ALTER TABLE `clientes` ADD COLUMN IF NOT EXISTS `direccion_enc` TEXT NULL AFTER `departamento`;

ALTER TABLE `clientes` ADD COLUMN IF NOT EXISTS `distrito_enc` TEXT NULL AFTER `direccion_enc`;

ALTER TABLE `clientes` ADD COLUMN IF NOT EXISTS `provincia_enc` TEXT NULL AFTER `distrito_enc`;

ALTER TABLE `clientes` ADD COLUMN IF NOT EXISTS `departamento_enc` TEXT NULL AFTER `provincia_enc`;

ALTER TABLE `cotizaciones` ADD COLUMN IF NOT EXISTS `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `productos` ADD COLUMN IF NOT EXISTS `es_transferido` TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE `productos` ADD COLUMN IF NOT EXISTS `producto_origen_id` INT NULL;

ALTER TABLE `productos` ADD COLUMN IF NOT EXISTS `sucursal_origen_id` INT NULL;

ALTER TABLE `productos` ADD COLUMN IF NOT EXISTS `transferencia_venta_habilitada` TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE `temporada_descuentos` ADD COLUMN IF NOT EXISTS `tipo_descuento` enum('porcentaje','monto') NOT NULL DEFAULT 'porcentaje' AFTER `producto_id`;

ALTER TABLE `temporada_descuentos` ADD COLUMN IF NOT EXISTS `monto` DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `porcentaje`;

ALTER TABLE `temporada_descuentos` ADD UNIQUE INDEX IF NOT EXISTS `uq_temporada_producto` (`temporada_id`,`producto_id`);

CREATE TABLE IF NOT EXISTS `reparto_evidencias` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `ruta_id` INT NOT NULL,
  `ruta_detalle_id` INT NOT NULL,
  `tipo` ENUM('fachada','entrega','incidencia') NOT NULL DEFAULT 'entrega',
  `archivo_privado` VARCHAR(500) NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `created_by` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `eliminado_at` DATETIME NULL,
  `eliminado_por` INT NULL,
  `motivo_eliminacion` VARCHAR(300) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `idx_evidencia_ruta` (`ruta_id`,`ruta_detalle_id`,`eliminado_at`),
  UNIQUE KEY `uq_evidencia_detalle_hash` (`ruta_detalle_id`,`sha256`),
  CONSTRAINT `fk_evidencia_ruta` FOREIGN KEY (`ruta_id`) REFERENCES `rutas_reparto` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_evidencia_detalle` FOREIGN KEY (`ruta_detalle_id`) REFERENCES `ruta_reparto_pedidos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reparto_historial` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `ruta_id` INT NOT NULL,
  `ruta_detalle_id` INT NULL,
  `estado_anterior` VARCHAR(40) NOT NULL DEFAULT '',
  `estado_nuevo` VARCHAR(40) NOT NULL DEFAULT '',
  `comentario` VARCHAR(500) NOT NULL DEFAULT '',
  `lat` DECIMAL(10,7) NULL,
  `lng` DECIMAL(10,7) NULL,
  `precision_m` DECIMAL(10,2) NULL,
  `usuario_id` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_historial_ruta` (`ruta_id`,`ruta_detalle_id`,`created_at`),
  CONSTRAINT `fk_historial_ruta` FOREIGN KEY (`ruta_id`) REFERENCES `rutas_reparto` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_historial_detalle` FOREIGN KEY (`ruta_detalle_id`) REFERENCES `ruta_reparto_pedidos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `pedidos_web`
  ADD COLUMN IF NOT EXISTS `costo_delivery` DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `total`;

ALTER TABLE `ventas`
  ADD COLUMN IF NOT EXISTS `costo_delivery` DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `total`;

ALTER TABLE `ruta_reparto_pedidos`
  ADD COLUMN IF NOT EXISTS `pedido_entrega_sucursal_id` BIGINT NULL AFTER `pedido_web_id`;

ALTER TABLE `productos`
  ADD COLUMN IF NOT EXISTS `es_transferido` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `producto_origen_id` INT NULL,
  ADD COLUMN IF NOT EXISTS `sucursal_origen_id` INT NULL,
  ADD COLUMN IF NOT EXISTS `transferencia_venta_habilitada` TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE `productos`
  ADD INDEX IF NOT EXISTS `idx_producto_venta_sucursal`
  (`sucursal_id`,`estado`,`es_transferido`,`transferencia_venta_habilitada`,`stock_actual`);

ALTER TABLE `ventas`
  ADD INDEX IF NOT EXISTS `idx_ventas_reporte_canal`
  (`sucursal_id`,`estado_venta`,`created_at`,`canal`);

ALTER TABLE `pedidos_web`
  ADD INDEX IF NOT EXISTS `idx_pedidos_web_operacion`
  (`estado_pago`,`estado_pedido`,`tipo_entrega`,`created_at`);

ALTER TABLE `pedido_items`
  ADD INDEX IF NOT EXISTS `idx_pedido_items_sucursal`
  (`pedido_id`,`sucursal_id`,`producto_id`);

ALTER TABLE `pedido_entregas_sucursal`
  ADD INDEX IF NOT EXISTS `idx_entregas_delivery`
  (`tipo_entrega`,`estado`,`sucursal_id`,`pedido_id`);

ALTER TABLE `ruta_reparto_pedidos`
  ADD INDEX IF NOT EXISTS `idx_ruta_entrega_sucursal`
  (`pedido_entrega_sucursal_id`,`estado`);

ALTER TABLE `caja_sesiones`
  ADD INDEX IF NOT EXISTS `idx_caja_usuario_estado`
  (`usuario_id`,`estado`,`sucursal_id`);

ALTER TABLE `reservas_web`
  ADD INDEX IF NOT EXISTS `idx_reservas_stock`
  (`producto_id`,`sucursal_id`,`estado`,`expires_at`);

ALTER TABLE `temporada_descuentos`
  ADD UNIQUE INDEX IF NOT EXISTS `uq_temporada_producto` (`temporada_id`,`producto_id`);

CREATE TABLE IF NOT EXISTS `delivery_tarifas` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(120) NOT NULL,
  `sucursal_id` INT NULL,
  `departamento` VARCHAR(100) NOT NULL DEFAULT '',
  `provincia` VARCHAR(100) NOT NULL DEFAULT '',
  `distrito` VARCHAR(100) NOT NULL DEFAULT '',
  `tarifa_base` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `cargo_por_unidad` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `gratis_desde` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_delivery_tarifa_busqueda` (`activo`,`sucursal_id`,`departamento`,`provincia`,`distrito`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE pedido_entregas_sucursal
  MODIFY estado ENUM('pendiente','preparando','listo','asignado','en_ruta','entregado','incidencia','cancelado')
  NOT NULL DEFAULT 'pendiente';

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS transferencia_venta_panel TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS transferencia_venta_web TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE productos
  ADD INDEX IF NOT EXISTS idx_producto_canal_sucursal
  (sucursal_id,estado,es_transferido,transferencia_venta_panel,transferencia_venta_web,stock_actual);

-- ============================================================
-- DATOS BASE DEL SISTEMA
-- ============================================================

INSERT INTO `sucursales`
(`id`,`nombre`,`direccion`,`estado`,`telefono`,`monto_inicial_caja`,`hora_apertura_caja`,`hora_cierre_caja`,`caja_configurada`,`max_cajas`) VALUES
(1,'Gas','Av. Gas 100',0,'',0.00,'08:00:00','22:00:00',0,5),
(2,'Bidones','Av. Bidones 200',0,'',0.00,'08:00:00','22:00:00',0,5),
(3,'Sucursal de Acuarios','Av. Acuarios 300',0,'',0.00,'08:00:00','22:00:00',0,5);

INSERT INTO `almacenes` (`id`,`sucursal_id`,`nombre`,`tipo`,`estado`) VALUES
(1,1,'Almacén - Gas','sucursal',0),
(2,2,'Almacén - Bidones','sucursal',0),
(3,3,'Almacén - Acuarios','sucursal',0);

INSERT INTO `categorias` (`id`,`nombre`,`descripcion`,`icono`,`color`,`estado`) VALUES
(1,'Bidones','Bidones y envases de agua','ti-tag','#16a34a',0),
(2,'Gas','Balones y cilindros de gas','ti-tag','#0ea5e9',0),
(3,'Accesorios','Tapas, caños y accesorios','ti-tag','#f59e0b',0);

INSERT INTO `perfiles` (`id`,`nombre`,`descripcion`,`estado`,`es_global`) VALUES
(1,'Administrador','Administrador global del sistema.',0,1),
(2,'Vendedor','Registra ventas, cotizaciones y clientes de su sucursal.',0,0),
(3,'Cajero','Opera caja y registra ventas sin acceso administrativo.',0,0),
(4,'Almacenero','Controla inventario, movimientos y preparación logística.',0,0),
(5,'Supervisor','Supervisa ventas, inventario, cajas, pedidos y reportes de su sucursal.',0,0),
(6,'Repartidor','Consulta sus rutas y registra entregas o incidencias.',0,0);

INSERT INTO `opciones`
(`id`,`nombre`,`slug`,`icono`,`ruta`,`orden`,`padre_id`,`estado`,`activo`) VALUES
(1,'Dashboard','dashboard','ti-layout-dashboard','/',1,NULL,0,0),
(2,'Ventas','ventas','ti-shopping-cart','/ventas',10,NULL,0,0),
(3,'Cotizaciones','cotizaciones','ti-file-text','/cotizaciones',20,NULL,0,0),
(4,'Verificación de pagos','verificacion-pagos','ti-credit-card','/pagos',30,NULL,0,0),
(5,'Comprobantes','comprobantes','ti-receipt','/comprobantes',40,NULL,0,0),
(6,'Apertura de caja','apertura-caja','ti-lock-open','/apertura-caja',50,NULL,0,0),
(7,'Cajas','cajas','ti-cash','/cajas',60,NULL,0,0),
(8,'Productos','productos','ti-package','/productos',70,NULL,0,0),
(9,'Inventario','inventario','ti-clipboard-list','/inventario',80,NULL,0,0),
(10,'Clientes','clientes','ti-user-circle','/clientes',90,NULL,0,0),
(11,'Logística y reparto','logistica','ti-truck-delivery','/logistica',100,NULL,0,0),
(12,'Reportes','reportes','ti-chart-bar','/reportes',110,NULL,0,0),
(13,'Rentabilidad','rentabilidad','ti-chart-pie-2','/rentabilidad',120,NULL,0,0),
(14,'Gestión Tienda','gestion-tienda','ti-building-store','/gestion-tienda',130,NULL,0,0),
(15,'Recojo en Tienda','recojo','ti-map-pin','/recojo',140,NULL,0,0),
(16,'Temporadas','temporadas','ti-gift','/temporadas',150,NULL,0,0),
(17,'Usuarios','usuarios','ti-users','/usuarios',160,NULL,0,0),
(18,'Perfiles','perfiles','ti-shield','/perfiles',170,NULL,0,0),
(19,'Configuración','config','ti-settings','/config',180,NULL,0,0);

INSERT INTO `permisos_accion` (`id`,`slug`,`modulo`,`nombre`,`descripcion`) VALUES
(1,'dashboard.ver','dashboard','Ver dashboard',''),
(2,'dashboard.ver_finanzas','dashboard','Ver finanzas',''),
(3,'dashboard.ver_costos','dashboard','Ver costos y margen',''),
(4,'dashboard.ver_global','dashboard','Ver todas las sucursales',''),
(5,'clientes.ver','clientes','Ver clientes',''),
(6,'clientes.gestionar','clientes','Gestionar clientes',''),
(7,'categorias.gestionar','categorias','Gestionar categorías',''),
(9,'comprobantes.ver','comprobantes','Ver comprobantes',''),
(10,'usuarios.ver','usuarios','Ver usuarios',''),
(11,'usuarios.gestionar','usuarios','Gestionar usuarios',''),
(12,'perfiles.ver','perfiles','Ver perfiles',''),
(13,'perfiles.gestionar','perfiles','Gestionar perfiles y permisos',''),
(14,'productos.ver','productos','Ver productos',''),
(15,'productos.crear','productos','Crear productos',''),
(16,'productos.editar','productos','Editar productos',''),
(17,'productos.eliminar','productos','Eliminar productos',''),
(18,'productos.imagenes','productos','Gestionar imágenes',''),
(19,'productos.volumen','productos','Gestionar precios por volumen',''),
(20,'productos.ver_costo','productos','Ver costo',''),
(21,'inventario.ver','inventario','Ver inventario',''),
(22,'inventario.mover','inventario','Registrar movimientos',''),
(23,'inventario.ajustar','inventario','Ajustar stock',''),
(24,'inventario.transferir','inventario','Transferir entre sucursales',''),
(25,'ventas.ver','ventas','Ver ventas',''),
(26,'ventas.crear','ventas','Crear ventas',''),
(27,'ventas.anular','ventas','Anular ventas',''),
(28,'ventas.emitir','ventas','Emitir comprobantes',''),
(29,'cotizaciones.ver','cotizaciones','Ver cotizaciones',''),
(30,'cotizaciones.gestionar','cotizaciones','Gestionar cotizaciones',''),
(31,'caja.ver','caja','Ver caja',''),
(32,'caja.operar','caja','Operar caja',''),
(33,'caja.supervisar','caja','Supervisar caja',''),
(34,'reportes.ver','reportes','Ver reportes',''),
(35,'reportes.exportar','reportes','Exportar reportes',''),
(36,'reportes.ver_finanzas','reportes','Ver finanzas',''),
(37,'reportes.ver_costos','reportes','Ver costos',''),
(38,'tienda.gestionar','tienda','Gestionar tienda',''),
(39,'pedidos_web.ver','pedidos_web','Ver pedidos web',''),
(40,'pedidos_web.aprobar_sucursal','pedidos_web','Aprobar pedidos de su sucursal',''),
(41,'pedidos_web.aprobar_multisucursal','pedidos_web','Aprobar pedidos multisucursal',''),
(42,'pedidos_web.preparar','pedidos_web','Preparar pedidos',''),
(43,'pedidos_web.entregar','pedidos_web','Entregar pedidos',''),
(44,'recojo.configurar','recojo','Configurar recojo',''),
(45,'config.ver','config','Ver configuración',''),
(46,'config.gestionar','config','Gestionar configuración',''),
(47,'crm.ver','crm','Ver CRM',''),
(48,'crm.gestionar','crm','Gestionar CRM',''),
(49,'logistica.ver','logistica','Ver logística',''),
(50,'logistica.gestionar','logistica','Gestionar logística',''),
(51,'logistica.operar','logistica','Operar rutas',''),
(52,'logistica.ver_global','logistica','Ver logística global',''),
(53,'rentabilidad.ver','rentabilidad','Ver rentabilidad',''),
(54,'rentabilidad.ver_costos','rentabilidad','Ver costos de rentabilidad','');

-- Módulos visibles predeterminados. Las acciones sensibles se limitan en RolePolicy.js.
INSERT INTO `perfil_opciones` (`perfil_id`,`opcion_id`)
SELECT p.id,o.id FROM perfiles p JOIN opciones o
WHERE
 (p.id=2 AND o.slug IN ('ventas','cotizaciones','clientes','productos','apertura-caja','cajas')) OR
 (p.id=3 AND o.slug IN ('ventas','clientes','productos','apertura-caja','cajas')) OR
 (p.id=4 AND o.slug IN ('productos','inventario','logistica','recojo')) OR
 (p.id=5 AND o.slug IN ('dashboard','ventas','cotizaciones','clientes','productos','inventario','cajas','verificacion-pagos','logistica','recojo','reportes','comprobantes')) OR
 (p.id=6 AND o.slug IN ('logistica','recojo'));

-- El administrador global recibe todos los módulos y acciones en cada inicio de sesión.
INSERT INTO `usuarios`
(`id`,`nombre`,`username`,`email`,`password_hash`,`perfil_id`,`sucursal_id`,`estado`,`es_global`,`puede_operar_caja`,`login_fail_count`,`locked_until`,`session_version`) VALUES
(1,'Admin Principal','admin','admin@empresa.com','$2a$12$MnH4l0TGwjpwgrIP/g5irelVyA1wcwnGYxkACAedegGEfD1Y8uuvu',1,NULL,0,1,0,0,NULL,1);

INSERT INTO `metodos_pago` (`id`,`nombre`,`estado`) VALUES
(1,'Efectivo',0),(2,'Yape',0),(3,'Plin',0),(4,'Tarjeta',0),(5,'Transferencia',0),(6,'IziPay',0);

INSERT INTO `series_comprobante` (`id`,`tipo`,`serie`,`ultimo_numero`,`estado`) VALUES
(1,'nota_venta','NV01',0,0),(2,'boleta','B001',0,0),(3,'factura','F001',0,0),
(4,'nota_credito','BC01',0,0),(5,'nota_credito','FC01',0,0),
(6,'nota_debito','BD01',0,0),(7,'nota_debito','FD01',0,0);

INSERT INTO `correlativos_comprobante` (`serie`,`ultimo_numero`) VALUES
('NV01',0),('B001',0),('F001',0),('BC01',0),('FC01',0),('BD01',0),('FD01',0);

INSERT INTO `configuracion` (`clave`,`valor`,`grupo`) VALUES
('schema_version','53','sistema'),
('app_url','','sistema'),('public_url','','sistema'),('document_link_hours','168','sistema'),
('session_lock_minutes','20','seguridad'),('session_max_hours','8','seguridad'),
('empresa_nombre','DISTRIBUCIONES MAOZ E.I.R.L.','empresa'),('empresa_ruc','20607518751','empresa'),
('empresa_direccion','','empresa'),('empresa_telefono','','empresa'),('empresa_email','','empresa'),
('mail_host','smtp.gmail.com','correo'),('mail_port','587','correo'),('mail_user','','correo'),('mail_pass','','correo'),('mail_from_name','Mundo Pet','correo'),
('miapi_url','https://miapi.cloud/v1','facturacion'),('miapi_token','','facturacion'),
('sunat_modo','beta','facturacion'),('sunat_ruc_emisor','20607518751','facturacion'),('sunat_razon_social','DISTRIBUCIONES MAOZ E.I.R.L.','facturacion'),('sunat_clave_secreta','','facturacion'),
('igv_porcentaje','18','facturacion'),('moneda','PEN','facturacion'),
('serie_nota','NV01','facturacion'),('serie_boleta','B001','facturacion'),('serie_factura','F001','facturacion'),
('ecommerce_activo','true','ecommerce'),('delivery_activo','true','ecommerce'),('recojo_activo','true','ecommerce'),
('ecommerce_sucursal_central_id','1','ecommerce'),('ecommerce_whatsapp','','ecommerce'),('reserva_web_minutes','30','ecommerce'),
('tienda_nombre','Mundo Pet','ecommerce'),('tienda_descripcion','Tienda online y distribución por sucursal','ecommerce'),
('tienda_direccion','','ecommerce'),('tienda_horario','Lun-Sáb 09:00 - 20:00','ecommerce'),('tienda_facebook','','ecommerce'),('tienda_instagram','','ecommerce'),
('delivery_gratis_desde','150.00','ecommerce'),
('yape_activo','true','pagos'),('yape_numero','','pagos'),('yape_titular','','pagos'),('yape_qr_ruta','','pagos'),
('plin_activo','true','pagos'),('plin_numero','','pagos'),('plin_titular','','pagos'),('plin_qr_ruta','','pagos'),
('transferencia_activo','true','pagos'),('transferencia_banco','','pagos'),('transferencia_titular','','pagos'),('transferencia_cuenta','','pagos'),('transferencia_cci','','pagos'),('transferencia_imagen_ruta','','pagos'),
('izipay_activo','false','pagos'),('izipay_instrucciones','','pagos'),('izipay_imagen_ruta','','pagos');

INSERT INTO `delivery_tarifas`
(`id`,`nombre`,`sucursal_id`,`departamento`,`provincia`,`distrito`,`tarifa_base`,`cargo_por_unidad`,`gratis_desde`,`activo`) VALUES
(1,'Tarifa general',NULL,'','','',8.00,0.50,150.00,1);

INSERT INTO `tienda_imagenes` (`id`,`tipo`,`nombre`,`ruta`,`orden`,`estado`) VALUES
(1,'logo','Logo Mundo Pet','/uploads/logos/1782610423425.jpeg',0,1);

INSERT INTO `cajas_fisicas`
(`id`,`sucursal_id`,`codigo`,`monto_inicial`,`activo`,`created_by`,`hora_apertura`,`hora_cierre`,`configurada`,`orden`,`monto_inicial_predeterminado`) VALUES
(1,1,'Caja 01',0,1,1,'08:00:00','22:00:00',0,1,0),(2,1,'Caja 02',0,0,1,'08:00:00','22:00:00',0,2,0),(3,1,'Caja 03',0,0,1,'08:00:00','22:00:00',0,3,0),(4,1,'Caja 04',0,0,1,'08:00:00','22:00:00',0,4,0),(5,1,'Caja 05',0,0,1,'08:00:00','22:00:00',0,5,0),
(6,2,'Caja 01',0,1,1,'08:00:00','22:00:00',0,1,0),(7,2,'Caja 02',0,0,1,'08:00:00','22:00:00',0,2,0),(8,2,'Caja 03',0,0,1,'08:00:00','22:00:00',0,3,0),(9,2,'Caja 04',0,0,1,'08:00:00','22:00:00',0,4,0),(10,2,'Caja 05',0,0,1,'08:00:00','22:00:00',0,5,0),
(11,3,'Caja 01',0,1,1,'08:00:00','22:00:00',0,1,0),(12,3,'Caja 02',0,0,1,'08:00:00','22:00:00',0,2,0),(13,3,'Caja 03',0,0,1,'08:00:00','22:00:00',0,3,0),(14,3,'Caja 04',0,0,1,'08:00:00','22:00:00',0,4,0),(15,3,'Caja 05',0,0,1,'08:00:00','22:00:00',0,5,0);

-- Delivery por zonas de distancia (punto de despacho + anillos en km)
ALTER TABLE `sucursales`
  ADD COLUMN `lat` decimal(10,7) DEFAULT NULL,
  ADD COLUMN `lng` decimal(10,7) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS `delivery_zonas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(80) NOT NULL,
  `km_hasta` decimal(6,2) NOT NULL,
  `costo` decimal(12,2) NOT NULL DEFAULT 0.00,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_delivery_zona_km` (`activo`,`km_hasta`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `delivery_zonas` (`nombre`,`km_hasta`,`costo`) VALUES
('Zona cercana',3,5),('Zona media',6,8),('Zona lejana',10,12);

CREATE TABLE IF NOT EXISTS usuario_ubicaciones (
  id BIGINT NOT NULL AUTO_INCREMENT,
  usuario_id INT NOT NULL,
  sucursal_id INT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  precision_m INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ubicacion_usuario_fecha (usuario_id,created_at),
  KEY idx_ubicacion_fecha (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
COMMIT;
