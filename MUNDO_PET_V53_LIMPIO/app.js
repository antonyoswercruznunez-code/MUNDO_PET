require('dotenv').config();

const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const MySQLStore = require('express-mysql-session')(session);

const { initDB, getDB } = require('./config/database');
const { databaseOptions } = require('./config/database-options');
const {
  requestId,
  originGuard,
  csrfEmployee,
  noStore
} = require('./middleware/security');
const { uploadErrorHandler } = require('./middleware/upload');
const DocumentController = require('./controllers/DocumentController');
const { cerrarCajasVencidas } = require('./services/CajaAutoCloseService');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';
const HOST = String(process.env.HOST || (isProd ? '127.0.0.1' : '0.0.0.0'));

/*
|--------------------------------------------------------------------------
| Clave de sesión
|--------------------------------------------------------------------------
*/

let sessionSecret = String(process.env.SESSION_SECRET || '');

if (sessionSecret.length < 32) {
  if (isProd) {
    throw new Error(
      'SESSION_SECRET debe tener al menos 32 caracteres en producción'
    );
  }

  sessionSecret = crypto.randomBytes(48).toString('base64url');

  console.warn(
    '⚠️ SESSION_SECRET no configurado correctamente. ' +
    'Se utilizará una clave temporal solamente para desarrollo.'
  );
}

if (isProd && !process.env.APP_ENCRYPTION_KEY) {
  throw new Error('APP_ENCRYPTION_KEY es obligatorio en producción');
}

/*
|--------------------------------------------------------------------------
| Configuración general
|--------------------------------------------------------------------------
*/

app.disable('x-powered-by');

if (isProd) {
  app.set(
    'trust proxy',
    Number(process.env.TRUST_PROXY_HOPS || 1)
  );
}

app.use(requestId);

app.use(
  helmet({
    // Google Identity Services abre una ventana emergente y necesita conservar
    // la relación con la ventana principal para devolver la credencial.
    crossOriginOpenerPolicy: {
      policy: 'same-origin-allow-popups'
    },

    // No exigir aislamiento COEP en la tienda; los recursos de Google se
    // cargan desde dominios externos autorizados por la CSP.
    crossOriginEmbedderPolicy: false,

    crossOriginResourcePolicy: {
      policy: 'same-site'
    },

    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin'
    },

    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net',
          'https://accounts.google.com'
        ],

        /*
         * El frontend actual genera botones con atributos onclick/onchange.
         * Helmet 8 agrega por defecto `script-src-attr 'none'`, lo que
         * bloqueaba esos botones aunque scriptSrc tuviera unsafe-inline.
         * Se habilitan los atributos mientras se migra gradualmente a
         * addEventListener.
         */
        scriptSrcAttr: [
          "'unsafe-inline'"
        ],

        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net',
          'https://fonts.googleapis.com'
        ],

        fontSrc: [
          "'self'",
          'https://cdn.jsdelivr.net',
          'https://fonts.gstatic.com',
          'data:'
        ],

        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https:'
        ],

        connectSrc: [
          "'self'",
          'https://cdn.jsdelivr.net',
          'https://accounts.google.com',
          'https://oauth2.googleapis.com',
          // Búsqueda de direcciones del mapa de delivery (OpenStreetMap).
          'https://nominatim.openstreetmap.org'
        ],

        frameSrc: [
          "'self'",
          'https://accounts.google.com',
          'https://miapi.cloud'
        ],

        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],

        upgradeInsecureRequests: isProd ? [] : null
      }
    }
  })
);

app.use(compression());

app.use(
  express.json({
    limit: '1mb',
    strict: true
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: '1mb',
    parameterLimit: 100
  })
);

app.use(cookieParser());

/*
|--------------------------------------------------------------------------
| Almacenamiento de sesiones en MySQL
|--------------------------------------------------------------------------
|
| IMPORTANTE:
| Las opciones de conexión deben ir dentro del primer argumento.
|
| Antes se estaba enviando databaseOptions() como segundo argumento.
| express-mysql-session lo interpretaba como una conexión MySQL real y por
| eso aparecía:
|
| this.connection.query is not a function
|
*/

const sessionStore = new MySQLStore({
  ...databaseOptions(),

  clearExpired: true,

  checkExpirationInterval:
    15 * 60 * 1000,

  expiration:
    Number(process.env.SESSION_MAX_HOURS || 8) *
    60 *
    60 *
    1000,

  createDatabaseTable: true,

  schema: {
    tableName: 'app_sessions',

    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
});

app.use(
  session({
    name:
      process.env.SESSION_COOKIE_NAME ||
      'sv.sid',

    secret: sessionSecret,

    store: sessionStore,

    resave: false,

    saveUninitialized: false,

    rolling: false,

    proxy: isProd,

    cookie: {
      httpOnly: true,

      secure: isProd,

      sameSite: 'lax',

      maxAge:
        Number(process.env.SESSION_MAX_HOURS || 8) *
        60 *
        60 *
        1000,

      path: '/'
    }
  })
);

/*
|--------------------------------------------------------------------------
| Seguridad para APIs
|--------------------------------------------------------------------------
*/

app.use(originGuard);

app.use('/api', noStore);

app.use('/api', csrfEmployee);

app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,

    limit:
      Number(process.env.API_RATE_LIMIT || 300),

    standardHeaders: 'draft-7',

    legacyHeaders: false,

    message: {
      ok: false,
      msg: 'Demasiadas solicitudes. Espera un momento.'
    }
  })
);

/*
|--------------------------------------------------------------------------
| Archivos estáticos
|--------------------------------------------------------------------------
*/

// Estas rutas antiguas ya no deben permitir acceso público directo.
app.use(
  ['/comprobantes', '/uploads/vouchers'],
  (req, res) => {
    res.status(404).send('No encontrado');
  }
);

app.use(
  express.static(
    path.join(__dirname, 'public'),
    {
      dotfiles: 'deny',

      index: false,

      etag: true,

      maxAge: isProd ? '1d' : 0,

      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader(
            'Cache-Control',
            'no-cache'
          );
        }
      }
    }
  )
);

/*
|--------------------------------------------------------------------------
| Estado del servidor
|--------------------------------------------------------------------------
*/

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'sistema-ventas',
    time: new Date().toISOString()
  });
});

app.get('/health/ready', async (req, res) => {
  try {
    await getDB().query('SELECT 1');

    res.json({
      ok: true,
      database: 'ready',
      time: new Date().toISOString()
    });
  } catch (error) {
    console.error(
      'Error en health/ready:',
      error.message
    );

    res.status(503).json({
      ok: false,
      database: 'unavailable'
    });
  }
});

/*
|--------------------------------------------------------------------------
| Documentos públicos con token
|--------------------------------------------------------------------------
*/

app.get(
  '/documentos/:token',
  DocumentController.open
);

/*
|--------------------------------------------------------------------------
| Rutas API
|--------------------------------------------------------------------------
*/

app.use(
  '/api',
  require('./routes/index')
);

/*
|--------------------------------------------------------------------------
| Vistas del panel
|--------------------------------------------------------------------------
*/

app.get(
  '/views/pages/:pagina',
  (req, res) => {
    const pagina = String(
      req.params.pagina || ''
    ).replace(
      /[^a-zA-Z0-9_-]/g,
      ''
    );

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'views',
        'pages',
        `${pagina}.html`
      ),
      error => {
        if (
          error &&
          !res.headersSent
        ) {
          res.status(404).json({
            ok: false,
            msg: 'Vista no encontrada'
          });
        }
      }
    );
  }
);

app.get(
  ['/', '/login'],
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        'public',
        'views',
        'login.html'
      )
    );
  }
);

app.get(
  '/dashboard',
  (req, res) => {
    // Evita mostrar primero el panel cuando no existe una sesión de empleado.
    // La validación completa del usuario continúa realizándose en /api/auth/session.
    if (!req.session?.usuario) {
      return res.redirect('/login');
    }
    if (req.session.mfa_ok !== true) {
      return res.redirect('/verificar-2fa');
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(
      path.join(
        __dirname,
        'public',
        'index.html'
      )
    );
  }
);

app.get(
  '/verificar-2fa',
  (req, res) => {
    if (!req.session?.usuario) return res.redirect('/login');
    if (req.session.mfa_ok === true) return res.redirect('/dashboard');
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(path.join(__dirname, 'public', 'views', 'verificar-2fa.html'));
  }
);

app.get(
  ['/web', '/tienda'],
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        'public',
        'tienda.html'
      )
    );
  }
);

app.get('*', (req, res) => {
  res.status(404).sendFile(
    path.join(
      __dirname,
      'public',
      'views',
      'login.html'
    )
  );
});

/*
|--------------------------------------------------------------------------
| Errores
|--------------------------------------------------------------------------
*/

app.use(uploadErrorHandler);

app.use(
  (err, req, res, next) => {
    const status = Number(
      err.status ||
      err.statusCode ||
      500
    );

    console.error(
      `[${req.requestId || '-'}]`,
      err.stack || err.message
    );

    if (res.headersSent) {
      return next(err);
    }

    return res
      .status(
        status >= 400 &&
        status < 600
          ? status
          : 500
      )
      .json({
        ok: false,

        msg:
          status >= 500
            ? 'Ocurrió un error interno. Intenta nuevamente.'
            : (
              err.message ||
              'Solicitud inválida'
            ),

        requestId:
          req.requestId
      });
  }
);

/*
|--------------------------------------------------------------------------
| Inicio del servidor
|--------------------------------------------------------------------------
*/

async function start() {
  await initDB();

  /*
   * Esperar a que express-mysql-session haya creado o comprobado
   * la tabla app_sessions antes de aceptar solicitudes.
   */
  await sessionStore.onReady();

  /*
   * Liberar reservas web vencidas sin modificar el stock físico.
   */
  const cleanupReservations = async () => {
    const db = getDB();
    const connection =
      await db.getConnection();

    try {
      await connection.beginTransaction();

      const [pickupReservations] =
        await connection.query(`
          SELECT
            prr.id,
            prr.horario_id
          FROM pedido_recojo_reservas prr
          INNER JOIN pedidos_web pw
            ON pw.id = prr.pedido_id
          WHERE prr.estado = 'reservado'
            AND pw.estado_pago IN (
              'pendiente',
              'observado'
            )
            AND pw.reserva_expires_at < NOW()
          FOR UPDATE
        `);

      for (
        const reservation
        of pickupReservations
      ) {
        await connection.query(
          `
            UPDATE recojo_fechas
            SET cupos_usados =
              GREATEST(
                cupos_usados - 1,
                0
              )
            WHERE id = ?
          `,
          [reservation.horario_id]
        );

        await connection.query(
          `
            UPDATE pedido_recojo_reservas
            SET
              estado = 'liberado',
              updated_at = NOW()
            WHERE id = ?
          `,
          [reservation.id]
        );
      }

      await connection.query(`
        UPDATE reservas_web
        SET
          estado = 'vencida',
          updated_at = NOW()
        WHERE estado = 'activa'
          AND expires_at < NOW()
      `);

      await connection.commit();
    } catch (error) {
      await connection.rollback();

      /*
       * La limpieza de reservas no debe apagar el servidor.
       * El error se registra para poder revisarlo.
       */
      console.error(
        'No se pudieron limpiar reservas vencidas:',
        error.message
      );
    } finally {
      connection.release();
    }
  };

  await cleanupReservations();

  const cleanupTimer = setInterval(
    cleanupReservations,
    5 * 60 * 1000
  );

  cleanupTimer.unref();

  // Ninguna caja queda abierta de un día para otro. Se revisa al iniciar y
  // cada minuto contra la hora de cierre configurada en cajas_fisicas.
  try { await cerrarCajasVencidas(); } catch (error) {
    console.error('No se pudieron cerrar cajas vencidas:', error.message);
  }
  const cajaCloseTimer = setInterval(() => {
    cerrarCajasVencidas().catch(error => console.error('Cierre automático de caja:', error.message));
  }, 60 * 1000);
  cajaCloseTimer.unref();

  return app.listen(
    PORT,
    HOST,
    () => {
      console.log(
        `🚀 Sistema disponible en el puerto ${PORT}`
      );

      if (!isProd) {
        console.log(
          `   Panel: http://localhost:${PORT}`
        );

        console.log(
          `   Tienda: http://localhost:${PORT}/tienda`
        );
      }
    }
  );
}

if (require.main === module) {
  start().catch(error => {
    console.error(
      '❌ No se pudo iniciar:',
      error.message
    );

    process.exit(1);
  });
}

module.exports = {
  app,
  start
};