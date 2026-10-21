# Mundo Pet V53

Versión limpia para instalación nueva y despliegue en un Droplet de DigitalOcean.

## Cambios finales

- El código de operación de un pago digital no puede repetirse. Se normaliza y se valida en el backend antes de registrar el pedido.
- Recojo en Tienda ordena por fecha real de creación del pedido: el más reciente aparece primero.
- El simulador y la tabla de tarifas de delivery tienen una distribución estable, adaptable y sin columnas superpuestas.
- La base `database/gas_sistema.sql` está limpia: no contiene ventas, pedidos, clientes, comprobantes, movimientos ni archivos de prueba.

## Instalación local desde cero

1. Elimina la base anterior `gas_sistema`.
2. Importa `database/gas_sistema.sql` desde phpMyAdmin o MariaDB.
3. Copia `.env.example` como `.env` y completa las credenciales.
4. Ejecuta:

```bash
npm install
npm start
```

Acceso inicial del panel:

```text
Usuario: admin
Contraseña temporal: MundoPet#V53!
```

Cambia la contraseña inmediatamente desde Usuarios antes de publicar el sistema.

## Despliegue en DigitalOcean

### 1. Preparar el Droplet

Usa Ubuntu 22.04 o 24.04, una llave SSH y un usuario con permisos `sudo`.

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx mariadb-server unzip git curl certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### 2. Crear la base y el usuario

```bash
sudo mariadb
```

Dentro de MariaDB:

```sql
CREATE DATABASE IF NOT EXISTS gas_sistema CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'mundo_pet'@'127.0.0.1' IDENTIFIED BY 'UNA_CLAVE_DB_SEGURA';
GRANT ALL PRIVILEGES ON gas_sistema.* TO 'mundo_pet'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

### 3. Subir e instalar el proyecto

Coloca el proyecto en `/var/www/mundo-pet` y ejecuta:

```bash
cd /var/www/mundo-pet
cp .env.example .env
nano .env
npm ci --omit=dev
sudo mariadb < database/gas_sistema.sql
mkdir -p public/uploads/logos public/uploads/pagos public/uploads/productos public/uploads/qr public/uploads/sliders public/uploads/vouchers storage/documents storage/private storage/tmp
sudo chown -R "$USER":www-data public/uploads storage
sudo chmod -R 775 public/uploads storage
```

Genera dos secretos diferentes para `.env`:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

### 4. Iniciar con PM2

```bash
cd /var/www/mundo-pet
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Ejecuta el comando adicional que muestre `pm2 startup`.

### 5. Configurar Nginx

Edita `deploy/nginx-mundo-pet.conf`, cambia el dominio y luego:

```bash
sudo cp deploy/nginx-mundo-pet.conf /etc/nginx/sites-available/mundo-pet
sudo ln -s /etc/nginx/sites-available/mundo-pet /etc/nginx/sites-enabled/mundo-pet
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### 6. Firewall y HTTPS

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo certbot --nginx -d tu-dominio.com -d www.tu-dominio.com
sudo certbot renew --dry-run
```

## Comprobaciones

```bash
pm2 status
pm2 logs mundo-pet --lines 100
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/health/ready
sudo nginx -t
```

No subas `.env`, `node_modules`, documentos generados ni vouchers a GitHub.
