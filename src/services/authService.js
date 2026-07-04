const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../db');
const { initializeStoreData } = require('./ownerService');

async function signup(req, res, next) {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    if (!email || !password || !firstName || !phone) {
      return res.status(400).json({ message: 'Email, password, first name, and phone number are required' });
    }

    // Check if email already exists in owner_staff table
    const existing = await pool.query('SELECT id FROM owner_staff WHERE email=$1', [email]);
    if (existing.rows.length) {
      return res.status(409).json({ message: 'Email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const staffId = crypto.randomUUID();
    const fullName = `${firstName} ${lastName || ''}`.trim();

    // 1. Initialize the store in owner_stores first to obtain storeId
    let storeId;
    try {
      storeId = await initializeStoreData(staffId, `${firstName}'s Kitchen`, phone);
    } catch (dbErr) {
      console.error('Error initializing store data on signup:', dbErr);
      return res.status(500).json({ message: 'Failed to initialize store details' });
    }

    // 2. Insert store owner as a staff member with 'Owner' role in owner_staff
    const joinedOn = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const inserted = await pool.query(
      `INSERT INTO owner_staff (id, store_id, name, role, status, phone, email, password_hash, permissions, joined_on)
       VALUES ($1, $2, $3, 'Owner', 'active', $4, $5, $6, $7, $8)
       RETURNING id, name, email, phone, role, joined_on`,
      [staffId, storeId, fullName, phone, email, passwordHash, ['Menu', 'Orders', 'Settings', 'Earnings'], joinedOn]
    );

    const user = inserted.rows[0];

    const token = jwt.sign(
      { sub: user.id, email: user.email },
      process.env.JWT_SECRET || 'vedelivery-business-secret-key',
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      token,
      user: { id: user.id, email: user.email, first_name: firstName, last_name: lastName }
    });
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

    // Query owner_staff directly
    const found = await pool.query('SELECT id, email, password_hash, name FROM owner_staff WHERE email=$1', [email]);
    if (!found.rows.length) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = found.rows[0];
    if (!user.password_hash) {
      return res.status(401).json({ message: 'This staff member account is not set up for login' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email },
      process.env.JWT_SECRET || 'vedelivery-business-secret-key',
      { expiresIn: '7d' }
    );

    const nameParts = user.name.split(' ');
    const firstName = nameParts[0] || 'Owner';
    const lastName = nameParts.slice(1).join(' ') || '';

    return res.json({
      token,
      user: { id: user.id, email: user.email, first_name: firstName, last_name: lastName }
    });
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  return res.json({ user: req.user });
}

module.exports = { signup, login, me };
