const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../db');
const { initializeStoreData } = require('./ownerService');

// Normalize phone numbers by removing all whitespaces, handling duplicate country codes, and prepending +91 if needed
const normalizePhone = (p) => {
  if (!p) return '';
  let clean = p.replace(/\s+/g, '');
  while (clean.includes('+91+91')) {
    clean = clean.replace('+91+91', '+91');
  }
  if (!clean.startsWith('+91')) {
    // If it starts with 91 and has 12 digits, prepend '+'
    if (clean.startsWith('91') && clean.length === 12) {
      clean = '+' + clean;
    } else if (clean.length === 10) {
      clean = '+91' + clean;
    }
  }
  return clean;
};

async function signup(req, res, next) {
  try {
    const { email, password, firstName, lastName, phone } = req.body;
    console.log('*** SIGNUP ATTEMPT ***', { email, password, firstName, lastName, phone });

    if (!email || !password || !firstName || !phone) {
      return res.status(400).json({ message: 'Email, password, first name, and phone number are required' });
    }

    const normalizedPhone = normalizePhone(phone);

    // Check if email or normalized phone already exists in owner_staff table
    const existing = await pool.query('SELECT id FROM owner_staff WHERE email=$1 OR phone=$2', [email, normalizedPhone]);
    if (existing.rows.length) {
      return res.status(409).json({ message: 'Email or Phone number already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const staffId = crypto.randomUUID();
    const fullName = `${firstName} ${lastName || ''}`.trim();

    // 1. Initialize the store in owner_stores first to obtain storeId
    let storeId;
    try {
      storeId = await initializeStoreData(staffId, `${firstName}'s Kitchen`, normalizedPhone);
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
      [staffId, storeId, fullName, normalizedPhone, email, passwordHash, ['Menu', 'Orders', 'Settings', 'Earnings'], joinedOn]
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
    const { password } = req.body;
    const identifier = req.body.emailOrPhone || req.body.phone || req.body.username;
    console.log('*** LOGIN ATTEMPT ***', { identifier, password });

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Email/Phone and password are required' });
    }

    let found;
    if (identifier.includes('@')) {
      const cleanEmail = identifier.trim().toLowerCase();
      console.log('Querying by email:', cleanEmail);
      found = await pool.query('SELECT id, email, phone, password_hash, name FROM owner_staff WHERE email=$1', [cleanEmail]);
    } else {
      const normalizedPhone = normalizePhone(identifier);
      console.log('Querying by normalized phone:', normalizedPhone);
      found = await pool.query('SELECT id, email, phone, password_hash, name FROM owner_staff WHERE phone=$1', [normalizedPhone]);
    }

    console.log('Found rows in DB:', found.rows.length);
    if (!found.rows.length) {
      return res.status(401).json({ message: 'Invalid credentials. Please check your username/phone and password.' });
    }

    const user = found.rows[0];
    console.log('User details:', { id: user.id, email: user.email, phone: user.phone, hasHash: !!user.password_hash });
    if (!user.password_hash) {
      return res.status(401).json({ message: 'This account is not set up for login' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    console.log('Password match status:', ok);
    if (!ok) {
      return res.status(401).json({ message: 'Invalid credentials. Please check your username/phone and password.' });
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
  try {
    const found = await pool.query('SELECT name FROM owner_staff WHERE id = $1', [req.user.sub]);
    const name = found.rows[0]?.name || '';
    return res.json({
      user: {
        ...req.user,
        name
      }
    });
  } catch (err) {
    return res.json({ user: req.user });
  }
}

module.exports = { signup, login, me };
