const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

async function signup(req, res, next) {
  try {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length) {
      return res.status(409).json({ message: 'Email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1,$2,$3,$4)
       RETURNING id, email, first_name, last_name`,
      [email, passwordHash, firstName, lastName]
    );

    const user = inserted.rows[0];
    
    // Seed relational tables for the store immediately on user signup
    const { initializeStoreData } = require('./ownerService');
    try {
      await initializeStoreData(user.id, `${firstName}'s Kitchen`, '+91 98765 43210');
    } catch (dbErr) {
      console.error('Error seeding store tables during signup:', dbErr);
      // continue even if seed fails, so signup itself isn't blocked
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email },
      process.env.JWT_SECRET || 'vedelivery-business-secret-key',
      { expiresIn: '7d' }
    );

    return res.status(201).json({ token, user });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const found = await pool.query('SELECT id, email, password_hash, first_name, last_name FROM users WHERE email=$1', [email]);
    if (!found.rows.length) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = found.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email },
      process.env.JWT_SECRET || 'vedelivery-business-secret-key',
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name }
    });
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  // requireAuth leaves decoded JWT in req.user
  return res.json({ user: req.user });
}

module.exports = { signup, login, me };
