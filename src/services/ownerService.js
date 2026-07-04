const { pool } = require('../db');

// Helper to query store ID for a user
async function getStoreIdForUser(userId) {
  const res = await pool.query('SELECT store_id FROM owner_staff WHERE id = $1', [userId]);
  return res.rows[0]?.store_id;
}

// Seeding / first-time initialization of store details for a user
async function initializeStoreData(userId, defaultStoreName = "John's Kitchen", contactNumber = "+91 98765 43210") {
  // Check if store already exists
  let storeRes = await pool.query('SELECT id FROM owner_stores WHERE user_id = $1', [userId]);
  if (storeRes.rows.length > 0) {
    return storeRes.rows[0].id;
  }

  // 1. First-time initialization of store details
  const insertStore = await pool.query(
    `INSERT INTO owner_stores (user_id, name, type, cuisine, address, contact_number, is_open)
     VALUES ($1, $2, 'Restaurant', 'Indian', '123, 5th Cross, Koramangala, Bangalore 560038', $3, true)
     RETURNING *`,
    [userId, defaultStoreName, contactNumber]
  );
  const store = insertStore.rows[0];
  const storeId = store.id;

  // 2. Insert timings
  await pool.query(
    `INSERT INTO owner_timings (store_id, opening_time, closing_time, open_all_days, custom_days)
     VALUES ($1, '08:00 AM', '11:00 PM', true, ARRAY['M', 'T', 'W', 'T', 'F', 'S', 'S'])`,
    [storeId]
  );

  // 3. Insert location
  await pool.query(
    `INSERT INTO owner_locations (store_id, address, lat, lng)
     VALUES ($1, '123, 2nd Main, Koramangala, Bangalore 560034', 12.9352, 77.6244)`,
    [storeId]
  );

  // 4. Insert bank details
  await pool.query(
    `INSERT INTO owner_bank_details (store_id, account_holder_name, bank_name, account_number, ifsc_code, upi_id)
     VALUES ($1, 'John''s Kitchen', 'HDFC Bank', 'XXXX XXXX 5678', 'HDFC0001234', 'johnskitchen@okicici')`,
    [storeId]
  );

  // 5. Insert printer settings
  await pool.query(
    `INSERT INTO owner_printer_settings (store_id, select_printer, paper_size, print_automatically)
     VALUES ($1, 'Kitchen Printer', '80 mm', true)`,
    [storeId]
  );

  // 6. Insert preferences
  await pool.query(
    `INSERT INTO owner_app_preferences (user_id, order_sound, notification_sound, vibration, language, theme)
     VALUES ($1, true, true, true, 'English', 'Light')`,
    [userId]
  );

  return storeId;
}

// 1. Get all store data (Loads all tables and returns the full state)
async function getStoreData(req, res, next) {
  try {
    const userId = req.user.sub;
    
    // Check if store exists, if not initialize it
    let storeRes = await pool.query('SELECT * FROM owner_stores WHERE user_id = $1', [userId]);
    
    if (storeRes.rows.length === 0) {
      await initializeStoreData(userId);
      storeRes = await pool.query('SELECT * FROM owner_stores WHERE user_id = $1', [userId]);
    }

    // Load full details for response assembly
    const store = storeRes.rows[0];
    const storeId = store.id;

    const timings = (await pool.query('SELECT * FROM owner_timings WHERE store_id = $1', [storeId])).rows[0];
    const location = (await pool.query('SELECT * FROM owner_locations WHERE store_id = $1', [storeId])).rows[0];
    const bank = (await pool.query('SELECT * FROM owner_bank_details WHERE store_id = $1', [storeId])).rows[0];
    const printer = (await pool.query('SELECT * FROM owner_printer_settings WHERE store_id = $1', [storeId])).rows[0];
    const preferences = (await pool.query('SELECT * FROM owner_app_preferences WHERE user_id = $1', [userId])).rows[0] || {
      order_sound: true, notification_sound: true, vibration: true, language: 'English', theme: 'Light'
    };

    const categories = (await pool.query('SELECT * FROM owner_categories WHERE store_id = $1 ORDER BY display_order ASC', [storeId])).rows;
    const menu = (await pool.query('SELECT * FROM owner_menu_items WHERE store_id = $1 ORDER BY created_at ASC', [storeId])).rows;
    const staff = (await pool.query('SELECT * FROM owner_staff WHERE store_id = $1 ORDER BY created_at ASC', [storeId])).rows;
    const notifications = (await pool.query('SELECT * FROM owner_notifications WHERE store_id = $1 ORDER BY created_at DESC', [storeId])).rows.slice(0, 30);

    // Load orders
    const ordersRes = await pool.query('SELECT * FROM owner_orders WHERE store_id = $1 ORDER BY created_at DESC', [storeId]);
    const orders = [];
    for (const order of ordersRes.rows) {
      const itemsRes = await pool.query('SELECT name, quantity, price FROM owner_order_items WHERE order_id = $1', [order.id]);
      orders.push({
        id: order.order_number,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        deliveryAddress: order.delivery_address,
        distance: order.distance,
        time: order.time,
        items: itemsRes.rows,
        subtotal: order.subtotal,
        deliveryFee: order.delivery_fee,
        taxAmount: order.tax_amount,
        totalAmount: order.total_amount,
        status: order.status,
        paymentMethod: order.payment_method,
        paymentStatus: order.payment_status,
        deliveredAt: order.delivered_at
      });
    }

    // Assemble State
    const payload = {
      storeInfo: {
        name: store.name,
        type: store.type,
        cuisine: store.cuisine,
        address: store.address,
        contactNumber: store.contact_number,
        logoUrl: store.logo_url || '',
        isOpen: store.is_open
      },
      storeTimings: {
        openingTime: timings?.opening_time || '08:00 AM',
        closingTime: timings?.closing_time || '11:00 PM',
        openAllDays: timings?.open_all_days ?? true,
        customDays: timings?.custom_days || ['M', 'T', 'W', 'T', 'F', 'S', 'S']
      },
      storeLocation: {
        address: location?.address || '',
        lat: location?.lat || 12.9352,
        lng: location?.lng || 77.6244
      },
      printerSettings: {
        selectPrinter: printer?.select_printer || 'Kitchen Printer',
        paperSize: printer?.paper_size || '80 mm',
        printAutomatically: printer?.print_automatically ?? true
      },
      appPreferences: {
        orderSound: preferences.order_sound ?? true,
        notificationSound: preferences.notification_sound ?? true,
        vibration: preferences.vibration ?? true,
        language: preferences.language || 'English',
        theme: preferences.theme || 'Light'
      },
      bankDetails: {
        accountHolderName: bank?.account_holder_name || '',
        bankName: bank?.bank_name || '',
        accountNumber: bank?.account_number || '',
        ifscCode: bank?.ifsc_code || '',
        upiId: bank?.upi_id || ''
      },
      subscription: {
        planName: "Premium Plan",
        isActive: true,
        validTill: "24 Jun 2025",
        benefits: [
          "Zero commission on orders",
          "Advanced reports",
          "Priority support",
          "Unlimited menu items",
          "Marketing tools"
        ]
      },
      staff: staff.map(s => ({
        id: s.id,
        name: s.name,
        role: s.role,
        status: s.status,
        phone: s.phone,
        email: s.email,
        permissions: s.permissions,
        joinedOn: s.joined_on
      })),
      categories: categories.map(c => ({
        id: c.id,
        name: c.name,
        itemCount: menu.filter(item => item.category === c.name).length,
        iconName: c.icon_name,
        displayOrder: c.display_order
      })),
      menu: menu.map(m => ({
        id: m.id,
        name: m.name,
        price: m.price,
        category: m.category,
        isBestseller: m.is_bestseller,
        isAvailable: m.is_available,
        description: m.description || '',
        imageUrl: m.image_url || ''
      })),
      orders,
      earningsOverview: {
        totalEarnings: 8450,
        percentageChange: "+ 12.5% vs yesterday",
        orderEarnings: 7860,
        deliveryCharges: 590,
        taxes: 0,
        chartData: [
          { time: "12 AM", amount: 1000 },
          { time: "6 AM", amount: 1200 },
          { time: "12 PM", amount: 4500 },
          { time: "6 PM", amount: 6800 },
          { time: "11 PM", amount: 8450 }
        ]
      },
      earningsHistory: [
        { date: "24 May 2024", amount: 8450 },
        { date: "23 May 2024", amount: 7200 },
        { date: "22 May 2024", amount: 6980 },
        { date: "21 May 2024", amount: 5430 },
        { date: "20 May 2024", amount: 8120 },
        { date: "19 May 2024", amount: 4890 }
      ],
      reviews: [
        { id: "rev-1", customerName: "Rahul Kumar", rating: 5, date: "24 May", comment: "Great food and fast delivery!" },
        { id: "rev-2", customerName: "Priya Sharma", rating: 4, date: "23 May", comment: "Good taste. Will order again." },
        { id: "rev-3", customerName: "Amit Verma", rating: 5, date: "23 May", comment: "Best biryani in the city!" }
      ],
      customers: [
        { id: "cust-1", name: "Rahul Kumar", totalOrders: 5, totalSpend: 1250 },
        { id: "cust-2", name: "Priya Sharma", totalOrders: 8, totalSpend: 2350 },
        { id: "cust-3", name: "Amit Verma", totalOrders: 3, totalSpend: 680 },
        { id: "cust-4", name: "Neha Iyer", totalOrders: 6, totalSpend: 1890 },
        { id: "cust-5", name: "Suresh Rao", totalOrders: 4, totalSpend: 960 }
      ],
      notifications: notifications.map(n => ({
        id: n.id,
        title: n.title,
        message: n.message,
        time: n.time,
        isRead: n.is_read,
        type: n.type
      }))
    };

    return res.json({ state: payload });
  } catch (err) {
    next(err);
  }
}

// 2. Update Store Info
async function updateStoreInfo(req, res, next) {
  try {
    const storeId = await getStoreIdForUser(req.user.sub);
    const { name, type, cuisine, address, contactNumber } = req.body;
    
    await pool.query(
      `UPDATE owner_stores
       SET name = $1, type = $2, cuisine = $3, address = $4, contact_number = $5, updated_at = now()
       WHERE id = $6`,
      [name, type, cuisine, address, contactNumber, storeId]
    );

    return res.json({ message: 'Store information updated' });
  } catch (err) {
    next(err);
  }
}

// 3. Update Timings
async function updateTimings(req, res, next) {
  try {
    const storeId = await getStoreIdForUser(req.user.sub);
    const { openingTime, closingTime, openAllDays, customDays } = req.body;

    await pool.query(
      `UPDATE owner_timings
       SET opening_time = $1, closing_time = $2, open_all_days = $3, custom_days = $4, updated_at = now()
       WHERE store_id = $5`,
      [openingTime, closingTime, openAllDays, customDays, storeId]
    );

    return res.json({ message: 'Store timings updated' });
  } catch (err) {
    next(err);
  }
}

// 4. Update Location
async function updateLocation(req, res, next) {
  try {
    const storeId = await getStoreIdForUser(req.user.sub);
    const { address, lat, lng } = req.body;

    await pool.query(
      `UPDATE owner_locations
       SET address = $1, lat = $2, lng = $3, updated_at = now()
       WHERE store_id = $4`,
      [address, lat, lng, storeId]
    );

    return res.json({ message: 'Store location updated' });
  } catch (err) {
    next(err);
  }
}

// 5. Update Bank Details
async function updateBankDetails(req, res, next) {
  try {
    const storeId = await getStoreIdForUser(req.user.sub);
    const { accountHolderName, bankName, accountNumber, ifscCode, upiId } = req.body;

    await pool.query(
      `UPDATE owner_bank_details
       SET account_holder_name = $1, bank_name = $2, account_number = $3, ifsc_code = $4, upi_id = $5, updated_at = now()
       WHERE store_id = $6`,
      [accountHolderName, bankName, accountNumber, ifscCode, upiId, storeId]
    );

    return res.json({ message: 'Bank details updated' });
  } catch (err) {
    next(err);
  }
}

// 6. Update Printer Settings
async function updatePrinterSettings(req, res, next) {
  try {
    const storeId = await getStoreIdForUser(req.user.sub);
    const { selectPrinter, paperSize, printAutomatically } = req.body;

    await pool.query(
      `UPDATE owner_printer_settings
       SET select_printer = $1, paper_size = $2, print_automatically = $3, updated_at = now()
       WHERE store_id = $4`,
      [selectPrinter, paperSize, printAutomatically, storeId]
    );

    return res.json({ message: 'Printer settings updated' });
  } catch (err) {
    next(err);
  }
}

// 7. Update Preferences
async function updatePreferences(req, res, next) {
  try {
    const userId = req.user.sub;
    const { orderSound, notificationSound, vibration, language, theme } = req.body;

    await pool.query(
      `INSERT INTO owner_app_preferences (user_id, order_sound, notification_sound, vibration, language, theme, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (user_id)
       DO UPDATE SET order_sound = $2, notification_sound = $3, vibration = $4, language = $5, theme = $6, updated_at = now()`,
      [userId, orderSound, notificationSound, vibration, language, theme]
    );

    return res.json({ message: 'App preferences updated' });
  } catch (err) {
    next(err);
  }
}

// 8. Add Category
async function addCategory(req, res, next) {
  try {
    const storeId = await getStoreIdForUser(req.user.sub);
    const { name, iconName, displayOrder } = req.body;

    const catRes = await pool.query(
      `INSERT INTO owner_categories (store_id, name, icon_name, display_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, icon_name, display_order`,
      [storeId, name, iconName || '📁', parseInt(displayOrder) || 1]
    );

    return res.status(201).json({ category: catRes.rows[0] });
  } catch (err) {
    next(err);
  }
}

// 9. Add Menu Item
async function addMenuItem(req, res, next) {
  try {
    const storeId = await getStoreIdForUser(req.user.sub);
    const { name, price, category, description, available } = req.body;

    const itemRes = await pool.query(
      `INSERT INTO owner_menu_items (store_id, name, price, category, is_available, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, price, category, is_available, description`,
      [storeId, name, parseFloat(price), category, available ?? true, description]
    );

    return res.status(201).json({ menuItem: itemRes.rows[0] });
  } catch (err) {
    next(err);
  }
}

// 10. Update Menu Item
async function updateMenuItem(req, res, next) {
  try {
    const storeId = await getStoreIdForUser(req.user.sub);
    const itemId = req.params.id;
    const { name, price, category, description, available, isBestseller } = req.body;

    const itemRes = await pool.query(
      `UPDATE owner_menu_items
       SET name = COALESCE($1, name),
           price = COALESCE($2, price),
           category = COALESCE($3, category),
           description = COALESCE($4, description),
           is_available = COALESCE($5, is_available),
           is_bestseller = COALESCE($6, is_bestseller),
           updated_at = now()
       WHERE id = $7 AND store_id = $8
       RETURNING *`,
      [name, price ? parseFloat(price) : null, category, description, available, isBestseller, itemId, storeId]
    );

    if (itemRes.rows.length === 0) {
      return res.status(404).json({ message: 'Menu item not found' });
    }

    return res.json({ menuItem: itemRes.rows[0] });
  } catch (err) {
    next(err);
  }
}

// 11. Delete Menu Item
async function deleteMenuItem(req, res, next) {
  try {
    const storeId = await getStoreIdForUser(req.user.sub);
    const itemId = req.params.id;

    const delRes = await pool.query(
      `DELETE FROM owner_menu_items WHERE id = $1 AND store_id = $2 RETURNING id`,
      [itemId, storeId]
    );

    if (delRes.rows.length === 0) {
      return res.status(404).json({ message: 'Menu item not found' });
    }

    return res.json({ message: 'Menu item deleted' });
  } catch (err) {
    next(err);
  }
}

// 12. Update Order Status (accept, reject, prepare, ready, picked up)
async function updateOrderStatus(req, res, next) {
  try {
    const storeId = await getStoreIdForUser(req.user.sub);
    const orderNum = req.params.id; // e.g. #1258
    const { status } = req.body; // preparing, ready, completed, rejected

    const deliveredAt = status === 'completed' ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

    const orderRes = await pool.query(
      `UPDATE owner_orders
       SET status = $1,
           delivered_at = COALESCE($2, delivered_at),
           updated_at = now()
       WHERE order_number = $3 AND store_id = $4
       RETURNING *`,
      [status, deliveredAt, orderNum, storeId]
    );

    if (orderRes.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    return res.json({ message: `Order status updated to ${status}` });
  } catch (err) {
    next(err);
  }
}

// 13. Add Staff Member
async function addStaffMember(req, res, next) {
  try {
    const storeId = await getStoreIdForUser(req.user.sub);
    const { name, role, phone, email, permissions } = req.body;

    const joinedOn = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    const staffRes = await pool.query(
      `INSERT INTO owner_staff (store_id, name, role, status, phone, email, permissions, joined_on)
       VALUES ($1, $2, $3, 'active', $4, $5, $6, $7)
       RETURNING id, name, role, status, phone, email, permissions, joined_on`,
      [storeId, name, role, phone, email, permissions || ['Menu'], joinedOn]
    );

    return res.status(201).json({ staffMember: staffRes.rows[0] });
  } catch (err) {
    next(err);
  }
}

// 14. Delete Staff Member
async function deleteStaffMember(req, res, next) {
  try {
    const storeId = await getStoreIdForUser(req.user.sub);
    const staffId = req.params.id;

    const delRes = await pool.query(
      `DELETE FROM owner_staff WHERE id = $1 AND store_id = $2 RETURNING id`,
      [staffId, storeId]
    );

    if (delRes.rows.length === 0) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    return res.json({ message: 'Staff member removed' });
  } catch (err) {
    next(err);
  }
}

// 15. Mark All Notifications Read
async function markAllNotificationsRead(req, res, next) {
  try {
    const storeId = await getStoreIdForUser(req.user.sub);

    await pool.query(
      `UPDATE owner_notifications SET is_read = true WHERE store_id = $1`,
      [storeId]
    );

    return res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    next(err);
  }
}

// 16. Simulate Incoming Order
async function simulateIncomingOrder(req, res, next) {
  try {
    const storeId = await getStoreIdForUser(req.user.sub);
    const orderNum = `#${Math.floor(1000 + Math.random() * 9000)}`;
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Insert order
    const orderIns = await pool.query(
      `INSERT INTO owner_orders (store_id, order_number, customer_name, customer_phone, delivery_address, distance, time, subtotal, delivery_fee, tax_amount, total_amount, status, payment_method, payment_status)
       VALUES ($1, $2, 'Venkatesh Prasad', '+91 94488 12345', '456, 17th Cross, HSR Layout Sector 3, Bangalore 560102', '2.1 km away', $3, 520, 30, 26, 520, 'new', 'digital_wallet', 'completed')
       RETURNING *`,
      [storeId, orderNum, timeStr]
    );

    const orderId = orderIns.rows[0].id;

    // Insert order items
    await pool.query(
      `INSERT INTO owner_order_items (order_id, name, quantity, price)
       VALUES ($1, 'Chicken Biryani', 2, 220), ($1, 'Gulab Jamun', 1, 80)`,
      [orderId]
    );

    // Insert notification
    await pool.query(
      `INSERT INTO owner_notifications (store_id, title, message, time, is_read, type)
       VALUES ($1, 'New order received', $2, 'Just now', false, 'order')`,
      [storeId, orderNum]
    );

    return res.status(201).json({ message: 'Order simulated successfully', orderNumber: orderNum });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  initializeStoreData,
  getStoreData,
  updateStoreInfo,
  updateTimings,
  updateLocation,
  updateBankDetails,
  updatePrinterSettings,
  updatePreferences,
  addCategory,
  addMenuItem,
  updateMenuItem,
  deleteMenuItem,
  updateOrderStatus,
  addStaffMember,
  deleteStaffMember,
  markAllNotificationsRead,
  simulateIncomingOrder
};
