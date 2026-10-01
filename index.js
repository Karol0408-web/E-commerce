require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const mongoose = require('mongoose');

const app = express();
app.use(express.json()); 


// Conexión a PostgreSQL
const pgPool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});

// Conexión a MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Conectado a MongoDB'))
  .catch(err => console.error('Error conectando a MongoDB:', err));

// Esquema de MongoDB 
const LogSchema = new mongoose.Schema({
  mensaje: String,
  tipo: String, // 'INFO', 'EXITO', 'ERROR'
  fecha: { type: Date, default: Date.now }
});

const LogModel = mongoose.model('Log', LogSchema);


async function registrarLog(mensaje, tipo = 'INFO') {
  try {
    await LogModel.create({ mensaje, tipo });
  } catch (err) {
    console.error('Error guardando el log en MongoDB:', err.message);
  }
}


 //Obtener la lista de todos los productos 
app.get('/api/productos', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT * FROM productos ORDER BY id ASC');
    
    // Guardar en MongoDB
    await registrarLog('Se consultó el catálogo de productos', 'INFO');

    res.json(result.rows);
  } catch (error) {
    await registrarLog(`Error al consultar productos: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Error al consultar la base de datos SQL' });
  }
});

//  Crear un nuevo pedido 
app.post('/api/pedidos', async (req, res) => {
  const { cliente, producto_id, cantidad } = req.body;

  if (!cliente || !producto_id || !cantidad) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  try {
   
    const productoRes = await pgPool.query('SELECT * FROM productos WHERE id = $1', [producto_id]);
    
    if (productoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const producto = productoRes.rows[0];

    if (producto.stock < cantidad) {
      await registrarLog(`Stock insuficiente para producto ID ${producto_id}`, 'ERROR');
      return res.status(400).json({ error: 'Stock insuficiente para completar la compra' });
    }


    const total = producto.precio * cantidad;

    // 3. Insertar el nuevo pedido en PostgreSQL
    const nuevoPedidoRes = await pgPool.query(
      'INSERT INTO pedidos (cliente, producto_id, cantidad, total) VALUES ($1, $2, $3, $4) RETURNING *',
      [cliente, producto_id, cantidad, total]
    );

    const nuevoStock = producto.stock - cantidad;
    await pgPool.query('UPDATE productos SET stock = $1 WHERE id = $2', [nuevoStock, producto_id]);

    const pedidoGuardado = nuevoPedidoRes.rows[0];


    await registrarLog(`Pedido #${pedidoGuardado.id} creado por ${cliente} (Monto: $${total})`, 'EXITO');

    res.status(201).json({
      mensaje: 'Pedido creado exitosamente',
      pedido: pedidoGuardado
    });

  } catch (error) {
    await registrarLog(`Error al procesar el pedido: ${error.message}`, 'ERROR');
    res.status(500).json({ error: 'Ocurrió un error al procesar la solicitud' });
  }
});

// Ver los logs guardados en MongoDB 
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await LogModel.find().sort({ fecha: -1 }).limit(10);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar logs en MongoDB' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(` Servidor corriendo en http://localhost:${PORT}`);
});