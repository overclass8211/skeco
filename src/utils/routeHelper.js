const { handleError } = require('../middleware/errorHandler');

const PAGE_DEFAULT = 1;
const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 9999;

/**
 * Wraps an async route handler so unhandled rejections call handleError
 * instead of crashing or hanging.
 */
function asyncRoute(fn) {
  return (req, res, next) => {
    return Promise.resolve(fn(req, res, next)).catch(err => {
      if (res.headersSent) return next(err);
      handleError(res, err);
    });
  };
}

/**
 * Build a SET clause + values array from a whitelist of fields.
 * Returns null when no updatable fields are found.
 */
function buildPatch(body, allowedFields) {
  const sql = [];
  const values = [];
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      sql.push(`${field} = ?`);
      values.push(body[field]);
    }
  }
  if (!sql.length) return null;
  return { sql: sql.join(', '), values };
}

/**
 * Parse page/limit from req.query with safe defaults.
 * Returns { page, limit, offset } — ready for SQL LIMIT/OFFSET.
 *
 *   const { page, limit, offset } = parsePage(req.query);
 *   const [rows] = await pool.query(`SELECT ... LIMIT ? OFFSET ?`, [limit, offset]);
 */
function parsePage(query) {
  const page = Math.max(1, parseInt(query.page, 10) || PAGE_DEFAULT);
  const limit = Math.min(LIMIT_MAX, Math.max(1, parseInt(query.limit, 10) || LIMIT_DEFAULT));
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Build the standard paginated response envelope.
 *
 *   res.json(pageResult(rows, total, page, limit));
 */
function pageResult(rows, total, page, limit) {
  return {
    success: true,
    data: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

module.exports = { asyncRoute, buildPatch, parsePage, pageResult };
