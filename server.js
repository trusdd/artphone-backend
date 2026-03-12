const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// ==================== СОЗДАНИЕ ТАБЛИЦ ====================

// Таблица пользователей
const createUsersTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(50) NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ Таблица users готова');
};

// Таблица корзины
const createCartTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cart (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      product_id VARCHAR(255) NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      product_price VARCHAR(50) NOT NULL,
      product_image TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, product_id)
    )
  `);
  console.log('✅ Таблица cart готова');
};

// Таблица заказов
const createOrdersTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      total_amount INTEGER NOT NULL,
      status VARCHAR(50) DEFAULT 'processing',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ Таблица orders готова');
};

// Таблица товаров в заказе
const createOrderItemsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      product_id VARCHAR(255) NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      product_price VARCHAR(50) NOT NULL,
      quantity INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ Таблица order_items готова');
};

// Инициализация всех таблиц
const initTables = async () => {
  try {
    await createUsersTable();
    await createCartTable();
    await createOrdersTable();
    await createOrderItemsTable();
    console.log('🚀 Все таблицы успешно созданы');
  } catch (err) {
    console.error('❌ Ошибка при создании таблиц:', err);
  }
};
initTables();

// ==================== МИДЛВЕРЫ ====================

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Токен не предоставлен' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Недействительный токен' });
    }
    req.userId = user.id;
    next();
  });
};

// ==================== АВТОРИЗАЦИЯ ====================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, phone, password, confirmPassword } = req.body;

    if (!name || !email || !phone || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Пароли не совпадают' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await pool.query(
      'INSERT INTO users (name, email, phone, password) VALUES ($1, $2, $3, $4) RETURNING id, name, email, phone',
      [name, email, phone, hashedPassword]
    );

    const user = newUser.rows[0];
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ success: true, token, user });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, phone, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json({ user });

  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true, message: 'Выход выполнен' });
});

// ==================== КОРЗИНА ====================

// Получить корзину пользователя
app.get('/api/cart', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM cart WHERE user_id = $1 ORDER BY created_at DESC',
      [req.userId]
    );
    res.json({ items: result.rows });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Добавить товар в корзину
app.post('/api/cart/add', authenticateToken, async (req, res) => {
  try {
    const { product_id, product_name, product_price, product_image, quantity = 1 } = req.body;

    // Проверяем, есть ли уже такой товар
    const existing = await pool.query(
      'SELECT * FROM cart WHERE user_id = $1 AND product_id = $2',
      [req.userId, product_id]
    );

    if (existing.rows.length > 0) {
      // Обновляем количество
      await pool.query(
        'UPDATE cart SET quantity = quantity + $1 WHERE user_id = $2 AND product_id = $3',
        [quantity, req.userId, product_id]
      );
    } else {
      // Добавляем новый товар
      await pool.query(
        'INSERT INTO cart (user_id, product_id, product_name, product_price, product_image, quantity) VALUES ($1, $2, $3, $4, $5, $6)',
        [req.userId, product_id, product_name, product_price, product_image, quantity]
      );
    }

    const result = await pool.query('SELECT * FROM cart WHERE user_id = $1', [req.userId]);
    res.json({ success: true, items: result.rows });

  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновить количество товара
app.put('/api/cart/update/:productId', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity } = req.body;

    if (quantity < 1) {
      return res.status(400).json({ error: 'Количество должно быть больше 0' });
    }

    await pool.query(
      'UPDATE cart SET quantity = $1 WHERE user_id = $2 AND product_id = $3',
      [quantity, req.userId, productId]
    );

    const result = await pool.query('SELECT * FROM cart WHERE user_id = $1', [req.userId]);
    res.json({ success: true, items: result.rows });

  } catch (error) {
    console.error('Update cart error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удалить товар из корзины
app.delete('/api/cart/remove/:productId', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.params;

    await pool.query(
      'DELETE FROM cart WHERE user_id = $1 AND product_id = $2',
      [req.userId, productId]
    );

    const result = await pool.query('SELECT * FROM cart WHERE user_id = $1', [req.userId]);
    res.json({ success: true, items: result.rows });

  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Очистить корзину
app.delete('/api/cart/clear', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM cart WHERE user_id = $1', [req.userId]);
    res.json({ success: true, items: [] });
  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ==================== ЗАКАЗЫ ====================

// Оформить заказ (переносит товары из корзины в заказы)
app.post('/api/orders/create', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Получаем корзину пользователя
    const cartResult = await client.query(
      'SELECT * FROM cart WHERE user_id = $1',
      [req.userId]
    );

    if (cartResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Корзина пуста' });
    }

    // Вычисляем общую сумму
    let totalAmount = 0;
    cartResult.rows.forEach(item => {
      const price = parseInt(item.product_price.replace(/\D/g, ''));
      totalAmount += price * item.quantity;
    });

    // Создаем заказ
    const orderResult = await client.query(
      'INSERT INTO orders (user_id, total_amount) VALUES ($1, $2) RETURNING id',
      [req.userId, totalAmount]
    );

    const orderId = orderResult.rows[0].id;

    // Добавляем товары в order_items
    for (const item of cartResult.rows) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, product_name, product_price, quantity) VALUES ($1, $2, $3, $4, $5)',
        [orderId, item.product_id, item.product_name, item.product_price, item.quantity]
      );
    }

    // Очищаем корзину
    await client.query('DELETE FROM cart WHERE user_id = $1', [req.userId]);

    await client.query('COMMIT');

    res.json({ success: true, message: 'Заказ успешно оформлен', orderId });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

// Получить заказы пользователя
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const orders = await pool.query(
      `SELECT o.*, 
        json_agg(json_build_object(
          'product_id', oi.product_id,
          'product_name', oi.product_name,
          'product_price', oi.product_price,
          'quantity', oi.quantity
        )) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.user_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC`,
      [req.userId]
    );

    res.json({ orders: orders.rows });

  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить детали конкретного заказа
app.get('/api/orders/:orderId', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await pool.query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [orderId, req.userId]
    );

    if (order.rows.length === 0) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }

    const items = await pool.query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [orderId]
    );

    res.json({ order: order.rows[0], items: items.rows });

  } catch (error) {
    console.error('Get order details error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ==================== ПРОВЕРКА ====================

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    time: new Date().toISOString(),
    message: 'Сервер работает',
    database: 'connected'
  });
});

app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, phone, created_at FROM users ORDER BY created_at DESC');
    res.json({ users: result.rows });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📝 Регистрация: POST /api/auth/register`);
  console.log(`🔑 Вход: POST /api/auth/login`);
  console.log(`👤 Профиль: GET /api/auth/profile`);
  console.log(`🛒 Корзина: GET /api/cart`);
  console.log(`➕ Добавить в корзину: POST /api/cart/add`);
  console.log(`📦 Заказы: GET /api/orders`);
  console.log(`🔍 Проверка: GET /api/health`);
});